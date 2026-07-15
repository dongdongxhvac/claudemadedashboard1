-- 0101 — Per-engineer PTO auto-fill daily hours.
--
-- Drives the "Hours (auto: N)" default in the engineer self-serve PTO form
-- (web/src/components/MyPtoSection.tsx). The value is days-in-range x this rate.
--
-- NULL = fall back to the site default in the app layer:
--   Binney St (4x10 schedule) -> 10h/day
--   UPark                     ->  8h/day
-- New hires inherit the site default automatically. Only explicit exceptions
-- get a concrete value here.
--
-- Justin McCarthy (Binney) works 8h days, so he is set explicitly to 8.

alter table public.engineer_profiles
  add column if not exists pto_daily_hours numeric;

comment on column public.engineer_profiles.pto_daily_hours is
  'Per-engineer PTO auto-fill daily hours. NULL = site default (Binney 10, UPark 8).';

update public.engineer_profiles ep
set pto_daily_hours = 8
from public.users u
where u.id = ep.user_id
  and u.full_name = 'Justin McCarthy';
