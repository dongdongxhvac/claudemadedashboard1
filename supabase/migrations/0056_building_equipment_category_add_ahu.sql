-- Migration 0056 — Add AHU (air handling unit) as a category option.
--
-- The check constraint introduced in 0048 enumerates the allowed values.
-- Drop + recreate is the cleanest way to add one — Postgres doesn't have
-- ALTER CONSTRAINT-style enum extension for CHECK constraints.

alter table public.building_equipment
  drop constraint if exists building_equipment_category_check;

alter table public.building_equipment
  add constraint building_equipment_category_check
  check (category is null or category in (
    'chiller_plant',
    'boiler_plant',
    'compressed_air',
    'vacuum_air',
    'rodi',
    'ahu',
    'plumbing',
    'control',
    'electrical'
  ));
