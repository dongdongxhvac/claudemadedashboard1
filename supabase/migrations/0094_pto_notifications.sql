-- Migration 0094 — PTO email notifications (site-aware).
--
-- Trigger on pto_requests → pg_net POST → notify-pto edge function:
--   * INSERT status='pending'                        → event 'submitted'
--       (email the requester's home-site managers: active + is_manager)
--   * INSERT status='approved' (manager direct-add)  → event 'decided'
--   * UPDATE status → approved/denied                → event 'decided'
--       (email home-site managers + the requester)
-- Cancellations and non-status edits send nothing.
--
-- Same fire-and-forget pattern as notify_overtime_change(): the exception
-- handler guarantees a notification failure never blocks the PTO write.
--
-- Rollback:
--   -- drop trigger if exists pto_requests_notify_trg on pto_requests;
--   -- drop function if exists notify_pto_change();

create or replace function public.notify_pto_change()
returns trigger
language plpgsql
security definer
as $$
declare
  fn_url     text := 'https://iujuibvcahuapzowjtym.supabase.co/functions/v1/notify-pto';
  -- The function is deployed with verify_jwt enabled (tighter than the older
  -- notify-overtime); the project anon key below is a valid signed JWT and is
  -- public by design (it ships in the web bundle), so it may live here.
  anon_key   text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1anVpYnZjYWh1YXB6b3dqdHltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODk3MTcsImV4cCI6MjA5NDQ2NTcxN30.LlfxWpcdfwm70RoyHrtTQ63jEFWTivfw9kDpSWThfGI';
  evt        text;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      evt := 'submitted';
    elsif new.status = 'approved' then
      -- Manager add-direct: skip the "new request" email, announce the
      -- decision straight away.
      evt := 'decided';
    else
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status and new.status in ('approved', 'denied') then
      evt := 'decided';
    else
      return new;
    end if;
  else
    return new;
  end if;

  select net.http_post(
    url     := fn_url,
    body    := jsonb_build_object(
      'type',   'pto_request',
      'event',  evt,
      'record', row_to_json(new)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'apikey', anon_key
    ),
    timeout_milliseconds := 5000
  ) into request_id;

  return new;
exception when others then
  raise warning 'notify_pto_change failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists pto_requests_notify_trg on pto_requests;
create trigger pto_requests_notify_trg
  after insert or update on pto_requests
  for each row execute function notify_pto_change();
