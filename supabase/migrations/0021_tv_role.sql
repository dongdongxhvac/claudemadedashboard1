-- Migration 0021 — TV role: a read-only kiosk role for shop-floor displays.
--
-- A dedicated 'tv' user runs in a Chrome kiosk session on the shop TV. RLS
-- extends elevated SELECT to this role wherever director already has it, but
-- never grants any write. The frontend routes role='tv' to /tv (a fresh
-- layout, not a manager-view variant).

-- 1) Allow 'tv' on the role check.
alter table users drop constraint if exists users_role_check;
alter table users add  constraint users_role_check
  check (role in ('engineer','manager','client','admin','director','tv'));

-- 2) Extend SELECT on PM / WO / Labor to include 'tv'.
--    (Engineer self-scope path is unchanged — tv falls through the elevated arm.)
drop policy if exists "phase3_role_select" on pm_rows;
create policy "phase3_role_select" on pm_rows
  for select to authenticated
  using (
    current_user_role() in ('admin','manager','director','tv')
    or (current_user_role() = 'engineer' and assigned_to_name = current_user_cmms_name())
  );

drop policy if exists "phase3_role_select" on wo_rows;
create policy "phase3_role_select" on wo_rows
  for select to authenticated
  using (
    current_user_role() in ('admin','manager','director','tv')
    or (current_user_role() = 'engineer' and assigned_to_name = current_user_cmms_name())
  );

drop policy if exists "phase3_role_select" on labor_rows;
create policy "phase3_role_select" on labor_rows
  for select to authenticated
  using (
    current_user_role() in ('admin','manager','director','tv')
    or (current_user_role() = 'engineer' and assigned_to_name = current_user_cmms_name())
  );

-- 3) Extend users + engineer_profiles SELECT to include 'tv' (need full_name
--    for on-call rotations and cmms_assignee_name for per-tech aggregation).
drop policy if exists "users_self_or_elevated_select" on users;
create policy "users_self_or_elevated_select" on users
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or current_user_role() in ('admin','manager','director','tv')
    or current_user_is_lead()
  );

drop policy if exists "ep_elevated_select" on engineer_profiles;
create policy "ep_elevated_select" on engineer_profiles
  for select to authenticated
  using (
    current_user_role() in ('admin','manager','director','tv')
    or current_user_is_lead()
  );

-- 4) Tighten focus_board_items: SELECT stays open to all authenticated (tv
--    needs to display announcements), but writes are restricted to admin /
--    manager / lead. tv + director + client cannot post / dismiss.
drop policy if exists "phase2_auth_insert" on focus_board_items;
drop policy if exists "phase2_auth_update" on focus_board_items;
drop policy if exists "phase2_auth_delete" on focus_board_items;

create policy "focus_board_admin_manager_lead_insert" on focus_board_items
  for insert to authenticated
  with check (current_user_role() in ('admin','manager') or current_user_is_lead());
create policy "focus_board_admin_manager_lead_update" on focus_board_items
  for update to authenticated
  using       (current_user_role() in ('admin','manager') or current_user_is_lead())
  with check  (current_user_role() in ('admin','manager') or current_user_is_lead());
create policy "focus_board_admin_manager_lead_delete" on focus_board_items
  for delete to authenticated
  using (current_user_role() in ('admin','manager') or current_user_is_lead());

-- 5) Seed the TV user. auth_user_id stays null until an admin creates the
--    auth.users row via Supabase Dashboard → Authentication → Users → Add
--    user, with email tv@cove.local and a password of their choosing. The
--    auth-link trigger from migration 0008 will hook them up automatically.
insert into users (full_name, email, role, active)
select 'Shop TV', 'tv@cove.local', 'tv', true
where not exists (select 1 from users where email = 'tv@cove.local');
