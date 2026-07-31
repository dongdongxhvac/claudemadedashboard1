-- 0114: On-call staged joins — effective_from now COMPACTS instead of
-- leaving gap weeks.
--
-- Before: publish materialized week k -> participant (k mod N) and simply
-- SKIPPED pre-effective weeks, leaving literal no-one-on-call gaps; adding
-- a participant also changed N, re-dealing everyone's weeks from the anchor.
-- That made a mid-stream roster join (Austin, first week 2027-01-15)
-- inexpressible.
--
-- After: deal_oncall_weeks() walks the ordered roster with a rotating
-- pointer, one Friday per step, skipping members whose effective_from is
-- after the week being dealt. A joiner slots in at their roster position on
-- their first eligible pass; nobody else's weeks move; no gaps (unless
-- literally nobody is eligible). With every member always eligible this is
-- provably identical to the old (k mod N) deal — pre-existing schedules
-- are unchanged.
--
-- MUST stay in lockstep with the TS twin: web/src/lib/oncallRotation.ts
-- (dealRotationWeeks). The grid, /tv panel, exports, and §11 overtime all
-- use the TS version; this SQL version is what publish materializes into
-- oncall_rotations.

create or replace function deal_oncall_weeks(
  p_participants jsonb,   -- ordered array of {user_id, effective_from}
  p_start_friday date,
  p_weeks int
) returns table (week_start date, user_id uuid)
language plpgsql immutable
as $$
declare
  v_n     int := coalesce(jsonb_array_length(p_participants), 0);
  v_ptr   int := 0;
  v_w     int;
  v_s     int;
  v_idx   int;
  v_eff   date;
  v_found int;
begin
  if v_n = 0 or p_weeks is null or p_weeks < 1 then
    return;
  end if;
  for v_w in 0 .. p_weeks - 1 loop
    v_found := -1;
    for v_s in 0 .. v_n - 1 loop
      v_idx := (v_ptr + v_s) % v_n;
      v_eff := nullif(p_participants -> v_idx ->> 'effective_from', '')::date;
      if v_eff is null or v_eff <= p_start_friday + (v_w * 7) then
        v_found := v_idx;
        v_ptr   := v_ptr + v_s + 1;   -- continue from just past the pick
        exit;
      end if;
    end loop;
    if v_found >= 0 then
      week_start := p_start_friday + (v_w * 7);
      user_id    := (p_participants -> v_found ->> 'user_id')::uuid;
      return next;
    end if;
    -- nobody eligible: pointer unchanged, week left unmaterialized (gap)
  end loop;
end;
$$;

-- Recreate publish_oncall_proposal (0034 body) with the dealing loop
-- swapped for deal_oncall_weeks(). Everything else — the manager gate
-- (0112-widened current_user_is_manager), settings, participants, notes,
-- status transition — is verbatim.
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
  v_i              int;
  v_extra          int;
  v_weeks          int;
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

  -- Staged-join deal (0114): materialize enough weeks that EVERY member gets
  -- their R turns. With a staged joiner the early passes compress to fewer
  -- distinct members, so a flat R*N window could end before a late joiner's
  -- R-th turn — and the grid/tv/export (which deal per-member turns) would
  -- then display weeks the DB never wrote, leaving the badge/upcoming views
  -- with no-one-on-call gaps. After the latest effective_from (week E)
  -- everyone is eligible, so E + R*N weeks always suffices; capped at 520
  -- as a runaway guard against absurd far-future join dates.
  select coalesce(max(ceil((nullif(p ->> 'effective_from', '')::date - v_start_friday) / 7.0)), 0)::int
    into v_extra
    from jsonb_array_elements(v_participants) p;
  v_weeks := least(520, v_rotations * v_n + greatest(0, v_extra));

  insert into oncall_rotations (week_start, primary_user_id)
  select d.week_start, d.user_id
    from deal_oncall_weeks(v_participants, v_start_friday, v_weeks) d;

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
