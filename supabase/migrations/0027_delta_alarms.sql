-- Migration 0027 — Delta enteliWEB alarm ingestion (Phase 7.0)
--
-- enteliWEB exposes two relevant endpoints:
--   wsnotification/get?lastIndex=N  — cursor-based change feed. Returns 0+
--                                     transition records (state changes, acks,
--                                     clears) since N. Polled every 5s.
--   wsalarm/active/                 — full open-alarm list. XML payload, 529
--                                     rows at Takeda right now. Polled every
--                                     5 min as a reconcile against the
--                                     notification feed.
--
-- Auth: enteliWebID cookie + _csrfToken in form body. Managed by
-- watcher/delta_session.py (same shape as cove_session.py / plantlog_session.py).
--
-- Three tables:
--   delta_alarm_events  — append-only change log. One row per BMS notification.
--                         PK = the BMS-side monotonic ID (e.g. 3446695). This is
--                         the historical record; transitions, acks, clears all
--                         land here. NO snapshot coupling — events arrive
--                         continuously, not in batches.
--   delta_alarms_open   — open-alarm snapshot from the 5-min reconcile. PK on
--                         (snapshot_id, event_ref). Same shape as pm_rows.
--   delta_poll_state    — single-row cursor: last notification ID seen, last
--                         full sync timestamp. Daemon reads at startup.
--
-- Why no delta_alarm_close_events: unlike PM/WO where "closed" is inferred by
-- the row disappearing between snapshots, enteliWEB's notification feed emits
-- an explicit event for every ack and every transition to/from normal. So the
-- close history is already captured in delta_alarm_events. No second table.
--
-- Health-check after migration:
--   select count(*) from delta_alarm_events;
--   select * from delta_alarm_events order by event_timestamp_utc desc limit 10;
--   select count(*) from delta_alarms_open
--     where snapshot_id = (select id from snapshots where kind='delta_alarms_open' order by taken_at desc limit 1);
--   select * from delta_poll_state;

-- ============================================================
-- 1. snapshots.kind: allow 'delta_alarms_open'
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
    'plantlog_latest'::text,
    'delta_alarms_open'::text
  ]));

-- ============================================================
-- 2. delta_alarm_events — append-only change feed
-- ============================================================
-- One row per notification from wsnotification/get. The BMS-assigned ID is
-- globally monotonic across the entire enteliWEB instance, so it's a clean PK
-- and dedupes naturally on overlapping polls.
create table if not exists public.delta_alarm_events (
  event_id            bigint primary key,           -- e.g. 3446695 (BMS-assigned monotonic)
  event_ref           text   not null,              -- //Takeda/369.EV6 (BACnet event reference, FK-like to alarm)
  input_ref           text,                         -- //Takeda/369.BV301 (underlying point)
  input_name          text,                         -- SAFlow3064_AirflowAlarm
  object_name         text,                         -- 35_3194_SAFlow3064_Alm EV
  object_type         text,                         -- Alarm_Detail (always for our use case)
  action              text   not null,              -- STATUSCHANGE | ACKNOWLEDGE | ...
  property            text,                         -- Event
  priority            int,
  category_id         int,
  category_name       text,                         -- Maintenance Alarm Group / ForestCity_Critical / ...
  category_color      text,                         -- #f4c932
  alarm_category_name text,                         -- Maintenance / Critical / ...
  from_value          text,                         -- OldValue: normal | offnormal | fault | ack
  to_value            text,                         -- NewValue: normal | offnormal | fault | ack
  current_state       text,                         -- offnormal at time of event
  acked               boolean,
  user_name           text,                         -- System | <real user who acked>
  user_id             text,                         -- uuid from the BMS
  comment             text,                         -- full alarm text incl. point detail
  event_type_text     text,                         -- change-of-state
  notify_type_text    text,                         -- alarm | event
  module              text,                         -- bacnet
  device_id           int,                          -- event_detail_Device, e.g. 369
  event_timestamp_utc timestamptz not null,         -- when the event happened in the BMS
  log_timestamp_utc   timestamptz not null,         -- when enteliWEB logged it (usually ~ms after)
  raw                 jsonb       not null,         -- preserve full record
  inserted_at         timestamptz not null default now()
);

create index if not exists delta_alarm_events_event_ref_idx
  on public.delta_alarm_events(event_ref, event_timestamp_utc desc);
create index if not exists delta_alarm_events_recent_idx
  on public.delta_alarm_events(event_timestamp_utc desc);
create index if not exists delta_alarm_events_category_idx
  on public.delta_alarm_events(category_name, event_timestamp_utc desc);
create index if not exists delta_alarm_events_action_idx
  on public.delta_alarm_events(action, event_timestamp_utc desc);
create index if not exists delta_alarm_events_priority_idx
  on public.delta_alarm_events(priority)
  where priority is not null;

