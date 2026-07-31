-- 0113: Restore "Garage - 30 Pilgrim Street" — partial rollback of 0110.
--
-- User correction 2026-07-29: only Building 10 (10 Green St) and 20 Sidney
-- Street are the same physical building (survivor = 20 Sidney; that half of
-- 0110 stands). The Pilgrim garage is its OWN building and should not have
-- been merged. 0110's soft-delete design makes this a clean three-row undo:
--
--   1. Reactivate the buildings row (active flips back true; every picker
--      shows it again immediately).
--   2. Reopen Evan Sullivan's primary on G-30 — 0110 ended it same-day
--      (starts_on = ends_on = 2026-07-28), so clearing ends_on restores the
--      exact pre-merge state. G-30 has no other open primary (partial unique
--      index safe).
--   3. Move Dariusz Olszewski's coverage row home — 0110 repointed it from
--      G-30 to 20 Sidney; Sean Martell's coverage row STAYS on 20 Sidney
--      (his came from Building 10, which really is 20 Sidney).
--
-- Historical rows (Mark's / Rodney's ended G-30 primaries, Building 10's
-- ended rows) were never touched and stay as history. Building 10 remains
-- retired. Round stops: G-30 never had any; AM Route 1's 10→20 repoint
-- stands.

update buildings
   set active = true, updated_at = now()
 where id = '44331e4a-1585-491e-bc4a-a76f8746e4c7';  -- Garage - 30 Pilgrim Street

update building_assignments
   set ends_on = null
 where id = '0661801a-96b6-4991-985a-6ea98b2c13e8'   -- Evan Sullivan, primary, G-30
   and building_id = '44331e4a-1585-491e-bc4a-a76f8746e4c7'
   and role_in_building = 'primary';

update building_assignments
   set building_id = '44331e4a-1585-491e-bc4a-a76f8746e4c7'
 where id = '461258d7-5194-4475-9945-030adaa466a9'   -- Dariusz Olszewski, backup
   and role_in_building = 'backup';
