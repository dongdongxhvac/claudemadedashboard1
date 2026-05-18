-- Migration 0015 — Drop the legacy uniqueness constraint on
-- building_assignments (building_id, user_id, role_in_building, starts_on).
--
-- Why: that constraint also matches ended (ends_on IS NOT NULL) rows, so
-- reassigning a building back to its previous owner on the same day fails:
--   Edwin (primary, ended today) + new INSERT Edwin (primary, today) -> dupe
--
-- The partial unique index from migration 0014 already enforces "one current
-- primary per building" for active rows, which is what we actually want. Add
-- the matching partial unique for coverage (one open backup row per
-- engineer+building pair) and drop the legacy whole-history constraint.

alter table building_assignments
  drop constraint if exists building_assignments_building_id_user_id_role_in_building_s_key;

create unique index if not exists building_assignments_one_current_backup_per_user
  on building_assignments (building_id, user_id)
  where role_in_building = 'backup' and ends_on is null;
