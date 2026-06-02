-- Migration 0052 — Infer building for email alarms whose `building` is NULL.
--
-- Many BMS emails (Northeast Tech 730/750 especially) don't set the
-- `building` column at ingest time but encode the building code right in
-- the point_ref / point_name / event_value, e.g. "730_AS03_AHU03--..."
-- or in the body text ("dsc.061_300_penthouse2").
--
-- This migration:
--   1. Adds a helper function infer_building_from_text(text) that matches
--      the text against public.buildings.short_code as a standalone token
--      (digit-boundary surroundings) and returns the first hit, preferring
--      longer codes (so "300" wins over "30" inside "300_penthouse").
--   2. Rebuilds v_email_alarms_history to expose `building_resolved` —
--      coalesce(building, structured-field-inference, body-text-inference)
--      — so the §10.2 panel can group by it directly.
--
-- Precedence note (the fixed version vs the v1 attempt): structured fields
-- (point_ref / point_name / event_value) are checked BEFORE body_text.
-- Body text contains email headers like "jll750mainbms@northeast-tech.com"
-- and signature blocks that produce false matches if scanned alongside
-- the trustworthy fields. The original `building` column is non-destructive.

create or replace function public.infer_building_from_text(p_text text)
returns text
language sql stable
as $$
  -- First short_code that appears as a standalone token in p_text.
  -- Boundary: start/end of text, or any non-digit/non-letter char (so
  -- "300_penthouse" matches "300" but "1300" or "ll750" do not).
  -- Length DESC so longer codes win ("300" over "30").
  select b.short_code
  from public.buildings b
  where b.active
    and b.short_code is not null
    and p_text ~ ('(^|[^0-9A-Za-z])' || b.short_code || '([^0-9A-Za-z]|$)')
  order by length(b.short_code) desc
  limit 1;
$$;

-- DROP + CREATE (not OR REPLACE) because Postgres refuses to add a column
-- in the middle of an existing view's projection.
drop view if exists public.v_email_alarms_history;

create view public.v_email_alarms_history as
select
  e.gmail_msg_id,
  e.received_at_utc,
  e.alarm_time_utc,
  e.vendor,
  e.building,
  /* Precedence: explicit > structured-field scan > body_text scan. */
  coalesce(
    e.building,
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
