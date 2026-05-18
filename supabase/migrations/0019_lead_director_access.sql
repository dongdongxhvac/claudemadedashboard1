-- Migration 0019 — Lead engineer permissions + director role.
--
-- Until now is_lead was cosmetic (Buildings tab ★ marker only). This migration
-- gives lead engineers admin-lite write access to operational tabs (Buildings,
-- Rounds, On-call) while keeping user-record edits admin-only.
--
-- Also adds a 'director' role: read-only across everything. No writes.

-- 1) Allow 'director' on the role enum.
alter table users drop constraint if exists users_role_check;
alter table users add  constraint users_role_check
  check (role in ('engineer','manager','client','admin','director'));

-- 2) Helper: is the calling user a lead engineer?
--    SECURITY DEFINER so it can read engineer_profiles regardless of caller's RLS.
create or replace function current_user_is_lead()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(ep.is_lead, false)
  from users u
  join engineer_profiles ep on ep.user_id = u.id
  where u.auth_user_id = auth.uid() and u.active
  limit 1;
$$;

-- 3) Loosen WRITE policies on operational tables: admin OR lead can write.
--    Drop+recreate so we don't accumulate dead policies.

-- buildings
drop policy if exists "p4_admin_write" on buildings;
create policy "p4_admin_or_lead_write" on buildings
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead())
  with check  (current_user_role() = 'admin' or current_user_is_lead());

-- building_assignments
drop policy if exists "p4_admin_write" on building_assignments;
create policy "p4_admin_or_lead_write" on building_assignments
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead())
  with check  (current_user_role() = 'admin' or current_user_is_lead());

-- rounds
drop policy if exists "p4_admin_write" on rounds;
create policy "p4_admin_or_lead_write" on rounds
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead())
  with check  (current_user_role() = 'admin' or current_user_is_lead());

-- round_stops
drop policy if exists "p4_admin_write" on round_stops;
create policy "p4_admin_or_lead_write" on round_stops
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead())
  with check  (current_user_role() = 'admin' or current_user_is_lead());

-- round_assignments
drop policy if exists "p4_admin_write" on round_assignments;
create policy "p4_admin_or_lead_write" on round_assignments
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead())
  with check  (current_user_role() = 'admin' or current_user_is_lead());

-- oncall_rotations
drop policy if exists "p4_admin_write" on oncall_rotations;
create policy "p4_admin_or_lead_write" on oncall_rotations
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead())
  with check  (current_user_role() = 'admin' or current_user_is_lead());

-- 4) READ policies: include 'director' wherever admin/manager could read.
--    Leads need to read engineers for User Profiles (engineer-only filter is
--    applied in the UI; RLS still scopes engineers see only themselves on
--    engineer_profiles when visible_to_self=false, but is_lead bypasses that).

-- users: existing policy already allows self-read + admin/manager. Add lead + director read.
drop policy if exists "users_self_select" on users;
create policy "users_self_or_elevated_select" on users
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or current_user_role() in ('admin','manager','director')
    or current_user_is_lead()
  );

-- engineer_profiles: existing admin/manager select; add director + lead read.
drop policy if exists "ep_admin_manager_select" on engineer_profiles;
create policy "ep_elevated_select" on engineer_profiles
  for select to authenticated
  using (current_user_role() in ('admin','manager','director') or current_user_is_lead());

-- (engineer self-select-when-visible policy from 0006 stays untouched.)
