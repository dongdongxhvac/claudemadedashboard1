r"""Escort manual-run watcher — services the /binney/exp "Refresh now" button.

The page INSERTs into binney_escort_run_requests; this script (fired every
minute by binney-escort-watch.timer) claims any pending requests, runs
`systemctl start binney-escort-poller.service` (Type=oneshot, so start blocks
until the poll finishes), and stamps the outcome back on the request rows.

All pending requests are collapsed into a single poller run — five impatient
clicks still cost one Cove sweep. Exits 0 quickly when there's nothing to do,
which is the overwhelmingly common case.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402

POLLER_UNIT = "binney-escort-poller.service"


def main() -> int:
    client = get_client()

    pending = (
        client.table("binney_escort_run_requests")
        .select("id")
        .eq("status", "pending")
        .execute()
    )
    ids = [r["id"] for r in (pending.data or [])]
    if not ids:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    print(f"[{now}] {len(ids)} pending request(s) — starting {POLLER_UNIT}")
    client.table("binney_escort_run_requests").update(
        {"status": "running", "started_at": now}
    ).in_("id", ids).execute()

    proc = subprocess.run(
        ["systemctl", "start", POLLER_UNIT],
        capture_output=True, text=True, timeout=600,
    )

    done = datetime.now(timezone.utc).isoformat()
    if proc.returncode == 0:
        outcome = {"status": "done", "finished_at": done}
    else:
        detail = (proc.stderr or proc.stdout or "").strip()[:1000]
        outcome = {"status": "error", "finished_at": done,
                   "detail": f"systemctl exit {proc.returncode}: {detail}"}
        print(f"ERROR: {outcome['detail']}", file=sys.stderr)

    client.table("binney_escort_run_requests").update(outcome).in_("id", ids).execute()
    print(f"[{done}] {outcome['status']}")
    return 0 if proc.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
