-- Migration 0073 — self-service write for users.preferences (additive).
--
-- The only WRITE policy on `users` is admin-only (users_admin_all, 0006), so a
-- manager / lead supervisor cannot persist their own UI preferences. This adds a
-- tightly-scoped SECURITY DEFINER RPC that patches ONLY the caller's own row,
-- ONLY the preferences column. We deliberately do NOT add a table-level
-- self-UPDATE policy: Postgres RLS can't restrict UPDATE to specific columns, so
-- a broad "auth_user_id = auth.uid()" policy would let a user rewrite their own
-- role / access_level (privilege escalation). The RPC pattern mirrors the
-- SECURITY DEFINER functions already used by admin_proposals (0031).
--
-- Used by the Training view's curation layer (users.preferences.training =
-- pinned buildings / equipment / techs + visible sections). The `||` jsonb
-- concat shallow-merges, so writing {training: ...} replaces only that key and
-- leaves any other future preference keys intact.

create or replace function set_my_preferences(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_new jsonb;
begin
  select id into v_id
    from users
   where auth_user_id = auth.uid() and active
   limit 1;
  if v_id is null then
    raise exception 'no active user row for caller';
  end if;

  update users
     set preferences = coalesce(preferences, '{}'::jsonb) || p_patch,
         updated_at  = now()
   where id = v_id
   returning preferences into v_new;

  return v_new;
end;
$$;

grant execute on function set_my_preferences(jsonb) to authenticated;
