-- Migration 0072 — Detect flapping BMS email alarms.
--
-- User direction 2026-06-06: if the same point goes Active → Quiet → Active
-- (or oscillates further) within 20 minutes, flag it for manual review.
-- These look "closed" to the BMS auto-resolve logic because each cycle
-- has a quiet, but in practice the point is chattering around a threshold
-- and a human needs to look.
--
-- Threshold: >= 2 state TRANSITIONS in trailing 20 min for the same
-- (vendor, point_ref). One round-trip Active→Quiet→Active is 2
-- transitions and qualifies; longer oscillations qualify too.
--
-- Excluded:
--   * Points whose latest event in the window is a manual close
--     (parsed_fields ->> 'manual_close' = 'true') — manager already
--     acknowledged it; let it cool off until the next genuine cycle.

create or replace view public.v_email_alarms_flapping as
with windowed as (
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
    e.event_class,
    e.event_value,
    e.received_at_utc,
    coalesce((e.parsed_fields ->> 'manual_close')::boolean, false) as is_manual_close,
    lag(e.alarm_state)
      over (partition by e.vendor, e.point_ref order by e.received_at_utc) as prev_state
  from public.email_alarm_events e
  where e.received_at_utc >= now() - interval '20 minutes'
    and e.point_ref is not null
), grouped as (
  select
    vendor,
    point_ref,
    max(point_name)              as point_name,
    max(building_resolved)       as building_resolved,
    count(*)                     as event_count,
    count(*) filter (
      where prev_state is not null and alarm_state <> prev_state
    ) as transition_count,
    min(received_at_utc)         as first_seen,
    max(received_at_utc)         as last_seen,
    (array_agg(alarm_state    order by received_at_utc desc))[1] as latest_state,
    (array_agg(is_manual_close order by received_at_utc desc))[1] as latest_is_manual
  from windowed
  group by vendor, point_ref
)
select
  vendor,
  point_ref,
  point_name,
  building_resolved,
  event_count,
  transition_count,
  first_seen,
  last_seen,
  latest_state,
  latest_is_manual as acknowledged
from grouped
where transition_count >= 2
  and not latest_is_manual;

alter view public.v_email_alarms_flapping set (security_invoker = true);
