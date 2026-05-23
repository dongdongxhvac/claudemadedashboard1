r"""Phase 7.0 - Delta enteliWEB alarms daemon.

Long-running daemon. Two tiers:

  TIER 1 (every 5s, jittered):
    POST wsnotification/get with lastIndex=<cursor>
    -> JSON envelope {data: {result: [event,...], index: <new cursor>}}
    Append each event to delta_alarm_events. Update cursor in delta_poll_state.

  TIER 2 (every 5min, or on demand if tier 1 saw new events and an hour has
  passed since the last full sync):
    POST wsalarm/active/ with pagination
    -> XML <ActiveAlarmList><Alarm>...</Alarm></ActiveAlarmList>
    Replace delta_alarms_open snapshot.

The notification feed is the source of truth for state transitions. The
periodic full-sync exists only to reconcile drift (e.g., daemon was offline
for a stretch and missed events older than the BMS feed retention).

Run interactively:
    .\.venv\Scripts\python.exe delta_alarms_daemon.py

Run as a Windows service: see install_delta_alarms_service.ps1.
"""
from __future__ import annotations

import json
import os
import random
import signal
import sys
import time
import traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")
sys.path.insert(0, str(HERE))

from supabase_client import get_client  # noqa: E402
import delta_session  # noqa: E402

UTC = ZoneInfo("UTC")
# enteliWEB at Takeda reports timestamps in local site time. Takeda's plant
# is in NY -> America/New_York for both the alarm list "Timestamp" string
# and the notification feed timestamps.
SITE_TZ = ZoneInfo("America/New_York")

NOTIFICATION_PATH = "/enteliweb/wsnotification/get"
ACTIVE_ALARM_PATH = "/enteliweb/wsalarm/active/"

# DB query filter copied verbatim from the captured cURL. Site=Takeda
# scopes the alarm list to the Takeda subtree of the enteliWEB hierarchy.
DB_QUERY = '{"site":"Takeda"}'
FILTER_QUERY = "{}"
# The "Forest City Alarm Group" filter UUID that was selected in the user's
# captured request. Empty list returns all alarms.
FILTER_IDS = '["6a83db31-1af7-11e3-97c3-000acd20d761"]'

POLL_INTERVAL_S = 60.0         # tier 1 cadence (matches plantlog/WO; ~1 event/poll given BMS arrival rate of ~70s/event)
POLL_JITTER_S = 5.0            # +/- jitter so requests don't look mechanical
FULL_SYNC_INTERVAL_S = 300     # tier 2 cadence (5 min)
NOTIFICATION_MAX_RESULT = 200  # how many events to drain per tier-1 call
ACTIVE_PAGE_LIMIT = 500        # per-page batch when paginating full list

# Exponential backoff on errors: 1s, 2s, 5s, 15s, 60s. Cap at 60s so the
# daemon recovers quickly when whatever broke (network, BMS, supabase) comes
# back, but doesn't hammer either side while it's broken.
BACKOFF_LADDER = [1, 2, 5, 15, 60]


# ---------- shutdown handling ----------

_shutdown = False


def _on_signal(signum, _frame):
    global _shutdown
    print(f"[signal] received {signum}, shutting down", flush=True)
    _shutdown = True


signal.signal(signal.SIGINT, _on_signal)
signal.signal(signal.SIGTERM, _on_signal)


# ---------- supabase state ----------

def load_poll_state() -> dict:
    client = get_client()
    r = client.table("delta_poll_state").select("*").eq("id", 1).execute()
    if not r.data:
        # Migration seeds row id=1 but be defensive against a clean schema.
        client.table("delta_poll_state").insert({"id": 1, "session_status": "unknown"}).execute()
        return {"id": 1}
    return r.data[0]


def update_poll_state(**fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = datetime.now(UTC).isoformat()
    get_client().table("delta_poll_state").update(fields).eq("id", 1).execute()


# ---------- timestamp helpers ----------

def parse_local_to_utc(s: str | None) -> str | None:
    """enteliWEB serves timestamps as 'YYYY-MM-DD HH:MM:SS' in SITE_TZ.
    Convert to UTC ISO 8601 (with offset)."""
    if not s:
        return None
    try:
        # Some payloads include an ISO offset already (e.g. 2026-05-22T13:13:04-04:00)
        if "T" in s and (s.endswith("Z") or "+" in s[10:] or "-" in s[10:]):
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC).isoformat()
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=SITE_TZ).astimezone(UTC).isoformat()
    except (ValueError, TypeError):
        return None


