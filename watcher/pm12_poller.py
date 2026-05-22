r"""Phase 5.2 — hourly PM12 poller.

Hits Cove's GetPMTasksPage GQL directly (no Chrome / no CSV), paginates through
all open PM tasks, writes a fresh `pm12` snapshot + `pm_rows` to Supabase each
run. Mirrors labor_poller.py's structure for consistency.

Filter matches the user's PM12 bookmark: status in (in_progress, on_hold, to_do).

Schedule (set up via install_pm12_poller_task.ps1):
  - Fires hourly 7:00am - 7:00pm daily (script does NOT skip Sunday — PMs can
    move on weekends, unlike labor totals).

Run manually:
    .\.venv\Scripts\python.exe pm12_poller.py
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402
from classify import classify_pm  # noqa: E402
from cove_session import get_fresh_token, SessionError  # noqa: E402

# Populated in main() via cove_session.get_fresh_token(). The session manager
# transparently refreshes the JWT when it's within 24h of expiry.
TOKEN: str = ""
COOKIE = os.environ.get("COVE_COOKIE", "").strip()
NETWORK_ID = os.environ.get("COVE_NETWORK_ID", "OoxMP8BZJF").strip()
GQL_URL = "https://api.cove.is/gql"
EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# Same query string the Cove web app sends. Preserved verbatim (whitespace
# included) so the operation hash matches if Cove ever switches to APQ.
QUERY = """
    query GetPMTasksPage($networkId: ID!, $page: GQLPageInput, $sortBy: GQLSortByInput, $filter: GQLFilterInput) {
  siteNetwork(id: $networkId) {
    pmTasks(page: $page, sortBy: $sortBy, filter: $filter) {
      items {
        ...PMTaskTable
      }
      page {
        total
      }
    }
  }
}

    fragment PMTaskTable on GQLPMTask {
  altId
  assignee {
    email
    firstName
    id
    lastName
  }
  cadence {
    duration
    period
  }
  category {
    id
    name
  }
  completedOn
  createdAt
  dueDate
  equipment {
    building {
      id
      name
    }
    category {
      id
      name
    }
    floor {
      id
      name
    }
    id
    name
    suite {
      id
      name
    }
  }
  estimatedHours
  groups(sortBy: {field: "name", desc: false}) {
    items {
      id
      name
    }
  }
  hoursLogged
  id
  linkedTasks {
    altId
    id
  }
  name
  site {
    id
    name
    region
  }
  status
  type
  updatedAt
}
    """

# Mirror the user's PM12 bookmark (verified from DevTools 2026-05-19):
#   - status:   open + completed (dashboard sees recently-finished PMs too)
#   - assignee: only the 12 engineers/managers on the COVE team
#   - dueDate:  rolling N-day lookback from today (bump PM_DUE_LOOKBACK_DAYS
#               to widen or narrow the window — no need to keep editing dates)
#
# If the team roster changes, edit PM_ASSIGNEE_IDS — Cove user IDs aren't
# discoverable from this script alone, you'd need to recapture the bookmark's
# fetch from DevTools.
PM_ASSIGNEE_IDS = [
    "thGxmdCU3x", "uv9FFWuCIT", "V0cfCtkNuC", "8ZVqd2HExb",
    "D6ZvMf8Mcj", "RxaNCAOXew", "IKIPg7ql0G", "9PAgDPhuXE",
    "uQNAPN9ipb", "hGCSa1lcK5", "IrQac3eAnX", "yGVXKlnu4F",
]
PM_DUE_LOOKBACK_DAYS = 60

# Cove status enum values. Split so the poller can fetch open (for pm_rows
# snapshot) and closed (for pm_close_events log) in separate paginated calls.
OPEN_STATUSES   = ["in_progress", "on_hold", "to_do"]
CLOSED_STATUSES = ["completed"]

SORT_BY = {"desc": True, "field": "createdAt"}
PAGE_LIMIT = 100


def compute_due_date_start() -> str:
    """Midnight Eastern, N days before today, expressed as the UTC ISO string
    Cove's GQL expects (e.g. '2026-03-20T04:00:00.000Z')."""
    today_eastern = datetime.now(EASTERN).replace(hour=0, minute=0, second=0, microsecond=0)
    start_eastern = today_eastern - timedelta(days=PM_DUE_LOOKBACK_DAYS)
    return start_eastern.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def build_pm_filter(statuses: list[str]) -> dict:
    return {
        "items": [
            {"field": "status",   "operator": "CONTAINED_IN", "value": statuses},
            {"field": "assignee", "operator": "CONTAINED_IN", "value": PM_ASSIGNEE_IDS},
            {"field": "dueDate",  "operator": "DATE_RANGE",   "value": {"start": compute_due_date_start()}},
        ],
        "orItems": [],
    }


# ---------- helpers ----------

def hour_label(dt: datetime) -> str:
    h = dt.hour
    period = "pm" if h >= 12 else "am"
    h12 = h % 12 or 12
    return f"{h12}{period}"


