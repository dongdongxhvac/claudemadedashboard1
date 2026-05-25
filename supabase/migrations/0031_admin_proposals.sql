-- Migration 0031 — Admin draft → review → publish workflow (Phase A: On-call).
--
-- Adds a single shared `admin_proposals` table that backs draft+approval for
-- every Admin tab. Phase A wires only the On-call tab; Buildings and Rounds
-- come in later phases and reuse the same table by setting tab='buildings' /
-- tab='rounds' with their own payload shapes.
--
-- Permissions model:
--   - Anyone authenticated can READ proposals (drafts are publicly visible
--     so the team can see what's coming).
--   - Admin OR lead OR is_manager can PROPOSE (insert pending row).
--   - Only is_manager can PUBLISH or REJECT (gated inside RPCs).
--   - Only the original proposer can WITHDRAW their own draft (gated in RPC).
--   - Admins do NOT bypass — even admins go through propose → publish so
--     every change has an audit trail. An admin who also wants approver
--     rights gets is_manager=true and self-publishes their own drafts.
--
-- Workflow is enforced via SECURITY DEFINER RPCs (not direct UPDATE policies)
-- because publishing has to write across multiple tables (oncall_participants,
-- oncall_schedule_settings, oncall_rotations) that have admin-only RLS write
-- policies. SECURITY DEFINER lets the RPC apply the payload atomically.

-- ----------------------------------------------------------------------------
-- 1) New permission flag on users
-- ----------------------------------------------------------------------------
alter table users add column if not exists is_manager boolean not null default false;

create or replace function current_user_is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(u.is_manager, false)
  from users u
  where u.auth_user_id = auth.uid() and u.active
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 2) admin_proposals: shared draft+approval table
-- ----------------------------------------------------------------------------
create table if not exists admin_proposals (
  id                   uuid primary key default gen_random_uuid(),
  tab                  text not null check (tab in ('oncall','buildings','rounds')),
  payload              jsonb not null,
  note                 text,
  status               text not null default 'pending'
                       check (status in ('pending','published','rejected','withdrawn')),
  proposed_by_user_id  uuid not null references users(id),
  proposed_at          timestamptz not null default now(),
  reviewed_by_user_id  uuid references users(id),
  reviewed_at          timestamptz,
  reviewer_note        text
);

create index if not exists admin_proposals_tab_status_idx
  on admin_proposals (tab, status, proposed_at desc);

-- At most ONE pending proposal per tab. Second proposer gets a clear error
-- and is told to ask the first proposer to withdraw or wait for review.
create unique index if not exists admin_proposals_one_pending_per_tab
  on admin_proposals (tab) where status = 'pending';

alter table admin_proposals enable row level security;

-- READ: open to all authenticated users (the whole point is shared visibility).
create policy "ap_auth_select" on admin_proposals
  for select to authenticated using (true);

-- INSERT: admin OR lead OR manager, and proposer field must equal the caller.
create policy "ap_proposer_insert" on admin_proposals
  for insert to authenticated
  with check (
    (current_user_role() = 'admin'
     or current_user_is_lead()
     or current_user_is_manager())
    and proposed_by_user_id = (select id from users where auth_user_id = auth.uid() limit 1)
    and status = 'pending'
  );

-- No UPDATE/DELETE policies — direct row mutation is blocked. The publish /
-- reject / withdraw RPCs below own the status transitions.

alter publication supabase_realtime add table admin_proposals;

-- ----------------------------------------------------------------------------
-- 3) RPC: publish_oncall_proposal
--    Applies a pending tab='oncall' proposal to live oncall_* tables and
--    marks it published. Mirrors the JS logic in useSaveOncallSchedule().
-- ----------------------------------------------------------------------------
create or replace function publish_oncall_proposal(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id      uuid;
  v_proposal       admin_proposals%rowtype;
  v_participants   jsonb;
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

  delete from oncall_participants;

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

  update admin_proposals
     set status = 'published',
         reviewed_by_user_id = v_caller_id,
         reviewed_at = now()
   where id = p_proposal_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) RPC: reject_proposal (manager only)
-- ----------------------------------------------------------------------------
create or replace function reject_proposal(p_proposal_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id uuid;
  v_status    text;
begin
  if not current_user_is_manager() then
    raise exception 'Only managers can reject proposals';
  end if;
  select id into v_caller_id from users
   where auth_user_id = auth.uid() and active limit 1;
  if v_caller_id is null then
    raise exception 'Caller not linked to a users row';
  end if;

  select status into v_status from admin_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal % not found', p_proposal_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Proposal % is not pending (status=%)', p_proposal_id, v_status;
  end if;

  update admin_proposals
     set status = 'rejected',
         reviewed_by_user_id = v_caller_id,
         reviewed_at = now(),
         reviewer_note = p_note
   where id = p_proposal_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) RPC: withdraw_proposal (original proposer only)
-- ----------------------------------------------------------------------------
create or replace function withdraw_proposal(p_proposal_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_caller_id uuid;
  v_proposer  uuid;
  v_status    text;
begin
  select id into v_caller_id from users
   where auth_user_id = auth.uid() and active limit 1;
  if v_caller_id is null then
    raise exception 'Caller not linked to a users row';
  end if;

  select proposed_by_user_id, status into v_proposer, v_status
    from admin_proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal % not found', p_proposal_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Proposal % is not pending (status=%)', p_proposal_id, v_status;
  end if;
  if v_proposer <> v_caller_id then
    raise exception 'Only the original proposer can withdraw a proposal';
  end if;

  update admin_proposals
     set status = 'withdrawn',
         reviewed_at = now()
   where id = p_proposal_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) Grants — RPCs run as definer; authenticated role just needs EXECUTE.
-- ----------------------------------------------------------------------------
grant execute on function publish_oncall_proposal(uuid)  to authenticated;
grant execute on function reject_proposal(uuid, text)     to authenticated;
grant execute on function withdraw_proposal(uuid)          to authenticated;
