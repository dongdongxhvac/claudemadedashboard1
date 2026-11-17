r"""Phase 5.2 — hourly PM12 poller.

Hits Cove's GetPMTasksPage GQL directly (no Chrome / no CSV), paginates through
all open PM tasks, writes a fresh `pm12` snapshot + `pm_rows` to Supabase each
run. Mirrors labor_poller.py's structure for consistency.

Filter matches the user's PM12 bookmark: status in (in_progress, on_hold, to_do).

Schedule (set up via install_pm12_poller_task.ps1):
  - Fires hourly 7:00am - 7:00pm daily (script does NOT skip Sunday — PMs can
    move on weekends, unlike labor totals).

Run manually:
    .\.venv\Scripts\python.exe pm12_poller.py
"""
from __future__ import annotations

import base64
import json
import os
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
from classify import classify_pm  # noqa: E402
from cove_session import get_fresh_token, SessionError  # noqa: E402
from cove_roster import assignee_ids, backfill_cove_ids, roster_gap_check  # noqa: E402
from cove_sites import SITE, NETWORK_ID as _SITE_NETWORK_ID, filename_label, sunday_skip, fetch_unassigned  # noqa: E402
import cove_task_details  # noqa: E402  (PM audit evidence: steps / photos / notes / history)

# Populated in main() via cove_session.get_fresh_token(). The session manager
# transparently refreshes the JWT when it's within 24h of expiry.
TOKEN: str = ""
COOKIE = os.environ.get("COVE_COOKIE", "").strip()
NETWORK_ID = _SITE_NETWORK_ID  # per COVE_SITE (cove_sites); UPark default unchanged
GQL_URL = "https://api.cove.is/gql"
EASTERN = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# Same query string the Cove web app sends. Preserved verbatim (whitespace
# included) so the operation hash matches if Cove ever switches to APQ.
QUERY = """
    query GetPMTasksPage($networkId: ID!, $page: GQLPageInput, $sortBy: GQLSortByInput, $filter: GQLFilterInput) {
  siteNetwork(id: $networkId) {
    pmTasks(page: $page, sortBy: $sortBy, filter: $filter) {
      items {
        ...PMTaskTable
      }
      page {
        total
      }
    }
  }
}

    fragment PMTaskTable on GQLPMTask {
  altId
  assignee {
    email
    firstName
    id
    lastName
  }
  cadence {
    duration
    period
  }
  category {
    id
    name
  }
  completedOn
  createdAt
  dueDate
  equipment {
    building {
      id
      name
    }
    category {
      id
      name
    }
    floor {
      id
      name
    }
    id
    name
    suite {
      id
      name
    }
  }
  estimatedHours
  groups(sortBy: {field: "name", desc: false}) {
    items {
      id
      name
    }
  }
  hoursLogged
  id
  linkedTasks {
    altId
    id
  }
  name
  site {
    id
    name
    region
  }
  status
  type
  updatedAt
}
    """

# Mirror the user's PM12 bookmark (verified from DevTools 2026-05-19):
#   - status:   open + completed (dashboard sees recently-finished PMs too)
#   - assignee: only the 12 engineers/managers on the COVE team
#   - dueDate:  rolling N-day lookback from today (bump PM_DUE_LOOKBACK_DAYS
#               to widen or narrow the window — no need to keep editing dates)
#
# Since 0127 the assignee list is roster-driven: at run start we read
# engineer_profiles.cove_user_id for every active UPark engineer (via
# v_upark_active_engineers) and UNION it with this legacy list — see
# cove_roster.assignee_ids. So a new hire is a single field in Admin › User
# Profiles (Cove user ID), no code change. This list stays as the floor:
# an empty assignee filter would pull the whole Cove network, so if the
# roster read ever fails we still poll for everyone captured here.
#
# 2026-08-18: Austin Myette (DVQ8HxDTKS) — hired 06-22, a month after this
# list was captured, so his 61 open PMs were invisible to the dashboard for
# ~8 weeks (0 rows in every snapshot). That's what motivated the roster
# column + cove_roster.roster_gap_check, which logs a warn row whenever an
# active engineer has 0 fetched tasks.
PM_ASSIGNEE_IDS = [
    "thGxmdCU3x", "uv9FFWuCIT", "V0cfCtkNuC", "8ZVqd2HExb",
    "D6ZvMf8Mcj", "RxaNCAOXew", "IKIPg7ql0G", "9PAgDPhuXE",
    "uQNAPN9ipb", "hGCSa1lcK5", "IrQac3eAnX", "yGVXKlnu4F",
    "DVQ8HxDTKS",  # Austin Myette
]
PM_DUE_LOOKBACK_DAYS = 60

