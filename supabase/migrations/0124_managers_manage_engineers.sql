-- Migration 0124 — Managers can add and edit ENGINEER users.
--
-- Until now the only write policy on public.users was admin-only
-- (users_admin_all, 0006 — its comment promised "Phase 3.5 will refine for
-- manager updates" and never did). Managers were let into /admin for the
-- credential panels but User Profiles stayed view-only, so a site manager
-- couldn't onboard a new hire without an admin.
--
-- Scope (per user 2026-08-10: "proper fix and just engineers"):
--   * INSERT: managers may create users only with role = 'engineer'.
--   * UPDATE: managers may edit rows that ARE engineers and must LEAVE them
--     engineers — both USING and WITH CHECK pin role = 'engineer', so a
--     manager can neither promote an engineer to admin/manager nor touch an
--     existing admin/manager/director row. WITH CHECK also pins
--     is_manager = false: the flag grants publish/roster powers regardless
--     of role, so letting a manager set it on an engineer would be a
--     side-door escalation. No self-escalation path.
--   * DELETE stays admin-only (the app's add-user rollback delete will
--     silently no-op for managers — acceptable; the orphan row is a
--     harmless engineer with no profile fields, fixable via Edit).
--   * engineer_profiles: managers get INSERT + UPDATE on any profile row.
--     The old ep_manager_write_no_toggle matched role = 'manager' literally,
--     which excluded is_manager-flag holders and directors.
--
-- "Manager" here = current_user_can_manage_users(): role = 'manager' OR
-- users.is_manager OR role in (admin, director), for the active caller.
-- That's current_user_is_manager() (0112) widened to also accept the plain
-- 'manager' role, so a manager-role account with the is_manager flag unset
-- (possible via direct DB edits) still gets the roster powers its role
-- implies. Admins already pass every policy via users_admin_all /
-- ep_admin_write; the new policies are purely additive.

create or replace function current_user_can_manage_users()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(u.is_manager, false)
         or u.role in ('manager', 'admin', 'director')
  from users u
  where u.auth_user_id = auth.uid() and u.active
  limit 1;
$$;

revoke all on function current_user_can_manage_users() from public;
grant execute on function current_user_can_manage_users() to authenticated;

-- ── users ────────────────────────────────────────────────────────────────

drop policy if exists users_manager_insert_engineer on users;
create policy users_manager_insert_engineer on users
  for insert to authenticated
  with check (
    current_user_can_manage_users()
    and role = 'engineer'
    and coalesce(is_manager, false) = false
  );

-- USING mirrors WITH CHECK: an engineer row that already carries the manager
-- flag (admin-granted publish rights) is out of a manager's reach entirely,
-- rather than editable-until-save-fails.
drop policy if exists users_manager_update_engineer on users;
create policy users_manager_update_engineer on users
  for update to authenticated
  using (
    current_user_can_manage_users()
    and role = 'engineer'
    and coalesce(is_manager, false) = false
  )
  with check (
    current_user_can_manage_users()
    and role = 'engineer'
    and coalesce(is_manager, false) = false
  );

-- ── engineer_profiles ────────────────────────────────────────────────────

drop policy if exists ep_manager_write_no_toggle on engineer_profiles;
drop policy if exists ep_manager_write on engineer_profiles;
create policy ep_manager_write on engineer_profiles
  for all to authenticated
  using (current_user_can_manage_users())
  with check (current_user_can_manage_users());
