-- Migration 0122 — Binney Escort experiment (/binney/exp).
--
-- binney_escort_poller.py (VM Task Scheduler, mirrors wo12_poller.py) polls
-- the Binney Portfolio Cove network (moBABfC2ZR) for open Escort work orders,
-- parses the escort date/time out of each free-text description, and keeps
-- this table as a live mirror: upsert current open set on wo_id, then prune
-- rows the latest run no longer saw (closed/cancelled WOs disappear).
--
-- Unlike pm_rows/wo_rows there is no snapshot lineage — the escort list is
-- ~a dozen rows and only the current open set matters to the schedule page.

create table binney_escort_wos (
  wo_id             text primary key,          -- Cove altId, e.g. W-CDK-1526
  object_id         text,                      -- Cove internal id
  status            text,                      -- humanized: Submitted/Scheduled/...
  building          text,
  floor             text,
  suite             text,
  category          text,
  issue_type        text,
  assigned_to_name  text,
  submitted_by      text,
  created_for       text,
  tenant            text,
  groups            text,
  ticket_type       text,
  description       text,
  last_note         text,
  submitted_at      timestamptz,
  updated_at_cmms   timestamptz,
  -- Parsed escort schedule. escort_time null = description gave a date only,
  -- so the page renders it as an all-day item. parse_snippet keeps the exact
  -- text the parser matched so a human can audit misreads on the page.
  escort_date       date,
  escort_time       time,
  parse_snippet     text,
  parse_ok          boolean not null default false,
  fetched_at        timestamptz not null default now()
);

create index binney_escort_wos_date_idx on binney_escort_wos(escort_date);

alter table binney_escort_wos enable row level security;

-- Experiment page: any signed-in role may read (schedule data, nothing
-- sensitive). Writes come only from the poller's service-role key.
create policy "binney_escort_select" on binney_escort_wos
  for select to authenticated using (true);
