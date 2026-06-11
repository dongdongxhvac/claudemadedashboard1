-- Migration 0080 — per-day AM / PM building counts for §06.
--
-- Counts go by round START time per building (user rule):
--   AM — the building's FIRST entry of the day is before 11:30 ET
--   PM — the building's first AFTERNOON entry (noon or later, so the
--        morning round can't bleed in) is at/after 15:00 ET
-- Same et_day + building_inferred attribution as v_plantlog_building_daily
-- (0024), so the counts line up with the §06 matrix columns.

create or replace view public.v_plantlog_daily_ampm as
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
  count(*) filter (where day_start < time '11:30')  as am_buildings,
  count(*) filter (where pm_start >= time '15:00')  as pm_buildings
from b
group by et_day;

alter view public.v_plantlog_daily_ampm set (security_invoker = true);
