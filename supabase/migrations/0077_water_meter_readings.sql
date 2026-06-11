-- Migration 0077 — Water meter readings + tenant billing foundation.
--
-- Two sources, one timeline:
--   * Jan–Apr 2026  — manual backfill from the PlantLog "Item Values By
--     Label" Excel exports (water meter label). Seeded below into
--     water_meter_readings with source='excel_backfill'. The May export
--     came back empty and one file was a duplicate of March; the seed
--     below is the deduplicated union (82 readings).
--   * May 2026 →     — extracted LIVE from plantlog_latest_readings
--     (memo 8), which the hourly plantlog poller keeps fresh. The
--     combined view below unions both sources, so future monthly
--     readings appear automatically with no poller changes.
--
-- Reading cadence is irregular by design (engineers read meters in
-- person at month end/start; some buildings skip a month; some get 2+
-- visits). Billing math therefore happens against actual reading dates,
-- not calendar assumptions — the Water Billing admin tab picks, for a
-- date range, the closest reading at-or-before each boundary.
--
-- Meter label conventions (shared by both sources):
--   'Main Meter High (x10) (Water Room)' — name + optional multiplier
--   paren ((x10) / (10) / (10x) / (x100)) + location paren. The view
--   parses the multiplier so usage = (end - start) × multiplier.

create table if not exists water_meter_readings (
  id           uuid primary key default gen_random_uuid(),
  building     text not null,
  meter_label  text not null,
  unit         text not null default 'Cubic Feet',
  value        numeric not null,
  reading_at   timestamptz not null,
  source       text not null default 'manual'
                 check (source in ('excel_backfill','manual')),
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  unique (building, meter_label, reading_at)
);

create index if not exists water_meter_readings_bld_idx
  on water_meter_readings(building, meter_label, reading_at desc)
  where active;

alter table water_meter_readings enable row level security;

create policy "wmr_auth_select" on water_meter_readings
  for select to authenticated using (true);

create policy "wmr_kb_editor_insert" on water_meter_readings
  for insert to authenticated
  with check (current_user_can_edit_kb());

create policy "wmr_kb_editor_update" on water_meter_readings
  for update to authenticated
  using (current_user_can_edit_kb())
  with check (current_user_can_edit_kb());

create policy "wmr_kb_editor_delete" on water_meter_readings
  for delete to authenticated
  using (current_user_can_edit_kb());

alter publication supabase_realtime add table water_meter_readings;

