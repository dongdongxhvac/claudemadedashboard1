"""Plantlog compliance check + deadline alert email.

Called at the tail of plantlog_poller.main() after a successful sync.
For each shift window whose deadline has passed today (and isn't a
weekend), check whether every "expected" building has at least one
plantlog log entry with performed_at_local <= deadline. If any are
missing AND no alert has been sent yet for that (day, window), send
an email to ALERT_RECIPIENT via Gmail SMTP using the existing
GMAIL_USER / GMAIL_APP_PASSWORD env vars.

Dedupe via the plantlog_compliance_alerts table (migration 0071):
UNIQUE(et_day, window_key) + INSERT ... ON CONFLICT DO NOTHING tells
us whether THIS poller-run is the one that should send the email.

Windows (Eastern Time):
  AM — 10:30am for the 7am crew
  PM — 17:55   for the 9:30am crew

Excluded short-codes (per user direction 2026-06-04): 20, 55, 80
(and their G- garage variants). Building plant log isn't expected
from these locations.
"""
from __future__ import annotations

import os
import smtplib
import sys
from datetime import datetime, date, time
from email.message import EmailMessage
from typing import Iterable
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
ALERT_RECIPIENT = "jie.lao@cwservices.com"

# Eastern-Time deadlines for each window.
AM_DEADLINE = time(10, 30)   # 10:30am — 7am crew morning rounds
PM_DEADLINE = time(17, 55)   #  5:55pm — 9:30am crew afternoon rounds

# Substring matchers — building_inferred strings are full street names
# like "20 Sidney St" / "80 Landsdowne St" / "55 Franklin St". Match by
# the leading street number with a non-digit boundary so "20" doesn't
# also kill "300 Mass Ave".
EXCLUDED_LEADING_NUMBERS = {"20", "55", "80"}


def _is_excluded(building_inferred: str | None) -> bool:
    if not building_inferred:
        return True
    # Pull the leading run of digits.
    head = ""
    for ch in building_inferred.strip():
        if ch.isdigit():
            head += ch
        else:
            break
    return head in EXCLUDED_LEADING_NUMBERS


def _list_expected_buildings(client) -> list[str]:
    """Distinct building_inferred values seen in the last 30d minus the
    user's exclusion list. We use observed rather than a hard-coded list
    so adding a new building to plant log doesn't require a code change."""
    res = client.table("plantlog_log_records") \
        .select("building_inferred, performed_on") \
        .gte("performed_on", (date.today().replace(day=1)).isoformat()) \
        .execute()
    seen: set[str] = set()
    for row in (res.data or []):
        b = row.get("building_inferred")
        if b and not _is_excluded(b):
            seen.add(b)
    return sorted(seen)


def _missing_buildings(client, deadline_t: time, et_day: date,
                       expected: list[str]) -> list[str]:
    """Return the buildings that have NO log entry today with
    performed_at_local <= deadline. Empty list = everyone synced."""
    res = client.table("plantlog_log_records") \
        .select("building_inferred, performed_at_local") \
        .eq("performed_on", et_day.isoformat()) \
        .execute()
    synced: set[str] = set()
    deadline_str = deadline_t.strftime("%H:%M:%S")
    for row in (res.data or []):
        b = row.get("building_inferred")
        t = row.get("performed_at_local")
        if not b or not t:
            continue
        # PostgREST returns time as 'HH:MM:SS' string; lexicographic
        # compare works because both sides are zero-padded 24h.
        if str(t)[:8] <= deadline_str:
            synced.add(b)
    return sorted(b for b in expected if b not in synced)


def _send_email(window_label: str, et_day: date, deadline_t: time,
                missing: list[str]) -> None:
    user = os.environ.get("GMAIL_USER", "").strip()
    pw = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    if not user or not pw:
        print("WARN: GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping "
              "compliance email", file=sys.stderr)
        return

    deadline_h12 = deadline_t.strftime("%I:%M %p").lstrip("0")
    subject = (f"[Plantlog compliance] {window_label} {et_day.isoformat()} "
               f"— {len(missing)} building(s) missing")
    body_lines = [
        f"Plantlog compliance check — {window_label} window "
        f"(deadline {deadline_h12} ET) for {et_day.isoformat()}.",
        "",
        f"{len(missing)} building(s) without a logged round before the deadline:",
        "",
    ]
    for b in missing:
        body_lines.append(f"  • {b}")
    body_lines.extend([
        "",
        ("This alert fires once per missed deadline; subsequent hourly "
         "poller runs today won't re-send."),
        "",
        "— Dashboard PLANTLOG-Poller",
    ])
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = ALERT_RECIPIENT
    msg["Subject"] = subject
    msg.set_content("\n".join(body_lines))

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as s:
        s.starttls()
        s.login(user, pw)
        s.send_message(msg)
    print(f"[ok] sent {window_label} compliance email to {ALERT_RECIPIENT}: "
          f"{len(missing)} missing")


def _try_claim_alert(client, et_day: date, window_key: str,
                     missing: list[str]) -> bool:
    """Insert a dedupe row. Returns True if this run is the first to claim
    the (day, window) — i.e. the email should be sent now. Returns False
    if a row already exists (someone else / a previous run handled it)."""
    try:
        res = client.table("plantlog_compliance_alerts").insert({
            "et_day": et_day.isoformat(),
            "window_key": window_key,
            "missing_buildings": missing,
            "recipient": ALERT_RECIPIENT,
        }).execute()
        return bool(res.data)
    except Exception as e:
        # UNIQUE violation = already alerted today. Anything else, log
        # and play safe (don't send a duplicate).
        msg = str(e)
        if "duplicate" in msg.lower() or "unique" in msg.lower() or "23505" in msg:
            return False
        print(f"WARN: failed to claim compliance alert "
              f"({et_day} {window_key}): {e}", file=sys.stderr)
        return False


def run_compliance_checks(client) -> None:
    """Entry point — called by plantlog_poller after a successful sync."""
    now_et = datetime.now(EASTERN)
    dow = now_et.weekday()  # 0=Mon..6=Sun
    if dow >= 5:
        print("[skip] compliance: weekend")
        return

    et_day = now_et.date()
    expected = _list_expected_buildings(client)
    if not expected:
        print("[skip] compliance: no expected buildings observed yet")
        return

    # AM window — after 10:30am
    if now_et.time() >= AM_DEADLINE:
        missing = _missing_buildings(client, AM_DEADLINE, et_day, expected)
        if missing:
            if _try_claim_alert(client, et_day, "am", missing):
                try:
                    _send_email("AM", et_day, AM_DEADLINE, missing)
                except Exception as e:
                    print(f"ERROR: AM email send failed: {e}", file=sys.stderr)
            else:
                print(f"[skip] AM compliance: already alerted today "
                      f"({len(missing)} still missing)")
        else:
            print("[ok] AM compliance: all buildings synced before "
                  "10:30am ET")

    # PM window — after 17:55
    if now_et.time() >= PM_DEADLINE:
        missing = _missing_buildings(client, PM_DEADLINE, et_day, expected)
        if missing:
            if _try_claim_alert(client, et_day, "pm", missing):
                try:
                    _send_email("PM", et_day, PM_DEADLINE, missing)
                except Exception as e:
                    print(f"ERROR: PM email send failed: {e}", file=sys.stderr)
            else:
                print(f"[skip] PM compliance: already alerted today "
                      f"({len(missing)} still missing)")
        else:
            print("[ok] PM compliance: all buildings synced before "
                  "5:55pm ET")
