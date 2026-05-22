-- Migration 0025 — Plantlog daily round efficiency view (Phase 6.7 follow-up)
--
-- Per-user × per-ET-day: first entry, last entry, count, and active span.
-- Excludes water treatment so the span reflects daily-round effort only,
-- not weekly tests that pull engineers off their normal route.
--
-- Used by the §06 Plantlog rounds panel's "Daily round efficiency" section.

create or replace view public.v_plantlog_user_daily_span as
  select
    user_name,
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    min(performed_at_utc) as first_entry_utc,
    max(performed_at_utc) as last_entry_utc,
    count(*) as entries,
    extract(epoch from (max(performed_at_utc) - min(performed_at_utc)))::int as span_seconds
  from public.plantlog_log_records
  where coalesce(activity_name,'') not ilike '%water test%'
    and coalesce(activity_name,'') not ilike '%water treatment%'
  group by user_name, (performed_at_utc at time zone 'America/New_York')::date;
