"""Classify a dropped CSV by filename and extract its taken_at timestamp.

Expected patterns (matching what cove_pm_daily.py + the user's manual exports produce):
    COVE PM12 2026-05-14 6am.csv
    COVE PM12 2026-05-13 9pm.csv
    COVE Labor 2026-05-13 9pm.csv
    COVE WO12 2026-05-12 9pm.csv

A bare YYYY-MM-DD (no time-of-day) is also accepted; missing time defaults to midnight.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

# Use the host's local timezone for the filename time-of-day so that "11pm"
# in the filename gets stored as the user's local 11pm (not 11pm UTC).
_LOCAL_TZ = datetime.now().astimezone().tzinfo

_DATE_RE = re.compile(
    r"""
    (?P<kind>PM12|Labor|WO12)        # CSV kind tag
    \s+
    (?P<date>\d{4}-\d{2}-\d{2})      # YYYY-MM-DD
    (?:\s+(?P<hour>\d{1,2})(?P<ampm>am|pm))?   # optional time-of-day
    """,
    re.IGNORECASE | re.VERBOSE,
)

_KIND_MAP = {"PM12": "pm12", "LABOR": "labor", "WO12": "wo"}


@dataclass(frozen=True)
class Parsed:
    kind: str           # 'pm12' | 'labor' | 'wo'
    taken_at: datetime  # timezone-aware, host's local TZ


def parse(filename: str) -> Parsed | None:
    """Return Parsed if filename matches a known pattern, else None."""
    m = _DATE_RE.search(filename)
    if not m:
        return None

    kind = _KIND_MAP[m.group("kind").upper()]
    d = datetime.strptime(m.group("date"), "%Y-%m-%d")

    if m.group("hour"):
        hour = int(m.group("hour")) % 12
        if m.group("ampm").lower() == "pm":
            hour += 12
        taken = d.replace(hour=hour, tzinfo=_LOCAL_TZ)
    else:
        taken = d.replace(hour=0, tzinfo=_LOCAL_TZ)

    return Parsed(kind=kind, taken_at=taken)
