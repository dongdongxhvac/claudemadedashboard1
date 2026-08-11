r"""Binney Escort poller — feeds /binney/exp.

Hits Cove's GetWorkOrdersPage GQL against the BINNEY network (moBABfC2ZR —
note: wo12/pm12 poll the UPark network), pulls all open-ish work orders,
keeps the Escort-category ones, parses the escort date/time out of each
description (escort_parse.py), and mirrors the set into Supabase
`binney_escort_wos`: upsert on wo_id, then prune rows this run no longer saw.

Category filtering happens client-side (parentCategory/category title ==
"Escort") rather than in the GQL filter — the open set is ~150 rows / 2 pages,
and it sidesteps guessing Cove's CONTAINED_IN payload shape for category
objects. Mirrors wo12_poller.py otherwise.

Requires the same watcher/.env + cove_session.json as the other pollers.
NOTE: the Cove session account must have access to the Binney Portfolio
network (Jie Lao's does).

Schedule (set up via install_binney_escort_poller_task.ps1):
  - Hourly 7:00am - 7:00pm daily.

Run manually:
    .\.venv\Scripts\python.exe binney_escort_poller.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402
from cove_session import get_fresh_token, SessionError  # noqa: E402
from escort_parse import parse_escort_when  # noqa: E402

TOKEN: str = ""
NETWORK_ID = os.environ.get("COVE_BINNEY_NETWORK_ID", "moBABfC2ZR").strip()
GQL_URL = "https://api.cove.is/gql"
EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

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
    """  # verbatim copy of wo12_poller.QUERY

# Matches the Escort bookmark on manage.cove.is: every open-ish status,
# including "scheduled" (used on the Binney network, absent from UPark's WO12).
OPEN_STATUSES = ["scheduled", "submitted", "accepted", "in_progress", "on_hold"]
SORT_BY = {"desc": True, "field": "createdAt"}
PAGE_LIMIT = 100

_STATUS_HUMAN = {
    "in_progress": "In Progress",
    "submitted":   "Submitted",
    "accepted":    "Accepted",
    "on_hold":     "On Hold",
    "scheduled":   "Scheduled",
    "done":        "Done",
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
    return f"{fn} {ln}".strip() or None


def safe_get(d: dict | None, *keys):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


def synthetic_filename(now_local: datetime) -> str:
    return f"api-COVE BinneyEscort {now_local.strftime('%Y-%m-%d %H-%M')}"


def _log_error(filename: str, error_msg: str) -> None:
    try:
        get_client().table("ingestion_log").insert({
            "filename":  filename,
            "kind":      "binney_escort",
            "status":    "error",
            "rows":      0,
            "error_msg": error_msg[:4000],
        }).execute()
    except Exception as e:
        print(f"WARN: also failed to write ingestion_log: {e}", file=sys.stderr)


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
        # siteNetwork authenticates via the cove_manage_auth cookie (see
        # wo12_poller.post_gql).
        "Cookie": f"cove_manage_auth={TOKEN}",
    }
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    return resp.status_code, resp


def fetch_all_open_wos() -> list[dict]:
    wo_filter = {
        "items": [
            {"field": "status", "operator": "CONTAINED_IN", "value": OPEN_STATUSES},
        ],
        "orItems": [],
    }
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
        if skip > 10_000:
            raise RuntimeError(f"pagination runaway at skip={skip}")
    return out


def is_escort(item: dict) -> bool:
    return "escort" in (
        (safe_get(item, "workOrderCategory", "parentCategory", "title") or "")
        + " "
        + (safe_get(item, "workOrderCategory", "title") or "")
    ).lower()


def map_escort(item: dict, fetched_at_iso: str) -> dict:
    last_note = safe_get(item, "notes", "items")
    last_note_text = (last_note[0].get("note") if last_note else None) if isinstance(last_note, list) else None
    groups_list = item.get("groups") or []
    groups_str = ", ".join([g.get("name") for g in groups_list if g and g.get("name")]) or None
    when = parse_escort_when(item.get("description"), item.get("createdAt"))
    return {
        "wo_id":            item.get("altId"),
        "object_id":        item.get("id"),
        "status":           humanize_status(item.get("status")),
        "building":         safe_get(item, "building", "name"),
        "floor":            safe_get(item, "floor", "name"),
        "suite":            safe_get(item, "suite", "name"),
        "category":         safe_get(item, "workOrderCategory", "title"),
        "issue_type":       safe_get(item, "workOrderCategory", "parentCategory", "title"),
        "assigned_to_name": name_of(item.get("assignee")),
        "submitted_by":     name_of(item.get("createdBy")),
        "created_for":      name_of(item.get("createdFor")),
        "tenant":           safe_get(item, "tenant", "name"),
        "groups":           groups_str,
        "ticket_type":      item.get("ticketType"),
        "description":      item.get("description"),
        "last_note":        last_note_text,
        "submitted_at":     item.get("createdAt"),
        "updated_at_cmms":  item.get("updatedAt"),
        "escort_date":      when.escort_date.isoformat() if when.escort_date else None,
        "escort_time":      when.escort_time.isoformat() if when.escort_time else None,
        "parse_snippet":    when.snippet,
        "parse_ok":         when.ok,
        "fetched_at":       fetched_at_iso,
    }


def main() -> int:
    now_local = datetime.now(EASTERN)
    filename = synthetic_filename(now_local)

    global TOKEN
    try:
        TOKEN = get_fresh_token()
    except SessionError as e:
        msg = f"cove_session: {e}"
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    print(f"[{now_local.isoformat()}] polling Binney escorts (network {NETWORK_ID})")

    try:
        items = fetch_all_open_wos()
    except Exception as e:
        msg = str(e)
        if "Not Authenticated" in msg:
            msg += " — auth rejected mid-run. Try `python cove_session.py refresh`."
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    escorts = [it for it in items if is_escort(it)]
    print(f"  {len(escorts)} escort WOs of {len(items)} open")

    fetched_at = datetime.now(UTC).isoformat()
    rows = [map_escort(it, fetched_at) for it in escorts]
    rows = [r for r in rows if r["wo_id"]]

    client = get_client()
    CHUNK = 200
    for i in range(0, len(rows), CHUNK):
        client.table("binney_escort_wos").upsert(rows[i:i + CHUNK], on_conflict="wo_id").execute()
    # Prune WOs that left the open set (closed/cancelled) — everything this
    # run saw carries fetched_at == this run's stamp.
    client.table("binney_escort_wos").delete().lt("fetched_at", fetched_at).execute()

    client.table("ingestion_log").insert({
        "filename": filename,
        "kind":     "binney_escort",
        "status":   "ok",
        "rows":     len(rows),
    }).execute()

    unparsed = [r["wo_id"] for r in rows if not r["parse_ok"]]
    if unparsed:
        print(f"  WARN: no escort date parsed for: {', '.join(unparsed)}")
    print(f"  done — {len(rows)} rows upserted, stale pruned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
