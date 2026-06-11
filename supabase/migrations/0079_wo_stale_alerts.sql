-- Migration 0079 — stale work order detection (no CMMS update in 7+ days).
--
-- v_wo_stale: open WOs from the current snapshot whose last Cove update
-- (updated_at_cmms, falling back to submitted_date) is older than 7 days.
-- Powers the §02 manager flag, the /tv strip, and the watcher email.
--
-- wo_stale_alerts: dedup ledger for the email. Keyed (wo_id,
-- last_update_at) — a WO alerts ONCE per update-state. If someone
-- touches it in Cove and it later goes stale again, the new
-- updated_at_cmms forms a new key and it alerts again. Insert-claim
-- pattern identical to plantlog_compliance_alerts (0071).

create or replace view public.v_wo_stale as
select
  wo_id,
  status,
  assigned_to_name,
  building_code,
  description,
  coalesce(updated_at_cmms, submitted_date) as last_update_at,
  floor(extract(epoch from (now() - coalesce(updated_at_cmms, submitted_date))) / 86400)::int as days_stale
from public.current_wo_snapshot
where is_open
  and coalesce(updated_at_cmms, submitted_date) < now() - interval '7 days';

alter view public.v_wo_stale set (security_invoker = true);

create table if not exists wo_stale_alerts (
  id              uuid primary key default gen_random_uuid(),
  wo_id           text not null,
  last_update_at  timestamptz not null,
  days_stale      int,
  recipient       text not null,
  alerted_at      timestamptz not null default now(),
  unique (wo_id, last_update_at)
);

alter table wo_stale_alerts enable row level security;

create policy "wsa_auth_select" on wo_stale_alerts
  for select to authenticated using (true);
-- No insert/update/delete policies — only the service-role watcher writes.
