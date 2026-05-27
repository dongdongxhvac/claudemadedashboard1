r"""Phase 12 — OnTheClock PTO poller.

Fetches all PTO requests from OnTheClock's BFF API and upserts them into
public.pto_records (keyed by ontheclock_request_id). Maps employees to
our users via users.ontheclock_employee_id when present.

Auth: cookie-based session from `ontheclock_session.py`. When the session
expires, this script exits non-zero and Task Scheduler History surfaces it;
re-capture cookies via `ontheclock_session.py bootstrap`.

Schedule: daily (PTO changes slow — once a day at 7am ET is plenty).
Set up via `install_pto_poller_task.ps1`.

Run manually:
    .\.venv\Scripts\python.exe pto_poller.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

sys.path.insert(0, str(HERE))
from supabase_client import get_client  # noqa: E402
from ontheclock_session import (  # noqa: E402
    SessionError,
    base_headers,
    get_account_id,
    get_cookies,
    verify,
)

BASE_URL = "https://app.ontheclock.com"

# OnTheClock's type codes → human-readable lowercase strings that the
# PtoPanel renders verbatim. Pass through unknown codes.
TYPE_MAP = {
    "VAC": "vacation",
    "SIC": "sick",
    "PER": "personal",
    "HOL": "holiday",
    "BER": "bereavement",
    "JUR": "jury duty",
    "UNP": "unpaid",
}

# OnTheClock status strings → pto_status enum values.
STATUS_MAP = {
    "Approved": "approved",
    "Pending":  "pending",
    "Denied":   "denied",
    "Cancelled": "cancelled",
    "Canceled":  "cancelled",
}


def fetch_pto_requests(account_id: str, cookies: dict[str, str]) -> list[dict[str, Any]]:
    url = f"{BASE_URL}/api/accounts/{account_id}/pto-requests"
    headers = base_headers()
    headers["Referer"] = f"{BASE_URL}/pto/requests"
    resp = requests.get(url, headers=headers, cookies=cookies, timeout=60, allow_redirects=False)
    if resp.status_code != 200:
        raise SessionError(
            f"pto-requests HTTP {resp.status_code}: {resp.text[:300]}"
        )
    data = resp.json()
    if not isinstance(data, list):
        raise SessionError(f"unexpected pto-requests payload type: {type(data).__name__}")
    return data


def fetch_pto_summary(account_id: str, cookies: dict[str, str], employee_id: str) -> dict[str, Any]:
    """Per-employee PTO balance summary. One HTTP call per engineer; no batch
    endpoint exists. Response shape (selected fields):
        {
          employeeId, employeeName,
          vacationHoursAvailable, vacationHoursUsed, vacationHoursRemaining,
          vacationRule, vacationStartDate, vacationEndDate,
          sickHoursAvailable, sickHoursUsed, sickHoursRemaining, sickRule, ...
          personalHoursAvailable, ..., holidayHoursAvailable, ...,
          earliestStartDate, latestStartDate, timeCards: [...]
        }
    Dates come as "YYYY/MM/DD" or "0001/01/01" when the bucket is disabled."""
    url = f"{BASE_URL}/api/accounts/{account_id}/pto-summary/details/{employee_id}"
    headers = base_headers()
    headers["Referer"] = f"{BASE_URL}/pto/summary/"
    resp = requests.get(url, headers=headers, cookies=cookies, timeout=60, allow_redirects=False)
    if resp.status_code != 200:
        raise SessionError(
            f"pto-summary/{employee_id} HTTP {resp.status_code}: {resp.text[:300]}"
        )
    data = resp.json()
    if not isinstance(data, dict):
        raise SessionError(f"unexpected pto-summary payload type: {type(data).__name__}")
    return data


def iso_date(s: str | None) -> str | None:
    """OnTheClock dates come as '2026-06-05T00:00:00' (no TZ). We only care
    about the calendar date, not the time portion."""
    if not s:
        return None
    return s.split("T", 1)[0]


def slash_date_to_iso(s: str | None) -> str | None:
    """Convert "YYYY/MM/DD" to "YYYY-MM-DD". Returns None for the sentinel
    "0001/01/01" that OnTheClock uses when a PTO bucket is disabled."""
    if not s or s.startswith("0001"):
        return None
    return s.replace("/", "-")


def year_from_slash_date(s: str | None) -> int | None:
    if not s or s.startswith("0001"):
        return None
    try:
        return int(s.split("/", 1)[0])
    except (ValueError, IndexError):
        return None


def load_employee_id_map(supabase) -> dict[str, str]:
    """Map OnTheClock employee_id → our public.users.id. Engineers we haven't
    mapped yet get a None user_id and the poller writes raw rows; the manager
    fills in the OTC ID via Admin → User Profiles."""
    resp = supabase.table("users").select("id, ontheclock_employee_id").not_.is_("ontheclock_employee_id", "null").execute()
    out: dict[str, str] = {}
    for row in resp.data or []:
        otc = row.get("ontheclock_employee_id")
        if otc:
            out[otc] = row["id"]
    return out


def to_record(req: dict[str, Any], user_id_by_otc: dict[str, str]) -> dict[str, Any]:
    """Project an OTC request dict into a pto_records row."""
    otc_employee_id = req.get("employeeId")
    return {
        "ontheclock_request_id":  req["id"],
        "user_id":                user_id_by_otc.get(otc_employee_id),
        "ontheclock_employee_id": otc_employee_id,
        "starts_on":              iso_date(req.get("fromDate")),
        "ends_on":                iso_date(req.get("thruDate")),
        "pto_type":               TYPE_MAP.get(req.get("type") or "", req.get("type")),
        "hours":                  req.get("totalHours"),
        "status":                 STATUS_MAP.get(req.get("status") or "", "approved"),
        "reason":                 (req.get("noteToManager") or "").strip() or None,
        "approved_by":            req.get("approvedDeniedBy"),
        "raw":                    req,
    }


def to_balance_record(summary: dict[str, Any], user_id_by_otc: dict[str, str]) -> dict[str, Any] | None:
    """Project an OTC PTO-summary dict into a pto_balances row.
    Returns None if no year can be inferred (means all buckets disabled —
    nothing useful to store)."""
    otc_employee_id = summary.get("employeeId")
    # The year comes from whichever bucket is enabled. Try in order; fall
    # back to current year if everything's disabled (rare).
    year = (
        year_from_slash_date(summary.get("vacationStartDate"))
        or year_from_slash_date(summary.get("sickStartDate"))
        or year_from_slash_date(summary.get("personalStartDate"))
        or year_from_slash_date(summary.get("holidayStartDate"))
        or year_from_slash_date(summary.get("earliestStartDate"))
    )
    if not year:
        return None  # nothing actionable
    return {
        "user_id":                user_id_by_otc.get(otc_employee_id),
        "ontheclock_employee_id": otc_employee_id,
        "year":                   year,
        # Vacation
        "vacation_accrued":   summary.get("vacationHoursAvailable"),
        "vacation_used":      summary.get("vacationHoursUsed"),
        "vacation_remaining": summary.get("vacationHoursRemaining"),
        "vacation_rule":      summary.get("vacationRule"),
        "vacation_start_date": slash_date_to_iso(summary.get("vacationStartDate")),
        "vacation_end_date":   slash_date_to_iso(summary.get("vacationEndDate")),
        # Sick
        "sick_accrued":   summary.get("sickHoursAvailable"),
        "sick_used":      summary.get("sickHoursUsed"),
        "sick_remaining": summary.get("sickHoursRemaining"),
        "sick_rule":      summary.get("sickRule"),
        "sick_start_date": slash_date_to_iso(summary.get("sickStartDate")),
        "sick_end_date":   slash_date_to_iso(summary.get("sickEndDate")),
        # Personal
        "personal_accrued":   summary.get("personalHoursAvailable"),
        "personal_used":      summary.get("personalHoursUsed"),
        "personal_remaining": summary.get("personalHoursRemaining"),
        "personal_rule":      summary.get("personalRule"),
        # Holiday
        "holiday_accrued":   summary.get("holidayHoursAvailable"),
        "holiday_used":      summary.get("holidayHoursUsed"),
        "holiday_remaining": summary.get("holidayHoursRemaining"),
        "holiday_rule":      summary.get("holidayRule"),
        # Strip the timeCards array — it's huge and pto_records already has
        # day-level detail. Keep the rest of the payload for forensics.
        "raw": {k: v for k, v in summary.items() if k != "timeCards"},
    }


def upsert_records(supabase, records: list[dict[str, Any]]) -> tuple[int, int]:
    """Upsert by ontheclock_request_id. Returns (added, updated) counts
    (best-effort — Supabase's upsert doesn't tell us which, so we look up
    existing IDs once before the upsert)."""
    if not records:
        return (0, 0)
    ids = [r["ontheclock_request_id"] for r in records]
    existing = supabase.table("pto_records").select("ontheclock_request_id").in_("ontheclock_request_id", ids).execute()
    existing_ids = {r["ontheclock_request_id"] for r in (existing.data or [])}
    added = len([r for r in records if r["ontheclock_request_id"] not in existing_ids])
    updated = len(records) - added

    # Supabase's upsert with on_conflict needs a unique constraint on the
    # target column, which we already have (ontheclock_request_id UNIQUE).
    # Process in chunks of 500 to stay under PostgREST request limits.
    for i in range(0, len(records), 500):
        chunk = records[i : i + 500]
        supabase.table("pto_records").upsert(chunk, on_conflict="ontheclock_request_id").execute()

    return (added, updated)


def upsert_balances(supabase, balances: list[dict[str, Any]]) -> int:
    """Upsert by (ontheclock_employee_id, year). Returns the row count
    written (we don't bother distinguishing inserts vs updates — balances
    are overwritten in place on every poll anyway)."""
    if not balances:
        return 0
    supabase.table("pto_balances").upsert(
        balances,
        on_conflict="ontheclock_employee_id,year",
    ).execute()
    return len(balances)


def write_poll_state(supabase, status: str, seen: int, added: int, updated: int, error: str | None = None) -> None:
    supabase.table("pto_poll_state").upsert(
        {
            "id": 1,
            "last_run_at":     datetime.now(timezone.utc).isoformat(),
            "last_run_status": status,
            "last_error":      error,
            "records_seen":    seen,
            "records_added":   added,
            "records_updated": updated,
            "updated_at":      datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="id",
    ).execute()


def main() -> int:
    supabase = get_client()
    seen = added = updated = 0
    try:
        account_id = get_account_id()
        cookies    = get_cookies()
        if not verify(cookies, account_id):
            raise SessionError(
                "Session not alive — re-capture cookies via "
                "ontheclock_session.py bootstrap."
            )
        requests_list = fetch_pto_requests(account_id, cookies)
        seen = len(requests_list)

        user_id_by_otc = load_employee_id_map(supabase)
        records = [to_record(r, user_id_by_otc) for r in requests_list if r.get("id")]
        added, updated = upsert_records(supabase, records)

        # Per-employee balance summaries — one HTTP call per known OTC
        # employee. Cap the set of IDs to:
        #   1. Active engineers we've mapped in users.ontheclock_employee_id
        #   2. Anyone seen in the requests payload (catches active employees
        #      who aren't in our users table yet, e.g. Rodney / Benny)
        otc_ids_to_fetch = set(user_id_by_otc.keys())
        for r in requests_list:
            otc_id = r.get("employeeId")
            if otc_id:
                otc_ids_to_fetch.add(otc_id)

        balance_records: list[dict[str, Any]] = []
        balance_errors:  list[str] = []
        for otc_id in sorted(otc_ids_to_fetch):
            try:
                summary = fetch_pto_summary(account_id, cookies, otc_id)
                bal = to_balance_record(summary, user_id_by_otc)
                if bal:
                    balance_records.append(bal)
            except SessionError as e:
                balance_errors.append(f"{otc_id}: {e}")
        balances_written = upsert_balances(supabase, balance_records)

        write_poll_state(supabase, status="ok", seen=seen, added=added, updated=updated)
        unmapped     = sum(1 for r in records          if r["user_id"] is None)
        bal_unmapped = sum(1 for b in balance_records  if b["user_id"] is None)
        print(
            f"OK: requests {seen} fetched ({added} added, {updated} updated, {unmapped} unmapped) | "
            f"balances {balances_written} written ({bal_unmapped} unmapped)"
        )
        if balance_errors:
            print(f"WARN: {len(balance_errors)} balance fetch errors: {balance_errors[:3]}", file=sys.stderr)
        return 0
    except SessionError as e:
        msg = f"SessionError: {e}"
        print(msg, file=sys.stderr)
        write_poll_state(supabase, status="auth_error", seen=seen, added=added, updated=updated, error=msg)
        return 2
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        print(msg, file=sys.stderr)
        write_poll_state(supabase, status="error", seen=seen, added=added, updated=updated, error=msg)
        return 1


if __name__ == "__main__":
    sys.exit(main())
