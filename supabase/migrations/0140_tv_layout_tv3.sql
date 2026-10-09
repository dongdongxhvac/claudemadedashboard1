-- Migration 0140 — set_tv_layout accepts 'tv3'.
--
-- Third wall layout (user 2026-10-09): /upark/tv3 = TV2's panels in three
-- side-by-side sections (PTO 25% · overtime 40% · on-call + LOTO 35%).
-- The gate (App.tsx TvLayoutGate / resolveTvLayout) and the Admin "Shop
-- TV" card already know the value; this just widens the RPC's allow-list
-- from 0138. 'rotate' keeps alternating tv/tv2 — unchanged. Body otherwise
-- identical to 0138.

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

  if p_layout not in ('tv', 'tv2', 'tv3', 'rotate') then
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
