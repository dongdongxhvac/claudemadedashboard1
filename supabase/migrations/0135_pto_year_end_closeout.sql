-- Migration 0135 — next-year PTO allotments + year-end close-out (both sites).
--
-- Next-year allotment needs no new table: pto_balances is already keyed on
-- (user_id, year), so a 2027 allotment is just a 2027 row. What's new:
--
--   * pto_balances.vacation_carryover / sick_carryover — hours brought in
--     from the prior year's close-out. Kept separate from *_alloted so the
--     allotment stays the policy number and the carry is visible. Default 0,
--     so every existing remaining figure is unchanged.
--   * v_pto_summary — remaining = alloted + carryover − used; the two
--     carryover columns are appended at the end (create-or-replace safe).
--   * pto_year_end_closeouts — the record/log. One active row per
--     (user, from_year); a re-run or undo voids the prior row instead of
--     deleting it, so the full history stays.
--   * pto_close_year() / pto_undo_close_year() — the close-out itself.
--
-- Rules (user, 2026-09-26):
--   Sick     — carry at most 2 days (2 × the engineer's daily hours: UPark 8,
--              Binney 10, per-engineer pto_daily_hours override), pay out the
--              rest. A negative sick balance carries as-is, nothing paid.
--   Vacation — manager's call per engineer: 'carry' the balance as-is
--              (positive or negative), 'lose' it (forfeit / write off), or
--              'custom' hours carried with the rest forfeited.
--   Floating holiday — never carries; the leftover is logged as forfeited.
--
-- Functions are SECURITY INVOKER: the existing pto_balances elevated-write
-- policy (admin / manager / lead) and the new table's policy gate them.

alter table public.pto_balances
  add column if not exists vacation_carryover numeric not null default 0,
  add column if not exists sick_carryover     numeric not null default 0;

create or replace view public.v_pto_summary as
with used as (
  select
    user_id,
    extract(year from starts_on)::integer as year,
    sum(case when type = 'vacation' then hours else 0 end) as vacation_used,
    sum(case when type = 'sick'     then hours else 0 end) as sick_used,
    sum(case when type = 'holiday'  then hours else 0 end) as holiday_used
  from public.pto_requests
  where status = 'approved'
  group by user_id, extract(year from starts_on)::integer
)
select
  b.id,
  b.user_id,
  u.full_name as user_full_name,
  b.year,
  b.vacation_alloted,
  coalesce(used.vacation_used, 0) as vacation_used,
  b.vacation_alloted + b.vacation_carryover - coalesce(used.vacation_used, 0) as vacation_remaining,
  b.sick_alloted,
  coalesce(used.sick_used, 0) as sick_used,
  b.sick_alloted + b.sick_carryover - coalesce(used.sick_used, 0) as sick_remaining,
  b.holiday_alloted,
  coalesce(used.holiday_used, 0) as holiday_used,
  b.holiday_alloted - coalesce(used.holiday_used, 0) as holiday_remaining,
  b.notes,
  b.updated_at,
  b.vacation_carryover,
  b.sick_carryover
from public.pto_balances b
left join public.users u on u.id = b.user_id
left join used on used.user_id = b.user_id and used.year = b.year;

alter view public.v_pto_summary set (security_invoker = true);

create table if not exists public.pto_year_end_closeouts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.users(id) on delete cascade,
  from_year                 integer not null,
  to_year                   integer generated always as (from_year + 1) stored,
  daily_hours               numeric not null,
  -- sick
  sick_remaining            numeric not null,
  sick_carry_cap            numeric not null,
  sick_carryover_hours      numeric not null,
  sick_payout_hours         numeric not null,
  payout_paid_at            timestamptz,
  payout_paid_by            uuid references public.users(id),
  -- vacation
  vacation_remaining        numeric not null,
  vacation_action           text not null check (vacation_action in ('carry', 'lose', 'custom')),
  vacation_carryover_hours  numeric not null,
  vacation_forfeit_hours    numeric not null,
  -- floating holiday
  holiday_forfeit_hours     numeric not null default 0,
  notes                     text,
  closed_by                 uuid references public.users(id),
  closed_at                 timestamptz not null default now(),
  voided_at                 timestamptz,
  voided_by                 uuid references public.users(id)
);

create unique index if not exists pto_year_end_closeouts_one_active
  on public.pto_year_end_closeouts (user_id, from_year) where voided_at is null;

alter table public.pto_year_end_closeouts enable row level security;

drop policy if exists pto_year_end_closeouts_select on public.pto_year_end_closeouts;
create policy pto_year_end_closeouts_select on public.pto_year_end_closeouts
  for select to authenticated
  using (
    current_user_role() = any (array['admin', 'manager']) or current_user_is_lead()
    or user_id = current_user_id()
  );

drop policy if exists pto_year_end_closeouts_elevated_write on public.pto_year_end_closeouts;
create policy pto_year_end_closeouts_elevated_write on public.pto_year_end_closeouts
  for all to authenticated
  using      (current_user_role() = any (array['admin', 'manager']) or current_user_is_lead())
  with check (current_user_role() = any (array['admin', 'manager']) or current_user_is_lead());

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

  v_cap      := 2 * v_daily;
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

create or replace function public.pto_undo_close_year(p_user_id uuid, p_from_year integer)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not (current_user_role() = any (array['admin', 'manager']) or current_user_is_lead()) then
    raise exception 'Only a manager can undo a PTO close-out';
  end if;
  update public.pto_year_end_closeouts
     set voided_at = now(), voided_by = current_user_id()
   where user_id = p_user_id and from_year = p_from_year and voided_at is null;
  update public.pto_balances
     set vacation_carryover = 0, sick_carryover = 0, updated_at = now()
   where user_id = p_user_id and year = p_from_year + 1;
end;
$$;

grant execute on function public.pto_close_year(uuid, integer, text, numeric, text) to authenticated;
grant execute on function public.pto_undo_close_year(uuid, integer) to authenticated;
