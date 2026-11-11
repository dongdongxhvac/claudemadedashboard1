-- Migration 0160 — the year-end close-out also saves next year's allotment.
--
-- (user, 2026-11-11) The close-out projection already works out each
-- engineer's next-year allotment by the CBA rule, so confirming it now saves
-- it — "Preload by CBA" becomes a secondary path for people who never go
-- through a close-out (mid-year hires, setting a year early).
--   * pto_close_year() takes optional p_vacation_alloted / p_sick_alloted /
--     p_holiday_alloted (hours). They are written to next year's
--     pto_balances row ONLY when no allotment is set there yet; an allotment
--     a manager already set is never overwritten.
--   * pto_year_end_closeouts.next_*_alloted log what this close-out saved
--     (null = it saved none: not sent, or one was already set).
--   * Undo (pto_undo_close_year) is unchanged: it resets the carry-over and
--     leaves the allotment in place.

alter table public.pto_year_end_closeouts
  add column if not exists next_vacation_alloted numeric,
  add column if not exists next_sick_alloted     numeric,
  add column if not exists next_holiday_alloted  numeric;

-- Three parameters are appended, so the old 5-argument function has to go
-- (create-or-replace would leave both and make the RPC call ambiguous).
-- Callers that send only the first five still work — the new ones default.
drop function if exists public.pto_close_year(uuid, integer, text, numeric, text);

create or replace function public.pto_close_year(
  p_user_id          uuid,
  p_from_year        integer,
  p_vacation_action  text,
  p_vacation_custom  numeric default null,
  p_notes            text default null,
  p_vacation_alloted numeric default null,
  p_sick_alloted     numeric default null,
  p_holiday_alloted  numeric default null
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
  v_save      boolean := false;
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

  -- Next year's allotment is saved by this close-out only when the caller
  -- sends one AND none is set yet (no row, or a row with all three at 0).
  -- An allotment a manager already set is never overwritten.
  if p_vacation_alloted is not null or p_sick_alloted is not null or p_holiday_alloted is not null then
    select not exists (
      select 1 from public.pto_balances b
       where b.user_id = p_user_id and b.year = p_from_year + 1
         and (b.vacation_alloted <> 0 or b.sick_alloted <> 0 or b.holiday_alloted <> 0)
    ) into v_save;
  end if;

  update public.pto_year_end_closeouts
     set voided_at = now(), voided_by = current_user_id()
   where user_id = p_user_id and from_year = p_from_year and voided_at is null;

  insert into public.pto_year_end_closeouts (
    user_id, from_year, daily_hours,
    sick_remaining, sick_carry_cap, sick_carryover_hours, sick_payout_hours,
    vacation_remaining, vacation_action, vacation_carryover_hours, vacation_forfeit_hours,
    vacation_payout_hours, holiday_forfeit_hours, notes, closed_by,
    next_vacation_alloted, next_sick_alloted, next_holiday_alloted
  ) values (
    p_user_id, p_from_year, v_daily,
    v_sick_rem, v_cap, v_sick_car, v_sick_pay,
    v_vac_rem, p_vacation_action, v_vac_owe, greatest(v_vac_rem, 0) - v_vac_pay,
    v_vac_pay, greatest(v_hol_rem, 0), p_notes, current_user_id(),
    case when v_save then coalesce(p_vacation_alloted, 0) end,
    case when v_save then coalesce(p_sick_alloted, 0) end,
    case when v_save then coalesce(p_holiday_alloted, 0) end
  ) returning * into v_row;

  insert into public.pto_balances as b
    (user_id, year, vacation_alloted, sick_alloted, holiday_alloted, vacation_carryover, sick_carryover)
  values (
    p_user_id, p_from_year + 1,
    case when v_save then coalesce(p_vacation_alloted, 0) else 0 end,
    case when v_save then coalesce(p_sick_alloted, 0) else 0 end,
    case when v_save then coalesce(p_holiday_alloted, 0) else 0 end,
    v_vac_owe, v_sick_car
  )
  on conflict (user_id, year) do update
    set vacation_carryover = excluded.vacation_carryover,
        sick_carryover     = excluded.sick_carryover,
        vacation_alloted   = case when v_save then excluded.vacation_alloted else b.vacation_alloted end,
        sick_alloted       = case when v_save then excluded.sick_alloted     else b.sick_alloted end,
        holiday_alloted    = case when v_save then excluded.holiday_alloted  else b.holiday_alloted end,
        updated_at         = now();

  return v_row;
end;
$$;

grant execute on function public.pto_close_year(uuid, integer, text, numeric, text, numeric, numeric, numeric) to authenticated;
