-- Migration 0138 — switch a wall screen's layout from the admin page.
--
-- One TV and one Pi in the shop (user 2026-10-06): the kiosk account's
-- users.preferences.tv_layout already decides which board it shows (App.tsx
-- TvLayoutGate, 'tv' | 'tv2'), but only SQL could change it. This RPC lets
-- an admin / manager / lead set it for a tv-role account from the Admin
-- page's "Shop TV" card, and adds a third value, 'rotate', which the gate
-- resolves to TV1 / TV2 by the clock (5-minute slots). `users` is already
-- in the realtime publication (0006) and the kiosk may read its own row, so
-- the screen follows within seconds — no touching the Pi.
--
-- SECURITY DEFINER like set_my_preferences (0073): `users` has no write
-- policy below admin, and a column-restricted RPC is the safe way to open
-- exactly one jsonb key on exactly one kind of row.

create or replace function public.set_tv_layout(p_user_id uuid, p_layout text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  users%rowtype;
  v_is_lead boolean := false;
  v_new     jsonb;
begin
  select u.* into v_caller
    from users u
   where u.auth_user_id = auth.uid() and u.active
   limit 1;
  if v_caller.id is null then
    raise exception 'no active user row for caller';
  end if;

  select coalesce(ep.is_lead, false) into v_is_lead
    from engineer_profiles ep
   where ep.user_id = v_caller.id;

  if not (v_caller.role in ('admin', 'manager', 'director')
          or coalesce(v_caller.is_manager, false)
          or coalesce(v_is_lead, false)) then
    raise exception 'admin, manager or lead only';
  end if;

  if p_layout not in ('tv', 'tv2', 'rotate') then
    raise exception 'unknown tv layout: %', p_layout;
  end if;

  update users
     set preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object('tv_layout', p_layout),
         updated_at  = now()
   where id = p_user_id and role = 'tv'
   returning preferences into v_new;

  if v_new is null then
    raise exception 'not a tv (kiosk) account';
  end if;

  return v_new;
end;
$$;

grant execute on function public.set_tv_layout(uuid, text) to authenticated;