def parse_raw_alarm_timestamp(s: str | None) -> str | None:
    """RawTimeStamp in the alarm list looks like '2026/05/22/5 13:13:04.80'
    where /5 is the day-of-week. Strip and parse."""
    if not s:
        return None
    try:
        # "2026/05/22/5 13:13:04.80" -> "2026/05/22 13:13:04"
        head, tail = s.split(" ", 1)
        ymd = "/".join(head.split("/")[:3])
        clock = tail.split(".")[0]
        dt = datetime.strptime(f"{ymd} {clock}", "%Y/%m/%d %H:%M:%S")
        return dt.replace(tzinfo=SITE_TZ).astimezone(UTC).isoformat()
    except (ValueError, TypeError):
        return None


# ---------- tier 1: notification feed ----------

def _coerce_int(v: Any) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _coerce_bool(v: Any) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    if s in ("true", "1", "yes"):
        return True
    if s in ("false", "0", "no"):
        return False
    return None


def map_notification(ev: dict) -> dict:
    return {
        "event_id":            int(ev["ID"]),
        "event_ref":           ev.get("EventRef") or ev.get("Reference") or "",
        "input_ref":           ev.get("InputRef"),
        "input_name":          ev.get("InputName"),
        "object_name":         ev.get("ObjectName"),
        "object_type":         ev.get("ObjectType"),
        "action":              ev.get("Action") or "UNKNOWN",
        "property":            ev.get("Property"),
        "priority":            _coerce_int(ev.get("Priority")),
        "category_id":         _coerce_int(ev.get("CategoryID") or ev.get("Category")),
        "category_name":       ev.get("CategoryName"),
        "category_color":      ev.get("CategoryColor"),
        "alarm_category_name": ev.get("alarm_category_Name"),
        "from_value":          ev.get("OldValue"),
        "to_value":            ev.get("NewValue"),
        "current_state":       ev.get("CurrentState"),
        "acked":               _coerce_bool(ev.get("Acked") if ev.get("Acked") is not None else ev.get("BAcked")),
        "user_name":           ev.get("UserName"),
        "user_id":             ev.get("User"),
        "comment":             ev.get("Comment") or ev.get("PAlarmText"),
        "event_type_text":     ev.get("EventTypeText"),
        "notify_type_text":    ev.get("NotifyTypeText"),
        "module":              ev.get("Module"),
        "device_id":           _coerce_int(ev.get("event_detail_Device")),
        "event_timestamp_utc": parse_local_to_utc(ev.get("EventTimestamp")) or datetime.now(UTC).isoformat(),
        "log_timestamp_utc":   parse_local_to_utc(ev.get("Timestamp")) or datetime.now(UTC).isoformat(),
        "raw":                 ev,
    }


