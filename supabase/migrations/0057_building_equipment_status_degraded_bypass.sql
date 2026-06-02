-- Migration 0057 — Add `degraded` and `bypass` to equipment status enum.
--
-- The 0048 status enum was binary-ish: operational/standby_auto = good,
-- defaulted = degraded sensor, off_pm/down_cm = offline. It didn't capture
-- two common real-world states:
--
--   degraded — Equipment is running but a sub-component is failing
--              (e.g. chiller running but Compressor 2 of 4 is offline,
--              AHU running but one VFD is in fault). Needs attention,
--              not a total outage.
--   bypass   — Equipment is running outside automatic control
--              (HOA in Hand, valve in manual override, control loop
--              in manual). Needs attention to return to auto.
--
-- Both behave like off_pm/down_cm in the form: required status_detail
-- + status_date + RSP. Both surface on §10.1 and the /tv equipment-down
-- stripe alongside off_pm/down_cm (the React side decides tone color).

alter table public.building_equipment
  drop constraint if exists building_equipment_status_check;

alter table public.building_equipment
  add constraint building_equipment_status_check
  check (status in (
    'operational',
    'standby_auto',
    'defaulted',
    'degraded',
    'bypass',
    'off_pm',
    'down_cm'
  ));

-- v_building_equipment_status now needs to surface degraded/bypass too
-- alongside off_pm/down_cm — they're all "equipment not happy" states
-- that should appear on §10.1 and the /tv stripe.
create or replace view public.v_building_equipment_status as
select
  eq.id, eq.building_id,
  b.short_code as building_short_code,
  b.name       as building_name,
  eq.full_name, eq.short_name, eq.category,
  eq.status, eq.status_detail, eq.status_date,
  eq.wo_number, eq.rsp,
  eq.last_status_change_at
from public.building_equipment eq
join public.buildings b on b.id = eq.building_id
where eq.active and b.active
  and eq.status in ('off_pm','down_cm','degraded','bypass');

alter view public.v_building_equipment_status set (security_invoker = true);
