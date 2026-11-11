-- Migration 0159 — over-used vacation is deducted from next year.
--
-- Rule (user, 2026-11-11, both sites): unused vacation still never carries
-- (lost, or paid out in a special case — 0158). But a NEGATIVE vacation
-- balance at year-end is no longer written off: it carries into the next
-- year as a negative vacation_carryover, so v_pto_summary's remaining for
-- that year starts that many hours lower.
--   vacation_carryover_hours = least(remaining, 0)
--   vacation_forfeit_hours   = unused hours lost (never negative now)
-- Only pto_close_year() changes.

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
  v_vac_pay   numeric;
  v_vac_owe   numeric;
  v_row       public.pto_year_end_closeouts;
begin
  if not (current_user_role() = any (array['admin', 'manager']) or current_user_is_lead()) then
    raise exception 'Only a manager can close out a PTO year';
  end if;
  if p_vacation_action not in ('lose', 'payout') then
    raise exception 'vacation action must be lose or payout';
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

  -- Unused vacation never carries: it is lost, or paid out when the manager
  -- picks 'payout'. An over-used (negative) balance is the exception — it
  -- carries as a negative and is deducted from next year's vacation.
  v_vac_pay := case when p_vacation_action = 'payout' then greatest(v_vac_rem, 0) else 0 end;
  v_vac_owe := least(v_vac_rem, 0);

  update public.pto_year_end_closeouts
     set voided_at = now(), voided_by = current_user_id()
   where user_id = p_user_id and from_year = p_from_year and voided_at is null;

  insert into public.pto_year_end_closeouts (
    user_id, from_year, daily_hours,
    sick_remaining, sick_carry_cap, sick_carryover_hours, sick_payout_hours,
    vacation_remaining, vacation_action, vacation_carryover_hours, vacation_forfeit_hours,
    vacation_payout_hours, holiday_forfeit_hours, notes, closed_by
  ) values (
    p_user_id, p_from_year, v_daily,
    v_sick_rem, v_cap, v_sick_car, v_sick_pay,
    v_vac_rem, p_vacation_action, v_vac_owe, greatest(v_vac_rem, 0) - v_vac_pay,
    v_vac_pay, greatest(v_hol_rem, 0), p_notes, current_user_id()
  ) returning * into v_row;

  insert into public.pto_balances (user_id, year, vacation_carryover, sick_carryover)
  values (p_user_id, p_from_year + 1, v_vac_owe, v_sick_car)
  on conflict (user_id, year) do update
    set vacation_carryover = excluded.vacation_carryover,
        sick_carryover     = excluded.sick_carryover,
        updated_at         = now();

  return v_row;
end;
$$;
