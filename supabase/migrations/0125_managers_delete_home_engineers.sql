-- Migration 0125 — Managers can DELETE engineer users homed at their own site.
--
-- Follow-up to 0124 (managers add/edit engineers). Per user 2026-08-10:
-- "manager can delete his home site engineer".
--
-- Scope:
--   * Target must be an engineer without the manager flag (same fence as
--     the 0124 UPDATE policy — admins/managers/directors and flag-holding
--     engineers are out of reach).
--   * Target's engineer_profiles.home_site_id must equal the caller's.
--     NULL home_site is treated as UPark on BOTH sides, matching the app's
--     useSiteScope rule: 0072 backfilled everyone to UPark, but the UPark
--     add-user flow leaves the column NULL for new hires — a NULL-vs-UPark
--     mismatch would make a manager unable to delete the very hire they
--     just added.
--   * DELETE cascades to engineer_profiles, pto_requests, pto_balances,
--     pm_completions, oncall_participants, overtime_signups, etc. and is
--     blocked (NO ACTION) if the user is referenced as updated_by /
--     closed_by / etc. on equipment_issues, SOPs, weekly_updates… — so
--     hard delete is realistically for fresh/mistaken rows. Established
--     engineers should be Deactivated (users.active=false), which the
--     0124 UPDATE policy already lets managers do. The UI says so.
--
-- Admins keep unrestricted delete via users_admin_all (0006).

-- Caller's home site, resolving NULL → UPark. security definer so it can
-- read engineer_profiles regardless of the caller's own RLS view of it.
create or replace function current_user_home_site_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select ep.home_site_id
       from users u
       join engineer_profiles ep on ep.user_id = u.id
      where u.auth_user_id = auth.uid() and u.active
      limit 1),
    (select id from sites where code = 'upark' limit 1)
  );
$$;

revoke all on function current_user_home_site_id() from public;
grant execute on function current_user_home_site_id() to authenticated;

-- Target user's home site with the same NULL → UPark resolution.
create or replace function user_home_site_id(p_user_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select ep.home_site_id from engineer_profiles ep where ep.user_id = p_user_id),
    (select id from sites where code = 'upark' limit 1)
  );
$$;

revoke all on function user_home_site_id(uuid) from public;
grant execute on function user_home_site_id(uuid) to authenticated;

drop policy if exists users_manager_delete_home_engineer on users;
create policy users_manager_delete_home_engineer on users
  for delete to authenticated
  using (
    current_user_can_manage_users()
    and role = 'engineer'
    and coalesce(is_manager, false) = false
    and user_home_site_id(id) = current_user_home_site_id()
  );
