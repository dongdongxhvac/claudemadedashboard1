-- Migration 0081 — per-(day, building) AM/PM round flags for §06.
--
-- Replaces the counts-only v_plantlog_daily_ampm (0080): the Daily round
-- efficiency section needs to show WHICH buildings are missing each
-- window, so the rollup moves client-side and the view exposes flags
-- per building instead.
--   has_am — the building's FIRST entry of the day starts before 11:30 ET
--   has_pm — the building's first AFTERNOON entry (noon or later) starts
--            at/after 15:00 ET

drop view if exists public.v_plantlog_daily_ampm;

create or replace view public.v_plantlog_daily_building_ampm as
with b as (
  select
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    building_inferred as building,
    min((performed_at_utc at time zone 'America/New_York')::time) as day_start,
    min((performed_at_utc at time zone 'America/New_York')::time)
      filter (where (performed_at_utc at time zone 'America/New_York')::time >= time '12:00')
      as pm_start
  from public.plantlog_log_records
  where building_inferred is not null
  group by 1, 2
)
select
  et_day,
  building,
  (day_start < time '11:30')                 as has_am,
  coalesce(pm_start >= time '15:00', false)  as has_pm
from b;

alter view public.v_plantlog_daily_building_ampm set (security_invoker = true);
