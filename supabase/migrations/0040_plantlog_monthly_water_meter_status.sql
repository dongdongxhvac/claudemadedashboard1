-- Migration 0040 — Monthly water meter readings compliance view.
--
-- Independent from the weekly tests view (0026) so adding monthly cadence
-- doesn't touch existing §07 weekly compliance logic. Matches the same
-- "latest completion per log_name" shape so the panel can reuse the same
-- row component.
--
-- Compliance rule (computed client-side, like weekly):
--   * fresh    ✓ — done in the current calendar month, on day 1-6 (in-window)
--   * late     ⚠ — done in the current calendar month, on day 7+ (out-of-window)
--   * pending  —  today is day 1-6 and this month has no completion yet
--   * overdue  ⚠ — today is day 7+ and this month has no completion at all
--
-- Backed by activity_name ilike '%monthly water meter%' (plantlog uses the
-- exact string 'Monthly Water Meter Readings' under group_name 'Monthly
-- Activities'). Single global log, no per-building dimension yet.

create or replace view public.v_plantlog_monthly_water_meters_status as
with monthly as (
  select
    log_name,
    activity_name,
    performed_at_utc,
    user_name,
    building_inferred
  from public.plantlog_log_records
  where coalesce(activity_name,'') ilike '%monthly water meter%'
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

-- Match the security_invoker policy applied to all other plantlog views in
-- migration 0039 — RLS evaluated as the querying user, not the view owner.
alter view public.v_plantlog_monthly_water_meters_status set (security_invoker = true);
