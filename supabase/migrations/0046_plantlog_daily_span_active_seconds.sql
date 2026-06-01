-- Migration 0046 — Add active_seconds to v_plantlog_user_daily_span.
--
-- The existing span_seconds is wall-clock first→last and gets inflated
-- whenever an engineer interleaves an excluded weekly/monthly task in the
-- middle of the daily round (the excluded rows don't widen the span, but
-- the GAP between daily-round rows around them does).
--
-- active_seconds = sum of per-building visit durations (from
-- v_plantlog_user_building_daily_visits). That's "time actually spent at a
-- building" and is independent of mid-round gaps. The §06 panel shows
-- both so a manager can see "5h span / 2h active" → engineer was busy
-- doing OTHER things, not the daily round.
--
-- Daily-round exclusion filter unchanged from 0025 — confirmed in-place:
-- excludes activity_name + log_name matching water test / water treatment
-- / weekly / monthly (case-insensitive).
--
-- DROP + CREATE rather than CREATE OR REPLACE because Postgres refuses to
-- replace a view if any column TYPE changes vs the existing definition,
-- and we're adding a column (which counts as a type change of the row).

drop view if exists public.v_plantlog_user_daily_span;

create view public.v_plantlog_user_daily_span as
with base as (
  select
    user_name,
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    min(performed_at_utc) as first_entry_utc,
    max(performed_at_utc) as last_entry_utc,
    count(*) as entries,
    extract(epoch from max(performed_at_utc) - min(performed_at_utc))::integer as span_seconds
  from public.plantlog_log_records
  where coalesce(activity_name, '') !~~* '%water test%'
    and coalesce(activity_name, '') !~~* '%water treatment%'
    and coalesce(activity_name, '') !~~* '%weekly%'
    and coalesce(activity_name, '') !~~* '%monthly%'
    and coalesce(log_name, '')      !~~* '%weekly%'
    and coalesce(log_name, '')      !~~* '%monthly%'
  group by user_name, ((performed_at_utc at time zone 'America/New_York')::date)
),
active as (
  select user_name, et_day, sum(total_visit_seconds)::integer as active_seconds
  from public.v_plantlog_user_building_daily_visits
  group by user_name, et_day
)
select
  b.user_name,
  b.et_day,
  b.first_entry_utc,
  b.last_entry_utc,
  b.entries,
  b.span_seconds,
  coalesce(a.active_seconds, 0)::integer as active_seconds
from base b
left join active a on a.user_name = b.user_name and a.et_day = b.et_day;

alter view public.v_plantlog_user_daily_span set (security_invoker = true);