# Cove status enum values. Split so the poller can fetch open (for pm_rows
# snapshot) and closed (for pm_close_events log) in separate paginated calls.
OPEN_STATUSES   = ["in_progress", "on_hold", "to_do"]
CLOSED_STATUSES = ["completed"]

SORT_BY = {"desc": True, "field": "createdAt"}
PAGE_LIMIT = 100


def compute_due_date_start() -> str:
    """Midnight Eastern, N days before today, expressed as the UTC ISO string
    Cove's GQL expects (e.g. '2026-03-20T04:00:00.000Z')."""
    today_eastern = datetime.now(EASTERN).replace(hour=0, minute=0, second=0, microsecond=0)
    start_eastern = today_eastern - timedelta(days=PM_DUE_LOOKBACK_DAYS)
    return start_eastern.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# "Assignee = Unassigned": the Cove UI's URL spells it CONTAINED_IN
# [{"id": null}], but the API wants a plain [null] (first live run,
# 2026-11-06: the object form was rejected, [null] returned 88). [null]
# first; the URL form stays as a fallback.
UNASSIGNED_VALUES: list[list] = [[None], [{"id": None}]]


def build_pm_filter(statuses: list[str], assignee_ids: list[str] | None = None,
                    assignee_value: list | None = None, due_floor: bool = True) -> dict:
    """assignee_value overrides the id list (used for the unassigned fetch).
    due_floor=False drops the rolling 60-day dueDate floor — the unassigned
    fetch wants every open unassigned PM however old (2026-11-06: Cove
    showed 138 unassigned, the floor let through 88)."""
    items = [
        {"field": "status",   "operator": "CONTAINED_IN", "value": statuses},
        {"field": "assignee", "operator": "CONTAINED_IN",
         "value": assignee_value if assignee_value is not None else (assignee_ids or PM_ASSIGNEE_IDS)},
    ]
    if due_floor:
        items.append({"field": "dueDate", "operator": "DATE_RANGE", "value": {"start": compute_due_date_start()}})
    return {"items": items, "orItems": []}


# ---------- helpers ----------

def hour_label(dt: datetime) -> str:
    h = dt.hour
    period = "pm" if h >= 12 else "am"
    h12 = h % 12 or 12
    return f"{h12}{period}"


def synthetic_filename(now_local: datetime) -> str:
    return f"api-{filename_label('COVE PM12')} {now_local.strftime('%Y-%m-%d %H-%M')}.csv"


