-- Migration 0029 — BMS heartbeat tracking (Phase 8.1)
--
-- Each of the 4 BMS systems sends a daily-test alarm email Mon-Fri. Power
-- Automate forwards all of them into Gmail label "UPark 4 BMS Heart Beat
-- from Power automate". The gmail_alarms_poller (extended) reads that label
-- and lands one row here per heartbeat email.
--
-- Why a separate table from email_alarm_events: heartbeats are operational
-- health signals, not real alarms. Separating them keeps the §09 alarms
-- count clean AND gives us a per-vendor "last heartbeat" lookup that
-- powers the pipeline-staleness indicator.
--
-- Vendor slugs (primary classifier = original sender email):
--   delta_takeda           — takedabms@albireoenergy.com (Forest City group)
--   siemens_thepoint       — noreply@siemens.com (TEST_PAGE [RENO_UP] at The Point)
--   northeasttech_730_750  — jll750mainbms@northeast-tech.com (730/750 Main BaseBuilding)
--   delta_10green          — deltabms@albireoenergy.com (10 Green Street)
--
-- Cadence: ~1 heartbeat per BMS per weekday. No heartbeats Sat/Sun. The
-- staleness rule has to be weekday-aware: a 72h gap on Monday morning
-- is normal (Fri-Mon), a 28h gap on a Tuesday afternoon is not.

create table if not exists public.bms_heartbeats (
  gmail_msg_id        text primary key,             -- X-GM-MSGID
  vendor              text not null,                 -- slug (see header)
  vendor_label        text,                          -- "Delta @ Takeda", etc.
  building            text,
  point_name          text,                          -- e.g. "LLEngDailyTestAlarm200"
  state               text,                          -- Active | Quiet | Alarm | Normal (raw)
  event_timestamp_utc timestamptz not null,          -- BMS-side timestamp (from body's Sent/Time of Transition/Timestamp line)
  received_at_utc     timestamptz not null,          -- Gmail INTERNALDATE (when we got it)
  original_sender     text,                          -- the From inside the forwarded body
  subject_raw         text,
  body_text           text,
  parsed_fields       jsonb,
  inserted_at         timestamptz not null default now()
);

create index if not exists bms_heartbeats_vendor_time_idx
  on public.bms_heartbeats(vendor, event_timestamp_utc desc);
create index if not exists bms_heartbeats_recent_idx
  on public.bms_heartbeats(event_timestamp_utc desc);

alter table public.bms_heartbeats enable row level security;
drop policy if exists bms_heartbeats_read on public.bms_heartbeats;
create policy bms_heartbeats_read
  on public.bms_heartbeats for select to authenticated using (true);

-- v_bms_heartbeat_latest: most-recent heartbeat per vendor. The §09 panel
-- joins this with a weekday-aware staleness check computed client-side.
create or replace view public.v_bms_heartbeat_latest as
  select distinct on (vendor)
    vendor,
    vendor_label,
    building,
    point_name,
    state,
    event_timestamp_utc as last_seen_utc,
    received_at_utc,
    extract(epoch from (now() - event_timestamp_utc)) / 3600.0 as hours_since
  from public.bms_heartbeats
  order by vendor, event_timestamp_utc desc;
