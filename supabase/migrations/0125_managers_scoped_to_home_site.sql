-- Migration 0125 — Manager add/edit of engineers is fenced to their HOME SITE.
--
-- 0124 gave managers INSERT/UPDATE on engineer users but, like every policy
-- before it, was role-based only — site fencing lived purely in navigation
-- (useSiteScope: "RLS stays role-based"). Fine while managers were
-- read-only; now that they can write, a Binney manager could technically
-- edit/deactivate a UPark engineer via the API (verified as Andrew Balbo's
-- session 2026-08-10: cross-site UPDATE affected 1 row). No UI path exists,
-- but the DB should say what the app means.
--
-- Rule: target's engineer_profiles.home_site_id must equal the caller's.
-- NULL resolves to UPark on BOTH sides — 0072 backfilled everyone to UPark,
-- and the UPark add-user flow leaves the column NULL for new hires, so a
-- NULL-vs-UPark mismatch would lock a UPark manager out of the row they
-- just created.
--
-- The NULL window: a users INSERT fires ensure_engineer_profile (AFTER
-- INSERT, security definer) which creates a blank, un-homed profile. The
-- Binney add flow then UPDATEs that profile to stamp home_site_id = binney.
-- Under a site-fenced profile policy, that un-homed row reads as UPark and
-- a Binney manager could never finish adding. Fix at the source: the
-- trigger now stamps the CREATOR's home site onto the new profile (admins
-- and the service role — no users row / no site — leave it NULL as
-- before). A Binney manager's insert therefore yields a Binney-homed
-- profile in the same statement; the follow-up stamp is a no-op that
-- passes the fence. UPark managers' hires get an explicit UPark stamp
-- instead of NULL, which the app already treats identically.
--
-- users INSERT stays site-agnostic (still engineer-only, no manager flag):
-- WITH CHECK runs before the trigger, when there is no profile to compare.
-- users UPDATE and engineer_profiles ALL gain the site match.
--
-- Admins keep unrestricted access via users_admin_all / ep_admin_write.

-- ── helpers ───────────────────────────────────────────────────────────────

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

-- ── trigger: stamp creator's home site on the auto-created profile ────────

create or replace function ensure_engineer_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_site uuid;
begin
  -- Only NON-ADMIN managers get their site stamped: they're fenced to one
  -- site, so a hire they add is unambiguously theirs. Admins roam both
  -- sites' admin pages, so their inserts stay NULL (as before 0125) and
  -- the page's own flow decides — the Binney add flow stamps binney
  -- explicitly; the UPark flow leaves NULL (= UPark). Service-role /
  -- seed inserts have no auth.uid() row → NULL, unchanged.
  select ep.home_site_id into v_creator_site
    from users u
    join engineer_profiles ep on ep.user_id = u.id
   where u.auth_user_id = auth.uid()
     and u.role not in ('admin', 'director')
   limit 1;

  insert into engineer_profiles (user_id, home_site_id)
  values (new.id, v_creator_site)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
-- (trigger ensure_engineer_profile_trg from 0017 is unchanged and keeps
--  pointing at this function.)

-- ── users: UPDATE gains the home-site match ───────────────────────────────

drop policy if exists users_manager_update_engineer on users;
create policy users_manager_update_engineer on users
  for update to authenticated
  using (
    current_user_can_manage_users()
    and role = 'engineer'
    and coalesce(is_manager, false) = false
    and user_home_site_id(id) = current_user_home_site_id()
  )
  with check (
    current_user_can_manage_users()
    and role = 'engineer'
    and coalesce(is_manager, false) = false
  );

-- ── engineer_profiles: manager writes fenced to own site ──────────────────
-- (0124's ep_manager_write was FOR ALL, site-agnostic.) NULL → UPark via
-- coalesce, same rule as the helpers. WITH CHECK pins the NEW value too so
-- a manager can't re-home a tech to another site.

drop policy if exists ep_manager_write on engineer_profiles;
create policy ep_manager_write on engineer_profiles
  for all to authenticated
  using (
    current_user_can_manage_users()
    and coalesce(home_site_id, (select id from sites where code = 'upark' limit 1))
        = current_user_home_site_id()
  )
  with check (
    current_user_can_manage_users()
    and coalesce(home_site_id, (select id from sites where code = 'upark' limit 1))
        = current_user_home_site_id()
  );
