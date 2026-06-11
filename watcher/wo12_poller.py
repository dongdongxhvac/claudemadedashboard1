r"""Phase 5.2 — WO12 poller.

Hits Cove's GetWorkOrdersPage GQL directly, paginates through all matching
work orders, writes a fresh `wo` snapshot + `wo_rows` to Supabase each run.
Mirrors pm12_poller.py for consistency.

Filter matches the user's WO12 bookmark: assignee whitelist + open-ish
statuses + rolling createdAt window.

Schedule (set up via install_wo12_poller_task.ps1):
  - Fires hourly 7:00am - 7:00pm daily. Adjust the .ps1 if you want fewer.

Run manually:
    .\.venv\Scripts\python.exe wo12_poller.py
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402
from cove_session import get_fresh_token, SessionError  # noqa: E402
from wo_stale_check import run_stale_wo_check  # noqa: E402

# Populated in main() via cove_session.get_fresh_token(). The session manager
# transparently refreshes the JWT when it's within 24h of expiry.
TOKEN: str = ""
COOKIE = os.environ.get("COVE_COOKIE", "").strip()
NETWORK_ID = os.environ.get("COVE_NETWORK_ID", "OoxMP8BZJF").strip()
GQL_URL = "https://api.cove.is/gql"
EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# Same query string Cove's web app sends. Includes nested fragments for the
# work-order detail tree. Preserved verbatim so the operation hash matches.
QUERY = """
    query GetWorkOrdersPage($networkId: ID!, $page: GQLPageInput, $sortBy: GQLSortByInput, $filter: GQLFilterInput) {
  siteNetwork(id: $networkId) {
    workOrders(page: $page, sortBy: $sortBy, filter: $filter) {
      items {
        ...WorkOrdersTable
      }
      page {
        total
      }
    }
  }
}

    fragment WorkOrdersTable on GQLWorkOrder {
  billableTotal
  billingVerificationStatus
  exportedAt
  isBillable
  isExported
  notes(page: {limit: 1, skip: 0}, sortBy: {desc: true, field: "createdAt"}) {
    items {
      createdAt
      createdBy {
        firstName
        lastName
      }
      id
      note
    }
  }
  reservation {
    altId
    id
  }
  tenant {
    externalOccupantId
    id
    name
  }
  verifiedAt
  workOrderCategory {
    ...WorkOrderWOCategoryBase
  }
  ...WorkOrdersBase
}

    fragment WorkOrderWOCategoryBase on GQLWorkOrderCategory {
  description
  id
  isDueDateCollected
  parentCategory {
    id
    title
  }
  title
  ...WorkOrderCategoriesConsentForm
}

    fragment WorkOrderCategoriesConsentForm on GQLWorkOrderCategory {
  consentForm {
    bulletList
    document {
      name
      url
    }
    id
    name
    subtitle
    title
  }
}


    fragment WorkOrdersBase on GQLWorkOrder {
  altId
  assignee {
    email
    firstName
    id
    imageUrl
    lastName
  }
  attachments {
    name
    url
  }
  billingVerificationStatus
  building {
    id
    name
  }
  closedAt
  completedAt
  createdAt
  createdBy {
    email
    firstName
    id
    lastName
  }
  createdFor {
    email
    firstName
    id
    lastName
    phone
    role
  }
  currentEscalation {
    escalationType
    id
    name
  }
  description
  estimateApprovalStatus
  floor {
    id
    name
  }
  groups {
    id
    name
  }
  hoursLogged
  id
  requiredDueAt
  scheduledOpenAt
  site {
    currency
    id
    name
    region
    workOrderRestrictions
  }
  source
  status
  suite {
    id
    name
  }
  tags {
    id
    name
  }
  ticketType
  updatedAt
}
    """

# Mirror the user's WO12 bookmark (verified from DevTools 2026-05-19):
#   - status:   open + done (so the dashboard sees recently-completed WOs too)
#   - assignee: 11 engineers/managers (subset of PM12 list — missing yGVXKlnu4F)
#   - createdAt: rolling N-day lookback from today
WO_ASSIGNEE_IDS = [
    "IrQac3eAnX", "thGxmdCU3x", "uv9FFWuCIT", "V0cfCtkNuC",
    "8ZVqd2HExb", "RxaNCAOXew", "9PAgDPhuXE", "uQNAPN9ipb",
    "IKIPg7ql0G", "D6ZvMf8Mcj", "hGCSa1lcK5",
]
WO_CREATED_LOOKBACK_DAYS = 60

# Split for the Phase 5.5 schema: wo_rows snapshots only OPEN WOs, while
# wo_close_events captures Done transitions via completedAt/closedAt.
OPEN_STATUSES   = ["in_progress", "submitted", "accepted", "on_hold"]
CLOSED_STATUSES = ["done"]

SORT_BY = {"desc": True, "field": "createdAt"}
PAGE_LIMIT = 100

# Closed/open classifier — same regex the CSV ingester uses (ingest_wo.py).
_CLOSED_RE = re.compile(r"closed|complete|cancel|done", re.IGNORECASE)


def compute_created_start() -> str:
    today_eastern = datetime.now(EASTERN).replace(hour=0, minute=0, second=0, microsecond=0)
    start_eastern = today_eastern - timedelta(days=WO_CREATED_LOOKBACK_DAYS)
    return start_eastern.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def build_wo_filter(statuses: list[str]) -> dict:
    return {
        "items": [
            {"field": "status",    "operator": "CONTAINED_IN", "value": statuses},
            {"field": "assignee",  "operator": "CONTAINED_IN", "value": WO_ASSIGNEE_IDS},
            {"field": "createdAt", "operator": "DATE_RANGE",   "value": {"start": compute_created_start()}},
        ],
        "orItems": [],
    }


# ---------- helpers ----------

def synthetic_filename(now_local: datetime) -> str:
    return f"api-COVE WO12 {now_local.strftime('%Y-%m-%d %H-%M')}.csv"


def decode_token_exp(jwt: str) -> int | None:
    try:
        seg = jwt.split(".")[1]
        seg += "=" * ((4 - len(seg) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(seg)).get("exp")
    except Exception:
        return None


_STATUS_HUMAN = {
    "in_progress": "In Progress",
    "submitted":   "Submitted",
    "accepted":    "Accepted",
    "on_hold":     "On Hold",
    "done":        "Done",
    "completed":   "Completed",
    "cancelled":   "Cancelled",
    "canceled":    "Cancelled",
    "closed":      "Closed",
}


def humanize_status(s: str | None) -> str | None:
    if not s:
        return None
    return _STATUS_HUMAN.get(s, " ".join(w.capitalize() for w in s.split("_")))


def name_of(person: dict | None) -> str | None:
    if not person:
        return None
    fn = (person.get("firstName") or "").strip()
    ln = (person.get("lastName") or "").strip()
    name = f"{fn} {ln}".strip()
    return name or None


def safe_get(d: dict | None, *keys):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


def iso_date(s: str | None) -> str | None:
    if not s:
        return None
    return s[:10] if "T" in s else s


def is_open(status_human: str | None) -> bool:
    if not status_human:
        return True
    return _CLOSED_RE.search(status_human) is None


def map_wo(item: dict, snapshot_id: str) -> dict:
    status_human = humanize_status(item.get("status"))
    last_note = safe_get(item, "notes", "items")
    last_note_text = (last_note[0].get("note") if last_note else None) if isinstance(last_note, list) else None
    groups_list = item.get("groups") or []
    groups_str = ", ".join([g.get("name") for g in groups_list if g and g.get("name")]) or None
    return {
        "snapshot_id":       snapshot_id,
        "wo_id":             item.get("altId"),
        "status":            status_human,
        "assigned_to_name":  name_of(item.get("assignee")),
        "submitted_by":      name_of(item.get("createdBy")),
        "category":          safe_get(item, "workOrderCategory", "title"),
        "building_code":     safe_get(item, "building", "name"),
        "description":       item.get("description"),
        "floor":             safe_get(item, "floor", "name"),
        # Parent category = the broader "Issue Type" (e.g. Plumbing > Pipe Leak).
        "issue_type":        safe_get(item, "workOrderCategory", "parentCategory", "title"),
        "submitted_date":    item.get("createdAt"),
        "required_due_date": iso_date(item.get("requiredDueAt")),
        "last_note":         last_note_text,
        "tenant":            safe_get(item, "tenant", "name"),
        "created_for":       name_of(item.get("createdFor")),
        "suite":             safe_get(item, "suite", "name"),
        "groups":            groups_str,
        "ticket_type":       item.get("ticketType"),
        "updated_at_cmms":   item.get("updatedAt"),
        # Cove distinguishes completedAt (tech marked done) from closedAt
        # (admin closed). The CSV's "Completion Date" historically aligns
        # with completedAt; fall back to closedAt if completedAt is null.
        "completion_date":   item.get("completedAt") or item.get("closedAt"),
        "billable_total":    item.get("billableTotal"),
        "object_id":         item.get("id"),
        "is_open":           is_open(status_human),
    }


def map_wo_close_event(item: dict, snapshot_id: str) -> dict | None:
    """Build a wo_close_events row from a Done Cove work order.

    Returns None if neither completedAt nor closedAt is set (can't establish a
    canonical close time). Identity is (wo_id, completed_on) so a reopen +
    reclose produces two rows."""
    completed_on = item.get("completedAt") or item.get("closedAt")
    if not completed_on:
        return None
    last_note = safe_get(item, "notes", "items")
    last_note_text = (last_note[0].get("note") if last_note else None) if isinstance(last_note, list) else None
    groups_list = item.get("groups") or []
    groups_str = ", ".join([g.get("name") for g in groups_list if g and g.get("name")]) or None
    return {
        "wo_id":             item.get("altId"),
        "object_id":         item.get("id"),
        "completed_on":      completed_on,
        "source_snapshot_id": snapshot_id,
        "building_code":     safe_get(item, "building", "name"),
        "suite":             safe_get(item, "suite", "name"),
        "floor":             safe_get(item, "floor", "name"),
        "category":          safe_get(item, "workOrderCategory", "title"),
        "issue_type":        safe_get(item, "workOrderCategory", "parentCategory", "title"),
        "assigned_to_name":  name_of(item.get("assignee")),
        "submitted_by":      name_of(item.get("createdBy")),
        "created_for":       name_of(item.get("createdFor")),
        "tenant":            safe_get(item, "tenant", "name"),
        "ticket_type":       item.get("ticketType"),
        "groups":            groups_str,
        "description":       item.get("description"),
        "last_note":         last_note_text,
        "submitted_date":    item.get("createdAt"),
        "required_due_date": iso_date(item.get("requiredDueAt")),
        "billable_total":    item.get("billableTotal"),
        "labor_hours":       item.get("hoursLogged"),
    }


def post_gql(body: dict):
    headers = {
        "Authorization": TOKEN,  # raw JWT, NO "Bearer " prefix
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": "https://manage.cove.is",
        "Referer": "https://manage.cove.is/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
    }
    if COOKIE:
        headers["Cookie"] = COOKIE
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    return resp.status_code, resp


def fetch_all_work_orders(statuses: list[str]) -> list[dict]:
    wo_filter = build_wo_filter(statuses)
    print(f"  status={statuses}  createdAt >= {wo_filter['items'][2]['value']['start']} (rolling {WO_CREATED_LOOKBACK_DAYS}d)")
    out: list[dict] = []
    skip = 0
    while True:
        body = {
            "operationName": "GetWorkOrdersPage",
            "query": QUERY,
            "variables": {
                "networkId": NETWORK_ID,
                "filter": wo_filter,
                "page": {"limit": PAGE_LIMIT, "skip": skip},
                "sortBy": SORT_BY,
            },
        }
        status, resp = post_gql(body)
        if status != 200:
            raise RuntimeError(f"HTTP {status}: {resp.text[:500]}")
        data = resp.json()
        if "errors" in data:
            msgs = " | ".join(e.get("message", "") for e in data["errors"])
            raise RuntimeError(f"GraphQL errors: {msgs}")
        page = safe_get(data, "data", "siteNetwork", "workOrders") or {}
        items = page.get("items") or []
        total = safe_get(page, "page", "total") or 0
        out.extend(items)
        print(f"  fetched skip={skip} got={len(items)} total_so_far={len(out)}/{total}")
        if len(items) == 0 or len(out) >= total:
            break
        skip += PAGE_LIMIT
        if skip > 50_000:
            raise RuntimeError(f"pagination runaway at skip={skip}")
    return out


# ---------- main ----------

def main() -> int:
    now_local = datetime.now(EASTERN)
    filename = synthetic_filename(now_local)

    # Sundays — skip. Task Scheduler still fires this every day so this is
    # the day-of-week gate.
    if now_local.weekday() == 6:
        print(f"[{now_local.isoformat()}] Sunday — skipping.")
        return 0

    global TOKEN
    try:
        TOKEN = get_fresh_token()
    except SessionError as e:
        msg = f"cove_session: {e}"
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    print(f"[{now_local.isoformat()}] polling wo12 (open snapshot + closes-since-last)")

    client = get_client()

    # Look up the most recent wo snapshot's taken_at — anything with
    # completedAt/closedAt after this is a new close.
    prev = (
        client.table("snapshots")
        .select("taken_at")
        .eq("kind", "wo")
        .order("taken_at", desc=True)
        .limit(1)
        .execute()
    )
    since_iso = prev.data[0]["taken_at"] if prev.data else None
    print(f"  since_iso={since_iso}")

    try:
        open_items   = fetch_all_work_orders(OPEN_STATUSES)
        closed_items = fetch_all_work_orders(CLOSED_STATUSES)
    except Exception as e:
        msg = str(e)
        if "Not Authenticated" in msg:
            msg += " — auth rejected mid-run. Try `python cove_session.py refresh`; if that fails, re-bootstrap from DevTools."
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    # ----- wo_rows: open work queue only -----
    snap = client.table("snapshots").insert({
        "kind":        "wo",
        "taken_at":    datetime.now(UTC).isoformat(),
        "filename":    filename,
        "source_path": "api://api.cove.is/gql",
    }).execute()
    snapshot_id = snap.data[0]["id"]

    rows = [map_wo(it, snapshot_id) for it in open_items]
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        client.table("wo_rows").insert(rows[i:i + CHUNK]).execute()

    # ----- wo_close_events: WOs newly closed since prev snapshot -----
    events = []
    for it in closed_items:
        ev = map_wo_close_event(it, snapshot_id)
        if not ev:
            continue                                  # neither completedAt nor closedAt
        if since_iso and ev["completed_on"] <= since_iso:
            continue                                  # already captured previously
        events.append(ev)

    for i in range(0, len(events), CHUNK):
        client.table("wo_close_events").upsert(
            events[i:i + CHUNK],
            on_conflict="wo_id,completed_on",
        ).execute()

    client.table("snapshots").update({"row_count": len(rows)}).eq("id", snapshot_id).execute()
    client.table("ingestion_log").insert({
        "filename":    filename,
        "kind":        "wo",
        "status":      "ok",
        "rows":        len(rows),
        "snapshot_id": snapshot_id,
    }).execute()

    print(f"[ok] {filename}: {len(rows)} open rows, {len(events)} new closes")

    # Stale-WO check (no Cove update in 7+ days) — alert email with
    # insert-claim dedupe. Never fails the ingest.
    try:
        run_stale_wo_check(client)
    except Exception as e:
        print(f"WARN: stale-WO check failed: {e}", file=sys.stderr)

    return 0


def _log_error(filename: str, error_msg: str) -> None:
    try:
        get_client().table("ingestion_log").insert({
            "filename":  filename,
            "kind":      "wo",
            "status":    "error",
            "rows":      0,
            "error_msg": error_msg[:4000],
        }).execute()
    except Exception as e:
        print(f"WARN: also failed to write ingestion_log: {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
