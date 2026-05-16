"""Parse a Labor CSV and insert rows into Supabase.

CSV columns: Assigned To, Labor Hours, Week Start
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from supabase_client import get_client

_CHUNK = 500


def _to_date(val) -> str | None:
    """Accepts any pandas-parseable date/datetime; returns ISO YYYY-MM-DD."""
    if pd.isna(val) or val == "":
        return None
    ts = pd.to_datetime(val, errors="coerce")
    if pd.isna(ts):
        return None
    return ts.date().isoformat()


def _to_num(val) -> float | None:
    if pd.isna(val) or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _clean_str(val) -> str | None:
    if pd.isna(val):
        return None
    s = str(val).strip()
    return s or None


def ingest(csv_path: Path, snapshot_id: str) -> int:
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)

    rows = [
        {
            "snapshot_id":      snapshot_id,
            "assigned_to_name": _clean_str(r.get("Assigned To")),
            "labor_hours":      _to_num(r.get("Labor Hours")),
            "week_start":       _to_date(r.get("Week Start")),
        }
        for _, r in df.iterrows()
    ]

    client = get_client()
    for i in range(0, len(rows), _CHUNK):
        client.table("labor_rows").insert(rows[i:i + _CHUNK]).execute()

    return len(rows)
