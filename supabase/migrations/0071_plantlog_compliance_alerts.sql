-- Migration 0071 — Plantlog compliance alert dedup.
--
-- §06 deadlines (Eastern Time, UPark schedule):
--   AM: 10:30am for the 7am crew
--   PM: 17:55   for the 9:30am crew
--
-- The plantlog poller runs hourly, so after each pull it checks whether
-- the deadline has passed and any building (excluding the codes the user
-- exempted: 80 / 20 / 55) has no entries for today's window. If a deadline
-- has been missed AND no alert has been sent for that (day, window) yet,
-- the poller emails jie.lao@cwservices.com.
--
-- This table is the dedupe ledger so we don't email every hour after the
-- first miss. UNIQUE(et_day, window_key) means a single INSERT ... ON
-- CONFLICT DO NOTHING in the poller decides "did I send already?"

create table if not exists plantlog_compliance_alerts (
  id            uuid primary key default gen_random_uuid(),
  et_day        date not null,
  window_key    text not null check (window_key in ('am', 'pm')),
  sent_at       timestamptz not null default now(),
  missing_buildings text[] not null default '{}',
  recipient     text not null,
  unique (et_day, window_key)
);

create index if not exists plantlog_compliance_alerts_day_idx
  on plantlog_compliance_alerts(et_day desc);

-- Read-only for authenticated users (managers can see what alerts fired).
alter table plantlog_compliance_alerts enable row level security;

create policy "plca_auth_select"
  on plantlog_compliance_alerts
  for select to authenticated using (true);

-- The poller writes via the service-role key, which bypasses RLS, so we
-- don't need write policies for authenticated.
