-- Migration 0035 — Buildings tab joins the propose → review → publish workflow.
--
-- Mirrors what 0031–0034 did for the On-call tab:
--   - buildings_notes: 2-slot editable header notes (writes locked to RPC).
--   - publish_buildings_proposal: SECURITY DEFINER RPC that applies a
--     pending tab='buildings' proposal to live building_assignments rows
--     and the notes table.
--
-- Payload shape:
--   {
--     "assignments": [
--        { "building_id": "uuid", "user_id": "uuid", "role_in_building": "primary"|"backup" },
--        ...
--     ],
--     "notes": [ { "slot": 1|2, "body": "..." } ]
--   }
--
-- Publish algorithm (preserves history by ENDING old rows rather than deleting):
--   1. For each currently-active (ends_on IS NULL) row with role primary|backup
--      whose (building_id, user_id, role_in_building) triple is NOT in payload
--      → set ends_on = today.
--   2. For each payload triple that doesn't have a matching currently-active row
--      → insert a new row with starts_on = today.
--   3. Rows with role='manager' are left untouched (out of scope for this tab's
--      workflow — handled separately).
--   4. Apply notes payload to buildings_notes (slots 1+2 only).

-- ----------------------------------------------------------------------------
-- 1) buildings_notes — 2-slot editable header notes
-- ----------------------------------------------------------------------------
create table if not exists buildings_notes (
  slot               int primary key check (slot in (1,2)),
  body               text not null default '',
  updated_at         timestamptz not null default now(),
  updated_by_user_id uuid references users(id)
);

insert into buildings_notes (slot) values (1), (2)
  on conflict (slot) do nothing;

alter table buildings_notes enable row level security;

create policy "buildings_notes_auth_select" on buildings_notes
  for select to authenticated using (true);

-- No write policy — workflow goes through publish_buildings_proposal (DEFINER).

alter publication supabase_realtime add table buildings_notes;

-- ----------------------------------------------------------------------------
-- 2) publish_buildings_proposal RPC
-- ----------------------------------------------------------------------------
create or replace function publish_buildings_proposal(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id     uuid;
  v_proposal      admin_proposals%rowtype;
  v_assignments   jsonb;
  v_notes         jsonb;
  v_today         date := current_date;
  v_n             int;
  v_i             int;
  v_a             jsonb;
  v_note          jsonb;
  v_building_id   uuid;
  v_user_id       uuid;
  v_role          text;
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
  if v_proposal.tab <> 'buildings' then
    raise exception 'Proposal % is not a buildings proposal (tab=%)', p_proposal_id, v_proposal.tab;
  end if;

  v_assignments := coalesce(v_proposal.payload -> 'assignments', '[]'::jsonb);
  v_notes       := v_proposal.payload -> 'notes';
  v_n           := coalesce(jsonb_array_length(v_assignments), 0);

  -- 1) Build a temp set of the payload triples for cheap lookup.
  create temporary table _bld_payload (
    building_id uuid not null,
    user_id     uuid not null,
    role_in_building text not null
  ) on commit drop;

  for v_i in 0 .. v_n - 1 loop
    v_a := v_assignments -> v_i;
    v_building_id := (v_a ->> 'building_id')::uuid;
    v_user_id     := (v_a ->> 'user_id')::uuid;
    v_role        := v_a ->> 'role_in_building';
    if v_role not in ('primary','backup') then
      raise exception 'Payload assignment role must be primary or backup (got %)', v_role;
    end if;
    insert into _bld_payload (building_id, user_id, role_in_building)
    values (v_building_id, v_user_id, v_role);
  end loop;

  -- 2) End currently-active rows (primary/backup) that aren't in the payload.
  update building_assignments
     set ends_on = v_today
   where ends_on is null
     and role_in_building in ('primary','backup')
     and not exists (
       select 1 from _bld_payload p
       where p.building_id = building_assignments.building_id
         and p.user_id     = building_assignments.user_id
         and p.role_in_building = building_assignments.role_in_building
     );

  -- 3) Insert payload triples that aren't currently active.
  insert into building_assignments (building_id, user_id, role_in_building, starts_on)
  select p.building_id, p.user_id, p.role_in_building, v_today
    from _bld_payload p
   where not exists (
     select 1 from building_assignments ba
     where ba.ends_on is null
       and ba.building_id = p.building_id
       and ba.user_id = p.user_id
       and ba.role_in_building = p.role_in_building
   );

  -- 4) Apply notes (if present)
  if v_notes is not null then
    for v_i in 0 .. jsonb_array_length(v_notes) - 1 loop
      v_note := v_notes -> v_i;
      update buildings_notes
         set body = coalesce(v_note ->> 'body', ''),
             updated_at = now(),
             updated_by_user_id = v_caller_id
       where slot = (v_note ->> 'slot')::int;
    end loop;
  end if;

  -- 5) Mark proposal published
  update admin_proposals
     set status = 'published',
         reviewed_by_user_id = v_caller_id,
         reviewed_at = now()
   where id = p_proposal_id;
end;
$$;

grant execute on function publish_buildings_proposal(uuid) to authenticated;
