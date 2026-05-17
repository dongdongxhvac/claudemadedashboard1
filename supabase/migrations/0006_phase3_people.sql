-- Migration 0006 — Phase 3: people tables (users + engineer_profiles)
--
-- public.users has its own UUID PK so we can seed engineers from CSV data
-- before they sign up to auth.users. When an engineer signs in via magic link
-- later, an admin links their auth.users.id into users.auth_user_id.
--
-- engineer_profiles.visible_to_self = false by default per plan: admin sets up
-- profiles, then optionally exposes each to its engineer.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  email         text,
  full_name     text not null,
  role          text not null default 'engineer'
                  check (role in ('engineer','manager','client','admin')),
  access_level  int  not null default 1 check (access_level between 1 and 5),
  hiring_date   date,
  avatar_url    text,
  active        boolean not null default true,
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists users_full_name_uk on users(lower(full_name));
create index if not exists users_role_idx on users(role) where active;

create table if not exists engineer_profiles (
  user_id            uuid primary key references users(id) on delete cascade,
  cmms_assignee_name text unique,            -- matches pm_rows.assigned_to_name
  discipline         text check (discipline in ('M','E','P','BMS','FLS')),
  level              int  not null default 1 check (level between 1 and 10),
  xp                 int  not null default 0,
  skill_tree         jsonb not null default '{}'::jsonb,
  certifications     text[] not null default '{}',
  badges             jsonb not null default '[]'::jsonb,
  visible_to_self    boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Helper: current user's role from public.users (so RLS policies stay readable).
create or replace function current_user_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from users where auth_user_id = auth.uid() and active limit 1;
$$;

-- RLS — Phase 3 baseline
alter table users enable row level security;
alter table engineer_profiles enable row level security;

-- users: an authenticated user sees their own row; admin/manager see all.
create policy "users_self_select" on users
  for select to authenticated
  using (auth_user_id = auth.uid() or current_user_role() in ('admin','manager'));

-- only admin can mutate users (Phase 3.5 will refine for manager updates).
create policy "users_admin_all" on users
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- engineer_profiles:
--   * admin: full read+write
--   * manager: read all, write all-but-visible_to_self (enforced at app level for Phase 3 v1)
--   * engineer self: read own row only when visible_to_self = true
create policy "ep_admin_manager_select" on engineer_profiles
  for select to authenticated
  using (current_user_role() in ('admin','manager'));

create policy "ep_self_select_when_visible" on engineer_profiles
  for select to authenticated
  using (
    visible_to_self = true
    and user_id = (select id from users where auth_user_id = auth.uid() limit 1)
  );

create policy "ep_admin_write" on engineer_profiles
  for all to authenticated
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

create policy "ep_manager_write_no_toggle" on engineer_profiles
  for update to authenticated
  using (current_user_role() = 'manager')
  with check (current_user_role() = 'manager');

-- Realtime so the future Admin tab + Engineer Mobile auto-update on changes.
alter publication supabase_realtime add table users;
alter publication supabase_realtime add table engineer_profiles;
