r"""Phase 5.1 — hourly labor poller.

Hits Cove's GQL labor endpoint directly (bypassing the date-picker constraint
that blocks today), writes a new `labor` snapshot + `labor_rows` to Supabase
each run. Combined with the existing `current_labor_snapshot` view (migration
0020), the dashboard sees the freshest hourly totals for the running week.

Schedule (set up via install_labor_poller_task.ps1):
  - Fires hourly 7:00am — 7:00pm Mon–Sat (13 runs/day, Sundays skipped here).

On auth expiry the script writes an `ingestion_log` row with status='error' and
exits non-zero so Task Scheduler marks the run as failed.

Run manually:
    .\.venv\Scripts\python.exe labor_poller.py
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

# Local import — same get_client() the watcher uses.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402
from cove_session import get_fresh_token, SessionError  # noqa: E402

# Populated in main() via cove_session.get_fresh_token(). The session manager
# transparently refreshes the JWT when it's within 24h of expiry.
TOKEN: str = ""
COOKIE = os.environ.get("COVE_COOKIE", "").strip()
NETWORK_ID = os.environ.get("COVE_NETWORK_ID", "OoxMP8BZJF").strip()
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


def synthetic_filename(now_local: datetime) -> str:
    # Prefix with "api-" so it's obvious in `snapshots` / `ingestion_log` that
    # this row came from the API poller, not a dropped CSV.
    # Use HH:MM (not just hour) so manual re-runs in the same hour as the
    # scheduled task don't collide on the (kind, filename) unique index.
    return f"api-COVE Labor {now_local.strftime('%Y-%m-%d %H-%M')}.csv"


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
    if now_local.weekday() == 6:  # Sunday
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

    print(f"[{now_local.isoformat()}] polling labor, window {start_iso} -> {end_iso}")

    body = {
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

    headers = {
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
    }
    if COOKIE:
        headers["Cookie"] = COOKIE

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
    sys.exit(main())