-- ----------------------------------------------------------------------------
-- Combined view: manual/backfill table  UNION  live plantlog extraction.
--
-- Plantlog side: building-prefixed monthly water meter logs only (the
-- legacy un-prefixed log can't be attributed to a building and is
-- excluded by the regex). Cut over at May 1 ET: the cutoff applies to
-- the PLANTLOG side only — everything before it comes from the Excel
-- backfill. The one reading that exists in both upstreams (building
-- 40's Apr 1) therefore appears exactly once: the Excel copy survives,
-- the plantlog copy is dropped by the cutoff.
--
-- multiplier: parsed from the label — digits-only parens with optional
-- x on either side: (x10), (10), (10x), (x100). The greedy '^.*' prefix
-- anchors the capture to the LAST digits-only paren, so a numeric
-- location paren earlier in the label can never be mistaken for the
-- multiplier. Letter-containing parens like (Water Room) never match.
-- ----------------------------------------------------------------------------
create or replace view public.v_water_meter_readings_all as
select
  building,
  meter_label,
  unit,
  value,
  reading_at,
  coalesce(nullif(substring(meter_label from '^.*\(x?(\d+)x?\)'), '')::numeric, 1) as multiplier,
  source,
  id as manual_id
from public.water_meter_readings
where active

union all

select
  substring(lr.log_name from '^(\d+)') as building,
  regexp_replace(trim(r ->> 'item'), '\s{2,}', ' ', 'g') as meter_label,
  coalesce(nullif(trim(r ->> 'unit'), ''), 'Cubic Feet') as unit,
  (r ->> 'value')::numeric as value,
  lr.completed_at_utc as reading_at,
  coalesce(nullif(substring((r ->> 'item') from '^.*\(x?(\d+)x?\)'), '')::numeric, 1) as multiplier,
  'plantlog' as source,
  null::uuid as manual_id
from public.plantlog_latest_readings lr
cross join lateral jsonb_array_elements(lr.readings) as r
where lr.activity_name ilike '%monthly water meter%'
  and lr.log_name ~ '^\d+'
  and lr.completed_at_utc >= ('2026-05-01 00:00:00'::timestamp at time zone 'America/New_York')
  and (r ->> 'value') ~ '^[0-9]+\.?[0-9]*$';

alter view public.v_water_meter_readings_all set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- Seed — 82 deduplicated readings from the Jan-Apr 2026 Excel exports.
-- Idempotent via the unique constraint.
-- ----------------------------------------------------------------------------
insert into water_meter_readings (building, meter_label, unit, value, reading_at, source) values
  ('20', 'Main Bottom Meter High (Water Room)', 'Cubic Feet', 503438, ('2026-01-06 09:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Bottom Meter Low (10) (Water Room)', 'Cubic Feet', 719684, ('2026-01-06 09:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Top Meter High (Water Room)', 'Cubic Feet', 2835, ('2026-01-06 09:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Top Meter Low (x10) (Water Room)', 'Cubic Feet', 110, ('2026-01-06 09:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Bottom Meter High (Water Room)', 'Cubic Feet', 541546, ('2026-02-04 12:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Bottom Meter Low (10) (Water Room)', 'Cubic Feet', 721112, ('2026-02-04 12:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Top Meter High (Water Room)', 'Cubic Feet', 2836, ('2026-02-04 12:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Top Meter Low (x10) (Water Room)', 'Cubic Feet', 110, ('2026-02-04 12:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Bottom Meter High (Water Room)', 'Cubic Feet', 624521, ('2026-04-07 11:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Bottom Meter Low (10) (Water Room)', 'Cubic Feet', 725408, ('2026-04-07 11:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Top Meter High (Water Room)', 'Cubic Feet', 3402, ('2026-04-07 11:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('20', 'Main Top Meter Low (x10) (Water Room)', 'Cubic Feet', 153, ('2026-04-07 11:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('26', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 928810, ('2026-01-02 10:45:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('26', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 93296, ('2026-02-02 15:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('26', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 93782, ('2026-03-02 09:57:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('26', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 94447, ('2026-04-01 10:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('35', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 280450, ('2026-02-04 12:12:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('35', 'Main Meter Low (Water Room)', 'Cubic Feet', 755830, ('2026-02-04 12:12:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('35', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 282050, ('2026-04-07 11:00:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('35', 'Main Meter Low (Water Room)', 'Cubic Feet', 817443, ('2026-04-07 11:00:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('38', 'Main Meter (Water Room)', 'Cubic Feet', 8903900, ('2026-02-02 10:49:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('38', 'Main Meter (Water Room)', 'Cubic Feet', 8908100, ('2026-03-02 11:11:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter High (Water Room)', 'Cubic Feet', 1722497, ('2026-01-02 10:52:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter Low (Water Room)', 'Cubic Feet', 703956, ('2026-01-02 10:52:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter High (Water Room)', 'Cubic Feet', 1727674, ('2026-02-03 09:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter Low (Water Room)', 'Cubic Feet', 729721, ('2026-02-03 09:16:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter High (Water Room)', 'Cubic Feet', 1733919, ('2026-03-02 12:19:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter Low (Water Room)', 'Cubic Feet', 760042, ('2026-03-02 12:19:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter High (Water Room)', 'Cubic Feet', 1746303, ('2026-04-01 10:47:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('40', 'Main Meter Low (Water Room)', 'Cubic Feet', 807488, ('2026-04-01 10:47:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('45', 'Main Meter (Water Room)', 'Cubic Feet', 25235400, ('2026-02-02 12:01:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('45', 'Main Meter (Water Room)', 'Cubic Feet', 25245000, ('2026-03-03 15:17:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('45', 'Main Meter (Water Room)', 'Cubic Feet', 25267300, ('2026-04-03 10:57:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('64', 'Main Meter High (Water Room)', 'Cubic Feet', 6075100, ('2026-02-02 15:19:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('64', 'Main Meter High (Water Room)', 'Cubic Feet', 6091100, ('2026-03-02 11:54:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 801481, ('2026-01-06 09:30:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 947425, ('2026-01-06 09:30:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 801764, ('2026-02-06 14:44:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 955509, ('2026-02-06 14:44:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 801981, ('2026-03-06 15:09:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 962295, ('2026-03-06 15:09:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 802590, ('2026-04-03 10:42:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('65', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 971443, ('2026-04-03 10:42:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('75', 'Main Meter High (Water Room)', 'Cubic Feet', 4113, ('2026-02-02 10:38:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('75', 'Main Meter Low (Water Room)', 'Cubic Feet', 3480, ('2026-02-02 10:38:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('75', 'Main Meter High (Water Room)', 'Cubic Feet', 4200, ('2026-03-03 14:18:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('75', 'Main Meter Low (Water Room)', 'Cubic Feet', 3547, ('2026-03-03 14:18:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('75', 'Main Meter High (Water Room)', 'Cubic Feet', 4266, ('2026-04-03 11:45:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('75', 'Main Meter Low (Water Room)', 'Cubic Feet', 3606, ('2026-04-03 11:45:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 631298, ('2026-01-08 11:43:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 629662, ('2026-01-08 11:43:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 631351, ('2026-02-04 12:34:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 635805, ('2026-02-04 12:34:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 631425, ('2026-03-06 15:06:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 646608, ('2026-03-06 15:06:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter High (x10) (Water Room)', 'Cubic Feet', 631515, ('2026-04-03 10:45:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('88', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 659967, ('2026-04-03 10:45:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('300', 'Main Meter High (Water Room)', 'Cubic Feet', 970488, ('2026-02-04 14:07:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('300', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 209465, ('2026-02-04 14:07:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('300', 'Main Meter High (Water Room)', 'Cubic Feet', 992091, ('2026-03-02 13:42:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('300', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 210077, ('2026-03-02 13:42:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('300', 'Main Meter High (Water Room)', 'Cubic Feet', 20088, ('2026-04-01 10:21:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('300', 'Main Meter Low (x10) (Water Room)', 'Cubic Feet', 211181, ('2026-04-01 10:21:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('350', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 150764, ('2026-02-04 13:47:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('350', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 151326, ('2026-03-02 13:55:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('350', 'Main Meter (x10) (Water Room)', 'Cubic Feet', 152043, ('2026-04-01 10:29:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter High (Water Room)', 'Cubic Feet', 165076, ('2026-01-05 10:27:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter Low (Water Room)', 'Cubic Feet', 254433, ('2026-01-05 10:27:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter High (Water Room)', 'Cubic Feet', 165920, ('2026-02-03 11:01:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter Low (Water Room)', 'Cubic Feet', 260512, ('2026-02-03 11:01:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter High (Water Room)', 'Cubic Feet', 167908, ('2026-03-09 13:28:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter Low (Water Room)', 'Cubic Feet', 269017, ('2026-03-09 13:28:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter High (Water Room)', 'Cubic Feet', 168958, ('2026-04-06 10:20:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('730', 'Main Meter Low (Water Room)', 'Cubic Feet', 275276, ('2026-04-06 10:20:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter High (Water Room)', 'Cubic Feet', 1692640, ('2026-01-05 12:54:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter Low (Water Room)', 'Cubic Feet', 455069, ('2026-01-05 12:54:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter High (Water Room)', 'Cubic Feet', 1698587, ('2026-02-03 10:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter Low (Water Room)', 'Cubic Feet', 467403, ('2026-02-03 10:23:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter High (Water Room)', 'Cubic Feet', 1706539, ('2026-03-09 13:42:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter Low (Water Room)', 'Cubic Feet', 483062, ('2026-03-09 13:42:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter High (Water Room)', 'Cubic Feet', 1718003, ('2026-04-06 10:37:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill'),
  ('750', 'Main Meter Low (Water Room)', 'Cubic Feet', 496500, ('2026-04-06 10:37:00'::timestamp AT TIME ZONE 'America/New_York'), 'excel_backfill')
on conflict (building, meter_label, reading_at) do nothing;