-- Migration 0144 — ot_api_job_events: what changed on the OT viewer board.
--
-- "log all the overtime posts" (user 2026-10-12). 0141 already keeps every
-- job forever (ot_api_jobs_log, with gone_at); what it cannot say is WHAT
-- changed between two polls — who signed up or withdrew, a reschedule, a
-- new job, a cancellation. The sync now diffs each poll against the log
-- and writes one row here per change:
--
--   added              a job id seen for the first time
--   removed            a job the API stopped listing (gone_at stamped)
--   restored           a gone id that came back
--   rescheduled        start/end moved        detail {from_start, from_end, to_start, to_end}
--   spaces_changed     spaces changed         detail {from, to}
--   volunteer_added    someone signed up      detail {name, email}
--   volunteer_removed  someone withdrew       detail {name, email}
--   retitled           title changed          detail {from, to}
--
-- title/start_at are copied in so the log reads on its own after the job
-- row changes. §11b's "Activity" drawer reads it newest-first.
--
-- Housekeeping: an earlier attempt at this (applied to the project as
-- "0139_ot_api_history" on 2026-10-12, never on master) created this table
-- and ALSO added first_seen_at / last_seen_at / removed_at to the live
-- MIRROR table (ot_api_jobs). That role belongs to 0141's log; the three
-- columns are unused and harmless (defaults fill them on upsert). They are
-- left in place because the MCP tool blocks on destructive DDL — drop them
-- by hand in the SQL editor when convenient:
--   alter table public.ot_api_jobs
--     drop column if exists first_seen_at, drop column if exists last_seen_at,
--     drop column if exists removed_at;
-- Everything below is idempotent and matches the project's live state.

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

drop policy if exists "ot_api_job_events_auth_select" on public.ot_api_job_events;
create policy "ot_api_job_events_auth_select" on public.ot_api_job_events
  for select to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ot_api_job_events'
  ) then
    alter publication supabase_realtime add table public.ot_api_job_events;
  end if;
end $$;
