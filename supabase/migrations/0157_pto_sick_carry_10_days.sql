-- Migration 0157 — sick carry-over cap raised from 2 days to 10 days.
--
-- Rule change (user, 2026-11-11, both sites): an engineer carries up to 10
-- unused sick days into the next year, on top of that year's fresh sick
-- allotment; anything over 10 days is paid out. Example: 15 days unused in
-- 2026 → 10 days carry into 2027 (+ the 8-day 2027 allotment), 5 days paid.
-- Days × the engineer's daily hours (UPark 8, Binney 10, per-engineer
-- override). Only the cap in pto_close_year() changes; no close-out had been
-- run under the old 2-day cap, so there is nothing to re-run.

create or replace function public.pto_close_year(
  p_user_id          uuid,
  p_from_year        integer,
  p_vacation_action  text,
  p_vacation_custom  numeric default null,
  p_notes            text default null
) returns public.pto_year_end_closeouts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vac_rem   numeric := 0;
  v_sick_rem  numeric := 0;
  v_hol_rem   numeric := 0;
  v_daily     numeric;
  v_cap       numeric;
  v_sick_car  numeric;
  v_sick_pay  numeric;
  v_vac_car   numeric;
  v_row       public.pto_year_end_closeouts;
begin
  if not (current_user_role() = any (array['admin', 'manager']) or current_user_is_lead()) then
    raise exception 'Only a manager can close out a PTO year';
  end if;
  if p_vacation_action not in ('carry', 'lose', 'custom') then
    raise exception 'vacation action must be carry, lose or custom';
  end if;
  if p_vacation_action = 'custom' and p_vacation_custom is null then
    raise exception 'custom vacation carry needs an hours value';
  end if;

  select s.vacation_remaining, s.sick_remaining, s.holiday_remaining
    into v_vac_rem, v_sick_rem, v_hol_rem
    from public.v_pto_summary s
   where s.user_id = p_user_id and s.year = p_from_year;
  v_vac_rem  := coalesce(v_vac_rem, 0);
  v_sick_rem := coalesce(v_sick_rem, 0);
  v_hol_rem  := coalesce(v_hol_rem, 0);

  select coalesce(ep.pto_daily_hours, case when st.code = 'binney' then 10 else 8 end)
    into v_daily
    from public.users u
    left join public.engineer_profiles ep on ep.user_id = u.id
    left join public.sites st on st.id = ep.home_site_id
   where u.id = p_user_id;
  v_daily := coalesce(v_daily, 8);

  v_cap      := 10 * v_daily;
  v_sick_car := least(v_sick_rem, v_cap);
  v_sick_pay := greatest(v_sick_rem - v_cap, 0);

  v_vac_car := case p_vacation_action
                 when 'carry'  then v_vac_rem
                 when 'lose'   then 0
                 else p_vacation_custom
               end;

  update public.pto_year_end_closeouts
     set voided_at = now(), voided_by = current_user_id()
   where user_id = p_user_id and from_year = p_from_year and voided_at is null;

  insert into public.pto_year_end_closeouts (
    user_id, from_year, daily_hours,
    sick_remaining, sick_carry_cap, sick_carryover_hours, sick_payout_hours,
    vacation_remaining, vacation_action, vacation_carryover_hours, vacation_forfeit_hours,
    holiday_forfeit_hours, notes, closed_by
  ) values (
    p_user_id, p_from_year, v_daily,
    v_sick_rem, v_cap, v_sick_car, v_sick_pay,
    v_vac_rem, p_vacation_action, v_vac_car, v_vac_rem - v_vac_car,
    greatest(v_hol_rem, 0), p_notes, current_user_id()
  ) returning * into v_row;

  insert into public.pto_balances (user_id, year, vacation_carryover, sick_carryover)
  values (p_user_id, p_from_year + 1, v_vac_car, v_sick_car)
  on conflict (user_id, year) do update
    set vacation_carryover = excluded.vacation_carryover,
        sick_carryover     = excluded.sick_carryover,
        updated_at         = now();

  return v_row;
end;
$$;
