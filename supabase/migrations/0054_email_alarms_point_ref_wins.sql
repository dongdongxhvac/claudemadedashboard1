-- Migration 0054 — Invert precedence: point_ref-inferred building beats raw label.
--
-- Background: the raw `building` column is set by the watcher at ingest
-- time, and for some vendors it's a TENANT or SYSTEM identifier rather
-- than a physical building short_code. Specifically:
--   "The Point" — Siemens BMS umbrella covering several buildings. The
--                  point_ref prefix (88_AHU1_LTD → 88) tells us which.
--   "Takeda"    — Delta BMS scope for tenant Takeda, which occupies 35,
--                  40, AND 300. point_ref also tells us which.
--
-- The point_ref / point_name / event_value field is the most reliable
-- signal we have for the physical building. So flip the resolver so
-- point-derived inference WINS over the raw label.
--
-- Precedence (new):
--   1. infer from point_ref + point_name + event_value   ← MOST reliable
--   2. normalize raw `building` label                    ← falls back to
--      • returns short_code if the label embeds one         the system /
--      • returns original label otherwise (e.g. "The Point") tenant name
--                                                            when there's
--                                                            no point signal
--   3. infer from body_text                              ← last resort
--
-- Concrete impact:
--   "The Point" / point_ref "88_AHU1_LTD"            → 88     (was: "The Point")
--   "The Point" / point_ref "SHV4_FRZ"  (no digits)  → "The Point"  (no change)
--   "Takeda"    / point_ref "300_AHU1_..."           → 300    (was: "Takeda")
--   "Takeda"    / point_ref no-digit-prefix          → "Takeda"     (no change)
--
-- No backfill of the raw column — the view handles it. Raw stays as-is
-- so we don't lose the original tenant/system identifier.

drop view if exists public.v_email_alarms_history;

create view public.v_email_alarms_history as
select
  e.gmail_msg_id,
  e.received_at_utc,
  e.alarm_time_utc,
  e.vendor,
  e.building,
  /* Precedence: point-derived inference > normalized raw label > body. */
  coalesce(
    public.infer_building_from_text(
      concat_ws(' ', e.point_ref, e.point_name, e.event_value)
    ),
    public.normalize_building_label(e.building),
    public.infer_building_from_text(e.body_text)
  ) as building_resolved,
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
