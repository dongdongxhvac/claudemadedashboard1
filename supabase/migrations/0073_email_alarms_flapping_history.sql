-- Migration 0073 — Past flapping incidents per (point × ET hour).
--
-- The live v_email_alarms_flapping view answers "is this point flapping
-- right now?" — 20-min trailing window. This view answers "did flapping
-- happen, and where / when?" over the last 30 days, bucketed by
-- Eastern-Time HOUR.
--
-- An "incident" here = one ET hour in which a given (vendor, point_ref)
-- had 2+ state transitions. The hourly granularity is coarse enough to
-- collapse a chattering burst into one row while still showing the
-- shape of the day.
--
-- We do NOT exclude rows that were manually closed during the hour —
-- the history view is for pattern-spotting. The live view drops
-- acknowledged rows; history keeps them so you can see "this point
-- always flaps Tuesday afternoons" even after Tuesday.

create or replace view public.v_email_alarms_flapping_history as
with events as (
  select
    e.vendor,
    e.point_ref,
    e.point_name,
    public.normalize_building_label(
      coalesce(
        public.infer_building_from_text(e.point_ref),
        public.infer_building_from_text(e.point_name),
        e.building
      )
    ) as building_resolved,
    e.alarm_state,
    e.received_at_utc,
    date_trunc('hour', e.received_at_utc at time zone 'America/New_York') as et_hour,
    -- lag over the FULL stream per (vendor, point_ref) so a state change
    -- straddling an hour boundary still counts (assigned to the later hour).
    lag(e.alarm_state) over (
      partition by e.vendor, e.point_ref
      order by e.received_at_utc
    ) as prev_state
  from public.email_alarm_events e
  where e.received_at_utc >= now() - interval '30 days'
    and e.point_ref is not null
)
select
  vendor,
  point_ref,
  max(point_name)              as point_name,
  max(building_resolved)       as building_resolved,
  et_hour,
  count(*)                     as event_count,
  count(*) filter (
    where prev_state is not null and alarm_state <> prev_state
  ) as transition_count,
  min(received_at_utc)         as first_seen,
  max(received_at_utc)         as last_seen,
  (array_agg(alarm_state order by received_at_utc desc))[1] as latest_state
from events
group by vendor, point_ref, et_hour
having count(*) filter (
  where prev_state is not null and alarm_state <> prev_state
) >= 2
order by et_hour desc, transition_count desc;

alter view public.v_email_alarms_flapping_history set (security_invoker = true);