def synthetic_filename(now_local: datetime) -> str:
    return f"api-COVE PM12 {now_local.strftime('%Y-%m-%d %H-%M')}.csv"


def decode_token_exp(jwt: str) -> int | None:
    try:
        seg = jwt.split(".")[1]
        seg += "=" * ((4 - len(seg) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(seg)).get("exp")
    except Exception:
        return None


# Cove's status enum (snake_case) -> the human-readable strings the CSV uses
# (so dashboard queries that filter on status keep matching across both paths).
_STATUS_HUMAN = {
    "in_progress": "In Progress",
    "on_hold":     "On Hold",
    "to_do":       "To Do",
    "completed":   "Completed",
    "cancelled":   "Cancelled",
    "canceled":    "Cancelled",
}

def humanize_status(s: str | None) -> str | None:
    if not s:
        return None
    return _STATUS_HUMAN.get(s, " ".join(w.capitalize() for w in s.split("_")))


# Format cadence as "1 month" / "3 months" / "1 year" etc to match the CSV's
# Interval column. period comes back as an enum like "MONTH" / "WEEK".
def format_interval(cadence: dict | None) -> str | None:
    if not cadence:
        return None
    dur = cadence.get("duration")
    per = cadence.get("period")
    if dur is None or not per:
        return None
    unit = str(per).lower()
    plural = "s" if dur != 1 else ""
    return f"{dur} {unit}{plural}"


def assignee_name(assignee: dict | None) -> str | None:
    if not assignee:
        return None
    fn = (assignee.get("firstName") or "").strip()
    ln = (assignee.get("lastName") or "").strip()
    name = f"{fn} {ln}".strip()
    return name or None


def safe_get(d: dict | None, *keys):
    """Walk nested dicts safely; returns None at the first missing/None hop."""
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


def iso_date(s: str | None) -> str | None:
    """Convert ISO-8601 (with or without time) to YYYY-MM-DD."""
    if not s:
        return None
    try:
        # GQL gives full timestamps for createdAt/dueDate (e.g. "2026-05-18T...");
        # for date-only columns we just want the date portion.
        return s[:10] if "T" in s else s
    except Exception:
        return None


def map_pm_task(item: dict, snapshot_id: str) -> dict:
    name = item.get("name")
    return {
        "snapshot_id":        snapshot_id,
        "task_no":            item.get("altId"),
        "due_date":           iso_date(item.get("dueDate")),
        "site":               safe_get(item, "site", "name"),
        "building_code":      safe_get(item, "equipment", "building", "name"),
        "equipment":          safe_get(item, "equipment", "name"),
        "name":               name,
        "interval":           format_interval(item.get("cadence")),
        "status":             humanize_status(item.get("status")),
        "assigned_to_name":   assignee_name(item.get("assignee")),
        "open_date":          iso_date(item.get("createdAt")),
        "category":           safe_get(item, "category", "name"),
        "est_labor_hours":    item.get("estimatedHours"),
        "suite":              safe_get(item, "equipment", "suite", "name"),
        "labor_hours":        item.get("hoursLogged"),
        "equipment_category": safe_get(item, "equipment", "category", "name"),
        "updated_at_cmms":    item.get("updatedAt"),
        "object_id":          safe_get(item, "equipment", "id"),
        "pm_type":            classify_pm(name),
        "cmms_type":          item.get("type"),
    }


def map_close_event(item: dict, snapshot_id: str) -> dict:
    """Build a pm_close_events row from a Completed Cove PM task.

    Identity in the table is (task_no, completed_on) — a reopen + reclose creates
    a new row, which is the desired behavior. completedOn comes straight from
    Cove's authoritative close time."""
    name = item.get("name")
    return {
        "task_no":            item.get("altId"),
        "object_id":          safe_get(item, "equipment", "id"),
        "completed_on":       item.get("completedOn"),
        "source_snapshot_id": snapshot_id,
        "site":               safe_get(item, "site", "name"),
        "building_code":      safe_get(item, "equipment", "building", "name"),
        "suite":              safe_get(item, "equipment", "suite", "name"),
        "equipment":          safe_get(item, "equipment", "name"),
        "equipment_category": safe_get(item, "equipment", "category", "name"),
        "category":           safe_get(item, "category", "name"),
        "assigned_to_name":   assignee_name(item.get("assignee")),
        "task_name":          name,
        "due_date":           iso_date(item.get("dueDate")),
        "open_date":          iso_date(item.get("createdAt")),
        "interval":           format_interval(item.get("cadence")),
        "pm_type":            classify_pm(name),
        "cmms_type":          item.get("type"),
        "labor_hours":        item.get("hoursLogged"),
        "est_labor_hours":    item.get("estimatedHours"),
    }


def post_gql(body: dict) -> dict:
    headers = {
        # Raw JWT, NO "Bearer " prefix — Cove's auth quirk (see reference_cove_api.md).
        "Authorization": TOKEN,
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": "https://manage.cove.is",
        "Referer": "https://manage.cove.is/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
    }
    if COOKIE:
        headers["Cookie"] = COOKIE
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    return resp.status_code, resp


def fetch_all_pm_tasks(statuses: list[str]) -> list[dict]:
    """Paginate through every PM task matching the bookmark filter. Cove's UI
    sends limit=25 but for a poller we want fewer round-trips, so PAGE_LIMIT=100."""
    pm_filter = build_pm_filter(statuses)
    print(f"  status={statuses}  dueDate >= {pm_filter['items'][2]['value']['start']} (rolling {PM_DUE_LOOKBACK_DAYS}d)")
    out: list[dict] = []
    skip = 0
    while True:
        body = {
            "operationName": "GetPMTasksPage",
            "query": QUERY,
            "variables": {
                "networkId": NETWORK_ID,
                "filter": pm_filter,
                "page": {"limit": PAGE_LIMIT, "skip": skip},
                "sortBy": SORT_BY,
            },
        }
        status, resp = post_gql(body)
        if status != 200:
            raise RuntimeError(f"HTTP {status}: {resp.text[:500]}")
        data = resp.json()
        if "errors" in data:
            msgs = " | ".join(e.get("message", "") for e in data["errors"])
            raise RuntimeError(f"GraphQL errors: {msgs}")
        page = safe_get(data, "data", "siteNetwork", "pmTasks") or {}
        items = page.get("items") or []
        total = safe_get(page, "page", "total") or 0
        out.extend(items)
        print(f"  fetched skip={skip} got={len(items)} total_so_far={len(out)}/{total}")
        if len(items) == 0 or len(out) >= total:
            break
        skip += PAGE_LIMIT
        # Safety: stop if the response is misbehaving so we don't loop forever.
        if skip > 50_000:
            raise RuntimeError(f"pagination runaway at skip={skip}")
    return out


# ---------- main ----------

def main() -> int:
    now_local = datetime.now(EASTERN)
    filename = synthetic_filename(now_local)

    # Sundays — skip. Task Scheduler still fires this every day so this is
    # the day-of-week gate.
    if now_local.weekday() == 6:
        print(f"[{now_local.isoformat()}] Sunday — skipping.")
        return 0

    global TOKEN
    try:
        TOKEN = get_fresh_token()
    except SessionError as e:
        msg = f"cove_session: {e}"
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    print(f"[{now_local.isoformat()}] polling pm12 (open snapshot + closes-since-last)")

    client = get_client()

    # Look up the most recent pm12 snapshot's taken_at. Any closed PM whose
    # completedOn is AFTER this is a new close we haven't logged yet. On the
    # very first run this is None and we'll insert every closed task in window
    # — the UNIQUE (task_no, completed_on) constraint protects subsequent runs.
    prev = (
        client.table("snapshots")
        .select("taken_at")
        .eq("kind", "pm12")
        .order("taken_at", desc=True)
        .limit(1)
        .execute()
    )
    since_iso = prev.data[0]["taken_at"] if prev.data else None
    print(f"  since_iso={since_iso}")

    try:
        open_items   = fetch_all_pm_tasks(OPEN_STATUSES)
        closed_items = fetch_all_pm_tasks(CLOSED_STATUSES)
    except Exception as e:
        msg = str(e)
        if "Not Authenticated" in msg:
            msg += " — auth rejected mid-run. Try `python cove_session.py refresh`; if that fails, re-bootstrap from DevTools."
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    # ----- pm_rows: open work queue only (To Do / In Progress / On Hold) -----
    snap = client.table("snapshots").insert({
        "kind":        "pm12",
        "taken_at":    datetime.now(UTC).isoformat(),
        "filename":    filename,
        "source_path": "api://api.cove.is/gql",
    }).execute()
    snapshot_id = snap.data[0]["id"]

    rows = [map_pm_task(it, snapshot_id) for it in open_items]
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        client.table("pm_rows").insert(rows[i:i + CHUNK]).execute()

    # ----- pm_close_events: only PMs newly closed since the previous snapshot -----
    events = []
    for it in closed_items:
        co = it.get("completedOn")
        if not co:
            continue                        # reopened / never closed — skip
        if since_iso and co <= since_iso:
            continue                        # already captured in a prior run
        events.append(map_close_event(it, snapshot_id))

    for i in range(0, len(events), CHUNK):
        client.table("pm_close_events").upsert(
            events[i:i + CHUNK],
            on_conflict="task_no,completed_on",
        ).execute()

    client.table("snapshots").update({"row_count": len(rows)}).eq("id", snapshot_id).execute()
    client.table("ingestion_log").insert({
        "filename":    filename,
        "kind":        "pm12",
        "status":      "ok",
        "rows":        len(rows),
        "snapshot_id": snapshot_id,
    }).execute()

    print(f"[ok] {filename}: {len(rows)} open rows, {len(events)} new closes")
    return 0


def _log_error(filename: str, error_msg: str) -> None:
    try:
        get_client().table("ingestion_log").insert({
            "filename":  filename,
            "kind":      "pm12",
            "status":    "error",
            "rows":      0,
            "error_msg": error_msg[:4000],
        }).execute()
    except Exception as e:
        print(f"WARN: also failed to write ingestion_log: {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
