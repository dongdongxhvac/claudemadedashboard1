-- Migration 0067 — Equipment category list update per user direction
-- 2026-06-04.
--
-- New list: chiller_plant, boiler_plant, ahu, vcair, rodi, plumbing, bms.
--   * ahu label changes to "AHU/GEF" (covers air handlers AND general
--     exhaust fans). DB slug stays as 'ahu' — no data migration needed.
--   * compressed_air + vacuum_air collapse into a single 'vcair' bucket
--     ("vcAIR" — covers both vacuum and compressed-air systems together).
--   * control renames to 'bms' (broader scope — building management,
--     not just control loops).
--   * electrical is dropped from the valid list. Existing rows get
--     category=NULL so they bubble up under "Uncategorized" for the
--     user to reassign.

-- Drop the OLD CHECK first — otherwise the UPDATEs below trip it because
-- 'vcair' / 'bms' aren't yet valid values.
alter table building_equipment
  drop constraint if exists building_equipment_category_check;

-- Migrate existing data into the new slug space.
update building_equipment
   set category = 'vcair'
 where category in ('compressed_air', 'vacuum_air');

update building_equipment
   set category = 'bms'
 where category = 'control';

update building_equipment
   set category = null
 where category = 'electrical';

-- Reinstate the CHECK against the new list.
alter table building_equipment
  add constraint building_equipment_category_check
  check (category is null or category in (
    'chiller_plant',
    'boiler_plant',
    'ahu',
    'vcair',
    'rodi',
    'plumbing',
    'bms'
  ));
