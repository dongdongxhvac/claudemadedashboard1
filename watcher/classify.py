"""PM type classifier — ported verbatim from cove_pm_daily.py:81.

Keeps the dashboard's PM-type taxonomy in one place so V5, the new React app,
and the watcher all classify the same way.
"""
from __future__ import annotations

import re

TYPE_ORDER = ["Major", "Filter Swap", "Test/Record", "Minor"]


def classify_pm(name: str | None) -> str:
    if not name or not isinstance(name, str):
        return "Minor"
    n = name.lower()
    if "major" in n:
        return "Major"
    if "filter swap" in n or "filter replace" in n or "filter change" in n:
        return "Filter Swap"
    if any(k in n for k in ("gen test", "water test", "churn test", "water meter")):
        return "Test/Record"
    if re.search(r"\bspcc\b", n) or re.search(r"\bdep log\b", n):
        return "Test/Record"
    return "Minor"
