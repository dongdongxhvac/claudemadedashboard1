-- Migration 0156 — assign a PM to an engineer in Cove from the dashboard.
--
-- The browser never talks to Cove: the Cove session (JWT + refresh token)
-- lives in watcher/cove_session.json on the VM. So, same shape as the
-- /binney/exp "Refresh now" button (0123): the manager page INSERTs a
-- request here, pm_assign_watcher.py (per-minute systemd timer on the VM)
-- claims it, runs Cove's UpdatePMTask mutation —
--
--     mutation UpdatePMTask($id: ID!, $input: GQLPMTaskUpdateInput!) {
--       updatePMTask(id: $id, input: $input) { id }
--     }
--     variables: { id: <PM task Cove id>, input: { assigneeId: <Cove user id> } }
--
-- (captured from manage.cove.is DevTools 2026-11-05) — and stamps the
-- outcome. The mutation wants Cove's internal task id, not the PM-ROG-6743
-- altId, so pm_rows learns that id from the poller (cove_task_id) and the
-- site view exposes it.

begin;

------------------------------------------------------------------
-- 1. pm_rows.cove_task_id — Cove's internal task id (GQLPMTask.id)
------------------------------------------------------------------
alter table pm_rows add column if not exists cove_task_id text;
create index if not exists pm_rows_cove_task_idx on pm_rows (cove_task_id);
comment on column pm_rows.cove_task_id is
  'Cove GQLPMTask.id — the id UpdatePMTask takes. Null on rows written before 0156.';

-- Same view, one column appended at the end (create or replace allows that).
-- current_pm_snapshot (UPark) lists its columns explicitly, so it is untouched.
create or replace view site_pm_snapshot
with (security_invoker = true)
as
with latest as (
  select distinct on (site_code) id, site_code, taken_at, filename
  from snapshots
  where kind = 'pm12'
  order by site_code, taken_at desc
)
select
  l.site_code,
  l.taken_at  as snapshot_taken_at,
  l.filename  as snapshot_filename,
  r.id, r.snapshot_id, r.task_no, r.due_date, r.site, r.building_code,
  r.equipment, r.name, r."interval", r.status, r.assigned_to_name,
  r.open_date, r.category, r.est_labor_hours, r.suite, r.labor_hours,
  r.equipment_category, r.updated_at_cmms, r.object_id, r.pm_type,
  r.cmms_type, r.created_at,
  r.cove_task_id
from latest l
join pm_rows r on r.snapshot_id = l.id;

------------------------------------------------------------------
-- 2. the request queue
------------------------------------------------------------------
create table if not exists pm_assign_requests (
  id                     uuid primary key default gen_random_uuid(),
  site_code              text not null default 'binney',
  cove_task_id           text not null,            -- GQLPMTask.id
  task_no                text,                     -- PM-ROG-6743, for the log
  task_name              text,
  assignee_user_id       uuid references users(id) on delete set null,
  assignee_cove_id       text not null,            -- engineer_profiles.cove_user_id
  assignee_name          text,
  previous_assignee_name text,
  requested_by           text,                     -- email
  requested_at           timestamptz not null default now(),
  started_at             timestamptz,
  finished_at            timestamptz,
  status                 text not null default 'pending'
                         check (status in ('pending','running','done','error')),
  detail                 text
);

create index if not exists pm_assign_requests_pending_idx
  on pm_assign_requests (status) where status in ('pending','running');
create index if not exists pm_assign_requests_requested_idx
  on pm_assign_requests (requested_at desc);

comment on table pm_assign_requests is
  'Queue: dashboard asks the VM to reassign a Cove PM task (UpdatePMTask). Only the watcher (service role) moves status past pending.';

alter table pm_assign_requests enable row level security;

-- Managers (role manager/director/admin or users.is_manager) may queue a
-- request; anyone signed in may watch its progress. Status transitions are
-- the watcher's alone (service role bypasses RLS) — no update policy.
drop policy if exists pm_assign_insert on pm_assign_requests;
create policy pm_assign_insert on pm_assign_requests
  for insert to authenticated
  with check (current_user_can_manage_users() and status = 'pending');

drop policy if exists pm_assign_select on pm_assign_requests;
create policy pm_assign_select on pm_assign_requests
  for select to authenticated using (true);

commit;
