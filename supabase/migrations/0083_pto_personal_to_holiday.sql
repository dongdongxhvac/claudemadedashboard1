-- Migration 0083 — rename the third PTO allotment slot Personal → Holiday.
--
-- 'personal' was retired from the offering (zero requests use it); the
-- enum already carries 'holiday'. Repoint the third balance slot to
-- Holiday: rename the column and recompute its "used" from type='holiday'
-- approved requests. Drop+recreate the view because create-or-replace
-- can't rename an existing view column.

drop view if exists public.v_pto_summary;

alter table public.pto_balances rename column personal_alloted to holiday_alloted;

create view public.v_pto_summary as
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
  b.vacation_alloted - coalesce(used.vacation_used, 0) as vacation_remaining,
  b.sick_alloted,
  coalesce(used.sick_used, 0) as sick_used,
  b.sick_alloted - coalesce(used.sick_used, 0) as sick_remaining,
  b.holiday_alloted,
  coalesce(used.holiday_used, 0) as holiday_used,
  b.holiday_alloted - coalesce(used.holiday_used, 0) as holiday_remaining,
  b.notes,
  b.updated_at
from public.pto_balances b
left join public.users u on u.id = b.user_id
left join used on used.user_id = b.user_id and used.year = b.year;

alter view public.v_pto_summary set (security_invoker = true);