def poll_notifications(last_index: int) -> tuple[list[dict], int | None, str | None]:
    """Return (event_rows, new_index, server_time). Raises on HTTP error."""
    resp, _ = delta_session.request(
        "POST", NOTIFICATION_PATH,
        data={"lastIndex": last_index, "maxResult": NOTIFICATION_MAX_RESULT},
    )
    if resp.status_code != 200:
        raise RuntimeError(f"notification HTTP {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    if str(body.get("code", "")).upper() != "OK":
        raise RuntimeError(f"notification body not OK: {body}")
    data = body.get("data") or {}
    results = data.get("result") or []
    new_index = _coerce_int(data.get("index"))
    server_time = data.get("time")
    rows = [map_notification(ev) for ev in results]
    return rows, new_index, server_time


def write_events(rows: list[dict]) -> int:
    if not rows:
        return 0
    # Upsert on PK to handle overlapping polls / replays gracefully.
    CHUNK = 200
    written = 0
    client = get_client()
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        client.table("delta_alarm_events").upsert(chunk, on_conflict="event_id").execute()
        written += len(chunk)
    return written


# ---------- tier 2: full alarm-list reconcile ----------

def _prop(el: ET.Element, name: str) -> str | None:
    """Extract <Property name=X>...</Property> by attribute name."""
    for child in el.findall("Property"):
        if child.get("name") == name:
            t = (child.text or "").strip()
            return t or None
    return None


def map_alarm(alarm_el: ET.Element, snapshot_id: str) -> dict:
    # Latest transition is the first child of TransitionList per enteliWEB
    # ordering observed in the captured XML.
    latest = None
    tlist = alarm_el.find("TransitionList")
    if tlist is not None:
        ts = tlist.findall("Transition")
        if ts:
            latest = ts[0]
    return {
        "snapshot_id":         snapshot_id,
        "event_ref":           _prop(alarm_el, "EventId") or "",
        "alarm_text":          _prop(alarm_el, "AlarmText"),
        "category":            _coerce_int(_prop(alarm_el, "Category")),
        "category_name":       _prop(alarm_el, "CategoryName"),
        "event_name":          _prop(alarm_el, "EventName"),
        "event_type_text":     _prop(alarm_el, "EventTypeText"),
        "notify_type_text":    _prop(alarm_el, "NotifyTypeText"),
        "priority":            _coerce_int(_prop(alarm_el, "Priority")),
        "parameter_text":      _prop(alarm_el, "ParameterText"),
        "to_state":            _prop(alarm_el, "ToState"),
        "in_use":              _coerce_int(_prop(alarm_el, "InUse")),
        "assigned":            _prop(alarm_el, "Assigned"),
        "module":              _prop(alarm_el, "Module"),
        "input_ref":           _prop(alarm_el, "InputRef"),
        "input_name":          _prop(alarm_el, "InputName"),
        "link_url":            _prop(alarm_el, "LinkUrl"),
        "icon_path":           _prop(alarm_el, "IconPath"),
        "raw_timestamp":       _prop(alarm_el, "RawTimeStamp"),
        "event_timestamp_utc": parse_raw_alarm_timestamp(_prop(alarm_el, "RawTimeStamp")),
        "group_name":          _prop(alarm_el, "GroupName"),
        "group_color":         _prop(alarm_el, "GroupColor"),
        "group_order":         _coerce_int(_prop(alarm_el, "GroupOrder")),
        "latest_from_state":   _prop(latest, "FromState") if latest is not None else None,
        "latest_to_state":     _prop(latest, "ToState")   if latest is not None else None,
        "latest_acked":        _coerce_bool(_prop(latest, "Acked")) if latest is not None else None,
        "latest_at_utc":       parse_local_to_utc(_prop(latest, "TimeStamp")) if latest is not None else None,
        "raw_xml":             ET.tostring(alarm_el, encoding="unicode"),
    }


def fetch_alarm_page(page: int, limit: int) -> tuple[int, list[ET.Element]]:
    """Returns (total_alarm_count_reported, list_of_<Alarm>_elements)."""
    start = (page - 1) * limit
    data = {
        "filterIds":   FILTER_IDS,
        "dbQuery":     DB_QUERY,
        "filterQuery": FILTER_QUERY,
        "query":       "",
        "page":        page,
        "start":       start,
        "limit":       limit,
    }
    resp, _ = delta_session.request("POST", ACTIVE_ALARM_PATH, data=data)
    if resp.status_code != 200:
        raise RuntimeError(f"active-alarm HTTP {resp.status_code}: {resp.text[:200]}")
    root = ET.fromstring(resp.content)
    total_el = root.find("TotalAlarmCount")
    total = _coerce_int(total_el.text) if (total_el is not None and total_el.text) else 0
    return total or 0, root.findall("Alarm")


def full_reconcile() -> tuple[int, str]:
    """Pull all open alarms, write a new snapshot. Returns (count, snapshot_id)."""
    client = get_client()
    snap = client.table("snapshots").insert({
        "kind":        "delta_alarms_open",
        "taken_at":    datetime.now(UTC).isoformat(),
        "filename":    f"api-DELTA Alarms {datetime.now(SITE_TZ).strftime('%Y-%m-%d %H-%M')}.xml",
        "source_path": "api://" + delta_session._base_url().replace("https://", "") + ACTIVE_ALARM_PATH,
    }).execute()
    snapshot_id = snap.data[0]["id"]

    page = 1
    rows: list[dict] = []
    seen_refs: set[str] = set()
    while True:
        total, alarms = fetch_alarm_page(page=page, limit=ACTIVE_PAGE_LIMIT)
        for el in alarms:
            row = map_alarm(el, snapshot_id)
            ref = row["event_ref"]
            # enteliWEB CAN return duplicates across page boundaries when the
            # active set shifts mid-fetch. Dedupe by event_ref within this run.
            if not ref or ref in seen_refs:
                continue
            seen_refs.add(ref)
            rows.append(row)
        if len(alarms) < ACTIVE_PAGE_LIMIT or len(rows) >= total:
            break
        page += 1
        if page > 100:
            raise RuntimeError(f"pagination runaway at page={page}")

    CHUNK = 200
    for i in range(0, len(rows), CHUNK):
        client.table("delta_alarms_open").insert(rows[i:i + CHUNK]).execute()
    client.table("snapshots").update({"row_count": len(rows)}).eq("id", snapshot_id).execute()
    return len(rows), snapshot_id


# ---------- main loop ----------

def main() -> int:
    print(f"[boot] delta_alarms_daemon starting at {datetime.now(UTC).isoformat()}", flush=True)

    # Initial session warm-up. Surface auth errors immediately rather than
    # crashing later in the tier-1 loop.
    try:
        if not delta_session.verify():
            print("[boot] no usable cached session; logging in", flush=True)
            delta_session.login()
        print("[boot] session ok", flush=True)
    except delta_session.SessionError as e:
        print(f"[boot] FATAL session error: {e}", file=sys.stderr, flush=True)
        return 1

    state = load_poll_state()
    last_index = state.get("last_notification_id") or 0
    last_full_sync_at = 0.0  # always trigger an initial full sync on boot
    print(f"[boot] cursor lastIndex={last_index}", flush=True)

    backoff_step = 0  # index into BACKOFF_LADDER; reset to 0 after each success

    while not _shutdown:
        # ----- tier 1: notification feed -----
        try:
            events, new_index, server_time = poll_notifications(last_index)
            written = write_events(events)
            if new_index is not None and new_index != last_index:
                update_poll_state(
                    last_notification_id=new_index,
                    last_notification_time=server_time,
                    session_status="ok",
                    last_error=None,
                )
                last_index = new_index
            if events:
                print(
                    f"[tier1] cursor={last_index} got={len(events)} written={written} "
                    f"server_time={server_time}",
                    flush=True,
                )
            backoff_step = 0
        except Exception as e:
            err = f"tier1: {e}"
            print(f"[tier1] ERROR {err}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            update_poll_state(session_status="error", last_error=err[:1000])
            time.sleep(BACKOFF_LADDER[min(backoff_step, len(BACKOFF_LADDER) - 1)])
            backoff_step = min(backoff_step + 1, len(BACKOFF_LADDER) - 1)
            continue

        # ----- tier 2: full reconcile every 5 min -----
        now_ts = time.time()
        if now_ts - last_full_sync_at >= FULL_SYNC_INTERVAL_S:
            try:
                count, snap_id = full_reconcile()
                last_full_sync_at = now_ts
                update_poll_state(
                    last_full_sync_at=datetime.now(UTC).isoformat(),
                    last_full_sync_snapshot_id=snap_id,
                )
                print(f"[tier2] full reconcile: {count} open alarms, snapshot={snap_id}", flush=True)
            except Exception as e:
                err = f"tier2: {e}"
                print(f"[tier2] ERROR {err}", file=sys.stderr, flush=True)
                traceback.print_exc(file=sys.stderr)
                update_poll_state(last_error=err[:1000])
                # Don't reset last_full_sync_at; next iteration will retry but
                # in the meantime tier 1 keeps running.

        # ----- sleep with jitter -----
        sleep_s = POLL_INTERVAL_S + random.uniform(-POLL_JITTER_S, POLL_JITTER_S)
        # Slice the sleep so SIGTERM (from nssm stop) returns quickly.
        slept = 0.0
        while slept < sleep_s and not _shutdown:
            chunk = min(0.5, sleep_s - slept)
            time.sleep(chunk)
            slept += chunk

    print(f"[shutdown] daemon exiting at {datetime.now(UTC).isoformat()}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
