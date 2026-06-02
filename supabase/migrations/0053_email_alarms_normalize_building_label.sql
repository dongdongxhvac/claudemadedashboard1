-- Migration 0053 — Normalize raw building labels to canonical short_codes.
--
-- After 0052 we had two flavors of the same building floating around:
--   raw `building` column: "730 Main"  (set by the watcher at ingest)
--   resolver's output:     "730"       (inferred via short_code regex)
-- They cluster as separate rows in §10.2 even though they refer to the
-- same physical building.
--
-- This migration:
--   1. Adds normalize_building_label(text) which runs infer on the label
--      and returns the short_code when found, else the original label.
--      "The Point" and "Takeda" pass through unchanged (no embedded
--      short_code — they're proper system names that don't map).
--   2. Backfills the email_alarm_events.building column for any existing
--      row where the label IS a short_code in disguise.
--   3. Rebuilds v_email_alarms_history's building_resolved to normalize
--      the raw label, so future watcher writes of "730 Main" still
--      cluster correctly without needing an UPDATE.

create or replace function public.normalize_building_label(p_label text)
returns text
language sql stable
as $$
  -- If the label embeds a known short_code as a standalone token, return
  -- the short_code. Otherwise return the original label.
  select coalesce(public.infer_building_from_text(p_label), p_label);
$$;

-- 1) Backfill: collapse "730 Main" → "730" etc on existing rows.
--    Only updates rows where normalization actually changes the value.
update public.email_alarm_events
   set building = public.normalize_building_label(building)
 where building is not null
   and public.normalize_building_label(building) is distinct from building;

-- 2) Rebuild the history view so building_resolved normalizes the raw
--    `building` value too. Any future ingest that writes "730 Main"
--    appears as "730" in the panel without requiring backfill.
drop view if exists public.v_email_alarms_history;

create view public.v_email_alarms_history as
select
  e.gmail_msg_id,
  e.received_at_utc,
  e.alarm_time_utc,
  e.vendor,
  e.building,
  /* Precedence (post-normalization):
       1. normalized raw `building`        (now "730" instead of "730 Main")
       2. infer from point_ref + name + event_value
       3. infer from body_text
     Proper names like "The Point" / "Takeda" pass through normalize
     unchanged because nothing in those strings matches a short_code. */
  coalesce(
    public.normalize_building_label(e.building),
    public.infer_building_from_text(
      concat_ws(' ', e.point_ref, e.point_name, e.event_value)
    ),
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
