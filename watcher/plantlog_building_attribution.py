r"""Per-building entry rollup via time-clustering inference.

The XLSX export from plantlog's "Log Records By User" report doesn't tell us
WHICH physical building each row belongs to when an equipment name exists
in multiple buildings (e.g., "Fire Pump (Always)" in "First Floor" exists
in 8 different buildings). This script infers the building via co-presence
within time-bounded clusters of an engineer's day.

Algorithm:
  1. Build (log_name, group_name) -> {set of buildings} from plantlog's
     live /groups + /logs catalog.
  2. Within each (user, day), sort rows by timestamp.
  3. Cluster: a 25-min gap starts a new cluster (engineers don't move
     between buildings inside that window; a typical round logs entries
     every 1-3 min).
  4. For each cluster, compute building "votes" from unambiguous rows.
     The building with the most votes wins the cluster. Ties resolved
     to the temporally-closest prior cluster's building.
  5. Attribute every row in a cluster (including ambiguous ones) to the
     cluster's building.

Run:
    .\.venv\Scripts\python.exe plantlog_building_attribution.py [DAYS]

Defaults to 4 days. Output is a table + diagnostic counters.
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")
sys.path.insert(0, str(HERE))
from plantlog_session import login  # noqa: E402
from supabase_client import get_client  # noqa: E402

GAP_MIN = 25  # minutes — anything bigger starts a new cluster
BASE = "https://cwservices-bmrupark.plantlog.com/plantlog/api"
H = {
    "Referer": "https://cwservices-bmrupark.plantlog.com/",
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}


def build_lookup(cookies: dict[str, str]) -> dict[tuple[str, str], frozenset[str]]:
    """(log_name, group_name) -> set of plausible buildings."""
    groups = requests.get(f"{BASE}/groups", cookies=cookies, headers=H, timeout=30).json()
    logs   = requests.get(f"{BASE}/logs",   cookies=cookies, headers=H, timeout=30).json()
    gmap = {g["groupId"]: (g["name"], g.get("parentId") if g.get("parentId") and g.get("parentId") != -1 else None) for g in groups}

    def root_of(gid: int | None) -> str | None:
        seen = set()
        while gid in gmap and gid not in seen:
            seen.add(gid)
            name, parent = gmap[gid]
            if parent is None:
                return name
            gid = parent
        return None

    lookup: dict[tuple[str, str], set[str]] = defaultdict(set)
    for L in logs:
        gid = L.get("groupId")
        if gid not in gmap:
            continue
        sub_name = gmap[gid][0]
        bldg = root_of(gid)
        if bldg:
            lookup[(L["name"], sub_name)].add(bldg)
    return {k: frozenset(v) for k, v in lookup.items()}


def attribute_nearest_neighbor(
    rows: list[dict],
    lookup: dict[tuple[str, str], frozenset[str]],
    max_gap_min: int = 15,
) -> tuple[Counter, dict[str, int]]:
    """Per-entry attribution: each ambiguous entry inherits from its
    temporally-closest unambiguous neighbor in the same user-day, as long
    as that neighbor is within max_gap_min. Otherwise the entry is unattributed.

    UPark is a campus where engineers can walk between buildings in <2 min,
    so we can't rely on clustering. Nearest-unambiguous-neighbor is more
    honest: it only attributes when we have direct local evidence.
    """
    rows_sorted = sorted(rows, key=lambda r: (r["user_name"], r["performed_at_utc"]))
    diag = {
        "total":               len(rows),
        "unambiguous":         0,
        "inferred":            0,  # nearest-neighbor within max_gap
        "unattributed":        0,  # ambiguous and no close-enough neighbor
    }
    per_building: Counter = Counter()
    per_building_day: Counter = Counter()
    per_user_day_building: Counter = Counter()
    by_user_day: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows_sorted:
        day = r["performed_at_utc"][:10]
        by_user_day[(r["user_name"], day)].append(r)

    for (_user, _day), day_rows in by_user_day.items():
        # First pass: tag each row with its unambiguous building (or None)
        for r in day_rows:
            key = (r["log_name"], r["group_name"] or "")
            bs = lookup.get(key, frozenset())
            r["_ts"] = datetime.fromisoformat(r["performed_at_utc"].replace("Z", "+00:00"))
            r["_building"] = next(iter(bs)) if len(bs) == 1 else None
            r["_inferred"] = False

        # Second pass: fill ambiguous rows from nearest unambiguous neighbor
        anchors = [r for r in day_rows if r["_building"] is not None]
        if not anchors:
            for r in day_rows:
                diag["unattributed"] += 1
            continue
        anchor_idx = 0
        for r in day_rows:
            if r["_building"] is not None:
                diag["unambiguous"] += 1
                per_building[r["_building"]] += 1
                per_building_day[(r["_building"], r["performed_on"])] += 1
                per_user_day_building[(r["user_name"], r["performed_on"], r["_building"])] += 1
                continue
            # Find nearest anchor in time
            # Advance anchor_idx so it points to the last anchor at-or-before r._ts
            while anchor_idx + 1 < len(anchors) and anchors[anchor_idx + 1]["_ts"] <= r["_ts"]:
                anchor_idx += 1
            cand_before = anchors[anchor_idx] if anchors[anchor_idx]["_ts"] <= r["_ts"] else None
            cand_after = None
            if cand_before is None:
                cand_after = anchors[0]
            elif anchor_idx + 1 < len(anchors):
                cand_after = anchors[anchor_idx + 1]
            best = None
            best_gap = timedelta(minutes=max_gap_min + 1)
            for c in (cand_before, cand_after):
                if c is None:
                    continue
                gap = abs(c["_ts"] - r["_ts"])
                if gap <= timedelta(minutes=max_gap_min) and gap < best_gap:
                    best = c
                    best_gap = gap
            if best is not None:
                per_building[best["_building"]] += 1
                per_building_day[(best["_building"], r["performed_on"])] += 1
                per_user_day_building[(r["user_name"], r["performed_on"], best["_building"])] += 1
                diag["inferred"] += 1
            else:
                diag["unattributed"] += 1

    return per_building, per_building_day, per_user_day_building, diag


def attribute_and_persist(days: int = 14, client=None) -> dict[str, int]:
    """Run attribution for rows in the last `days` days, write
    building_inferred + attribution_source back to plantlog_log_records.
    Returns the diagnostics dict so callers can log it.

    This is the function plantlog_poller calls at the end of each ingest.
    """
    cookies = login()
    lookup = build_lookup(cookies)
    if client is None:
        client = get_client()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows: list[dict] = []
    PAGE = 1000  # PostgREST server-side cap; paginate via .range()
    offset = 0
    while True:
        page = client.table("plantlog_log_records") \
            .select("id,user_name,performed_at_utc,performed_on,group_name,log_name") \
            .gte("performed_at_utc", cutoff) \
            .order("id") \
            .range(offset, offset + PAGE - 1) \
            .execute()
        if not page.data:
            break
        rows.extend(page.data)
        if len(page.data) < PAGE:
            break
        offset += PAGE

    # Run attribution but capture per-row results (we need ids to UPDATE).
    rows_sorted = sorted(rows, key=lambda r: (r["user_name"], r["performed_at_utc"]))
    by_user_day: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows_sorted:
        day = r["performed_at_utc"][:10]
        by_user_day[(r["user_name"], day)].append(r)

    diag = {"total": len(rows), "unambiguous": 0, "inferred": 0, "unattributed": 0}
    updates: list[dict] = []

    for (_user, _day), day_rows in by_user_day.items():
        for r in day_rows:
            key = (r["log_name"], r["group_name"] or "")
            bs = lookup.get(key, frozenset())
            r["_ts"] = datetime.fromisoformat(r["performed_at_utc"].replace("Z", "+00:00"))
            r["_building"] = next(iter(bs)) if len(bs) == 1 else None

        anchors = [r for r in day_rows if r["_building"] is not None]
        anchor_idx = 0
        for r in day_rows:
            building = None
            source = None
            if r["_building"] is not None:
                building = r["_building"]
                source = "direct"
                diag["unambiguous"] += 1
            elif anchors:
                while anchor_idx + 1 < len(anchors) and anchors[anchor_idx + 1]["_ts"] <= r["_ts"]:
                    anchor_idx += 1
                cand_before = anchors[anchor_idx] if anchors[anchor_idx]["_ts"] <= r["_ts"] else None
                cand_after = None
                if cand_before is None:
                    cand_after = anchors[0]
                elif anchor_idx + 1 < len(anchors):
                    cand_after = anchors[anchor_idx + 1]
                best = None
                best_gap = timedelta(minutes=16)
                for c in (cand_before, cand_after):
                    if c is None:
                        continue
                    gap = abs(c["_ts"] - r["_ts"])
                    if gap <= timedelta(minutes=15) and gap < best_gap:
                        best = c; best_gap = gap
                if best is not None:
                    building = best["_building"]
                    source = "inferred"
                    diag["inferred"] += 1
                else:
                    diag["unattributed"] += 1
            else:
                diag["unattributed"] += 1

            updates.append({"id": r["id"], "building_inferred": building, "attribution_source": source})

    # Batch UPDATE per-column-value group. supabase-py has no batch-update
    # API and ON CONFLICT path validates NOT NULL on the INSERT side, so
    # upsert(returning='minimal') fails here. Group by (building, source)
    # and do one UPDATE WHERE id IN (...) per group — at most ~15 buildings
    # × 2 sources = ~30 calls per 14-day window.
    by_value: dict[tuple[str | None, str | None], list[int]] = defaultdict(list)
    for u in updates:
        by_value[(u["building_inferred"], u["attribution_source"])].append(u["id"])

    CHUNK = 1000  # avoid URL-length blowup on the .in_() filter
    for (building, source), ids in by_value.items():
        for i in range(0, len(ids), CHUNK):
            client.table("plantlog_log_records").update({
                "building_inferred":   building,
                "attribution_source":  source,
            }).in_("id", ids[i:i + CHUNK]).execute()

    return diag


def main(days: int = 4) -> int:
    cookies = login()
    lookup = build_lookup(cookies)
    print(f"lookup built: {len(lookup)} (log_name, group_name) combos")

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    client = get_client()
    res = client.table("plantlog_log_records") \
        .select("user_name,performed_at_utc,performed_on,group_name,log_name") \
        .gte("performed_at_utc", cutoff).execute()
    rows = res.data
    print(f"{len(rows)} log records in last {days} days\n")

    per_building, per_building_day, per_user_day_building, diag = attribute_nearest_neighbor(rows, lookup)

    # Per-day breakdown: building (row) x day (column)
    days_seen = sorted({d for _, d in per_building_day.keys()})
    print(f"=== Per-building entries by day (last {days} days) ===")
    header = f"{'Building':<25}" + "".join(f"{d[-5:]:>8}" for d in days_seen) + f"{'TOTAL':>8}"
    print(header)
    print("-" * len(header))
    for b, _ in sorted(per_building.items(), key=lambda x: -x[1]):
        row = f"{b:<25}"
        for d in days_seen:
            row += f"{per_building_day.get((b, d), 0):>8}"
        row += f"{per_building[b]:>8}"
        print(row)
    total_row = f"{'TOTAL':<25}"
    for d in days_seen:
        day_tot = sum(c for (b, dd), c in per_building_day.items() if dd == d)
        total_row += f"{day_tot:>8}"
    total_row += f"{sum(per_building.values()):>8}"
    print("-" * len(header))
    print(total_row)
    # Per-user × per-day × per-building drill-down
    print()
    print(f"=== Per-user daily building visits ===")
    users = sorted({u for u, _, _ in per_user_day_building.keys()})
    for user in users:
        print(f"\n{user}")
        for d in days_seen:
            day_buildings = [(b, n) for (u, dd, b), n in per_user_day_building.items()
                             if u == user and dd == d]
            if not day_buildings:
                continue
            day_buildings.sort(key=lambda x: -x[1])
            day_total = sum(n for _, n in day_buildings)
            chunks = ", ".join(f"{b}({n})" for b, n in day_buildings)
            print(f"  {d} [{day_total:>3}]: {chunks}")

    print()
    print(f"Diagnostics:")
    for k in ("total", "unambiguous", "inferred", "unattributed"):
        print(f"  {k:<14} {diag[k]:>5}")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    days = 4
    persist = False
    for a in args:
        if a == "--persist":
            persist = True
        elif a.isdigit():
            days = int(a)
    if persist:
        diag = attribute_and_persist(days=days)
        print(f"Persisted attribution for last {days} days.")
        for k, v in diag.items():
            print(f"  {k:<14} {v:>5}")
        sys.exit(0)
    sys.exit(main(days))
