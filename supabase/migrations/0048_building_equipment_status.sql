-- Migration 0048 — Equipment status workflow + name split + new categories.
--
-- Schema changes to building_equipment:
--   * name             → full_name      (rename; existing values move over)
--   * short_name        new free-text column for compact panel labels
--   * category          enum replaced with HVAC-specific values (chiller_plant,
--                       boiler_plant, compressed_air, vacuum_air, rodi,
--                       plumbing, control, electrical). Old generic values
--                       (mechanical / other) mapped to NULL so the manager
--                       can re-categorize; plumbing / control / electrical
--                       carry over verbatim.
--   * status            new enum (operational / standby_auto / defaulted /
--                       off_pm / down_cm) — defaults to operational
--   * status_detail     free-text explanation, shown when down/off
--   * status_date       date the engineer marks the status (e.g. day it went down)
--   * wo_number         WO/ticket reference, free text
--   * rsp               responsible party, free text
--   * last_status_change_at  auto-stamped on every status update via trigger
--
-- New view v_building_equipment_status feeds the manager §10.1 panel and the
-- /tv BMS alarms equipment-down stripe.

-- ----------------------------------------------------------------------------
-- 1) Rename name → full_name, add short_name
-- ----------------------------------------------------------------------------
alter table public.building_equipment
  rename column name to full_name;

alter table public.building_equipment
  add column if not exists short_name text;

-- ----------------------------------------------------------------------------
-- 2) Replace category enum
-- ----------------------------------------------------------------------------
-- Drop the old check constraint, migrate generic values to NULL, then enforce
-- the new HVAC-specific check.

alter table public.building_equipment
  drop constraint if exists building_equipment_category_check;

update public.building_equipment
   set category = null
 where category in ('mechanical','other');

alter table public.building_equipment
  add constraint building_equipment_category_check
  check (category is null or category in (
    'chiller_plant',
    'boiler_plant',
    'compressed_air',   -- "cAIR"
    'vacuum_air',       -- "vAir"
    'rodi',
    'plumbing',
    'control',
    'electrical'
  ));

-- ----------------------------------------------------------------------------
-- 3) Status workflow columns
-- ----------------------------------------------------------------------------
alter table public.building_equipment
  add column if not exists status                 text not null default 'operational',
  add column if not exists status_detail          text,
  add column if not exists status_date            date,
  add column if not exists wo_number              text,
  add column if not exists rsp                    text,
  add column if not exists last_status_change_at  timestamptz not null default now();

alter table public.building_equipment
  drop constraint if exists building_equipment_status_check;
alter table public.building_equipment
  add constraint building_equipment_status_check
  check (status in ('operational','standby_auto','defaulted','off_pm','down_cm'));

-- Auto-stamp last_status_change_at whenever status actually changes. The DB
-- is the source of truth so the React side can't accidentally forget to
-- bump it on save.
create or replace function public.touch_building_equipment_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.last_status_change_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_touch_building_equipment_status on public.building_equipment;
create trigger trg_touch_building_equipment_status
  before update on public.building_equipment
  for each row execute function public.touch_building_equipment_status();

-- ----------------------------------------------------------------------------
-- 4) v_building_equipment_status — feeds §10.1 + /tv stripe
-- ----------------------------------------------------------------------------
-- One row per equipment that's currently "concerning" (off_pm / down_cm),
-- joined with the parent building's short_code + name so the panels can
-- render directly without a second query.

create or replace view public.v_building_equipment_status as
select
  eq.id,
  eq.building_id,
  b.short_code   as building_short_code,
  b.name         as building_name,
  eq.full_name,
  eq.short_name,
  eq.category,
  eq.status,
  eq.status_detail,
  eq.status_date,
  eq.wo_number,
  eq.rsp,
  eq.last_status_change_at
from public.building_equipment eq
join public.buildings b on b.id = eq.building_id
where eq.active and b.active
  and eq.status in ('off_pm','down_cm');

alter view public.v_building_equipment_status set (security_invoker = true);
