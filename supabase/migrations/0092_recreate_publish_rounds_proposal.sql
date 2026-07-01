-- Migration 0092 — recreate the missing publish_rounds_proposal RPC.
--
-- Only the rounds publish function failed to persist from migration 0036
-- (same partial-apply that dropped rounds_notes, recreated in 0084);
-- publish_buildings_proposal / publish_oncall_proposal exist. This is the
-- verbatim 0036 definition; its deps (rounds_notes, round_* tables,
-- current_user_is_manager) are all present now.

create or replace function publish_rounds_proposal(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id   uuid;
  v_proposal    admin_proposals%rowtype;
  v_rounds      jsonb;
  v_notes       jsonb;
  v_today       date := current_date;
  v_n           int;
  v_i           int;
  v_round       jsonb;
  v_round_id    uuid;
  v_stops       jsonb;
  v_stops_n     int;
  v_j           int;
  v_stop        jsonb;
  v_assigned    uuid;
  v_current_assignment record;
  v_note        jsonb;
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
  if v_proposal.tab <> 'rounds' then
    raise exception 'Proposal % is not a rounds proposal (tab=%)', p_proposal_id, v_proposal.tab;
  end if;

  v_rounds := coalesce(v_proposal.payload -> 'rounds', '[]'::jsonb);
  v_notes  := v_proposal.payload -> 'notes';
  v_n      := coalesce(jsonb_array_length(v_rounds), 0);

  -- Collect kept ids from payload (rounds with non-null id), so we know
  -- which live rounds are being soft-deleted.
  create temporary table _rds_kept_ids (id uuid primary key) on commit drop;
  for v_i in 0 .. v_n - 1 loop
    v_round := v_rounds -> v_i;
    if (v_round ->> 'id') is not null and (v_round ->> 'id') <> '' then
      insert into _rds_kept_ids (id) values ((v_round ->> 'id')::uuid)
        on conflict do nothing;
    end if;
  end loop;

  -- 3) Soft-delete live active rounds not present in payload. Close their
  --    open assignments first, then wipe their stops, then mark inactive.
  update round_assignments
     set ends_on = v_today
   where ends_on is null
     and round_id in (
       select id from rounds where active = true
         and id not in (select id from _rds_kept_ids)
     );

  delete from round_stops
   where round_id in (
     select id from rounds where active = true
       and id not in (select id from _rds_kept_ids)
   );

  update rounds
     set active = false, updated_at = now()
   where active = true
     and id not in (select id from _rds_kept_ids);

  -- 1) + 2) Walk payload: UPDATE matching rounds, INSERT new ones.
  for v_i in 0 .. v_n - 1 loop
    v_round    := v_rounds -> v_i;
    v_stops    := coalesce(v_round -> 'stops', '[]'::jsonb);
    v_stops_n  := jsonb_array_length(v_stops);
    v_assigned := nullif(v_round ->> 'assigned_user_id', '')::uuid;

    if (v_round ->> 'id') is null or (v_round ->> 'id') = '' then
      -- Insert new round
      insert into rounds (name, shift_id, sort_order, estimated_minutes, active)
      values (
        coalesce(v_round ->> 'name', 'New round'),
        nullif(v_round ->> 'shift_id', '')::uuid,
        coalesce((v_round ->> 'sort_order')::int, 1),
        nullif(v_round ->> 'estimated_minutes', '')::int,
        true
      )
      returning id into v_round_id;
    else
      v_round_id := (v_round ->> 'id')::uuid;
      update rounds
         set name = coalesce(v_round ->> 'name', name),
             shift_id = nullif(v_round ->> 'shift_id', '')::uuid,
             sort_order = coalesce((v_round ->> 'sort_order')::int, sort_order),
             estimated_minutes = nullif(v_round ->> 'estimated_minutes', '')::int,
             active = true,
             updated_at = now()
       where id = v_round_id;
    end if;

    -- 4) Rebuild stops for this round (small N — delete + insert is fine).
    delete from round_stops where round_id = v_round_id;
    for v_j in 0 .. v_stops_n - 1 loop
      v_stop := v_stops -> v_j;
      insert into round_stops (round_id, building_id, sequence)
      values (v_round_id, (v_stop ->> 'building_id')::uuid, v_j + 1);
    end loop;

    -- 5) Reconcile assignment. Currently-open one (if any):
    select id, user_id into v_current_assignment
      from round_assignments
     where round_id = v_round_id and ends_on is null
     limit 1;

    if v_assigned is null then
      -- Desired: unassigned. Close any open one.
      if v_current_assignment.id is not null then
        update round_assignments
           set ends_on = v_today
         where id = v_current_assignment.id;
      end if;
    else
      if v_current_assignment.id is null then
        -- No current → open new
        insert into round_assignments (round_id, user_id)
        values (v_round_id, v_assigned);
      elsif v_current_assignment.user_id <> v_assigned then
        -- Different user → close + open
        update round_assignments
           set ends_on = v_today
         where id = v_current_assignment.id;
        insert into round_assignments (round_id, user_id)
        values (v_round_id, v_assigned);
      end if;
      -- else: same user already open → no-op
    end if;
  end loop;

  -- 6) Apply notes
  if v_notes is not null then
    for v_i in 0 .. jsonb_array_length(v_notes) - 1 loop
      v_note := v_notes -> v_i;
      update rounds_notes
         set body = coalesce(v_note ->> 'body', ''),
             updated_at = now(),
             updated_by_user_id = v_caller_id
       where slot = (v_note ->> 'slot')::int;
    end loop;
  end if;

  -- Mark proposal published
  update admin_proposals
     set status = 'published',
         reviewed_by_user_id = v_caller_id,
         reviewed_at = now()
   where id = p_proposal_id;
end;
$$;

grant execute on function publish_rounds_proposal(uuid) to authenticated;
