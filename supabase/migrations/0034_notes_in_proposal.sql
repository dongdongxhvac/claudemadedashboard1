-- Migration 0034 — Route on-call note edits through the proposal workflow.
--
-- Before this migration: oncall_notes had a permissive write policy
-- (admin/lead/manager could edit any slot inline at any time).
--
-- After: direct writes to oncall_notes are blocked. Notes only change when
-- publish_oncall_proposal applies them, riding alongside the schedule changes.
-- This gives every note edit the same propose → review → publish audit trail
-- the schedule already has.

-- ----------------------------------------------------------------------------
-- 1) Lock down direct writes — only the SECURITY DEFINER publish RPC writes.
-- ----------------------------------------------------------------------------
drop policy if exists "oncall_notes_admin_lead_manager_write" on oncall_notes;
-- (Read policy oncall_notes_auth_select stays — everyone can still see notes.)

-- ----------------------------------------------------------------------------
-- 2) publish_oncall_proposal now ALSO applies notes from the payload.
--    Payload shape:
--      {
--        settings: { start_friday, rotations_per_engineer },
--        participants: [...],
--        notes: [ { slot: 1|2, body: "..." }, ... ]   -- optional
--      }
--    If notes is absent (old phase 9.0 proposals), notes stay untouched.
-- ----------------------------------------------------------------------------
create or replace function publish_oncall_proposal(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id      uuid;
  v_proposal       admin_proposals%rowtype;
  v_participants   jsonb;
  v_notes          jsonb;
  v_settings       jsonb;
  v_start_friday   date;
  v_rotations      int;
  v_n              int;
  v_cycle          int;
  v_i              int;
  v_user_id        uuid;
  v_effective_from date;
  v_week_start     date;
  v_participant    jsonb;
  v_note           jsonb;
begin
  if not current_user_is_manager() then
    raise exception 'Only managers can publish proposals';
  end if;

  select id into v_caller_id from users
   where auth_user_id = auth.uid() and active limit 1;
  if v_caller_id is null then
    raise exception 'Caller not linked to a users row';
  end if;

  select * into v_proposal from admin_proposals
   where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal % not found', p_proposal_id;
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'Proposal % is not pending (status=%)', p_proposal_id, v_proposal.status;
  end if;
  if v_proposal.tab <> 'oncall' then
    raise exception 'Proposal % is not an oncall proposal (tab=%)', p_proposal_id, v_proposal.tab;
  end if;

  v_settings     := v_proposal.payload -> 'settings';
  v_participants := v_proposal.payload -> 'participants';
  v_notes        := v_proposal.payload -> 'notes';
  v_start_friday := (v_settings ->> 'start_friday')::date;
  v_rotations    := (v_settings ->> 'rotations_per_engineer')::int;
  v_n            := coalesce(jsonb_array_length(v_participants), 0);

  if v_start_friday is null then
    raise exception 'Payload missing settings.start_friday';
  end if;
  if v_rotations is null or v_rotations < 1 or v_rotations > 12 then
    raise exception 'Payload settings.rotations_per_engineer out of range (got %)', v_rotations;
  end if;

  update oncall_schedule_settings
     set start_friday = v_start_friday,
         rotations_per_engineer = v_rotations,
         updated_at = now()
   where id = 'default';

  delete from oncall_participants where true;

  for v_i in 0 .. v_n - 1 loop
    v_participant := v_participants -> v_i;
    insert into oncall_participants (user_id, sort_order, effective_from)
    values (
      (v_participant ->> 'user_id')::uuid,
      v_i + 1,
      nullif(v_participant ->> 'effective_from', '')::date
    );
  end loop;

  delete from oncall_rotations where week_start >= v_start_friday;

  for v_cycle in 0 .. v_rotations - 1 loop
    for v_i in 0 .. v_n - 1 loop
      v_participant    := v_participants -> v_i;
      v_user_id        := (v_participant ->> 'user_id')::uuid;
      v_effective_from := nullif(v_participant ->> 'effective_from', '')::date;
      v_week_start     := v_start_friday + ((v_cycle * v_n + v_i) * 7);
      if v_effective_from is null or v_effective_from <= v_week_start then
        insert into oncall_rotations (week_start, primary_user_id)
        values (v_week_start, v_user_id);
      end if;
    end loop;
  end loop;

  -- Apply notes (optional in payload — old proposals from phase 9.0 won't have them)
  if v_notes is not null then
    for v_i in 0 .. jsonb_array_length(v_notes) - 1 loop
      v_note := v_notes -> v_i;
      update oncall_notes
         set body = coalesce(v_note ->> 'body', ''),
             updated_at = now(),
             updated_by_user_id = v_caller_id
       where slot = (v_note ->> 'slot')::int;
    end loop;
  end if;

  update admin_proposals
     set status = 'published',
         reviewed_by_user_id = v_caller_id,
         reviewed_at = now()
   where id = p_proposal_id;
end;
$$;