-- ============================================================
-- 3. delta_alarms_open — 5-min reconcile snapshot of active alarms
-- ============================================================
-- Replaces pm_rows/wo_rows pattern. Each full sync inserts a snapshot row and
-- fans out one row per alarm currently in <ActiveAlarmList>.
create table if not exists public.delta_alarms_open (
  id                 bigserial primary key,
  snapshot_id        uuid not null references public.snapshots(id) on delete cascade,
  event_ref          text not null,                 -- //Takeda/200.EV2 (the EventId from <Alarm>)
  alarm_text         text,
  category           int,                           -- numeric category id
  category_name      text,
  event_name         text,
  event_type_text    text,
  notify_type_text   text,
  priority           int,
  parameter_text     text,
  to_state           text,                          -- normal | offnormal | fault
  in_use             int,
  assigned           text,
  module             text,
  input_ref          text,
  input_name         text,
  link_url           text,
  icon_path          text,
  raw_timestamp      text,                          -- "2026/05/22/5 13:13:04.80" — keep raw, parse on read
  event_timestamp_utc timestamptz,                  -- parsed timestamp where possible
  group_name         text,
  group_color        text,
  group_order        int,
  latest_from_state  text,                          -- from TransitionList[0]
  latest_to_state    text,
  latest_acked       boolean,
  latest_at_utc      timestamptz,
  raw_xml            text,                          -- preserve original <Alarm>...</Alarm>
  inserted_at        timestamptz not null default now(),
  unique (snapshot_id, event_ref)
);

create index if not exists delta_alarms_open_snapshot_idx
  on public.delta_alarms_open(snapshot_id);
create index if not exists delta_alarms_open_event_ref_idx
  on public.delta_alarms_open(event_ref);
create index if not exists delta_alarms_open_category_idx
  on public.delta_alarms_open(snapshot_id, category_name);
create index if not exists delta_alarms_open_priority_idx
  on public.delta_alarms_open(snapshot_id, priority);
create index if not exists delta_alarms_open_to_state_idx
  on public.delta_alarms_open(snapshot_id, to_state);

-- ============================================================
-- 4. delta_poll_state — single-row cursor/state for the daemon
-- ============================================================
-- Single-row pattern enforced via PK check: only id=1 is allowed.
-- Daemon reads `last_notification_id` at startup, replays from there on
-- restarts so no events are missed across restarts.
create table if not exists public.delta_poll_state (
  id                          smallint primary key default 1 check (id = 1),
  last_notification_id        bigint,                       -- cursor for wsnotification/get
  last_notification_time      text,                         -- server-side "time" field, for debug
  last_full_sync_at           timestamptz,
  last_full_sync_snapshot_id  uuid references public.snapshots(id) on delete set null,
  csrf_token                  text,                         -- cached most-recent CSRF
  session_status              text,                         -- ok | expired | unknown
  last_error                  text,
  updated_at                  timestamptz not null default now()
);

-- Seed the single row so the daemon can always upsert by id=1.
insert into public.delta_poll_state (id, session_status)
  values (1, 'unknown')
  on conflict (id) do nothing;

-- ============================================================
-- 5. RLS — read-only for authenticated; service_role bypasses for writes.
-- ============================================================
alter table public.delta_alarm_events enable row level security;
alter table public.delta_alarms_open  enable row level security;
alter table public.delta_poll_state   enable row level security;

drop policy if exists delta_alarm_events_read on public.delta_alarm_events;
create policy delta_alarm_events_read
  on public.delta_alarm_events for select to authenticated using (true);

drop policy if exists delta_alarms_open_read on public.delta_alarms_open;
create policy delta_alarms_open_read
  on public.delta_alarms_open for select to authenticated using (true);

drop policy if exists delta_poll_state_read on public.delta_poll_state;
create policy delta_poll_state_read
  on public.delta_poll_state for select to authenticated using (true);

-- ============================================================
-- 6. Convenience views for the dashboard panel
-- ============================================================
-- v_delta_alarms_current: open alarms from the most recent snapshot. The /tv
-- panel queries this — no need to know the latest snapshot_id client-side.
create or replace view public.v_delta_alarms_current as
  with latest as (
    select id from public.snapshots
      where kind = 'delta_alarms_open'
      order by taken_at desc
      limit 1
  )
  select o.*
    from public.delta_alarms_open o
    join latest l on o.snapshot_id = l.id;

-- v_delta_alarm_events_recent: last 24h of transitions, newest first.
create or replace view public.v_delta_alarm_events_recent as
  select *
    from public.delta_alarm_events
    where event_timestamp_utc >= now() - interval '24 hours'
    order by event_timestamp_utc desc;

-- v_delta_alarms_by_category: counts for the panel header.
create or replace view public.v_delta_alarms_by_category as
  select category_name,
         count(*)                                       as open_count,
         sum(case when to_state <> 'normal' then 1 else 0 end) as active_count,
         sum(case when coalesce(latest_acked, false) = false then 1 else 0 end) as unacked_count
    from public.v_delta_alarms_current
    group by category_name
    order by open_count desc;
