r"""Escort description date/time parser (stdlib only).

Binney escort WOs carry their schedule only inside free-text descriptions:

    "J.C.Cannistraro will be onsite Monday 8/10 at 6:30 am to replace..."
    "Please escort American Plant Maintenance on Friday, August 14th at around 7am..."
    "Nick Gray from JCC will be coming to 65 Grove at 7:00 AM on 8/10/26..."
    "Burt Process is scheduled for Thursday, 8/27 to perform..."
    "On Saturday, August 8th InfraRed will be onsite..."

parse_escort_when() extracts the FIRST date mentioned (numeric 8/10[/26] or
month-name "August 14th"), plus a time if one appears near it (or anywhere in
the text as a fallback — descriptions rarely mention more than one clock time).

Year inference when the description omits it: start from the submission year;
if that lands the escort more than 30 days BEFORE submission, roll forward a
year (Dec submission -> Jan escort). Kept separate from the poller so it can
be unit-tested without requests/supabase installed.
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from typing import NamedTuple

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# 8/10, 8/10/26, 08/10/2026 — not preceded/followed by more digits, and not
# followed by another slash (guards against reading "8/10" out of "8/10/26"
# wrongly, handled by the optional year group instead).
_NUMERIC_DATE = re.compile(r"(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d/])")

# "August 14th", "Aug 14", "August 14th, 2026"
_NAME_DATE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b",
    re.IGNORECASE,
)

# "6:30 am", "7am", "7 a.m.", "12:15PM" — am/pm marker required unless the
# colon form is used ("at 6:30"). Bare integers never match (phone numbers).
_TIME = re.compile(
    r"\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|\b(\d{1,2}):(\d{2})\b(?!\s*(?:a\.?m\.?|p\.?m\.?))",
    re.IGNORECASE,
)


class EscortWhen(NamedTuple):
    escort_date: date | None
    escort_time: time | None
    snippet: str | None          # exact matched text, for on-page auditing
    ok: bool


def _mk_date(month: int, day: int, year: int | None, submitted: date) -> date | None:
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if year is not None:
        if year < 100:
            year += 2000
        try:
            return date(year, month, day)
        except ValueError:
            return None
    try:
        d = date(submitted.year, month, day)
    except ValueError:
        return None
    # No explicit year: escorts are scheduled at/after submission. A date far
    # before the submission date means it belongs to the following year.
    if d < submitted - timedelta(days=30):
        d = d.replace(year=submitted.year + 1)
    return d


def _find_time(text: str, near: int | None) -> tuple[time | None, str | None]:
    """Pick the clock time nearest to offset `near` (the date match)."""
    best: tuple[int, time, str] | None = None
    for m in _TIME.finditer(text):
        if m.group(3):                        # am/pm branch
            hh, mm = int(m.group(1)), int(m.group(2) or 0)
            if hh == 12:
                hh = 0
            if m.group(3).lower().startswith("p"):
                hh += 12
        else:                                 # bare colon branch, e.g. "at 6:30"
            hh, mm = int(m.group(4)), int(m.group(5))
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            continue
        dist = abs(m.start() - near) if near is not None else m.start()
        t = time(hh, mm)
        if best is None or dist < best[0]:
            best = (dist, t, m.group(0))
    if best is None:
        return None, None
    return best[1], best[2]


def parse_escort_when(description: str | None, submitted_at: str | None) -> EscortWhen:
    """submitted_at: ISO string (Cove createdAt) used only for year inference."""
    if not description:
        return EscortWhen(None, None, None, False)
    submitted = date.today()
    if submitted_at:
        try:
            submitted = datetime.fromisoformat(submitted_at.replace("Z", "+00:00")).date()
        except ValueError:
            pass

    # First date mentioned wins, whichever pattern form it uses.
    num = _NUMERIC_DATE.search(description)
    name = _NAME_DATE.search(description)
    if num and name:
        m = num if num.start() < name.start() else name
    else:
        m = num or name
    if m is None:
        return EscortWhen(None, None, None, False)

    if m.re is _NUMERIC_DATE:
        d = _mk_date(int(m.group(1)), int(m.group(2)),
                     int(m.group(3)) if m.group(3) else None, submitted)
    else:
        d = _mk_date(_MONTHS[m.group(1).lower()[:3]], int(m.group(2)),
                     int(m.group(3)) if m.group(3) else None, submitted)
    if d is None:
        return EscortWhen(None, None, None, False)

    t, t_text = _find_time(description, m.start())
    snippet = m.group(0) if t_text is None else f"{m.group(0)} · {t_text}"
    return EscortWhen(d, t, snippet, True)
