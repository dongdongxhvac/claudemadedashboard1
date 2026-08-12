-- Migration 0123 — manual "run poller now" button on /binney/exp.
--
-- The escort poller lives on the Hetzner VM with no inbound endpoint, so the
-- page can't call it directly. Instead the button INSERTs a request here and
-- escort_run_watcher.py (systemd timer, every minute on the VM) picks it up,
-- starts binney-escort-poller.service, and stamps the outcome.

create table binney_escort_run_requests (
  id           uuid primary key default gen_random_uuid(),
  requested_by text,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  status       text not null default 'pending'
               check (status in ('pending','running','done','error')),
  detail       text
);

create index binney_escort_run_requests_pending_idx
  on binney_escort_run_requests(status) where status in ('pending','running');

alter table binney_escort_run_requests enable row level security;

-- Any signed-in user may request a run and watch its progress; only the
-- watcher (service role) transitions status.
create policy "escort_run_insert" on binney_escort_run_requests
  for insert to authenticated with check (status = 'pending');
create policy "escort_run_select" on binney_escort_run_requests
  for select to authenticated using (true);
