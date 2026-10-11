-- Migration 0143 — per-kiosk rotate interval.
--
-- "make refresh timer as drop down menu, 2-10 mins" (user 2026-10-11).
-- The rotate interval was a code constant (5 min). It is now
-- users.preferences.tv_rotate_minutes (integer 2..10; absent = 5), set from
-- the Admin "Shop TV" card's dropdown through this RPC. The gate's
-- wall-clock slots and the header countdown both read it, so screens on
-- different intervals simply run on their own clocks. Same guards as
-- set_tv_layout (0138/0140) and set_tv_layout_enabled (0142).

create or replace function public.set_tv_rotate_minutes(p_user_id uuid, p_minutes int)
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

  if p_minutes is null or p_minutes < 2 or p_minutes > 10 then
    raise exception 'rotate interval must be 2-10 minutes, got %', p_minutes;
  end if;

  update users
     set preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object('tv_rotate_minutes', p_minutes),
         updated_at  = now()
   where id = p_user_id and role = 'tv'
   returning preferences into v_new;

  if v_new is null then
    raise exception 'not a tv (kiosk) account';
  end if;

  return v_new;
end;
$$;

grant execute on function public.set_tv_rotate_minutes(uuid, int) to authenticated;
