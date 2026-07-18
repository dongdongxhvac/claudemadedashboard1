-- Migration 0105 — PTO notify trigger v4: 'amended' event for date edits.
--
-- (0104 is reserved for the invite-links renumber of 0103_user_account_events.)
--
-- Gap being closed: editing an APPROVED request's dates/hours/type never
-- touched the calendar — the event silently stayed on the old dates. Now an
-- UPDATE that keeps status='approved' but changes starts_on / ends_on /
-- hours / type fires event 'amended' with a prev_record payload
-- (old starts/ends/hours/type), and notify-pto (v22):
--   * Binney PA feed — sends a CANCEL feed email with the OLD values (so the
--     flow's cancel branch can find and delete the old event) followed by a
--     REQUEST feed email with the new values.
--   * .ics path (UPark / Binney-at-launch) — sends METHOD:REQUEST with the
--     same UID and a bumped SEQUENCE; M365 updates the event in place.
--   * No notification email — the calendar change is the message.
--
-- IMPORTANT: this recreates the LIVE trigger function, which includes the
-- backfill/past-date guard added 2026-07-13 on the laptop. That guard is
-- NOT in migrations 0094/0095 — do not rebuild from those. The guard is
-- REFINED here (review finding 2026-07-18): on UPDATE it now suppresses only
-- when the row was ALREADY past (old.ends_on < today too). Otherwise editing
-- an approved FUTURE request into the past would be swallowed and its
-- future-dated calendar event would live forever with no cleanup path; now
-- that edit fires 'amended' so the calendars get corrected. Imports
-- (ontheclock_csv) and already-past rows stay silent as before.
--
-- Rollback: re-apply the live pre-0105 version (guard + v2 events, no
-- amended branch).

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
  prev_rec   jsonb := null;
  request_id bigint;
begin
  -- Backfill / historical guard (added 2026-07-13, refined 2026-07-18):
  -- Suppress notification emails + calendar invites for
  --   (a) bulk timeclock imports (request_source = 'ontheclock_csv'),
  --   (b) INSERTs of PTO whose last day is already past (already happened),
  --   (c) UPDATEs of rows that were past BEFORE the edit too.
  -- An UPDATE that moves a FUTURE row into the past still fires — its
  -- calendar event exists and must be corrected/cleaned up.
  if new.request_source = 'ontheclock_csv' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.ends_on < current_date then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.ends_on < current_date and old.ends_on < current_date then
    return new;
  end if;

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
    elsif old.status = 'approved' and new.status = 'approved'
      and (old.starts_on is distinct from new.starts_on
        or old.ends_on   is distinct from new.ends_on
        or old.hours     is distinct from new.hours
        or old.type      is distinct from new.type) then
      -- Date/hours/type edit on an approved request → update the calendar.
      evt := 'amended';
      prev_rec := jsonb_build_object(
        'starts_on', old.starts_on,
        'ends_on',   old.ends_on,
        'hours',     old.hours,
        'type',      old.type
      );
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
      'prev_record', prev_rec,
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
