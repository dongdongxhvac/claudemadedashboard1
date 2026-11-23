r"""Phase 5.1 — hourly labor poller.

Hits Cove's GQL labor endpoint directly (bypassing the date-picker constraint
that blocks today), writes a new `labor` snapshot + `labor_rows` to Supabase
each run. Combined with the existing `current_labor_snapshot` view (migration
0020), the dashboard sees the freshest hourly totals for the running week.

Schedule (set up via install_labor_poller_task.ps1):
  - Fires hourly 7:00am — 7:00pm Mon–Sat (13 runs/day, Sundays skipped here).

On auth expiry the script writes an `ingestion_log` row with status='error' and
exits non-zero so Task Scheduler marks the run as failed.

Sites whose PM-audit week is not Monday–Sunday (Binney: Sunday–Saturday,
migration 0167) also get that window's totals upserted into `audit_week_hours`
after the normal poll — a second read of the same report, nothing written to
Cove. A failure there never fails the poll.

Run manually:
    .\.venv\Scripts\python.exe labor_poller.py
    COVE_SITE=binney .venv/bin/python labor_poller.py backfill-audit-weeks [weeks=26]

Both sites also get the report one day at a time, upserted into
`audit_day_hours` (migration 0169): the PM audit Week tab's day columns.

    COVE_SITE=binney .venv/bin/python labor_poller.py backfill-audit-days [days=190]
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from datetime import date, datetime, time as dtime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

# Local import — same get_client() the watcher uses.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402
from cove_session import get_fresh_token, SessionError  # noqa: E402
from cove_sites import SITE, NETWORK_ID as _SITE_NETWORK_ID, audit_week_sunday, filename_label, sunday_skip  # noqa: E402

# Populated in main() via cove_session.get_fresh_token(). The session manager
# transparently refreshes the JWT when it's within 24h of expiry.
TOKEN: str = ""
COOKIE = os.environ.get("COVE_COOKIE", "").strip()
NETWORK_ID = _SITE_NETWORK_ID  # per COVE_SITE (cove_sites); UPark default unchanged
GQL_URL = "https://api.cove.is/gql"
EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

QUERY = """
    query GetWorkOrderAndPMTaskLaborReport($filter: GQLFilterInput!, $page: GQLPageInput!, $sortDesc: Boolean!, $networkId: ID!) {
  siteNetwork(id: $networkId) {
    workOrderAndPMTaskLaborReport(
      metric: TOTAL_HOURS
      groupBy: PERFORMED_BY
      filter: $filter
      page: $page
      sortDesc: $sortDesc
    ) {
      items {
        label
        value
      }
      page {
        end
        start
        total
      }
      totalValue
    }
  }
}
    """


# ---------- helpers ----------

def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def this_week_monday_eastern() -> datetime:
    now = datetime.now(EASTERN)
    monday = now - timedelta(days=now.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def end_of_today_eastern() -> datetime:
    now = datetime.now(EASTERN)
    return now.replace(hour=23, minute=59, second=59, microsecond=999000)


def _report_body(start_iso: str, end_iso: str) -> dict:
    return {
        "operationName": "GetWorkOrderAndPMTaskLaborReport",
        "query": QUERY,
        "variables": {
            "networkId": NETWORK_ID,
            "filter": {
                "items": [
                    {"field": "performedAt", "operator": "GREATER_THAN", "value": start_iso},
                    {"field": "performedAt", "operator": "LESS_THAN",    "value": end_iso},
                ],
            },
            "page": {"limit": 500, "skip": 0},
            "sortDesc": True,
        },
    }


def _report_headers() -> dict:
    return {
        # NOTE: Cove takes the RAW JWT here — NO "Bearer " prefix.
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
        # Cove's siteNetwork resolver authenticates via the cove_manage_auth cookie,
        # not the Authorization header (which it ignores). Send the fresh session
        # token as that cookie; the legacy static COVE_COOKIE env is no longer used.
        "Cookie": f"cove_manage_auth={TOKEN}",
    }


# ---------- PM audit week (sites where it is not Monday–Sunday) ----------

def audit_week_key(now_local: datetime) -> date:
    """The audit week key (a Monday) for a Sunday–Saturday site: the Monday
    after the Sunday that starts the week. Same rule as SQL audit_week_key()."""
    d = now_local.date() + timedelta(days=1)
    return d - timedelta(days=d.weekday())


def audit_week_window(key: date) -> tuple[datetime, datetime]:
    """Sunday 00:00 → Saturday 23:59:59.999 Eastern for the week under `key`."""
    start = datetime.combine(key - timedelta(days=1), dtime.min, tzinfo=EASTERN)
    end = datetime.combine(key + timedelta(days=5), dtime(23, 59, 59, 999000), tzinfo=EASTERN)
    return start, end


def _report_hours(start: datetime, end: datetime) -> dict[str, float]:
    """The labor report for one window: hours per person. Read-only."""
    resp = requests.post(GQL_URL, headers=_report_headers(), json=_report_body(_iso_utc(start), _iso_utc(end)), timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if "errors" in data:
        raise RuntimeError("GraphQL errors: " + " | ".join(e.get("message", "") for e in data["errors"]))
    items = (data.get("data", {}).get("siteNetwork", {}).get("workOrderAndPMTaskLaborReport", {}).get("items")) or []
    hours: dict[str, float] = {}
    for it in items:
        name = str(it.get("label") or "").strip()
        if name and it.get("value") is not None:
            hours[name] = hours.get(name, 0.0) + float(it["value"])
    return hours


def store_audit_week(client, key: date) -> tuple[int, float]:
    """Read the labor report for one audit week and upsert it into
    audit_week_hours (one row per person). Returns (people, total hours)."""
    start, end = audit_week_window(key)
    hours = _report_hours(start, end)
    if not hours:
        return 0, 0.0          # nothing logged yet (or an empty answer): leave what is stored
    stamp = datetime.now(UTC).isoformat()
    client.table("audit_week_hours").upsert(
        [{"site_code": SITE, "week_start": key.isoformat(), "assigned_to_name": n, "week_hours": round(h, 4), "as_of": stamp}
         for n, h in hours.items()],
        on_conflict="site_code,week_start,assigned_to_name",
    ).execute()
    # someone whose hours were removed in Cove since the last read
    client.table("audit_week_hours").delete().eq("site_code", SITE).eq("week_start", key.isoformat()).lt("as_of", stamp).execute()
    return len(hours), sum(hours.values())


# ---------- PM audit: hours per person per day (both sites, migration 0169) ----------

def store_audit_day(client, day: date) -> tuple[int, float]:
    """Read the labor report for one Eastern calendar day and upsert it into
    audit_day_hours. The PM audit Week tab shows these as its day columns: the
    report counts every hour by the day it was worked, including hours on work
    orders still open, which no task entry we hold shows."""
    start = datetime.combine(day, dtime.min, tzinfo=EASTERN)
    end = datetime.combine(day, dtime(23, 59, 59, 999000), tzinfo=EASTERN)
    hours = _report_hours(start, end)
    if not hours:
        return 0, 0.0          # nobody logged that day yet (or an empty answer): leave what is stored
    stamp = datetime.now(UTC).isoformat()
    client.table("audit_day_hours").upsert(
        [{"site_code": SITE, "day": day.isoformat(), "assigned_to_name": n, "hours": round(h, 4), "as_of": stamp}
         for n, h in hours.items()],
        on_conflict="site_code,day,assigned_to_name",
    ).execute()
    client.table("audit_day_hours").delete().eq("site_code", SITE).eq("day", day.isoformat()).lt("as_of", stamp).execute()
    return len(hours), sum(hours.values())


def backfill_audit_days(days: int = 190) -> int:
    """One-off: store the last `days` days (the report takes any date range)."""
    global TOKEN
    TOKEN = get_fresh_token()
    client = get_client()
    today = datetime.now(EASTERN).date()
    stored = 0
    for i in range(days):
        d = today - timedelta(days=i)
        people, total = store_audit_day(client, d)
        stored += 1 if people else 0
        if i < 14 or i % 30 == 0:
            print(f"[audit day {d}] {people} people, {total:.1f} h")
        time.sleep(0.25)
    print(f"[done] site={SITE}: {stored} of {days} days have hours")
    return 0


def backfill_audit_weeks(weeks: int = 26) -> int:
    """One-off: store the last `weeks` audit weeks (the report takes any date range)."""
    global TOKEN
    if not audit_week_sunday():
        print(f"site={SITE}: audit week is Monday–Sunday, nothing to backfill")
        return 0
    TOKEN = get_fresh_token()
    client = get_client()
    key = audit_week_key(datetime.now(EASTERN))
    for i in range(weeks):
        k = key - timedelta(days=7 * i)
        people, total = store_audit_week(client, k)
        print(f"[audit week {k}] {people} people, {total:.1f} h")
        time.sleep(0.5)
    return 0


def synthetic_filename(now_local: datetime) -> str:
    # Prefix with "api-" so it's obvious in `snapshots` / `ingestion_log` that
    # this row came from the API poller, not a dropped CSV.
    # Use HH:MM (not just hour) so manual re-runs in the same hour as the
    # scheduled task don't collide on the (kind, filename) unique index.
    return f"api-{filename_label('COVE Labor')} {now_local.strftime('%Y-%m-%d %H-%M')}.csv"


def decode_token_exp(jwt: str) -> int | None:
    try:
        seg = jwt.split(".")[1]
        seg += "=" * ((4 - len(seg) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(seg)).get("exp")
    except Exception:
        return None


# ---------- main ----------

def main() -> int:
    now_local = datetime.now(EASTERN)

    # Sunday gate. Task Scheduler fires every hour 7-19 daily; this is the
    # day-of-week filter so we don't burn auth tokens on Sundays when nothing
    # changes.
    if sunday_skip() and now_local.weekday() == 6:  # Sunday (UPark only)
        print(f"[{now_local.isoformat()}] Sunday — skipping.")
        return 0

    global TOKEN
    try:
        TOKEN = get_fresh_token()
    except SessionError as e:
        msg = f"cove_session: {e}"
        print(f"ERROR: {msg}", file=sys.stderr)
        _log_error(synthetic_filename(now_local), msg)
        return 1

    week_monday = this_week_monday_eastern()
    end = end_of_today_eastern()
    start_iso = _iso_utc(week_monday)
    end_iso = _iso_utc(end)
    filename = synthetic_filename(now_local)

    print(f"[{now_local.isoformat()}] polling labor for site={SITE} network={NETWORK_ID}, window {start_iso} -> {end_iso}")

    body = _report_body(start_iso, end_iso)
    headers = _report_headers()

    try:
        resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    except requests.RequestException as e:
        msg = f"network error: {e}"
        print(f"ERROR: {msg}", file=sys.stderr)
        _log_error(filename, msg)
        return 1

    if resp.status_code != 200:
        msg = f"HTTP {resp.status_code}: {resp.text[:500]}"
        print(f"ERROR: {msg}", file=sys.stderr)
        _log_error(filename, msg)
        return 1

    data = resp.json()
    if "errors" in data:
        msgs = " | ".join(e.get("message", "") for e in data["errors"])
        full = f"GraphQL errors: {msgs}"
        if "Not Authenticated" in msgs:
            full += " — auth rejected mid-run. Try `python cove_session.py refresh`; if that fails, re-bootstrap from DevTools."
        print(f"ERROR: {full}", file=sys.stderr)
        _log_error(filename, full)
        return 1

    report = (
        data.get("data", {})
        .get("siteNetwork", {})
        .get("workOrderAndPMTaskLaborReport", {})
    )
    items = report.get("items") or []

    # Write the snapshot first so we have an id to attach rows to. Use UTC
    # `taken_at` per Supabase convention; week_start stays in local date space.
    client = get_client()
    snap = client.table("snapshots").insert({
        "kind":        "labor",
        "site_code":   SITE,
        "taken_at":    datetime.now(UTC).isoformat(),
        "filename":    filename,
        "source_path": "api://api.cove.is/gql",
    }).execute()
    snapshot_id = snap.data[0]["id"]

    week_start_iso = week_monday.date().isoformat()
    rows = [
        {
            "snapshot_id":      snapshot_id,
            "assigned_to_name": (str(it.get("label") or "").strip() or None),
            "labor_hours":      float(it["value"]) if it.get("value") is not None else None,
            "week_start":       week_start_iso,
        }
        for it in items
    ]
    if rows:
        client.table("labor_rows").insert(rows).execute()

    client.table("snapshots").update({"row_count": len(rows)}).eq("id", snapshot_id).execute()
    client.table("ingestion_log").insert({
        "filename":    filename,
        "kind":        "labor",
        "status":      "ok",
        "rows":        len(rows),
        "snapshot_id": snapshot_id,
    }).execute()

    print(f"[ok] {filename}: {len(rows)} rows, total={report.get('totalValue')}")

    if audit_week_sunday():
        try:
            key = audit_week_key(now_local)
            people, total = store_audit_week(client, key)
            print(f"[ok] audit week {key}: {people} people, {total:.1f} h")
            # Sunday / Monday: settle the week that ended Saturday (entries typed in late)
            if now_local.weekday() in (6, 0):
                prev = key - timedelta(days=7)
                people, total = store_audit_week(client, prev)
                print(f"[ok] audit week {prev}: {people} people, {total:.1f} h")
        except Exception as e:  # never fail the poll over the audit copy
            print(f"WARN: audit week hours not stored: {e}", file=sys.stderr)

    # Hours per person per day, both sites. Each run refreshes today and the two
    # days before; the first run of the day goes back two weeks, so entries
    # typed in late still land on the day they were worked.
    try:
        today = now_local.date()
        span = 14 if now_local.hour <= 7 else 3
        got = 0
        for i in range(span):
            people, _ = store_audit_day(client, today - timedelta(days=i))
            got += 1 if people else 0
        print(f"[ok] audit days: {got} of the last {span} have hours")
    except Exception as e:  # never fail the poll over the audit copy
        print(f"WARN: audit day hours not stored: {e}", file=sys.stderr)
    return 0


def _log_error(filename: str, error_msg: str) -> None:
    """Best-effort write to ingestion_log. If Supabase is also down, log to
    stderr and move on — don't mask the original error with a logging crash."""
    try:
        get_client().table("ingestion_log").insert({
            "filename":  filename,
            "kind":      "labor",
            "status":    "error",
            "rows":      0,
            "error_msg": error_msg[:4000],
        }).execute()
    except Exception as e:
        print(f"WARN: also failed to write ingestion_log: {e}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "backfill-audit-weeks":
        sys.exit(backfill_audit_weeks(int(sys.argv[2]) if len(sys.argv) > 2 else 26))
    if len(sys.argv) > 1 and sys.argv[1] == "backfill-audit-days":
        sys.exit(backfill_audit_days(int(sys.argv[2]) if len(sys.argv) > 2 else 190))
    sys.exit(main())
