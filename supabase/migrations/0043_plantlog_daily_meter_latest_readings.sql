-- Migration 0043 — Latest daily-round meter readings per building.
--
-- Daily rounds log meter values (CT Meters, HW Meter, CHW Meter, Closed
-- Loop Meter, etc.) under activity_name = 'Rounds'. These are independent
-- from monthly water meter readings — different cadence (every shift vs
-- once a month), captured in different plantlog logs.
--
-- plantlog_latest_readings doesn't carry building_inferred directly, but
-- we can JOIN to plantlog_log_records on (log_name, completed_at_utc =
-- performed_at_utc, completed_by_user = user_name) to borrow it. The
-- existing cluster-inference attribution path already populates
-- building_inferred for all daily-round entries, so this works today —
-- no renames or schema changes needed.
--
-- View returns one row per (building, log_name) — the latest completion
-- per meter log per building. The §13 panel groups by building.

create or replace view public.v_plantlog_daily_meter_latest_readings as
with daily_meter as (
  select
    lr.log_name,
    lr.completed_at_utc,
    lr.completed_by_user,
    lr.activity_name,
    lr.note,
    lr.readings,
    lg.building_inferred,
    lg.attribution_source
  from public.plantlog_latest_readings lr
  inner join public.plantlog_log_records lg
    on lg.log_name = lr.log_name
   and lg.performed_at_utc = lr.completed_at_utc
   and lg.user_name = lr.completed_by_user
  where lr.log_name ilike '%meter%'
    and lr.activity_name = 'Rounds'
    and jsonb_array_length(coalesce(lr.readings, '[]'::jsonb)) > 0
    and lg.building_inferred is not null
)
select distinct on (building_inferred, log_name)
  building_inferred as building,
  log_name,
  completed_at_utc,
  completed_by_user,
  activity_name,
  note,
  readings,
  attribution_source
from daily_meter
order by building_inferred, log_name, completed_at_utc desc;

alter view public.v_plantlog_daily_meter_latest_readings
  set (security_invoker = true);
