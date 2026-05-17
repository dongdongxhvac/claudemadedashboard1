-- Migration 0013 — On-call as a rotation builder (v1.1, Turn 1 of 3).
--
-- Adds two tables that drive a "pick participants + start Friday + cycle count"
-- editor. The downstream oncall_rotations table stays unchanged; the new tables
-- are the SOURCE of truth that admin edits, and a future save action will
-- regenerate oncall_rotations rows from them. The existing free-form editor
-- continues to work against oncall_rotations until Turn 3 swaps the UI.
--
-- - oncall_participants: ordered list of engineers in the rotation. Anyone
--   not in this list is NOT on call. effective_from lets admin onboard a new
--   engineer 1-2 months ahead without disturbing the current schedule.
-- - oncall_schedule_settings: single row (id='default') with the rotation
--   anchor date (start_friday) and how many cycles to schedule per engineer.

create table if not exists oncall_participants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references users(id) on delete cascade,
  sort_order      int not null,
  effective_from  date,                                 -- null = in rotation from start_friday
  added_at        timestamptz not null default now()
);
create index if not exists oncall_participants_order_idx on oncall_participants(sort_order);

create table if not exists oncall_schedule_settings (
  id                     text primary key default 'default' check (id = 'default'),
  start_friday           date,
  rotations_per_engineer int not null default 4 check (rotations_per_engineer between 1 and 12),
  updated_at             timestamptz not null default now()
);
-- One-row table. Insert the default row idempotently.
insert into oncall_schedule_settings (id) values ('default') on conflict do nothing;

-- RLS: auth read, admin write. Matches the pattern used by the rest of Phase 4.
alter table oncall_participants        enable row level security;
alter table oncall_schedule_settings   enable row level security;

create policy "p4_auth_select" on oncall_participants
  for select to authenticated using (true);
create policy "p4_admin_write" on oncall_participants
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

create policy "p4_auth_select" on oncall_schedule_settings
  for select to authenticated using (true);
create policy "p4_admin_write" on oncall_schedule_settings
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- Realtime so the future edit UI + downstream badge update without polling.
alter publication supabase_realtime add table oncall_participants;
alter publication supabase_realtime add table oncall_schedule_settings;
