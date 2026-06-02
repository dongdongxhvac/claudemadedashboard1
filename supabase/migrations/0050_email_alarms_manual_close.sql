-- Migration 0050 — Manual close for §10 BMS email alarms.
--
-- Some BMS vendors (Siemens especially) glitch: they send the alarm-state
-- email but never the "back to normal" email when the equipment recovers.
-- The alarm gets stuck "Active" forever in v_email_alarms_open even though
-- the equipment is fine.
--
-- email_alarm_events is append-only (Gmail msg_id is the natural key), so
-- "closing" an alarm = inserting a synthetic event with the SAME point_ref
-- but alarm_state='Quiet' (the value the BMS uses for back-to-normal).
-- DISTINCT ON (point_ref) in v_email_alarms_open then naturally drops the
-- point from the open list.
--
-- RPC handles this insertion + an audit trail in parsed_fields, gated to
-- admin/manager/lead via current_user_can_edit_kb().

create or replace function public.close_email_alarm_manual(
  p_point_ref text,
  p_reason    text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id   uuid;
  v_caller_name text;
  v_src         email_alarm_events%rowtype;
  v_now         timestamptz := now();
  v_synth_id    text;
begin
  if not current_user_can_edit_kb() then
    raise exception 'Only admin / manager / lead can manually close BMS alarms';
  end if;

  select id, full_name into v_caller_id, v_caller_name
  from public.users where auth_user_id = auth.uid() and active limit 1;
  if v_caller_id is null then
    raise exception 'Caller not linked to a users row';
  end if;

  -- Pull the most recent open alarm row for that point so we can copy the
  -- identifying fields (vendor, building, point_name, event_class) onto
  -- the synthetic close. If no Active row exists, no-op.
  select * into v_src
  from public.email_alarm_events
  where point_ref = p_point_ref
    and alarm_state = 'Active'
  order by coalesce(alarm_time_utc, received_at_utc) desc
  limit 1;

  if not found then
    raise exception 'No active alarm found for point_ref=%', p_point_ref;
  end if;

  -- Synthetic msg id must be unique + parseable as a manual close. Format
  -- matches the existing manual-prefix scheme other features use.
  v_synth_id := 'manual:' || to_char(v_now at time zone 'UTC', 'YYYYMMDDHH24MISS')
                          || ':' || gen_random_uuid()::text;

  insert into public.email_alarm_events (
    gmail_msg_id,
    gmail_thread_id,
    gmail_uid,
    label,
    from_addr,
    original_sender,
    vendor,
    subject_raw,
    subject_clean,
    received_at_utc,
    building,
    point_name,
    point_ref,
    alarm_state,
    event_class,
    event_value,
    alarm_time_local,
    alarm_time_utc,
    body_text,
    parsed_fields,
    inserted_at
  ) values (
    v_synth_id,
    null,
    null,
    'manual-close',
    'dashboard@cove-internal',
    v_caller_name,
    v_src.vendor,
    format('Manually closed: %s', coalesce(v_src.subject_clean, v_src.subject_raw, p_point_ref)),
    format('Manually closed by %s', v_caller_name),
    v_now,
    v_src.building,
    v_src.point_name,
    v_src.point_ref,
    'Quiet',
    v_src.event_class,
    null,
    null,
    v_now,
    coalesce(p_reason, format('Manually closed by %s — BMS did not send back-to-normal email.', v_caller_name)),
    jsonb_build_object(
      'manual_close',     true,
      'closed_by_id',     v_caller_id,
      'closed_by_name',   v_caller_name,
      'closed_at',        v_now,
      'reason',           p_reason,
      'sourced_from_msg', v_src.gmail_msg_id
    ),
    v_now
  );
end;
$$;

grant execute on function public.close_email_alarm_manual(text, text) to authenticated;
