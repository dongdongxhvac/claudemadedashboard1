"""Cove assignee roster — shared by pm12_poller and wo12_poller.

The pollers filter Cove server-side by assignee ID. Historically that list
was hardcoded in each poller (captured 2026-05-19); a hire made after that
was invisible to the dashboard until someone edited Python and redeployed
the VM (Austin Myette, 06-22 → discovered 08-18). Since 0127 the ID lives
on the profile: engineer_profiles.cove_user_id, editable in Admin › User
Profiles. This module:

  assignee_ids(client, legacy)  → the filter list = roster IDs ∪ legacy.
      Union, never replace: if the roster read fails or is empty we still
      poll for everyone the legacy list knows. An EMPTY assignee filter
      would pull the whole Cove network (contractors, other CW staff…),
      which is a data-shape change nobody asked for — so the legacy list is
      the floor, and the roster is how it grows.

  backfill_cove_ids(client, items, kind)  → stamp cove_user_id on any
      roster profile whose cmms_assignee_name matches a fetched task's
      assignee name and has no ID yet. Every fetched task carries
      assignee.id, so the 12 legacy people self-populate on the first poll
      after deploy. Best-effort — logs and swallows its own errors.

  roster_gap_check(client, items, kind, filename)  → warn to
      ingestion_log about any active roster engineer with 0 fetched tasks
      (moved here from pm12_poller so wo12 gets it too). Best-effort.

All three read v_upark_active_engineers (0126/0127) with the service-role
client the pollers already hold.
"""
from __future__ import annotations

import sys


def _full_name(assignee: dict | None) -> str | None:
    if not assignee:
        return None
    fn = (assignee.get("firstName") or "").strip()
    ln = (assignee.get("lastName") or "").strip()
    name = f"{fn} {ln}".strip()
    return name or None


def _roster(client) -> list[dict]:
    res = (
        client.table("v_upark_active_engineers")
        .select("user_id, full_name, cmms_assignee_name, cove_user_id")
        .execute()
    )
    return res.data or []


def assignee_ids(client, legacy: list[str], label: str = "") -> list[str]:
    """Roster cove_user_ids ∪ legacy list, deduped, order-stable (legacy
    first so the request body is stable across runs when nothing changed)."""
    ids: list[str] = list(dict.fromkeys(legacy))
    try:
        roster = _roster(client)
        added = 0
        for r in roster:
            cid = (r.get("cove_user_id") or "").strip()
            if cid and cid not in ids:
                ids.append(cid)
                added += 1
        print(f"  assignee filter{(' ' + label) if label else ''}: {len(legacy)} legacy + {added} from roster = {len(ids)}")
    except Exception as e:  # noqa: BLE001
        print(f"WARN: roster read failed, using legacy assignee list only: {e}", file=sys.stderr)
    return ids


def backfill_cove_ids(client, items: list[dict], kind: str) -> int:
    """For each fetched task, if its assignee's name matches a roster row
    with NULL cove_user_id, set it. Returns how many profiles were updated.
    Name → id map is built from the fetch, so this only ever learns IDs of
    people whose tasks we already receive — it can't discover someone the
    filter excludes (that's what the manual field + gap warning are for)."""
    try:
        seen: dict[str, str] = {}
        for it in items:
            a = it.get("assignee") or {}
            name = _full_name(a)
            cid = (a.get("id") or "").strip()
            if name and cid and name not in seen:
                seen[name] = cid
        if not seen:
            return 0
        roster = _roster(client)
        updated = 0
        for r in roster:
            if r.get("cove_user_id"):
                continue
            cmms = (r.get("cmms_assignee_name") or "").strip()
            cid = seen.get(cmms)
            if not cid:
                continue
            client.table("engineer_profiles").update({"cove_user_id": cid}) \
                  .eq("user_id", r["user_id"]).execute()
            print(f"  backfilled cove_user_id for {r['full_name']} ← {cid}")
            updated += 1
        return updated
    except Exception as e:  # noqa: BLE001
        print(f"WARN: cove_user_id backfill failed ({kind}): {e}", file=sys.stderr)
        return 0


def roster_gap_check(client, items: list[dict], kind: str, filename: str) -> None:
    """Warn (ingestion_log status='warn') when an active roster engineer has
    ZERO tasks in this fetch. That's the fingerprint of a missing Cove ID:
    Cove filters server-side, so a missing ID doesn't error — the person's
    tasks simply never arrive. Zero is also *possible* legitimately (brand-new
    hire, long leave), hence a warn row, not a failure, and it never blocks
    the snapshot write."""
    try:
        seen = {_full_name(it.get("assignee")) for it in items}
        seen.discard(None)
        roster = _roster(client)
        missing = [
            r for r in roster
            if r.get("cmms_assignee_name") and r["cmms_assignee_name"] not in seen
        ]
        if not missing:
            return
        parts = []
        for r in missing:
            has_id = "has Cove ID" if r.get("cove_user_id") else "NO Cove ID on profile"
            parts.append(f"{r['full_name']} (CMMS '{r['cmms_assignee_name']}', {has_id})")
        noun = {"pm12": "PMs", "wo": "WOs"}.get(kind, "tasks")
        msg = (
            f"ROSTER GAP: {len(missing)} active engineer(s) with 0 {noun} in this fetch — "
            + "; ".join(parts) + ". "
            "If they have open tasks in Cove and show 'NO Cove ID', set Cove user ID on their "
            "profile (Admin › User Profiles › Edit) — it's in the URL of Cove's assignee "
            "filter for them (…%22id%22%3A%22<ID>%22…). If they already have an ID, "
            "they may genuinely have nothing assigned."
        )
        print(f"WARN: {msg}", file=sys.stderr)
        client.table("ingestion_log").insert({
            "filename":  filename,
            "kind":      kind,
            "status":    "warn",
            "rows":      0,
            "error_msg": msg[:4000],
        }).execute()
    except Exception as e:  # noqa: BLE001
        print(f"WARN: roster_gap_check failed ({kind}): {e}", file=sys.stderr)
