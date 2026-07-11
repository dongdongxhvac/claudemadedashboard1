-- Migration 0095 — PTO notify trigger v2: prev_status + retraction events.
--
-- Extends 0094 for the calendar-invite feature in notify-pto:
--   * payload gains 'prev_status' (OLD.status on UPDATE, null on INSERT) so
--     the function knows an approved request is being retracted and can send
--     an iCalendar CANCEL for the event it previously created.
--   * new event 'retracted' fires on UPDATE approved → cancelled. It sends
--     ONLY the calendar cancellation — no notification email (the calendar
--     cancel itself lands in recipients' inboxes as "Canceled: ...").
--   * approved → denied continues to fire 'decided' (Denied email) and the
--     function also cancels the calendar event via prev_status.
--
-- Rollback: re-apply the 0094 version of notify_pto_change().

create or replace function public.notify_pto_change()
returns trigger
language plpgsql
security definer
as $$
declare
  fn_url     text := 'https://iujuibvcahuapzowjtym.supabase.co/functions/v1/notify-pto';
  -- Public anon JWT (ships in the web bundle) — satisfies verify_jwt.
  anon_key   text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1anVpYnZjYWh1YXB6b3dqdHltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODk3MTcsImV4cCI6MjA5NDQ2NTcxN30.LlfxWpcdfwm70RoyHrtTQ63jEFWTivfw9kDpSWThfGI';
  evt        text;
  prev       text := null;
  request_id bigint;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' then
      evt := 'submitted';
    elsif new.status = 'approved' then
      evt := 'decided';
    else
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    prev := old.status;
    if old.status is distinct from new.status and new.status in ('approved', 'denied') then
      evt := 'decided';
    elsif old.status = 'approved' and new.status = 'cancelled' then
      evt := 'retracted';
    else
      return new;
    end if;
  else
    return new;
  end if;

  select net.http_post(
    url     := fn_url,
    body    := jsonb_build_object(
      'type',        'pto_request',
      'event',       evt,
      'prev_status', prev,
      'record',      row_to_json(new)
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
