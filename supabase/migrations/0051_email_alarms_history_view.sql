-- Migration 0051 — Flattened history view for §10.2 panel.
--
-- email_alarm_events stores both BMS-sent events (Active / Quiet) and the
-- synthetic manual-close events from migration 0050. The audit info for
-- manual closes lives inside parsed_fields JSONB.
--
-- This view surfaces it as flat columns so the React side doesn't have to
-- dig into JSON for the "Alarm history" / "Manual close log" panel:
--   is_manual_close      — boolean for the filter pill
--   closed_by_name       — who clicked the button
--   manual_close_reason  — optional reason they typed
--   sourced_from_msg     — gmail_msg_id of the original Active row this
--                          manual close was paired with

create or replace view public.v_email_alarms_history as
select
  e.gmail_msg_id,
  e.received_at_utc,
  e.alarm_time_utc,
  e.vendor,
  e.building,
  e.point_name,
  e.point_ref,
  e.alarm_state,
  e.event_class,
  e.event_value,
  e.subject_clean,
  e.original_sender,
  coalesce((e.parsed_fields ->> 'manual_close')::boolean, false) as is_manual_close,
  e.parsed_fields ->> 'closed_by_name'    as closed_by_name,
  e.parsed_fields ->> 'reason'            as manual_close_reason,
  e.parsed_fields ->> 'sourced_from_msg'  as sourced_from_msg
from public.email_alarm_events e;

alter view public.v_email_alarms_history set (security_invoker = true);
