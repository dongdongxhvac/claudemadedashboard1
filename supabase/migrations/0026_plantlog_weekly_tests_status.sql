-- Migration 0026 — Plantlog weekly compliance tests view (Phase 6.7 follow-up)
--
-- Per-equipment status of the two recurring weekly tests:
--   * Generator Weekly Test (activity_name ilike '%generator%')
--   * Weekly Water Test     (activity_name ilike '%water test%' / '%water treatment%')
--
-- Picks the most-recent completion per (test_type, log_name), with the
-- engineer who did it and the building (when attribution resolved).
-- Used by §07 Weekly compliance tests on manager Pc.

create or replace view public.v_plantlog_weekly_tests_status as
with weekly as (
  select
    case
      when coalesce(activity_name,'') ilike '%water test%'
        or coalesce(activity_name,'') ilike '%water treatment%' then 'water'
      when coalesce(activity_name,'') ilike '%generator%' then 'generator'
    end as test_type,
    log_name,
    activity_name,
    performed_at_utc,
    user_name,
    building_inferred
  from public.plantlog_log_records
  where coalesce(activity_name,'') ilike '%generator%'
     or coalesce(activity_name,'') ilike '%water test%'
     or coalesce(activity_name,'') ilike '%water treatment%'
)
select
  test_type,
  log_name,
  activity_name,
  max(performed_at_utc) as last_done_utc,
  (current_date - (max(performed_at_utc) at time zone 'America/New_York')::date) as days_ago,
  (array_agg(user_name order by performed_at_utc desc))[1] as last_by_user,
  (array_agg(building_inferred order by performed_at_utc desc)
     filter (where building_inferred is not null))[1] as building
from weekly
where test_type is not null
group by test_type, log_name, activity_name;
