-- 0110: Merge the Green St trio into one building record.
--
-- ⚠ CORRECTION (2026-07-29, migration 0113): the trio premise was wrong —
-- only Building 10 (10 Green St) and 20 Sidney Street are one building.
-- "Garage - 30 Pilgrim Street" is separate and was RESTORED by 0113
-- (reactivated, Evan's primary reopened, Dariusz's coverage moved back).
-- The Building-10 half of this migration stands.
--
-- Per the site: "Building 10" (10 Green St), "20 Sidney Street" and
-- "Garage - 30 Pilgrim Street" are one physical structure. Survivor =
-- 20 Sidney Street; Building 10 and Garage-30 are retired.
--
-- Approach (deliberately reversible):
--   * victims are SOFT-deleted (active=false) — useBuildings filters
--     .eq('active', true), so every picker/tab drops them immediately, while
--     historical building_assignments rows and admin_proposals JSONB payloads
--     that reference the uuids stay intact.
--   * open lead coverage rows move to the survivor (Sean Martell on 10,
--     Dariusz Olszewski on G-30) — "one building" keeps its coverage.
--   * other open rows are ENDED, not deleted (close-open convention):
--     Piotr's primary on 10 is redundant (he already holds 20 Sidney);
--     Brandon's non-lead coverage on 10 ends per the new lead-only rule;
--     Evan's primary on G-30 ends (20 Sidney already has a primary — the
--     partial unique index allows only one open primary per building).
--   * round stops on victims repoint to the survivor where the round doesn't
--     already visit it (UNIQUE(round_id, building_id)); leftovers dropped.
--
-- Deliberately NOT touched: plantlog attribution ("10 Green St" mirrors
-- plantlog.com's own folder naming and its morning/evening round is actively
-- compliance-monitored), COVE building_code strings (COVE is authoritative),
-- and the delta_10green BMS heartbeat labels (physical BMS endpoint).
--
-- Replay caveat (if reused as a template): the NOT EXISTS guards in steps 1
-- and 3 see the statement-start snapshot, so a single lead covering BOTH
-- victims (step 1) or a round visiting both victims but not the survivor
-- (step 3) would collide inside one statement. Prod data had neither shape
-- when this ran (verified 2026-07-28); split into per-victim statements if
-- that ever isn't true.

do $$
declare
  v10  uuid := 'bccf6327-f07a-4209-b413-27a3553375c9';  -- Building 10 (10 Green St)
  v30  uuid := '44331e4a-1585-491e-bc4a-a76f8746e4c7';  -- Garage - 30 Pilgrim Street
  keep uuid := '7de16e96-3554-4925-8611-a4c2d24322e8';  -- 20 Sidney Street (survivor)
begin
  -- 1. Open coverage rows held by LEAD engineers follow the merge onto the
  --    survivor (skip any that would collide with an existing open pair).
  update building_assignments ba
     set building_id = keep
   where ba.building_id in (v10, v30)
     and ba.ends_on is null
     and ba.role_in_building = 'backup'
     and exists (select 1 from engineer_profiles ep
                  where ep.user_id = ba.user_id and ep.is_lead)
     and not exists (select 1 from building_assignments x
                      where x.building_id = keep
                        and x.user_id = ba.user_id
                        and x.role_in_building = 'backup'
                        and x.ends_on is null);

  -- 2. End every remaining open row on the victims (redundant/second
  --    primaries + non-lead coverage). History rows keep their building_id.
  update building_assignments
     set ends_on = current_date
   where building_id in (v10, v30)
     and ends_on is null;

  -- 3. Round stops: repoint to the survivor unless the round already visits
  --    it, then drop whatever is left on the victims.
  update round_stops rs
     set building_id = keep
   where rs.building_id in (v10, v30)
     and not exists (select 1 from round_stops x
                      where x.round_id = rs.round_id and x.building_id = keep);
  delete from round_stops where building_id in (v10, v30);

  -- 4. Retire the victim buildings.
  update buildings
     set active = false, updated_at = now()
   where id in (v10, v30);
end $$;
