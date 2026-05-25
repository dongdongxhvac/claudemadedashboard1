-- Migration 0030 — Fix v_email_alarms_open to use BMS-side timestamp
--
-- The previous version of v_email_alarms_open ordered by received_at_utc
-- (when Gmail got the email). That broke when Power Automate forwarded
-- duplicate alarm pairs out-of-order — Gmail received the Active half
-- after multiple Quiet duplicates of the same BMS event, and the view
-- mistakenly reported the alarm as currently active.
--
-- New ordering:
--   1. alarm_time_utc desc nulls last  — BMS-side transition time is
--                                        the authoritative event time.
--   2. alarm_state desc                — when timestamps tie (e.g. fire
--                                        + clear at the same second),
--                                        prefer 'Quiet' (Q > A
--                                        alphabetically) so the
--                                        "settled" state wins.
--   3. received_at_utc desc            — fallback tiebreaker for legacy
--                                        rows where alarm_time_utc is
--                                        null (Siemens-format parse
--                                        misses occasionally).

create or replace view public.v_email_alarms_open as
  with latest as (
    select distinct on (point_ref) *
      from public.email_alarm_events
      where point_ref is not null
      order by point_ref,
               alarm_time_utc desc nulls last,
               alarm_state desc,
               received_at_utc desc
  )
  select *
    from latest
    where alarm_state = 'Active';
