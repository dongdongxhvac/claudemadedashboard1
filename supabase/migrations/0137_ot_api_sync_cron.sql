-- Migration 0137 — schedule the hosted OT viewer sync.
--
-- The OT viewer turned out to answer on a public hostname
-- (https://uparkot.rai-zenith.com), so the edge function ot-api-sync can do
-- the 5-minute mirror from inside Supabase and nothing has to run on a VM
-- or workstation (the watcher poller stays as the fallback for a tailnet-
-- only address). Both write the same tables (0136) with the same semantics,
-- so running either — or both — is safe.
--
-- Config lives in the Vault (set_app_secret, 0078/0103):
--   select set_app_secret('UPARK_OT_API_KEY',  'upot_...');
--   select set_app_secret('UPARK_OT_API_BASE', 'https://uparkot.rai-zenith.com');
--
-- Anon key satisfies verify_jwt, same pattern as flush-pto-notify-queue
-- (0109). Every 15 minutes (user 2026-10-15; was every minute with the
-- function pacing reads to the key's one-per-300 s limit). The function's
-- own floor is set to match (select set_app_secret('UPARK_OT_API_MIN_GAP_S',
-- '840')) so a stray extra call can't read upstream sooner. A change in the
-- OT viewer therefore reaches the dashboard within 15 minutes; to go faster
-- again, shorten both the schedule here and that secret.
--
-- Pause:   select cron.unschedule('ot-api-sync');
-- Resume:  re-run this file.

select cron.unschedule(jobid) from cron.job where jobname = 'ot-api-sync';

select cron.schedule(
  'ot-api-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://iujuibvcahuapzowjtym.supabase.co/functions/v1/ot-api-sync',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1anVpYnZjYWh1YXB6b3dqdHltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODk3MTcsImV4cCI6MjA5NDQ2NTcxN30.LlfxWpcdfwm70RoyHrtTQ63jEFWTivfw9kDpSWThfGI',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1anVpYnZjYWh1YXB6b3dqdHltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODk3MTcsImV4cCI6MjA5NDQ2NTcxN30.LlfxWpcdfwm70RoyHrtTQ63jEFWTivfw9kDpSWThfGI'
    ),
    timeout_milliseconds := 30000
  );
  $$
);
