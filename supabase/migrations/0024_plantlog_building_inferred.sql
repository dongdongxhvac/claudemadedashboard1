-- Migration 0024 — Plantlog building attribution column (Phase 6.7)
--
-- plantlog_log_records.group_name stores the sub-location ("Garage Level 4",
-- "Roof") not the building. For 33 of 82 distinct group names, the same
-- name appears in multiple buildings (e.g., "Boilers", "First Floor"). To
-- support per-building rollups, we add an `building_inferred` column
-- populated by `watcher/plantlog_building_attribution.py`:
--
--   - direct:   (log_name, group_name) maps to exactly one building in
--               plantlog's /groups + /logs catalog.
--   - inferred: ambiguous mapping resolved by nearest-unambiguous-neighbor
--               within 15 min by the same engineer that day.
--
-- The poller (Phase 6.6) calls attribute_and_persist() at the end of each
-- ingest, so building_inferred stays fresh on a rolling 14-day window.
-- Older rows attributed only by the one-shot backfill.

alter table public.plantlog_log_records
  add column if not exists building_inferred  text,
  add column if not exists attribution_source text;

create index if not exists plantlog_log_records_building_inferred_idx
  on public.plantlog_log_records(building_inferred, performed_at_utc desc)
  where building_inferred is not null;

-- v_plantlog_building_daily: per-building daily counts.
create or replace view public.v_plantlog_building_daily as
  select
    building_inferred as building,
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    count(*) as entries
  from public.plantlog_log_records
  where building_inferred is not null
  group by building_inferred,
           (performed_at_utc at time zone 'America/New_York')::date;

-- v_plantlog_user_building_daily: drill-down for the per-engineer breakdown.
create or replace view public.v_plantlog_user_building_daily as
  select
    user_name,
    building_inferred as building,
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    count(*) as entries
  from public.plantlog_log_records
  where building_inferred is not null
  group by user_name, building_inferred,
           (performed_at_utc at time zone 'America/New_York')::date;
