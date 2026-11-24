-- Migration 0170 — Plantlog compliance history, per building.
--
-- plantlog_compliance_alerts (0071) keeps one row per alert email: the list
-- of buildings missing at the moment the deadline check ran. It says nothing
-- about the buildings that were fine, and nothing about what happened after
-- — tablets often upload hours later, so "missing at 11:00" is frequently a
-- round that was done at 7:30 and synced at 1 PM.
--
-- This table is the log (user 2026-11-23, "keep the log too by buildings"):
-- one row per (day, window, building), rewritten by the plantlog poller on
-- every run for the past 7 days (the records report reaches back 7 days, so
-- a late upload still lands on the right day).
--
--   status       on_time      an entry inside the window, already here when
--                             the deadline check ran
--                synced_late  an entry inside the window that reached the
--                             dashboard after the deadline check
--                late         the round was logged after the deadline
--                             (AM: 10:30 to noon; PM: after 17:55)
--                missing      no round logged for that window
--   first_entry  time of the building's first entry for the window (ET)
--   synced_at    when that round first reached the dashboard
--
-- Windows are the ones in watcher/plantlog_compliance.py: AM = entries
-- before noon against the 10:30 deadline, PM = entries from noon against
-- the 17:55 deadline. Weekends are not checked and get no rows.

create table if not exists public.plantlog_compliance_log (
  et_day       date        not null,
  window_key   text        not null check (window_key in ('am', 'pm')),
  building     text        not null,
  status       text        not null
               check (status in ('on_time', 'synced_late', 'late', 'missing')),
  first_entry  time,
  synced_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (et_day, window_key, building)
);

create index if not exists plantlog_compliance_log_building_idx
  on public.plantlog_compliance_log (building, et_day desc);

-- Same visibility as the alert ledger (0071): signed-in users read, the
-- poller writes with the service-role key (bypasses RLS).
alter table public.plantlog_compliance_log enable row level security;

create policy "plcl_auth_select"
  on public.plantlog_compliance_log
  for select to authenticated using (true);

comment on table public.plantlog_compliance_log is
  'Plantlog round compliance per (day, window, building): on_time / synced_late / late / missing. Rewritten by the plantlog poller for the past 7 days on every run (migration 0170).';
