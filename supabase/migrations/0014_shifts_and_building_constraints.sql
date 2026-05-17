-- Migration 0014 — Buildings tab support: shifts table, engineer lead flag,
-- one-current-primary-per-building constraint, building short codes.
--
-- Backs the new admin Buildings tab. Engineers belong to a shift (7am / 9:30am).
-- Sean Martell and Dariusz Olszewski are flagged as lead engineers (visual gold
-- marker; never auto-reshuffled). Short codes power the building chips.

-- =========================================================================
-- shifts: one row per shift schedule (7am, 9:30am, etc).
-- =========================================================================

create table if not exists shifts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,           -- "7am" / "9:30am"
  start_time  time not null,                  -- 07:00
  lunch_out   time,                           -- 12:00
  lunch_in    time,                           -- 12:30
  end_time    time not null,                  -- 15:30
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table shifts enable row level security;
create policy "shifts_auth_select" on shifts for select to authenticated using (true);
create policy "shifts_admin_write" on shifts for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

alter publication supabase_realtime add table shifts;

-- =========================================================================
-- engineer_profiles: add shift_id FK and is_lead flag.
-- =========================================================================

alter table engineer_profiles
  add column if not exists shift_id uuid references shifts(id) on delete set null,
  add column if not exists is_lead  boolean not null default false;

create index if not exists engineer_profiles_shift_idx on engineer_profiles(shift_id);
create index if not exists engineer_profiles_lead_idx  on engineer_profiles(is_lead) where is_lead;

-- =========================================================================
-- building_assignments: partial unique on one current primary per building.
-- Allows historical primaries (with ends_on set) plus exactly one open primary.
-- =========================================================================

create unique index if not exists building_assignments_one_current_primary
  on building_assignments (building_id)
  where role_in_building = 'primary' and ends_on is null;

-- =========================================================================
-- buildings: short_code for chip labels (e.g. "300", "G-30").
-- =========================================================================

alter table buildings
  add column if not exists short_code text;

create unique index if not exists buildings_short_code_uniq
  on buildings (short_code) where short_code is not null;

-- =========================================================================
-- Seed: two default shifts, lead flags, building short codes.
-- All idempotent — safe to re-run.
-- =========================================================================

insert into shifts (name, start_time, lunch_out, lunch_in, end_time, sort_order)
values
  ('7am',    '07:00', '12:00', '12:30', '15:30', 1),
  ('9:30am', '09:30', '13:00', '13:30', '18:00', 2)
on conflict (name) do nothing;

update engineer_profiles
set is_lead = true
where user_id in (select id from users where full_name in ('Sean Martell','Dariusz Olszewski'))
  and is_lead = false;

update buildings
set short_code = case
  when code ilike 'Garage - %' then 'G-' || split_part(substring(code from 10), ' ', 1)
  when split_part(code, ' ', 1) ~ '^[0-9]+$' then split_part(code, ' ', 1)
  else null
end
where short_code is null;
