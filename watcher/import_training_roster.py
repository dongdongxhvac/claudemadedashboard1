"""One-shot CSV importer for the Training & Competency roster (Phase A).

Loads two CSVs into the live schema, NON-DESTRUCTIVELY:

  buildings.csv    -> public.buildings   (Binney St buildings; UPark verify)
  technicians.csv  -> public.users + engineer_profiles + building_assignments

Safe to re-run. Existing rows -- matched on buildings.code and on
lower(full_name) for techs -- are never overwritten. Only a NULL site column
gets patched, and brand-new rows get inserted. Always preview with --dry-run
first.

Prereqs:
  * Migration 0072 applied (sites table + site_id / home_site_id columns).
  * SUPABASE_URL and SUPABASE_SERVICE_KEY set in the environment (same as the
    pollers). The service-role key bypasses RLS -- never ship it to a browser.
  * supabase-py available (already in watcher/.venv).

Usage (from repo root):
  python watcher/import_training_roster.py --dir seed/training --dry-run
  python watcher/import_training_roster.py --dir seed/training
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

# Allow running as `python watcher/import_training_roster.py` from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from supabase_client import get_client  # noqa: E402


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def site_ids(sb) -> dict[str, str]:
    rows = sb.table("sites").select("id, code").execute().data
    return {r["code"]: r["id"] for r in rows}


def import_buildings(sb, path: Path, sites: dict[str, str], dry: bool) -> None:
    if not path.exists():
        print(f"  (skip) {path.name} not found")
        return
    existing = {
        b["code"]: b
        for b in sb.table("buildings").select("id, code, site_id").execute().data
    }
    created = patched = unchanged = 0
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            code = _clean(row.get("code"))
            if not code:
                continue
            site_code = (row.get("site_code") or "").strip().lower()
            site_id = sites.get(site_code)
            if site_code and not site_id:
                print(f"  ! unknown site_code '{site_code}' for building {code} -- skipping")
                continue

            if code in existing:
                cur = existing[code]
                if site_id and not cur.get("site_id"):
                    print(f"  ~ patch site on existing building {code}")
                    if not dry:
                        sb.table("buildings").update({"site_id": site_id}).eq("id", cur["id"]).execute()
                    patched += 1
                else:
                    unchanged += 1
                continue

            payload = {
                "code": code,
                "name": _clean(row.get("name")) or code,
                "address": _clean(row.get("address")),
                "client_company": _clean(row.get("client_company")),
                "site_id": site_id,
            }
            print(f"  + building {code} ({payload['name']})")
            if not dry:
                sb.table("buildings").insert(payload).execute()
            created += 1
    print(f"  buildings: +{created} new, ~{patched} patched, {unchanged} unchanged")


def import_technicians(sb, path: Path, sites: dict[str, str], dry: bool) -> None:
    if not path.exists():
        print(f"  (skip) {path.name} not found")
        return
    by_name = {
        u["full_name"].strip().lower(): u["id"]
        for u in sb.table("users").select("id, full_name").execute().data
    }
    bldgs = {
        b["code"]: b["id"]
        for b in sb.table("buildings").select("id, code").execute().data
    }
    created = existing = 0
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            name = _clean(row.get("full_name"))
            if not name:
                continue
            site_code = (row.get("site_code") or "").strip().lower()
            site_id = sites.get(site_code)
            uid = by_name.get(name.lower())

            if uid:
                print(f"  = exists: {name} (leaving as-is)")
                existing += 1
            else:
                user_payload = {
                    "full_name": name,
                    "email": _clean(row.get("email")),
                    "role": _clean(row.get("role")) or "engineer",
                    "hiring_date": _clean(row.get("hiring_date")),
                }
                print(f"  + tech {name}")
                created += 1
                if not dry:
                    uid = sb.table("users").insert(user_payload).execute().data[0]["id"]
                    level = _clean(row.get("level"))
                    profile = {
                        "user_id": uid,
                        "home_site_id": site_id,
                        "discipline": _clean(row.get("discipline")),
                        "level": int(level) if level else 1,
                        "cmms_assignee_name": _clean(row.get("cmms_assignee_name")),
                        "plantlog_username": _clean(row.get("plantlog_username")),
                        "title": _clean(row.get("title")),
                    }
                    sb.table("engineer_profiles").upsert(profile, on_conflict="user_id").execute()

            primary = _clean(row.get("primary_building_code"))
            if primary and uid and not dry:
                if primary not in bldgs:
                    print(f"    ! primary_building_code '{primary}' not found -- assignment skipped")
                else:
                    sb.table("building_assignments").upsert(
                        {"building_id": bldgs[primary], "user_id": uid, "role_in_building": "primary"},
                        on_conflict="building_id,user_id,role_in_building,starts_on",
                    ).execute()
    print(f"  technicians: +{created} new, {existing} already present")


def main() -> None:
    ap = argparse.ArgumentParser(description="Import Training roster CSVs (Phase A).")
    ap.add_argument("--dir", default="seed/training", help="folder holding buildings.csv / technicians.csv")
    ap.add_argument("--dry-run", action="store_true", help="preview without writing")
    args = ap.parse_args()

    sb = get_client()
    sites = site_ids(sb)
    if "upark" not in sites or "binney" not in sites:
        raise SystemExit("sites table not seeded -- apply migration 0072 first")

    base = Path(args.dir)
    mode = "DRY RUN" if args.dry_run else "LIVE"
    print(f"== Training roster import ({mode}) from {base} ==")
    print("buildings.csv:")
    import_buildings(sb, base / "buildings.csv", sites, args.dry_run)
    print("technicians.csv:")
    import_technicians(sb, base / "technicians.csv", sites, args.dry_run)
    print("done.")


if __name__ == "__main__":
    main()
