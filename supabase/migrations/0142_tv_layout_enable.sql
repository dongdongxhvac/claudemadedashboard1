-- Migration 0142 — per-kiosk enable/disable of wall layouts.
--
-- "disable and enable tv layout" (user 2026-10-11). Each tv-role account
-- keeps the set of layouts it may NOT show in users.preferences
-- .tv_layouts_off (a jsonb array of layout keys: 'tv' | 'tv2' | 'tv3').
-- The Admin "Shop TV" card toggles entries through this RPC; the gate
-- (resolveTvLayout) skips disabled layouts when rotating and falls back to
-- the first enabled one if the fixed choice is disabled. Absent / empty =
-- everything enabled, which is how every account behaves today.
--
-- Same guards and shape as set_tv_layout (0138/0140): SECURITY DEFINER,
-- admin / manager / lead callers, tv-role targets only.

create or replace function public.set_tv_layout_enabled(p_user_id uuid, p_layout text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  users%rowtype;
  v_is_lead boolean := false;
  v_off     jsonb;
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

  if p_layout not in ('tv', 'tv2', 'tv3') then
    raise exception 'unknown tv layout: %', p_layout;
  end if;

  select coalesce(preferences->'tv_layouts_off', '[]'::jsonb) into v_off
    from users where id = p_user_id and role = 'tv';
  if v_off is null then
    raise exception 'not a tv (kiosk) account';
  end if;
  if jsonb_typeof(v_off) <> 'array' then
    v_off := '[]'::jsonb;
  end if;

  -- Rebuild the array without the layout, then append it when disabling.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_off
    from jsonb_array_elements(v_off) e
   where e <> to_jsonb(p_layout);
  if not p_enabled then
    v_off := v_off || to_jsonb(p_layout);
  end if;

  update users
     set preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object('tv_layouts_off', v_off),
         updated_at  = now()
   where id = p_user_id and role = 'tv'
   returning preferences into v_new;

  return v_new;
end;
$$;

grant execute on function public.set_tv_layout_enabled(uuid, text, boolean) to authenticated;
