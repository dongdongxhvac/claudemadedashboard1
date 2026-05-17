-- Migration 0012 — Phase 4 schema: buildings, building_assignments, rounds,
-- round_assignments, round_log, oncall_rotations.
--
-- Tables C–E from the plan. Admin can edit; everyone authenticated can read.
-- Realtime publication so on-call badges + admin tabs update live.

-- =========================================================================
-- C. buildings + building_assignments
-- =========================================================================

create table if not exists buildings (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,           -- joins pm_rows.building_code
  name            text not null,
  address         text,
  client_company  text,
  active          boolean not null default true,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists buildings_active_idx on buildings(active) where active;

create table if not exists building_assignments (
  id                uuid primary key default gen_random_uuid(),
  building_id       uuid not null references buildings(id) on delete cascade,
  user_id           uuid not null references users(id) on delete cascade,
  role_in_building  text not null default 'primary'
                       check (role_in_building in ('primary','backup','manager')),
  starts_on         date not null default current_date,
  ends_on           date,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (building_id, user_id, role_in_building, starts_on)
);
create index if not exists building_assignments_user_idx on building_assignments(user_id);
create index if not exists building_assignments_building_idx on building_assignments(building_id);

-- =========================================================================
-- D. rounds + round_assignments + round_log
-- =========================================================================

create table if not exists rounds (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  building_id        uuid references buildings(id) on delete cascade,
  schedule_cron      text,                              -- e.g. "0 7 * * 1-5"
  estimated_minutes  int,
  checklist          jsonb not null default '[]'::jsonb,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists rounds_building_idx on rounds(building_id) where active;

create table if not exists round_assignments (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references rounds(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  starts_on   date not null default current_date,
  ends_on     date,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (round_id, user_id, starts_on)
);
create index if not exists round_assignments_user_idx on round_assignments(user_id);
create index if not exists round_assignments_round_idx on round_assignments(round_id);

create table if not exists round_log (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references rounds(id) on delete cascade,
  user_id       uuid not null references users(id) on delete set null,
  completed_at  timestamptz not null default now(),
  notes         text,
  findings      jsonb not null default '[]'::jsonb,
  wo_created    text[] not null default '{}'
);
create index if not exists round_log_round_idx on round_log(round_id, completed_at desc);
create index if not exists round_log_user_idx on round_log(user_id, completed_at desc);

-- =========================================================================
-- E. oncall_rotations
-- =========================================================================

create table if not exists oncall_rotations (
  id                 uuid primary key default gen_random_uuid(),
  week_start         date not null unique,            -- Monday of the week
  primary_user_id    uuid references users(id) on delete set null,
  secondary_user_id  uuid references users(id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists oncall_rotations_week_idx on oncall_rotations(week_start desc);

-- Convenience view: this week's on-call (whatever Monday is today/earlier).
create or replace view current_oncall as
  select * from oncall_rotations
  where week_start <= current_date
  order by week_start desc
  limit 1;
alter view current_oncall set (security_invoker = true);

-- =========================================================================
-- RLS
-- =========================================================================

alter table buildings           enable row level security;
alter table building_assignments enable row level security;
alter table rounds              enable row level security;
alter table round_assignments   enable row level security;
alter table round_log           enable row level security;
alter table oncall_rotations    enable row level security;

-- Authenticated read on all six (data isn't sensitive at the row level;
-- everyone needs the context to navigate).
create policy "p4_auth_select" on buildings           for select to authenticated using (true);
create policy "p4_auth_select" on building_assignments for select to authenticated using (true);
create policy "p4_auth_select" on rounds              for select to authenticated using (true);
create policy "p4_auth_select" on round_assignments   for select to authenticated using (true);
create policy "p4_auth_select" on round_log           for select to authenticated using (true);
create policy "p4_auth_select" on oncall_rotations    for select to authenticated using (true);

-- Admin owns all writes for now. Manager-write polish lands in Phase 4 step 4
-- (when the on-call admin tab can dispatch a manager-friendly subset).
create policy "p4_admin_write" on buildings           for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');
create policy "p4_admin_write" on building_assignments for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');
create policy "p4_admin_write" on rounds              for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');
create policy "p4_admin_write" on round_assignments   for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');
create policy "p4_admin_write" on oncall_rotations    for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- round_log: engineer can record their own walk; admin/manager can manage all.
create policy "p4_round_log_self_insert" on round_log
  for insert to authenticated
  with check (
    user_id = (select id from users where auth_user_id = auth.uid() limit 1)
    or current_user_role() in ('admin','manager')
  );
create policy "p4_round_log_admin_manager_write" on round_log
  for update to authenticated
  using (current_user_role() in ('admin','manager'))
  with check (current_user_role() in ('admin','manager'));
create policy "p4_round_log_admin_delete" on round_log
  for delete to authenticated
  using (current_user_role() = 'admin');

-- =========================================================================
-- Realtime
-- =========================================================================
alter publication supabase_realtime add table buildings;
alter publication supabase_realtime add table building_assignments;
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table round_assignments;
alter publication supabase_realtime add table round_log;
alter publication supabase_realtime add table oncall_rotations;
