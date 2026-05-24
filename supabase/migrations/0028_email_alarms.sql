-- Migration 0028 — Email-forwarded alarm ingestion (Phase 8.0)
--
-- Power Automate forwards BMS alarm emails (currently from
-- noreply@siemens.com via the user's cwservices.com mailbox) into the
-- bmrupark55@gmail.com Gmail account, labeled "UPark Siemens Alarms from
-- Power Automate". A 5-min Task Scheduler poll reads the label via IMAP,
-- parses the structured subject + body, and lands one row per email here.
--
-- This is effectively our Siemens-alarm coverage — Desigo CC at UPark is
-- on-prem and not directly reachable (see project_siemens_deferred.md),
-- but it already pushes alarms via email, so we ingest the emails instead.
--
-- Each transition produces ~2 emails: one "Active" when the alarm fires
-- and one "Quiet" when it returns to normal. To answer "what's currently
-- broken?" we look at the latest row per point_ref where alarm_state =
-- 'Active'.
--
-- Health-check after migration:
--   select count(*) from email_alarm_events;
--   select * from email_alarm_events order by received_at_utc desc limit 5;
--   select * from v_email_alarms_open;

-- ============================================================
-- 1. email_alarm_events — append-only feed
-- ============================================================
-- PK is Gmail's globally-unique message ID (X-GM-MSGID), so reruns of the
-- poller idempotently upsert without duplicating rows.
create table if not exists public.email_alarm_events (
  gmail_msg_id        text primary key,           -- X-GM-MSGID (globally unique across all gmail accounts)
  gmail_thread_id     text,                       -- X-GM-THRID
  gmail_uid           bigint,                     -- IMAP UID inside the watched label
  label               text not null,              -- the Gmail label this came from
  from_addr           text,                       -- outer From (the forwarder, e.g. jie.lao@cwservices.com)
  original_sender     text,                       -- inner From extracted from body (e.g. noreply@siemens.com)
  vendor              text,                       -- inferred: 'siemens' | 'delta' | 'schneider' | 'unknown'
  subject_raw         text,
  subject_clean       text,                       -- subject minus "FW: " / "Fwd: " / "RE: " prefixes
  received_at_utc     timestamptz not null,       -- Gmail INTERNALDATE
  -- Parsed pieces from the alarm body / subject -----------------------
  building            text,                       -- e.g. "The Point"
  point_name          text,                       -- e.g. "AHU1 LOW TEMP DT"
  point_ref           text,                       -- e.g. "88_AHU1_LTD" — the BACnet object reference
  alarm_state         text,                       -- "Active" | "Quiet" | other (raw last word of subject)
  event_class         text,                       -- "Off Normal" | "High Limit" | "Low Limit" | "Fault" | ...
  event_value         text,                       -- "ON" | "OFF" | "30.71" — value inside the (...)
  alarm_time_local    text,                       -- raw "5/24 7:47 AM" from subject
  alarm_time_utc      timestamptz,                -- parsed, assuming site_tz = America/New_York
  -- Raw payloads for re-parsing if the regex changes ------------------
  body_text           text,
  body_html           text,
  parsed_fields       jsonb,                      -- copy of the structured pieces
  inserted_at         timestamptz not null default now()
);

create index if not exists email_alarm_events_received_idx
  on public.email_alarm_events(received_at_utc desc);
create index if not exists email_alarm_events_point_ref_idx
  on public.email_alarm_events(point_ref, received_at_utc desc)
  where point_ref is not null;
create index if not exists email_alarm_events_vendor_state_idx
  on public.email_alarm_events(vendor, alarm_state, received_at_utc desc);
create index if not exists email_alarm_events_building_idx
  on public.email_alarm_events(building, received_at_utc desc)
  where building is not null;

-- ============================================================
-- 2. email_poll_state — single-row heartbeat for the daemon
-- ============================================================
create table if not exists public.email_poll_state (
  id              smallint primary key default 1 check (id = 1),
  last_run_at     timestamptz,
  last_run_status text,                           -- 'ok' | 'error' | 'unknown'
  last_run_seen   int,                            -- messages examined
  last_run_added  int,                            -- new rows inserted
  last_error      text,
  updated_at      timestamptz not null default now()
);

insert into public.email_poll_state (id, last_run_status)
  values (1, 'unknown')
  on conflict (id) do nothing;

-- ============================================================
-- 3. RLS — same pattern as delta_*: read-only for authenticated,
--    service_role bypasses for writes.
-- ============================================================
alter table public.email_alarm_events enable row level security;
alter table public.email_poll_state   enable row level security;

drop policy if exists email_alarm_events_read on public.email_alarm_events;
create policy email_alarm_events_read
  on public.email_alarm_events for select to authenticated using (true);

drop policy if exists email_poll_state_read on public.email_poll_state;
create policy email_poll_state_read
  on public.email_poll_state for select to authenticated using (true);

-- ============================================================
-- 4. Views for the §09 panel
-- ============================================================
-- v_email_alarms_open: per point_ref, the most recent row IF it's Active.
-- That's our "currently in alarm via email" view — same idea as
-- v_delta_alarms_current but the data model is event-stream not snapshot.
create or replace view public.v_email_alarms_open as
  with latest as (
    select distinct on (point_ref) *
      from public.email_alarm_events
      where point_ref is not null
      order by point_ref, received_at_utc desc
  )
  select *
    from latest
    where alarm_state = 'Active';

-- v_email_alarms_recent: last 24h.
create or replace view public.v_email_alarms_recent as
  select *
    from public.email_alarm_events
    where received_at_utc >= now() - interval '24 hours'
    order by received_at_utc desc;

-- v_email_alarms_by_building: counts grouped by building for the panel header.
create or replace view public.v_email_alarms_by_building as
  select
    coalesce(building, '(unknown)') as building,
    count(*)                         as open_count,
    sum(case when event_class = 'Off Normal' then 1 else 0 end) as off_normal_count,
    sum(case when event_class = 'High Limit' or event_class = 'Low Limit' then 1 else 0 end) as limit_count,
    sum(case when event_class = 'Fault'      then 1 else 0 end) as fault_count
  from public.v_email_alarms_open
  group by 1
  order by open_count desc;
