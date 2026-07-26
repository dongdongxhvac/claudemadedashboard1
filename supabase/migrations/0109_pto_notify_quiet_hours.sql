-- 0109 — PTO notification quiet hours (user 2026-07-25).
--
-- Emails that would fire between 9pm and 6am Eastern no longer ding phones
-- overnight: notify-pto v25 parks the whole trigger payload in
-- pto_notify_queue instead of sending, and the pg_cron job below flushes the
-- queue once the window ends. EVERYTHING is held — notification emails,
-- the engineer's personal copy, .ics invites and the Binney PA feed — so
-- nothing arrives overnight; the morning flush lands as the crews start
-- (Binney 6A = 06:00, UPark 07:00).
--
-- The window lives in the function, not here: Vault key PTO_QUIET_HOURS
-- ("21-6" default when unset, "off" disables, env var wins). Change with
--   select set_app_secret('PTO_QUIET_HOURS', '22-6');
-- The cron job runs ALL DAY every 10 minutes — the function itself decides
-- whether quiet hours are over (DST-safe via America/New_York in Deno) and
-- no-ops on an empty queue, so the all-day schedule costs one cheap SELECT.

create table if not exists public.pto_notify_queue (
  id         bigint generated always as identity primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   int not null default 0,
  last_error text
);

comment on table public.pto_notify_queue is
  'PTO notification events held during quiet hours (21:00-06:00 ET by default). '
  'Written and flushed only by the notify-pto edge function (service role); '
  'rows with sent_at set are done, attempts >= 5 are poison-pilled and skipped.';

-- Service-role only: RLS on with no policies = invisible to every client key.
alter table public.pto_notify_queue enable row level security;

-- Flush job. Named cron.schedule upserts, so re-running this migration is safe.
-- Anon key satisfies verify_jwt, same pattern as pto_requests_notify_trg (0094).
select cron.schedule(
  'flush-pto-notify-queue',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://iujuibvcahuapzowjtym.supabase.co/functions/v1/notify-pto',
    body    := jsonb_build_object('type', 'flush_queue'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1anVpYnZjYWh1YXB6b3dqdHltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODk3MTcsImV4cCI6MjA5NDQ2NTcxN30.LlfxWpcdfwm70RoyHrtTQ63jEFWTivfw9kDpSWThfGI',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1anVpYnZjYWh1YXB6b3dqdHltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODk3MTcsImV4cCI6MjA5NDQ2NTcxN30.LlfxWpcdfwm70RoyHrtTQ63jEFWTivfw9kDpSWThfGI'
    ),
    timeout_milliseconds := 5000
  );
  $$
);
