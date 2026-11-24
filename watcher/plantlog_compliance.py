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
  AM — 10:30am for the 7am crew: any entry today at or before 10:30
  PM — 17:55   for the 9:30am crew: an AFTERNOON entry, noon to 17:55
       (user 2026-11-23 — a morning entry no longer satisfies the PM
       window; "afternoon = noon or later" is the same split migration
       0081 uses for the dashboard's has_pm flag)

AM recheck (user 2026-11-23): tablets often upload hours after the round,
so the 11:00 AM alert lists buildings whose round was done on time but had
not reached us yet. The PM run therefore looks at every building the AM
alert listed again and reports, in the PM email, which are in now (and
when their first entry was) and which still have nothing. That email goes
out whenever an AM alert was sent that day, even with nothing missing in
the PM window.

History (user 2026-11-23, "keep the log too by buildings"): every run also
rewrites plantlog_compliance_log (migration 0170) for the past 7 days — one
row per (day, window, building) with on_time / synced_late / late / missing,
the first entry time and when it reached the dashboard.

Excluded short-codes (per user direction 2026-06-04): 20, 55, 80
(and their G- garage variants). Building plant log isn't expected
from these locations.
"""
from __future__ import annotations

import os
import smtplib
import sys
from datetime import datetime, date, time, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
ALERT_RECIPIENT = "jie.lao@cwservices.com"

# Eastern-Time deadlines for each window.
AM_DEADLINE = time(10, 30)   # 10:30am — 7am crew morning rounds
PM_DEADLINE = time(17, 55)   #  5:55pm — 9:30am crew afternoon rounds
PM_ROUND_START = time(12, 0)  # an entry from noon on belongs to the PM round

# The deadline check runs on the first hourly poll after each deadline. When
# no alert row records the exact moment, the log assumes these.
NOMINAL_CHECK = {"am": time(11, 5), "pm": time(18, 5)}
# The records report reaches back 7 days; older days cannot change any more.
LOG_LOOKBACK_DAYS = 7

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


EXPECTED_LOOKBACK_DAYS = 30
PAGE = 1000  # PostgREST caps every response at 1000 rows


def _list_expected_buildings(client, et_day: date) -> list[str]:
    """Distinct buildings with a logged round in the last 30 days minus the
    user's exclusion list. We use observed rather than a hard-coded list
    so adding a new building to plant log doesn't require a code change.

    Reads the per-(building, day) view — at most ~17 buildings x 30 days,
    so the answer never depends on which 1000 raw rows PostgREST returns."""
    since = et_day - timedelta(days=EXPECTED_LOOKBACK_DAYS)
    seen: set[str] = set()
    offset = 0
    while True:
        res = client.table("v_plantlog_building_daily") \
            .select("building, et_day") \
            .gte("et_day", since.isoformat()) \
            .order("et_day").order("building") \
            .range(offset, offset + PAGE - 1) \
            .execute()
        data = res.data or []
        for row in data:
            b = row.get("building")
            if b and not _is_excluded(b):
                seen.add(b)
        if len(data) < PAGE:
            break
        offset += PAGE
    return sorted(seen)


def _first_entries_today(client, et_day: date) -> tuple[dict[str, str], dict[str, str]]:
    """(building -> time of its earliest log entry today,
        building -> time of its earliest AFTERNOON entry today).
    Times are 'HH:MM:SS' ET; a building with no such entry is absent."""
    first: dict[str, str] = {}
    first_pm: dict[str, str] = {}
    pm_start = PM_ROUND_START.strftime("%H:%M:%S")
    offset = 0
    while True:
        res = client.table("plantlog_log_records") \
            .select("id, building_inferred, performed_at_local") \
            .eq("performed_on", et_day.isoformat()) \
            .not_.is_("building_inferred", "null") \
            .order("id") \
            .range(offset, offset + PAGE - 1) \
            .execute()
        data = res.data or []
        for row in data:
            b = row["building_inferred"]
            t = str(row.get("performed_at_local") or "")[:8]
            # PostgREST returns time as 'HH:MM:SS'; lexicographic compare
            # works because it is zero-padded 24h.
            if not t:
                continue
            if b not in first or t < first[b]:
                first[b] = t
            if t >= pm_start and (b not in first_pm or t < first_pm[b]):
                first_pm[b] = t
        if len(data) < PAGE:
            break
        offset += PAGE
    return first, first_pm


def _missing_buildings(expected: list[str], first: dict[str, str],
                       deadline_t: time) -> list[str]:
    """Expected buildings with NO entry in `first` at or before the deadline.
    Pass the all-day map for the AM window, the afternoon map for PM.
    Empty list = everyone synced."""
    deadline_str = deadline_t.strftime("%H:%M:%S")
    return sorted(b for b in expected
                  if b not in first or first[b] > deadline_str)


def _alerted_buildings(client, et_day: date, window_key: str) -> list[str] | None:
    """Buildings listed in the alert already sent for (day, window);
    None when no alert went out."""
    res = client.table("plantlog_compliance_alerts") \
        .select("missing_buildings") \
        .eq("et_day", et_day.isoformat()) \
        .eq("window_key", window_key) \
        .limit(1) \
        .execute()
    if not res.data:
        return None
    return list(res.data[0].get("missing_buildings") or [])


def _h12(t: time | str) -> str:
    """time or 'HH:MM:SS' -> '7:18 AM'."""
    if isinstance(t, str):
        t = time(int(t[0:2]), int(t[3:5]))
    return t.strftime("%I:%M %p").lstrip("0")


def _am_recheck_lines(am_listed: list[str], first: dict[str, str]) -> tuple[list[str], int]:
    """Body lines re-checking the buildings the AM alert listed, and how
    many of them turned out to be logged before the AM deadline."""
    am_deadline_str = AM_DEADLINE.strftime("%H:%M:%S")
    pm_start = PM_ROUND_START.strftime("%H:%M:%S")
    on_time = 0
    lines = [
        f"AM recheck: this morning's alert listed "
        f"{len(am_listed)} building(s). Now:",
        "",
    ]
    for b in am_listed:
        t = first.get(b)
        if t is None:
            lines.append(f"  • {b}: still no round logged today")
        elif t <= am_deadline_str:
            on_time += 1
            lines.append(f"  • {b}: in, first entry {_h12(t)} (synced late)")
        elif t < pm_start:
            lines.append(f"  • {b}: late, first entry {_h12(t)} "
                         f"(after the {_h12(AM_DEADLINE)} deadline)")
        else:
            lines.append(f"  • {b}: no morning round "
                         f"(first entry today {_h12(t)})")
    lines.extend([
        "",
        f"{on_time} of {len(am_listed)} were logged before "
        f"{_h12(AM_DEADLINE)} and reached the dashboard after the AM check.",
    ])
    return lines, on_time


def _send_email(window_label: str, et_day: date, deadline_t: time,
                missing: list[str],
                am_recheck: tuple[list[str], dict[str, str]] | None = None) -> None:
    """am_recheck = (buildings the AM alert listed, first entry per building
    today); only passed for the PM email."""
    user = os.environ.get("GMAIL_USER", "").strip()
    pw = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    if not user or not pw:
        print("WARN: GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping "
              "compliance email", file=sys.stderr)
        return

    subject = (f"[Plantlog compliance] {window_label} {et_day.isoformat()} "
               f"— {len(missing)} building(s) missing")
    body_lines = [
        f"Plantlog compliance check — {window_label} window "
        f"(deadline {_h12(deadline_t)} ET) for {et_day.isoformat()}.",
        "",
    ]
    if window_label == "PM":
        what = f"an afternoon round ({_h12(PM_ROUND_START)} or later)"
    else:
        what = "a round"
    if missing:
        body_lines.extend([
            f"{len(missing)} building(s) without {what} logged before the deadline:",
            "",
        ])
        for b in missing:
            body_lines.append(f"  • {b}")
    else:
        body_lines.append(f"Every building has {what} logged before the deadline.")
    body_lines.append("")
    if am_recheck is not None:
        am_listed, first = am_recheck
        recheck_lines, on_time = _am_recheck_lines(am_listed, first)
        body_lines.extend(recheck_lines)
        body_lines.append("")
        subject += f" · AM recheck {on_time}/{len(am_listed)} in on time"
    elif window_label == "AM":
        body_lines.extend([
            ("Rounds that were done but have not synced yet are checked "
             "again at the PM check and reported in that email."),
            "",
        ])
    body_lines.extend([
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


def window_status(entries: list[tuple[str, datetime]], window_key: str,
                  checked_at: datetime) -> dict:
    """Pure. One building, one day, one window.

    entries    — (performed_at_local 'HH:MM:SS', inserted_at) for every log
                 entry of the building that day
    checked_at — when the deadline check for this window ran
    Returns {status, first_entry, synced_at} as stored in
    plantlog_compliance_log."""
    pm_start = PM_ROUND_START.strftime("%H:%M:%S")
    if window_key == "am":
        deadline = AM_DEADLINE.strftime("%H:%M:%S")
        mine = [e for e in entries if e[0] < pm_start]
    else:
        deadline = PM_DEADLINE.strftime("%H:%M:%S")
        mine = [e for e in entries if e[0] >= pm_start]
    if not mine:
        return {"status": "missing", "first_entry": None, "synced_at": None}
    in_time = [e for e in mine if e[0] <= deadline]
    pool = in_time or mine
    synced_at = min(e[1] for e in pool)
    if not in_time:
        status = "late"
    elif synced_at > checked_at:
        status = "synced_late"
    else:
        status = "on_time"
    return {"status": status,
            "first_entry": min(e[0] for e in pool),
            "synced_at": synced_at.isoformat()}


def build_log_rows(records: list[dict], alert_sent: dict[tuple[str, str], datetime],
                   expected: list[str], now_et: datetime, since: date) -> list[dict]:
    """Pure. Rows for plantlog_compliance_log: every weekday from `since` to
    today x every window whose deadline has passed x every expected building.

    records    — plantlog_log_records rows (performed_on, performed_at_local,
                 building_inferred, inserted_at)
    alert_sent — (et_day iso, window_key) -> sent_at of that alert email"""
    by_day_building: dict[tuple[str, str], list[tuple[str, datetime]]] = {}
    for r in records:
        t = str(r.get("performed_at_local") or "")[:8]
        ins = r.get("inserted_at")
        if not t or not ins or not r.get("building_inferred"):
            continue
        by_day_building.setdefault((r["performed_on"], r["building_inferred"]), []) \
            .append((t, datetime.fromisoformat(ins.replace("Z", "+00:00"))))

    today = now_et.date()
    stamp = now_et.astimezone(ZoneInfo("UTC")).isoformat()
    out: list[dict] = []
    d = since
    while d <= today:
        if d.weekday() < 5:
            for key, deadline_t in (("am", AM_DEADLINE), ("pm", PM_DEADLINE)):
                if d == today and now_et.time() < deadline_t:
                    continue
                checked_at = alert_sent.get((d.isoformat(), key)) or \
                    datetime.combine(d, NOMINAL_CHECK[key], EASTERN)
                for b in expected:
                    row = window_status(by_day_building.get((d.isoformat(), b), []),
                                        key, checked_at)
                    row.update(et_day=d.isoformat(), window_key=key, building=b,
                               updated_at=stamp)
                    out.append(row)
        d += timedelta(days=1)
    return out


def log_building_history(client, now_et: datetime, expected: list[str],
                         days: int = LOG_LOOKBACK_DAYS) -> int:
    """Rewrite plantlog_compliance_log for the last `days` days. Returns the
    number of rows written."""
    since = now_et.date() - timedelta(days=days)
    records: list[dict] = []
    offset = 0
    while True:
        res = client.table("plantlog_log_records") \
            .select("id, performed_on, performed_at_local, building_inferred, inserted_at") \
            .gte("performed_on", since.isoformat()) \
            .not_.is_("building_inferred", "null") \
            .order("id") \
            .range(offset, offset + PAGE - 1) \
            .execute()
        data = res.data or []
        records.extend(data)
        if len(data) < PAGE:
            break
        offset += PAGE

    alert_sent: dict[tuple[str, str], datetime] = {}
    offset = 0
    while True:
        res = client.table("plantlog_compliance_alerts") \
            .select("et_day, window_key, sent_at") \
            .gte("et_day", since.isoformat()) \
            .order("et_day").order("window_key") \
            .range(offset, offset + PAGE - 1) \
            .execute()
        data = res.data or []
        for a in data:
            alert_sent[(a["et_day"], a["window_key"])] = \
                datetime.fromisoformat(a["sent_at"].replace("Z", "+00:00"))
        if len(data) < PAGE:
            break
        offset += PAGE

    rows = build_log_rows(records, alert_sent, expected, now_et, since)
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        client.table("plantlog_compliance_log").upsert(
            rows[i:i + CHUNK],
            on_conflict="et_day,window_key,building",
            returning="minimal",
        ).execute()
    return len(rows)


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
    expected = _list_expected_buildings(client, et_day)
    if not expected:
        print("[skip] compliance: no expected buildings observed yet")
        return

    first, first_pm = _first_entries_today(client, et_day)
    pm_due = now_et.time() >= PM_DEADLINE
    # Read before the AM block below can claim a row in this same run: the
    # recheck is only worth sending for an alert that went out earlier.
    am_listed = _alerted_buildings(client, et_day, "am") if pm_due else None

    # AM window — after 10:30am
    if now_et.time() >= AM_DEADLINE:
        missing = _missing_buildings(expected, first, AM_DEADLINE)
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

    # PM window — after 17:55. Also re-checks what the AM alert listed.
    if pm_due:
        missing = _missing_buildings(expected, first_pm, PM_DEADLINE)
        if missing or am_listed:
            if _try_claim_alert(client, et_day, "pm", missing):
                try:
                    _send_email("PM", et_day, PM_DEADLINE, missing,
                                am_recheck=(am_listed, first) if am_listed else None)
                except Exception as e:
                    print(f"ERROR: PM email send failed: {e}", file=sys.stderr)
            else:
                print(f"[skip] PM compliance: already alerted today "
                      f"({len(missing)} still missing)")
        else:
            print("[ok] PM compliance: every building has an afternoon "
                  "round before 5:55pm ET")

    # Per-building history. After the alerts so this run's alert time is on
    # record; its own failure never touches them.
    try:
        n = log_building_history(client, now_et, expected)
        print(f"[ok] compliance log: {n} building rows for the last "
              f"{LOG_LOOKBACK_DAYS} days")
    except Exception as e:
        print(f"WARN: compliance log write failed: {e}", file=sys.stderr)
