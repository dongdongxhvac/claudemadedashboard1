-- Migration 0042 — Latest monthly water meter readings per building.
--
-- Sources from plantlog_latest_readings (memo 8) which captures each
-- equipment's most-recent reading values in a JSONB array. We filter to
-- water-meter logs that carry a building-number prefix (so we know which
-- building the readings belong to), keep only the latest completion per
-- log, and inline-map the prefix to its canonical building name.
--
-- One row per (prefixed) log. The `readings` JSONB carries one entry per
-- physical meter at that building, e.g.
--   {"item": "Main Meter (Water Room)", "unit": "Cubic Feet", "value": "170450"}
--
-- Used by §13 Latest meter readings per building (manager view).

create or replace view public.v_plantlog_monthly_water_meter_latest_readings as
with prefixed as (
  select
    log_name,
    completed_at_utc,
    completed_by_user,
    activity_name,
    note,
    readings
  from public.plantlog_latest_readings
  where activity_name ilike '%monthly water meter%'
    and log_name ~ '^\d+\s+'
),
latest_per_log as (
  select distinct on (log_name)
    log_name,
    completed_at_utc,
    completed_by_user,
    activity_name,
    note,
    readings
  from prefixed
  order by log_name, completed_at_utc desc
)
select
  log_name,
  substring(log_name from '^(\d+)\s+') as building_prefix,
  case substring(log_name from '^(\d+)\s+')
    when '10'  then '10 Green St'
    when '20'  then '20 Sidney St'
    when '26'  then '26 Landsdowne St'
    when '30'  then '30 Pilgrim St'
    when '35'  then '35 Landsdowne St'
    when '38'  then '38 Sidney St'
    when '40'  then '40 Landsdowne St'
    when '45'  then '45 Sidney St'
    when '55'  then '55 Franklin St'
    when '64'  then '64 Sidney St'
    when '65'  then '65 Landsdowne St'
    when '75'  then '75 Sidney St'
    when '80'  then '80 Landsdowne St'
    when '88'  then '88 Sidney St'
    when '300' then '300 Mass Ave'
    when '350' then '350 Mass Ave'
    when '730' then '730 Main St'
    when '750' then '750 Main St'
    else null
  end as building,
  completed_at_utc,
  completed_by_user,
  activity_name,
  note,
  readings
from latest_per_log;

alter view public.v_plantlog_monthly_water_meter_latest_readings
  set (security_invoker = true);
