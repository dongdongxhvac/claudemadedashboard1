-- Migration 0060 — Multi-issue support for building equipment.
--
-- Before: building_equipment had a single status + status_detail / status_date
-- / wo_number / rsp. Real-world equipment (MAU-boiler, AHUs, chillers) often
-- has 2-3 simultaneous problems being worked at once — boiler down for
-- electrical AND a separate freeze stat issue, AHU running degraded AND in
-- bypass on a VFD. The single-row model forced engineers to mash both into
-- one detail field with no per-issue WO# / RSP.
--
-- After:
--   building_equipment.status        is constrained to OK states only
--                                    (operational / standby_auto / defaulted).
--   equipment_issues                 is a new child table holding the four
--                                    "attention" states (off_pm / down_cm /
--                                    degraded / bypass), each with their own
--                                    detail / date / wo / rsp / closed_at.
--   v_building_equipment_status      now returns ONE ROW PER OPEN ISSUE,
--                                    joined with equipment + building.
--                                    §10.1 + the /tv equipment stripe show
--                                    issues directly — equipment with two
--                                    open issues now appears twice.
--
-- Backfill: every equipment row whose status is in the attention set is
-- migrated to a single equipment_issues row carrying its current detail /
-- date / wo / rsp, then the equipment row's status is reset to 'operational'
-- and the now-redundant status_* columns are dropped.

-- ----------------------------------------------------------------------------
-- 1) equipment_issues table
-- ----------------------------------------------------------------------------
create table if not exists equipment_issues (
  id              uuid primary key default gen_random_uuid(),
  equipment_id    uuid not null references building_equipment(id) on delete cascade,
  status          text not null check (status in ('off_pm','down_cm','degraded','bypass')),
  detail          text,
  status_date     date,
  wo_number       text,
  rsp             text,
  sort_order      int not null default 0,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id)
);

create index if not exists equipment_issues_open_idx
  on equipment_issues(equipment_id)
  where closed_at is null;

alter table equipment_issues enable row level security;

create policy "ei_auth_select" on equipment_issues
  for select to authenticated using (true);

create policy "ei_kb_editor_insert" on equipment_issues
  for insert to authenticated
  with check (current_user_can_edit_kb());

create policy "ei_kb_editor_update" on equipment_issues
  for update to authenticated
  using (current_user_can_edit_kb())
  with check (current_user_can_edit_kb());

create policy "ei_kb_editor_delete" on equipment_issues
  for delete to authenticated
  using (current_user_can_edit_kb());

alter publication supabase_realtime add table equipment_issues;

-- ----------------------------------------------------------------------------
-- 2) Backfill from existing inline status columns
-- ----------------------------------------------------------------------------
-- Any equipment currently flagged as off_pm / down_cm / degraded / bypass
-- gets one issue row carrying its inline detail/date/wo/rsp.
insert into equipment_issues
  (equipment_id, status, detail, status_date, wo_number, rsp, created_at, updated_at)
select
  id,
  status,
  status_detail,
  status_date,
  wo_number,
  rsp,
  coalesce(last_status_change_at, updated_at, now()),
  coalesce(updated_at, now())
from building_equipment
where status in ('off_pm','down_cm','degraded','bypass')
  and active;

-- Flip the parent rows back to operational so the new CHECK passes.
update building_equipment
   set status = 'operational'
 where status in ('off_pm','down_cm','degraded','bypass');

-- ----------------------------------------------------------------------------
-- 3) Tighten building_equipment.status to OK states only
-- ----------------------------------------------------------------------------
alter table building_equipment
  drop constraint if exists building_equipment_status_check;
alter table building_equipment
  add constraint building_equipment_status_check
  check (status in ('operational','standby_auto','defaulted'));

-- Drop the dependent view BEFORE dropping its source columns. Recreated below.
drop view if exists v_building_equipment_status;

-- Drop now-redundant inline status detail columns. Effective status comes
-- from open equipment_issues (worst-of) computed in the view.
alter table building_equipment
  drop column if exists status_detail,
  drop column if exists status_date,
  drop column if exists wo_number,
  drop column if exists rsp;

-- ----------------------------------------------------------------------------
-- 4) v_building_equipment_status — issue-keyed
-- ----------------------------------------------------------------------------
-- One row per OPEN issue, joined to equipment + building. Same column names
-- as the old view where possible so the React side change is minimal; `id`
-- is now issue.id and a new `equipment_id` exposes the parent.

create view v_building_equipment_status as
select
  i.id,
  i.equipment_id,
  eq.building_id,
  b.short_code                            as building_short_code,
  b.name                                  as building_name,
  eq.full_name,
  eq.short_name,
  eq.category,
  i.status,
  i.detail                                as status_detail,
  i.status_date,
  i.wo_number,
  i.rsp,
  i.created_at                            as last_status_change_at
from equipment_issues i
join building_equipment eq on eq.id = i.equipment_id
join buildings b           on b.id  = eq.building_id
where i.closed_at is null
  and eq.active
  and b.active;

alter view v_building_equipment_status set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 5) Touch trigger for equipment_issues
-- ----------------------------------------------------------------------------
create or replace function public.touch_equipment_issues_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_equipment_issues on equipment_issues;
create trigger trg_touch_equipment_issues
  before update on equipment_issues
  for each row execute function public.touch_equipment_issues_updated_at();
