r"""University Park Overtime API poller — feeds §11b on /upark/manager and
the TV2 overtime strip.

Steve's (BMR) OT viewer publishes the crew's overtime schedule — Outlook
calendar events in off-hours plus jobs added through its editor, each with a
number of spaces and the engineers who volunteered — at

    GET https://vpn-1.tail198a37.ts.net/api/v1/ot?days=14
    Authorization: Bearer <key>

The host is on Tailscale and the API has no CORS headers by design: the
browser can't call it and the key must never ship in the web bundle. So this
runs server-side on a timer (every 5 minutes — the handoff asks for no more
than one read a minute, "every few minutes is enough") and mirrors the jobs
into Supabase `ot_api_jobs`: upsert on the API's job id, then delete rows
this run no longer saw. A job's id changes when its event is moved in
Outlook, so the old id simply disappears and the new one appears. Each run
also writes an `ot_api_syncs` row (ok or error, with the raw payload) that
the UI reads for "synced N min ago".

Read-only. The API also takes writes (add job, volunteer, spaces); nothing
here uses them.

watcher/.env:
    SUPABASE_URL / SUPABASE_SERVICE_KEY   (as for every poller)
    UPARK_OT_API_KEY=upot_...             the key from the OT viewer — never commit it
    UPARK_OT_API_BASE=https://vpn-1.tail198a37.ts.net   (optional, default)
    UPARK_OT_API_DAYS=14                  (optional, 1-90)
    UPARK_OT_SYNC_KEEP_DAYS=7             (optional; older sync rows are trimmed)

The host running this must be on the same tailnet as the OT viewer (the
"vpn-1" node) — check with the quick curl in Steve's handoff before
installing the timer.

Schedule (every 5 minutes):
  - Hetzner VM / Linux: sudo ./install_ot_api_poller_linux.sh   (systemd timer)
  - Mac:                ./install_ot_api_poller_mac.sh           (launchd)
  - Windows:            .\install_ot_api_poller_task.ps1          (Task Scheduler)

Run manually:
    ./.venv/bin/python ot_api_poller.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402

EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

API_BASE = os.environ.get("UPARK_OT_API_BASE", "https://vpn-1.tail198a37.ts.net").rstrip("/")
API_KEY = os.environ.get("UPARK_OT_API_KEY", "").strip()
WINDOW_DAYS = max(1, min(90, int(os.environ.get("UPARK_OT_API_DAYS", "14") or 14)))
SYNC_KEEP_DAYS = int(os.environ.get("UPARK_OT_SYNC_KEEP_DAYS", "7") or 7)
TIMEOUT_S = 25


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _ts(v) -> str | None:
    """Pass the API's ISO-8601-with-offset strings straight through; Postgres
    parses the offset into timestamptz. Anything unparseable becomes NULL."""
    s = _str(v)
    if not s:
        return None
    try:
        datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return s


def fetch_ot() -> tuple[dict, str]:
    url = f"{API_BASE}/api/v1/ot?days={WINDOW_DAYS}"
    r = requests.get(
        url,
        headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
        timeout=TIMEOUT_S,
    )
    if r.status_code != 200:
        body = ""
        try:
            body = (r.json() or {}).get("error") or ""
        except ValueError:
            body = r.text[:200]
        hint = {
            401: "missing/invalid key",
            403: "key not allowed",
            429: "rate limited — the timer is too frequent",
        }.get(r.status_code, "")
        raise RuntimeError(f"GET {url} -> {r.status_code} {hint} {body}".strip())
    data = r.json()
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise RuntimeError(f"GET {url}: unexpected payload shape (no jobs list)")
    return data, url


def map_job(j: dict, fetched_at: str) -> dict | None:
    job_id = _str(j.get("id"))
    start = _ts(j.get("start"))
    if not job_id or not start:
        return None
    spaces = _int(j.get("spaces"))
    volunteers = j.get("volunteers") if isinstance(j.get("volunteers"), list) else []
    filled = _int(j.get("filled"), len(volunteers))
    open_spaces = _int(j.get("open"), max(0, spaces - filled))
    status = _str(j.get("status")) or ("full" if open_spaces == 0 else "partial" if filled else "unfilled")
    return {
        "id":          job_id,
        "title":       _str(j.get("title")) or "",
        "location":    _str(j.get("location")),
        "source":      _str(j.get("source")),
        "notes":       _str(j.get("notes")),
        "start_at":    start,
        "end_at":      _ts(j.get("end")),
        "all_day":     bool(j.get("all_day", False)),
        "when_text":   _str(j.get("when")),
        "spaces":      spaces,
        "filled":      filled,
        "open_spaces": open_spaces,
        "status":      status,
        "volunteers":  [
            {
                "name":      _str(v.get("name")),
                "email":     _str(v.get("email")),
                "signed_up": _ts(v.get("signed_up")),
            }
            for v in volunteers if isinstance(v, dict)
        ],
        "raw":         j,
        "fetched_at":  fetched_at,
    }


def main() -> int:
    now_local = datetime.now(EASTERN)
    print(f"[{now_local.isoformat()}] polling UPark OT API (days={WINDOW_DAYS})")

    if not API_KEY:
        print("ERROR: UPARK_OT_API_KEY is not set in watcher/.env", file=sys.stderr)
        return 1

    client = get_client()
    fetched_at = datetime.now(UTC).isoformat()

    try:
        data, url = fetch_ot()
    except Exception as e:  # network, auth, shape — all land in the sync log
        msg = str(e)
        print(f"ERROR: {msg}", file=sys.stderr)
        try:
            client.table("ot_api_syncs").insert({
                "fetched_at": fetched_at,
                "status":     "error",
                "error_msg":  msg[:4000],
                "source_url": f"{API_BASE}/api/v1/ot?days={WINDOW_DAYS}",
            }).execute()
        except Exception as e2:
            print(f"WARN: also failed to write ot_api_syncs: {e2}", file=sys.stderr)
        return 1

    rows = [m for m in (map_job(j, fetched_at) for j in data["jobs"] if isinstance(j, dict)) if m]
    skipped = len(data["jobs"]) - len(rows)
    seen_ids = [r["id"] for r in rows]

    # Upsert this run's set, then drop every job the run didn't see (closed,
    # cancelled, moved in Outlook → new id, or fell out of the window).
    CHUNK = 200
    for i in range(0, len(rows), CHUNK):
        client.table("ot_api_jobs").upsert(rows[i:i + CHUNK], on_conflict="id").execute()
    if seen_ids:
        client.table("ot_api_jobs").delete().not_.in_("id", seen_ids).execute()
    else:
        client.table("ot_api_jobs").delete().neq("id", "").execute()

    warnings = data.get("warnings") if isinstance(data.get("warnings"), list) else []
    team = data.get("team") if isinstance(data.get("team"), list) else []
    client.table("ot_api_syncs").insert({
        "fetched_at":   fetched_at,
        "status":       "ok",
        "source_url":   url,
        "generated_at": _ts(data.get("generated")),
        "window_days":  _int(data.get("window_days"), WINDOW_DAYS),
        "job_count":    len(rows),
        "warnings":     warnings,
        "team":         team,
        "payload":      data,
    }).execute()

    # Trim old sync rows (each carries the full payload).
    cutoff = (datetime.now(UTC) - timedelta(days=SYNC_KEEP_DAYS)).isoformat()
    try:
        client.table("ot_api_syncs").delete().lt("fetched_at", cutoff).execute()
    except Exception as e:
        print(f"WARN: sync-log trim failed: {e}", file=sys.stderr)

    open_total = sum(r["open_spaces"] for r in rows)
    print(f"[ok] {len(rows)} jobs ({open_total} open spaces), {skipped} skipped, {len(warnings)} API warnings")
    for w in warnings:
        print(f"  warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
