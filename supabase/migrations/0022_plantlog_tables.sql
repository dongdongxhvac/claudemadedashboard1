-- Migration 0022 — Plantlog ingestion tables (Phase 6.5)
--
-- Two tables, two data shapes, one source system:
--   plantlog_log_records   — chronological feed (memorized report 7 =
--                            "Past 7days logs by user"). One row per log
--                            entry an engineer recorded in plantlog.
--   plantlog_latest_readings — per-equipment current state (memorized report
--                              8 = "Log Record Latest ALL"). One row per
--                              unique completion per log, with all the
--                              individual item readings preserved in jsonb.
--
-- Plantlog hosts its own user namespace ("Bgonzalez", "Mdonovan", "Jie Lao"),
-- separate from Cove's `cmms_assignee_name`. Adding a `plantlog_username`
-- column to `engineer_profiles` so the dashboard can resolve "who walked
-- this round" back to a real engineer profile.
--
-- Auth: plantlog auth is JSESSIONID cookies (no JWT, no service-role key
-- equivalent). The poller writes with Supabase's service_role key via
-- supabase_client.get_client() — same pattern as the Cove pollers.
--
-- Health-check after this migration:
--   select * from plantlog_log_records order by performed_at_utc desc limit 10;
--   select log_name, completed_by_user, completed_at_utc
--     from plantlog_latest_readings order by completed_at_utc desc limit 10;
--   select count(*) from snapshots where kind in ('plantlog_records','plantlog_latest');

-- ============================================================
-- 1a. snapshots.kind: allow the two plantlog kinds
-- ============================================================
alter table public.snapshots
  drop constraint if exists snapshots_kind_check;

alter table public.snapshots
  add constraint snapshots_kind_check
  check (kind = any (array[
    'pm12'::text,
    'labor'::text,
    'wo'::text,
    'plantlog_records'::text,
    'plantlog_latest'::text
  ]));

-- ============================================================
-- 1. engineer_profiles: add plantlog_username for cross-system join
-- ============================================================
alter table public.engineer_profiles
  add column if not exists plantlog_username text;

create index if not exists engineer_profiles_plantlog_username_idx
  on public.engineer_profiles(plantlog_username)
  where plantlog_username is not null;

-- ============================================================
-- 2. plantlog_log_records — chronological "who-did-what-when" feed
-- ============================================================
create table if not exists public.plantlog_log_records (
  id                 bigserial primary key,
  snapshot_id        uuid not null references public.snapshots(id) on delete cascade,
  source_memo_id     int not null,                  -- e.g. 7 for current report
  user_name          text not null,                 -- plantlog username, e.g. "Bgonzalez"
  performed_on       date not null,                 -- 2026-05-21
  performed_at_local time not null,                 -- 17:10 (no TZ, as plantlog reports it)
  performed_at_utc   timestamptz not null,          -- America/New_York -> UTC
  group_name         text,                          -- "Garage Level 4" — location within building
  log_name           text not null,                 -- "Dry System (Always)"
  activity_name      text,                          -- "Rounds" | "PM Rounds"
  raw_row            jsonb,                         -- preserve full row in case parsing changes
  inserted_at        timestamptz not null default now(),
  -- Identity: same person at the same minute on the same piece of equipment
  -- can't be duplicate entries — plantlog enforces minute-level granularity.
  unique (user_name, log_name, performed_at_utc)
);

create index if not exists plantlog_log_records_performed_at_idx
  on public.plantlog_log_records(performed_at_utc desc);
create index if not exists plantlog_log_records_user_perf_idx
  on public.plantlog_log_records(user_name, performed_at_utc desc);
create index if not exists plantlog_log_records_group_perf_idx
  on public.plantlog_log_records(group_name, performed_at_utc desc);
create index if not exists plantlog_log_records_snapshot_idx
  on public.plantlog_log_records(snapshot_id);

-- ============================================================
-- 3. plantlog_latest_readings — per-equipment latest state + readings
-- ============================================================
create table if not exists public.plantlog_latest_readings (
  id                 bigserial primary key,
  snapshot_id        uuid not null references public.snapshots(id) on delete cascade,
  source_memo_id     int not null,                  -- 8 for current report
  log_name           text not null,                 -- "RTU 1 (Always)"
  completed_at_local timestamp not null,            -- "May 21, 2026 @ 09:39" parsed (no TZ)
  completed_at_utc   timestamptz not null,          -- America/New_York -> UTC
  completed_by_user  text,                          -- "Mdonovan"
  activity_name      text,                          -- "Rounds"
  note               text,
  readings           jsonb not null default '[]'::jsonb,
                                                    -- [{item, unit, value}, ...]
                                                    -- preserves all numeric/string readings
  inserted_at        timestamptz not null default now(),
  -- A given equipment at a given completion timestamp is unique. Same
  -- (log_name, completed_at_utc) reappears across polls until someone
  -- walks the equipment again — ON CONFLICT DO NOTHING dedupes.
  unique (log_name, completed_at_utc)
);

create index if not exists plantlog_latest_readings_completed_idx
  on public.plantlog_latest_readings(completed_at_utc desc);
create index if not exists plantlog_latest_readings_log_idx
  on public.plantlog_latest_readings(log_name);
create index if not exists plantlog_latest_readings_user_idx
  on public.plantlog_latest_readings(completed_by_user, completed_at_utc desc);
create index if not exists plantlog_latest_readings_snapshot_idx
  on public.plantlog_latest_readings(snapshot_id);

-- ============================================================
-- 4. RLS — match the cove pollers' pattern (read for everyone, write
--    blocked at the API key level since the poller uses service_role).
-- ============================================================
alter table public.plantlog_log_records enable row level security;
alter table public.plantlog_latest_readings enable row level security;

-- Authenticated users can read everything (manager, engineer, lead, tv, director).
-- Engineers seeing their own data is filtered client-side via user_name match.
drop policy if exists plantlog_log_records_read on public.plantlog_log_records;
create policy plantlog_log_records_read
  on public.plantlog_log_records
  for select
  to authenticated
  using (true);

drop policy if exists plantlog_latest_readings_read on public.plantlog_latest_readings;
create policy plantlog_latest_readings_read
  on public.plantlog_latest_readings
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies — service_role bypasses RLS, and
-- no user-facing role should be writing to these tables.

-- ============================================================
-- 5. Convenience views
-- ============================================================
-- v_plantlog_latest_per_log: most recent reading per log_name, regardless
-- of how many historical completions are stored.
create or replace view public.v_plantlog_latest_per_log as
  select distinct on (log_name)
    log_name,
    completed_at_utc,
    completed_at_local,
    completed_by_user,
    activity_name,
    note,
    readings,
    source_memo_id
  from public.plantlog_latest_readings
  order by log_name, completed_at_utc desc;

-- v_plantlog_records_daily: per-user daily count for the manager Pc panel.
create or replace view public.v_plantlog_records_daily as
  select
    user_name,
    (performed_at_utc at time zone 'America/New_York')::date as et_day,
    count(*)            as records_count,
    min(performed_at_utc) as first_at,
    max(performed_at_utc) as last_at
  from public.plantlog_log_records
  group by user_name, (performed_at_utc at time zone 'America/New_York')::date;
