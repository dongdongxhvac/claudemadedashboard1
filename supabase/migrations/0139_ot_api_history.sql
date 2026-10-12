-- Migration 0139 — keep every OT viewer job and log what changed.
--
-- Until now the sync deleted any job the API no longer listed, so §11b had
-- no history: a cancelled shift simply vanished, and a sign-up or
-- withdrawal left no trace. Per user 2026-10-12 ("log all the overtime
-- posts"):
--
--   ot_api_jobs     — rows are never deleted. first_seen_at / last_seen_at
--                     bracket a job's life in the API; removed_at is set
--                     when a poll no longer lists it (cancelled, or moved in
--                     Outlook so it came back under a new id) and cleared if
--                     it reappears. The UI treats removed_at as "cancelled".
--   ot_api_job_events — one row per change the sync noticed between two
--                     polls: added, removed, restored, rescheduled,
--                     spaces_changed, volunteer_added, volunteer_removed,
--                     retitled. detail carries the specifics (who, from/to).
--                     title/start_at are copied in so the log reads on its
--                     own after the job row changes.
--
-- Written by ot-api-sync (edge function) with the service role; the
-- watcher poller fallback only does the soft-delete, no events.

alter table public.ot_api_jobs
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at  timestamptz not null default now(),
  add column if not exists removed_at    timestamptz;

create index if not exists ot_api_jobs_removed_idx on public.ot_api_jobs (removed_at);

create table if not exists public.ot_api_job_events (
  id        bigserial primary key,
  job_id    text not null,
  at        timestamptz not null default now(),
  kind      text not null check (kind in (
              'added', 'removed', 'restored', 'rescheduled',
              'spaces_changed', 'volunteer_added', 'volunteer_removed', 'retitled')),
  detail    jsonb not null default '{}'::jsonb,
  title     text,
  start_at  timestamptz
);

create index if not exists ot_api_job_events_at_idx  on public.ot_api_job_events (at desc);
create index if not exists ot_api_job_events_job_idx on public.ot_api_job_events (job_id);

alter table public.ot_api_job_events enable row level security;

create policy "ot_api_job_events_auth_select" on public.ot_api_job_events
  for select to authenticated using (true);

alter publication supabase_realtime add table public.ot_api_job_events;
