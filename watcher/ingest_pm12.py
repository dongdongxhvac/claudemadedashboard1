"""Parse a PM12 CSV and insert rows into Supabase.

CSV columns (from the COVE CMMS export):
  Task #, Due Date, Site, Building, Equipment, Name, Interval, Status,
  Assigned To, Open Date, Category, Est Labor Hours, Suite, Labor Hours,
  Equipment Category, Updated At, Object ID
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from classify import classify_pm
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


def _to_ts(val) -> str | None:
    if pd.isna(val) or val == "":
        return None
    ts = pd.to_datetime(val, errors="coerce")
    if pd.isna(ts):
        return None
    return ts.isoformat()


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
    """Parse the CSV and insert rows under the given snapshot_id. Returns row count."""
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)

    rows = []
    for _, r in df.iterrows():
        name = _clean_str(r.get("Name"))
        rows.append({
            "snapshot_id":        snapshot_id,
            "task_no":            _clean_str(r.get("Task #")),
            "due_date":           _to_date(r.get("Due Date")),
            "site":               _clean_str(r.get("Site")),
            "building_code":      _clean_str(r.get("Building")),
            "equipment":          _clean_str(r.get("Equipment")),
            "name":               name,
            "interval":           _clean_str(r.get("Interval")),
            "status":             _clean_str(r.get("Status")),
            "assigned_to_name":   _clean_str(r.get("Assigned To")),
            "open_date":          _to_date(r.get("Open Date")),
            "category":           _clean_str(r.get("Category")),
            "est_labor_hours":    _to_num(r.get("Est Labor Hours")),
            "suite":              _clean_str(r.get("Suite")),
            "labor_hours":        _to_num(r.get("Labor Hours")),
            "equipment_category": _clean_str(r.get("Equipment Category")),
            "updated_at_cmms":    _to_ts(r.get("Updated At")),
            "object_id":          _clean_str(r.get("Object ID")),
            "pm_type":            classify_pm(name),
            # New "Type" column added to the CMMS export bookmark (e.g.
            # "On-Demand" / "Scheduled"). Past CSVs without this column will
            # yield None here, which is fine — the rule that uses it is permissive.
            "cmms_type":          _clean_str(r.get("Type")),
        })

    client = get_client()
    for i in range(0, len(rows), _CHUNK):
        client.table("pm_rows").insert(rows[i:i + _CHUNK]).execute()

    return len(rows)