def decode_token_exp(jwt: str) -> int | None:
    try:
        seg = jwt.split(".")[1]
        seg += "=" * ((4 - len(seg) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(seg)).get("exp")
    except Exception:
        return None


# Cove's status enum (snake_case) -> the human-readable strings the CSV uses
# (so dashboard queries that filter on status keep matching across both paths).
_STATUS_HUMAN = {
    "in_progress": "In Progress",
    "on_hold":     "On Hold",
    "to_do":       "To Do",
    "completed":   "Completed",
    "cancelled":   "Cancelled",
    "canceled":    "Cancelled",
}

def humanize_status(s: str | None) -> str | None:
    if not s:
        return None
    return _STATUS_HUMAN.get(s, " ".join(w.capitalize() for w in s.split("_")))


# Format cadence as "1 month" / "3 months" / "1 year" etc to match the CSV's
# Interval column. period comes back as an enum like "MONTH" / "WEEK".
def format_interval(cadence: dict | None) -> str | None:
    if not cadence:
        return None
    dur = cadence.get("duration")
    per = cadence.get("period")
    if dur is None or not per:
        return None
    unit = str(per).lower()
    plural = "s" if dur != 1 else ""
    return f"{dur} {unit}{plural}"


def assignee_name(assignee: dict | None) -> str | None:
    if not assignee:
        return None
    fn = (assignee.get("firstName") or "").strip()
    ln = (assignee.get("lastName") or "").strip()
    name = f"{fn} {ln}".strip()
    return name or None


def safe_get(d: dict | None, *keys):
    """Walk nested dicts safely; returns None at the first missing/None hop."""
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


def iso_date(s: str | None) -> str | None:
    """Convert ISO-8601 (with or without time) to YYYY-MM-DD."""
    if not s:
        return None
    try:
        # GQL gives full timestamps for createdAt/dueDate (e.g. "2026-05-18T...");
        # for date-only columns we just want the date portion.
        return s[:10] if "T" in s else s
    except Exception:
        return None


def map_pm_task(item: dict, snapshot_id: str) -> dict:
    name = item.get("name")
    return {
        "snapshot_id":        snapshot_id,
        "task_no":            item.get("altId"),
        "due_date":           iso_date(item.get("dueDate")),
        "site":               safe_get(item, "site", "name"),
        "building_code":      safe_get(item, "equipment", "building", "name"),
        "equipment":          safe_get(item, "equipment", "name"),
        "name":               name,
        "interval":           format_interval(item.get("cadence")),
        "status":             humanize_status(item.get("status")),
        "assigned_to_name":   assignee_name(item.get("assignee")),
        "open_date":          iso_date(item.get("createdAt")),
        "category":           safe_get(item, "category", "name"),
        "est_labor_hours":    item.get("estimatedHours"),
        "suite":              safe_get(item, "equipment", "suite", "name"),
        "labor_hours":        item.get("hoursLogged"),
        "equipment_category": safe_get(item, "equipment", "category", "name"),
        "updated_at_cmms":    item.get("updatedAt"),
        "object_id":          safe_get(item, "equipment", "id"),
        "pm_type":            classify_pm(name),
        "cmms_type":          item.get("type"),
        # Cove's internal task id — what UpdatePMTask takes (0156, the
        # dashboard's assign-PM button). altId above is the PM-ROG-6743 label.
        "cove_task_id":       item.get("id"),
    }


def map_close_event(item: dict, snapshot_id: str) -> dict:
    """Build a pm_close_events row from a Completed Cove PM task.

    Identity in the table is (task_no, completed_on) — a reopen + reclose creates
    a new row, which is the desired behavior. completedOn comes straight from
    Cove's authoritative close time."""
    name = item.get("name")
    return {
        "task_no":            item.get("altId"),
        "object_id":          safe_get(item, "equipment", "id"),
        "completed_on":       item.get("completedOn"),
        "source_snapshot_id": snapshot_id,
        "site":               safe_get(item, "site", "name"),
        "building_code":      safe_get(item, "equipment", "building", "name"),
        "suite":              safe_get(item, "equipment", "suite", "name"),
        "equipment":          safe_get(item, "equipment", "name"),
        "equipment_category": safe_get(item, "equipment", "category", "name"),
        "category":           safe_get(item, "category", "name"),
        "assigned_to_name":   assignee_name(item.get("assignee")),
        "task_name":          name,
        "due_date":           iso_date(item.get("dueDate")),
        "open_date":          iso_date(item.get("createdAt")),
        "interval":           format_interval(item.get("cadence")),
        "pm_type":            classify_pm(name),
        "cmms_type":          item.get("type"),
        "labor_hours":        item.get("hoursLogged"),
        "est_labor_hours":    item.get("estimatedHours"),
    }


# No start date on GQLPMTask: the Cove detail page's PMTaskBase fragment
# (captured 2026-11-13) has only createdAt / dueDate / completedOn /
# updatedAt. The dashboard's "Start" is open_date (= createdAt, below).

def post_gql(body: dict) -> dict:
    headers = {
        # Raw JWT, NO "Bearer " prefix — Cove's auth quirk (see reference_cove_api.md).
        "Authorization": TOKEN,
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
    # Cove's siteNetwork resolver authenticates via the cove_manage_auth cookie,
    # not the Authorization header (which it ignores). Send the fresh session
    # token as that cookie; the legacy static COVE_COOKIE env is no longer used.
    headers["Cookie"] = f"cove_manage_auth={TOKEN}"
    resp = requests.post(GQL_URL, headers=headers, json=body, timeout=30)
    return resp.status_code, resp


def fetch_unassigned_pm_tasks(statuses: list[str]) -> list[dict]:
    """Open PMs with no assignee. Tries each UNASSIGNED_VALUES spelling until
    one is accepted; whatever comes back is filtered client-side to items
    whose assignee really is empty, so a misread filter can never leak the
    rest of the network into the snapshot."""
    last_err: Exception | None = None
    for value in UNASSIGNED_VALUES:
        try:
            items = fetch_all_pm_tasks(statuses, None, assignee_value=value, due_floor=False)
        except RuntimeError as e:
            last_err = e
            print(f"  unassigned filter {value!r} rejected: {e}", file=sys.stderr)
            continue
        kept = [it for it in items if not (it.get("assignee") or {}).get("id")]
        if len(kept) != len(items):
            print(f"  WARN: unassigned filter {value!r} returned {len(items) - len(kept)} assigned task(s) — "
                  f"filter not honoured as expected; kept the {len(kept)} truly unassigned", file=sys.stderr)
        print(f"  unassigned open PMs: {len(kept)} (filter {value!r})")
        return kept
    raise RuntimeError(f"every unassigned-filter spelling was rejected: {last_err}")


def fetch_all_pm_tasks(statuses: list[str], ids: list[str] | None = None,
                       assignee_value: list | None = None, due_floor: bool = True) -> list[dict]:
    """Paginate through every PM task matching the bookmark filter. Cove's UI
    sends limit=25 but for a poller we want fewer round-trips, so PAGE_LIMIT=100."""
    pm_filter = build_pm_filter(statuses, ids, assignee_value, due_floor)
    due_note = f"dueDate >= {pm_filter['items'][2]['value']['start']} (rolling {PM_DUE_LOOKBACK_DAYS}d)" if due_floor else "no dueDate floor"
    print(f"  status={statuses}  {due_note}")
    out: list[dict] = []
    skip = 0
    while True:
        body = {
            "operationName": "GetPMTasksPage",
            "query": QUERY,
            "variables": {
                "networkId": NETWORK_ID,
                "filter": pm_filter,
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
        page = safe_get(data, "data", "siteNetwork", "pmTasks") or {}
        items = page.get("items") or []
        total = safe_get(page, "page", "total") or 0
        out.extend(items)
        print(f"  fetched skip={skip} got={len(items)} total_so_far={len(out)}/{total}")
        if len(items) == 0 or len(out) >= total:
            break
        skip += PAGE_LIMIT
        # Safety: stop if the response is misbehaving so we don't loop forever.
        if skip > 50_000:
            raise RuntimeError(f"pagination runaway at skip={skip}")
    return out


# ---------- main ----------

def main() -> int:
    now_local = datetime.now(EASTERN)
    filename = synthetic_filename(now_local)

    # Sundays — skip (UPark only; Binney's Sun–Wed crew works Sundays).
    if sunday_skip() and now_local.weekday() == 6:
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

    print(f"[{now_local.isoformat()}] polling pm12 for site={SITE} network={NETWORK_ID} (open snapshot + closes-since-last)")

    client = get_client()

    # Look up the most recent pm12 snapshot's taken_at. Any closed PM whose
    # completedOn is AFTER this is a new close we haven't logged yet. On the
    # very first run this is None and we'll insert every closed task in window
    # — the UNIQUE (task_no, completed_on) constraint protects subsequent runs.
    prev = (
        client.table("snapshots")
        .select("taken_at")
        .eq("kind", "pm12")
        .eq("site_code", SITE)
        .order("taken_at", desc=True)
        .limit(1)
        .execute()
    )
    since_iso = prev.data[0]["taken_at"] if prev.data else None
    print(f"  since_iso={since_iso}")

    # Assignee filter = roster cove_user_ids ∪ legacy list (cove_roster).
    try:
        ids = assignee_ids(client, PM_ASSIGNEE_IDS, "pm12")
    except RuntimeError as e:
        _log_error(filename, str(e))
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    try:
        open_items   = fetch_all_pm_tasks(OPEN_STATUSES, ids)
        closed_items = fetch_all_pm_tasks(CLOSED_STATUSES, ids)
    except Exception as e:
        msg = str(e)
        if "Not Authenticated" in msg:
            msg += " — auth rejected mid-run. Try `python cove_session.py refresh`; if that fails, re-bootstrap from DevTools."
        _log_error(filename, msg)
        print(f"ERROR: {msg}", file=sys.stderr)
        return 1

    # Binney (cove_sites.fetch_unassigned): the month's new PMs land with no
    # assignee; pull them too so the manager page can hand them out. Best
    # effort — a failure here is logged, the roster snapshot still lands.
    if fetch_unassigned():
        try:
            seen = {it.get("id") for it in open_items}
            extra = [it for it in fetch_unassigned_pm_tasks(OPEN_STATUSES) if it.get("id") not in seen]
            open_items = open_items + extra
            print(f"  + {len(extra)} unassigned open PM(s) added to the snapshot")
        except Exception as e:  # noqa: BLE001
            print(f"WARN: unassigned PM fetch failed, snapshot is roster-only this run: {e}", file=sys.stderr)
            _log_error(filename, f"unassigned PM fetch failed (snapshot still written): {e}")

    all_items = open_items + closed_items
    # Learn Cove IDs for roster profiles that lack one (legacy 12 self-populate
    # on first run), then warn about anyone on the roster with 0 fetched PMs.
    backfill_cove_ids(client, all_items, "pm12")
    roster_gap_check(client, all_items, "pm12", filename)

    # ----- pm_rows: open work queue only (To Do / In Progress / On Hold) -----
    snap = client.table("snapshots").insert({
        "kind":        "pm12",
        "site_code":   SITE,
        "taken_at":    datetime.now(UTC).isoformat(),
        "filename":    filename,
        "source_path": "api://api.cove.is/gql",
    }).execute()
    snapshot_id = snap.data[0]["id"]

    rows = [map_pm_task(it, snapshot_id) for it in open_items]
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        client.table("pm_rows").insert(rows[i:i + CHUNK]).execute()

    # ----- pm_close_events: only PMs newly closed since the previous snapshot -----
    events = []
    for it in closed_items:
        co = it.get("completedOn")
        if not co:
            continue                        # reopened / never closed — skip
        if since_iso and co <= since_iso:
            continue                        # already captured in a prior run
        ev = map_close_event(it, snapshot_id)
        ev["site_code"] = SITE
        events.append(ev)

    for i in range(0, len(events), CHUNK):
        client.table("pm_close_events").upsert(
            events[i:i + CHUNK],
            on_conflict="task_no,completed_on",
        ).execute()

    client.table("snapshots").update({"row_count": len(rows)}).eq("id", snapshot_id).execute()
    client.table("ingestion_log").insert({
        "filename":    filename,
        "kind":        "pm12",
        "status":      "ok",
        "rows":        len(rows),
        "snapshot_id": snapshot_id,
    }).execute()

    print(f"[ok] {filename}: {len(rows)} open rows, {len(events)} new closes")

    # ----- pm_task_details: audit evidence for the closes just logged -----
    # docs/pm-audit.md §3. After the snapshot's bookkeeping on purpose: a slow
    # or failing detail pull must never cost the poll its snapshot.
    pull_close_details(client, closed_items, events)
    return 0


# ---------- PM audit: task details ----------

# Per-run ceiling on inline detail pulls (~1 s each). A normal poll logs a
# handful of closes; a first run for a site logs the whole window, and those
# belong to `pm12_poller.py backfill-details`, not to the hourly poll.
DETAILS_INLINE_MAX = 150


def _details_session() -> requests.Session:
    """requests.Session carrying the Cove auth cookie (the same token post_gql
    sends), for cove_task_details."""
    s = cove_task_details.make_session(TOKEN)
    s.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/148.0.0.0 Safari/537.36"
    )
    return s


def pull_close_details(client, closed_items: list[dict], events: list[dict]) -> None:
    """Fetch steps / attachments / history for the recurring PMs this run just
    logged as closed and upsert them into pm_task_details. The closed fetch
    already carries Cove's internal id per task, so no pm_rows lookup."""
    try:
        id_by_task = {it.get("altId"): it.get("id") for it in closed_items}
        ids = [
            id_by_task[ev["task_no"]] for ev in events
            if ev.get("cmms_type") == "recurring" and id_by_task.get(ev["task_no"])
        ]
        if not ids:
            return
        if len(ids) > DETAILS_INLINE_MAX:
            print(f"  task details: {len(ids)} new recurring closes — pulling the newest "
                  f"{DETAILS_INLINE_MAX}; run `pm12_poller.py backfill-details` for the rest")
            ids = ids[:DETAILS_INLINE_MAX]   # closed_items is createdAt-desc
        print(f"  task details: pulling {len(ids)} closed PM(s)")
        cove_task_details.on_close_events(_details_session(), client, ids)
    except Exception as e:  # noqa: BLE001
        print(f"WARN: task-details pull failed (snapshot unaffected): {e}", file=sys.stderr)


def _all_values(client, table: str, column: str, **eq) -> set[str]:
    """Every value of one column, paged past PostgREST's 1000-row cap."""
    out: set[str] = set()
    start = 0
    while True:
        q = client.table(table).select(column)
        for k, v in eq.items():
            q = q.eq(k, v)
        got = q.range(start, start + 999).execute().data or []
        out.update(r[column] for r in got if r.get(column))
        if len(got) < 1000:
            return out
        start += 1000


def backfill_details(days: int = 180) -> int:
    """One-time: detail rows for closed recurring PMs that pm12 logged before
    pm_rows carried cove_task_id (0156, 2026-11-06) — those never appear in
    v_pm_task_details_backlog, which finds the Cove id through pm_rows.

    Re-reads the site's closed list from Cove with a `days` due-date floor
    (wider than the hourly poll's 60), keeps the recurring tasks this site has
    a pm_close_events row for and no pm_task_details row yet, newest close
    first. Safe to re-run; it only fetches what is still missing.

        COVE_SITE=binney .venv/bin/python pm12_poller.py backfill-details 180
    """
    global TOKEN, PM_DUE_LOOKBACK_DAYS
    TOKEN = get_fresh_token()
    PM_DUE_LOOKBACK_DAYS = days
    client = get_client()
    ids = assignee_ids(client, PM_ASSIGNEE_IDS, "pm12")
    closed = fetch_all_pm_tasks(CLOSED_STATUSES, ids)

    logged = _all_values(client, "pm_close_events", "task_no", site_code=SITE, cmms_type="recurring")
    have = _all_values(client, "pm_task_details", "task_no")
    todo = [it for it in closed
            if it.get("id") and it.get("completedOn")
            and it.get("altId") in logged and it.get("altId") not in have]
    todo.sort(key=lambda it: it["completedOn"], reverse=True)
    print(f"[backfill-details] site={SITE} closed in Cove={len(closed)} logged recurring={len(logged)} "
          f"already have={len(have & logged)} to fetch={len(todo)}")

    session = _details_session()
    sleep = float(os.environ.get("COVE_RATE_SLEEP", "0.5"))
    ok = err = 0
    for i, it in enumerate(todo, 1):
        try:
            row = cove_task_details.normalize(cove_task_details.fetch_task(session, it["id"]))
            cove_task_details.upsert(client, row)
            ok += 1
            if i % 25 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)} ok={ok} err={err} (last {row['task_no']})", flush=True)
        except Exception as e:  # noqa: BLE001
            err += 1
            print(f"  {i}/{len(todo)} {it.get('altId')} ERROR {e}", file=sys.stderr, flush=True)
        time.sleep(sleep)
    print(f"[backfill-details] done ok={ok} err={err}")
    return 0 if err == 0 else 1


def _log_error(filename: str, error_msg: str) -> None:
    try:
        get_client().table("ingestion_log").insert({
            "filename":  filename,
            "kind":      "pm12",
            "status":    "error",
            "rows":      0,
            "error_msg": error_msg[:4000],
        }).execute()
    except Exception as e:
        print(f"WARN: also failed to write ingestion_log: {e}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "backfill-details":
        sys.exit(backfill_details(int(sys.argv[2]) if len(sys.argv) > 2 else 180))
    sys.exit(main())
