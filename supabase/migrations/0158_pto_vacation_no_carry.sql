-- Migration 0158 — vacation no longer carries; floating holiday is use-it-or-lose-it.
--
-- Rule change (user, 2026-11-11, both sites):
--   Vacation — never carries into the next year. Unused hours are lost. In a
--              special case the manager may pay them out instead (e.g. 30h
--              left in November but the engineer is out on FMLA through
--              year-end). An over-used (negative) balance is written off.
--   Floating holiday — no carry, no payout: whatever is left is lost
--              (already the behavior; holiday_forfeit_hours logs it).
--   Sick     — unchanged from 0157 (carry up to 10 days, rest paid out).
--
-- pto_close_year() keeps its signature; p_vacation_custom is now ignored.
-- No close-out row existed when this ran, so the tightened check constraint
-- has nothing to migrate.

alter table public.pto_year_end_closeouts
  add column if not exists vacation_payout_hours numeric not null default 0;

alter table public.pto_year_end_closeouts
  drop constraint if exists pto_year_end_closeouts_vacation_action_check;
alter table public.pto_year_end_closeouts
  add constraint pto_year_end_closeouts_vacation_action_check
  check (vacation_action in ('lose', 'payout'));

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

  -- Vacation never carries. 'payout' pays whatever is left (never a
  -- negative); everything else is lost / written off.
  v_vac_pay := case when p_vacation_action = 'payout' then greatest(v_vac_rem, 0) else 0 end;

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
    v_vac_rem, p_vacation_action, 0, v_vac_rem - v_vac_pay,
    v_vac_pay, greatest(v_hol_rem, 0), p_notes, current_user_id()
  ) returning * into v_row;

  insert into public.pto_balances (user_id, year, vacation_carryover, sick_carryover)
  values (p_user_id, p_from_year + 1, 0, v_sick_car)
  on conflict (user_id, year) do update
    set vacation_carryover = excluded.vacation_carryover,
        sick_carryover     = excluded.sick_carryover,
        updated_at         = now();

  return v_row;
end;
$$;
