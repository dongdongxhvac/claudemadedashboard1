-- Migration 0082 — fix PM round detection (user-reported with screenshot).
--
-- Bug: has_pm took the building's FIRST entry after noon as "the PM
-- round start". A one-off midday visit (water treatment, callback —
-- e.g. Jun 10: 350 @ 13:50, 730 @ 12:10) became that "start", landed
-- before 15:00, and flagged the building missing even though the real
-- afternoon round ran at 15:58 / 16:56.
--
-- Fix: has_pm = the building has ANY entry at/after 15:00 ET. The
-- trade-off (a visit starting just before 3pm and spilling past it
-- would count) is minutes-rare; midday-visit poisoning was daily.
-- has_am unchanged: first entry of the day before 11:30 ET.

create or replace view public.v_plantlog_daily_building_ampm as
with b as (
  select
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    building_inferred as building,
    min((performed_at_utc at time zone 'America/New_York')::time) as day_start,
    bool_or((performed_at_utc at time zone 'America/New_York')::time >= time '15:00') as any_pm_entry
  from public.plantlog_log_records
  where building_inferred is not null
  group by 1, 2
)
select
  et_day,
  building,
  (day_start < time '11:30') as has_am,
  any_pm_entry               as has_pm
from b;

alter view public.v_plantlog_daily_building_ampm set (security_invoker = true);
