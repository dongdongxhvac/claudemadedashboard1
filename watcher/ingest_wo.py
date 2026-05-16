"""Parse a WO CSV and insert rows into Supabase.

CSV columns: ID, Status, Assigned To, Submitted By, Category, Building, Description,
Floor, Issue Type, Submitted Date, Required Due Date, Last Note, Tenant, Created For,
Suite, Groups, Ticket Type, Updated At, Completion Date, Billable Total, Object ID
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from supabase_client import get_client

_CHUNK = 500

# Matches the V5 dashboard's open/closed convention: status is "open" unless it
# contains closed / complete / cancel (any casing).
_CLOSED_RE = re.compile(r"closed|complete|cancel", re.IGNORECASE)


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


def _is_open(status: str | None) -> bool:
    if not status:
        return True  # treat unknown status as open, conservatively
    return _CLOSED_RE.search(status) is None


def ingest(csv_path: Path, snapshot_id: str) -> int:
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)

    rows = []
    for _, r in df.iterrows():
        status = _clean_str(r.get("Status"))
        rows.append({
            "snapshot_id":       snapshot_id,
            "wo_id":             _clean_str(r.get("ID")),
            "status":            status,
            "assigned_to_name":  _clean_str(r.get("Assigned To")),
            "submitted_by":      _clean_str(r.get("Submitted By")),
            "category":          _clean_str(r.get("Category")),
            "building_code":     _clean_str(r.get("Building")),
            "description":       _clean_str(r.get("Description")),
            "floor":             _clean_str(r.get("Floor")),
            "issue_type":        _clean_str(r.get("Issue Type")),
            "submitted_date":    _to_ts(r.get("Submitted Date")),
            "required_due_date": _to_date(r.get("Required Due Date")),
            "last_note":         _clean_str(r.get("Last Note")),
            "tenant":            _clean_str(r.get("Tenant")),
            "created_for":       _clean_str(r.get("Created For")),
            "suite":             _clean_str(r.get("Suite")),
            "groups":            _clean_str(r.get("Groups")),
            "ticket_type":       _clean_str(r.get("Ticket Type")),
            "updated_at_cmms":   _to_ts(r.get("Updated At")),
            "completion_date":   _to_ts(r.get("Completion Date")),
            "billable_total":    _to_num(r.get("Billable Total")),
            "object_id":         _clean_str(r.get("Object ID")),
            "is_open":           _is_open(status),
        })

    client = get_client()
    for i in range(0, len(rows), _CHUNK):
        client.table("wo_rows").insert(rows[i:i + _CHUNK]).execute()

    return len(rows)
