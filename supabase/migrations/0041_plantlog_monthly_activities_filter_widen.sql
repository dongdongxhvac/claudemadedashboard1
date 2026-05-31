-- Migration 0041 — Widen monthly compliance filter to ALL Monthly Activities.
--
-- 0040 filtered by activity_name ilike '%monthly water meter%' — too narrow.
-- Plantlog uses group_name = 'Monthly Activities' as the natural bucket for
-- recurring monthly compliance tasks, currently:
--   * Monthly Water Meter Readings
--   * Monthly DEP Log
-- and any future monthly task will land in the same group automatically.
--
-- Widening the filter to the group means §07's monthly subsection
-- auto-renders any new monthly task with zero code change. View name kept
-- (v_plantlog_monthly_water_meters_status) to avoid churn — the hook and
-- panel reference it, and renaming would just add three more edits for no
-- functional gain. The group filter is what matters.

create or replace view public.v_plantlog_monthly_water_meters_status as
with monthly as (
  select
    log_name,
    activity_name,
    performed_at_utc,
    user_name,
    building_inferred
  from public.plantlog_log_records
  where coalesce(group_name,'') = 'Monthly Activities'
)
select
  log_name,
  activity_name,
  max(performed_at_utc) as last_done_utc,
  (current_date - (max(performed_at_utc) at time zone 'America/New_York')::date) as days_ago,
  (array_agg(user_name order by performed_at_utc desc))[1] as last_by_user,
  (array_agg(building_inferred order by performed_at_utc desc)
     filter (where building_inferred is not null))[1] as building
from monthly
group by log_name, activity_name;

alter view public.v_plantlog_monthly_water_meters_status set (security_invoker = true);
