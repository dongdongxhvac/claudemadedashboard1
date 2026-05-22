-- Migration 0021 — Snapshot retention (Phase 5.4)
--
-- The Phase 5 pollers ingest ~10K rows/day across labor_rows + pm_rows + wo_rows.
-- Without pruning, the database fills Supabase's free tier in ~6 months. This
-- migration adds a nightly cron job that drops anything older than 75 days.
--
-- Why server-side cron instead of a Task Scheduler job:
--   - Runs regardless of whether the user's PC is on.
--   - No tokens, no .env, no auth maintenance.
--   - Single source of truth (the cleanup rule lives in the database).
--
-- What gets deleted nightly:
--   snapshots         older than 75 days
--   labor_rows        — cascade from snapshots (FK is ON DELETE CASCADE)
--   pm_rows           — cascade from snapshots
--   wo_rows           — cascade from snapshots
--   ingestion_log     older than 75 days (FK is ON DELETE SET NULL, so it
--                     would otherwise grow unbounded)
--
-- Health-check after this migration is applied:
--   select * from cron.job where jobname = 'prune-old-snapshots-nightly';
--   select * from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'prune-old-snapshots-nightly')
--     order by start_time desc limit 10;
--   select * from ingestion_log where kind = 'maintenance' order by at desc limit 10;

-- Enable pg_cron. On a fresh Supabase project you may need to enable it via
-- the dashboard first: Database -> Extensions -> pg_cron -> Enable.
create extension if not exists pg_cron;

-- Cleanup routine. SECURITY DEFINER lets the cron job run with owner rights
-- without needing a logged-in user. search_path is pinned to avoid the
-- "function with mutable search_path" RLS-bypass class of bugs.
create or replace function public.prune_old_snapshots()
returns table(snapshots_deleted bigint, ingestion_log_deleted bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s_count bigint;
  l_count bigint;
begin
  with d as (
    delete from public.snapshots
    where created_at < now() - interval '75 days'
    returning 1
  )
  select count(*) into s_count from d;

  with d as (
    delete from public.ingestion_log
    where at < now() - interval '75 days'
    returning 1
  )
  select count(*) into l_count from d;

  -- Self-log so the cleanup history is grep-able from the same place you
  -- watch ingest health.
  insert into public.ingestion_log (filename, kind, status, rows, error_msg)
  values (
    'maintenance-' || to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD-HH24MI'),
    'maintenance',
    'ok',
    s_count + l_count,
    format('pruned %s snapshots + %s ingestion_log rows', s_count, l_count)
  );

  return query select s_count, l_count;
end
$$;

-- Schedule it at 07:00 UTC = 3:00 AM EDT (2:00 AM EST during winter).
-- The pollers don't run between 5:50 PM and 6:50 AM so this window is clear.
-- Cron expression: minute hour day-of-month month day-of-week.
--
-- cron.schedule() will create a duplicate job if one with the same name
-- already exists, so unschedule first to make this migration idempotent.
do $$
begin
  perform cron.unschedule('prune-old-snapshots-nightly');
exception when others then
  null; -- job didn't exist, that's fine
end $$;

select cron.schedule(
  'prune-old-snapshots-nightly',
  '0 7 * * *',
  $$select public.prune_old_snapshots();$$
);
