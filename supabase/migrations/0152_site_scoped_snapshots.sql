-- Migration 0152 — site-scoped Cove snapshots (Binney St Workload + Labor).
--
-- Until now snapshots / pm_rows / wo_rows / labor_rows / pm_close_events /
-- wo_close_events were implicitly UPark-only: the pollers pulled one Cove
-- network (OoxMP8BZJF) and the current_* views picked "the latest snapshot
-- per kind". Running the same pollers against the Binney network
-- (moBABfC2ZR) would have made the two sites take turns being "latest".
--
-- This migration:
--   1. adds site_code (default 'upark') to snapshots, pm_close_events and
--      wo_close_events — every existing row is UPark, nothing to backfill;
--   2. adds site-aware base views (site_pm_snapshot, site_wo_snapshot,
--      site_labor_snapshot, site_labor_daily) that carry a site_code column
--      and compute "latest per site";
--   3. redefines current_pm_snapshot / current_wo_snapshot /
--      current_labor_snapshot / labor_daily as the UPark slice of those, with
--      IDENTICAL column lists, so every existing UPark consumer (TV, §02,
--      v_wo_stale, engineer pages) is unchanged;
--   4. adds v_site_active_engineers for the pollers' roster read (the UPark
--      view stays as-is).
--
-- pm_close_events already had a `site` column — that is Cove's site NAME
-- ("University Park"), free text. site_code is the app's sites.code.

begin;

------------------------------------------------------------------
-- 1. site_code columns
------------------------------------------------------------------
alter table snapshots       add column if not exists site_code text not null default 'upark';
alter table pm_close_events add column if not exists site_code text not null default 'upark';
alter table wo_close_events add column if not exists site_code text not null default 'upark';

create index if not exists snapshots_site_kind_taken_idx on snapshots (site_code, kind, taken_at desc);
create index if not exists pm_close_events_site_completed_idx on pm_close_events (site_code, completed_on desc);
create index if not exists wo_close_events_site_completed_idx on wo_close_events (site_code, completed_on desc);

comment on column snapshots.site_code is
  'sites.code the poller ran for (upark | binney). Latest-snapshot views partition by this.';

------------------------------------------------------------------
-- 2. site-aware base views
------------------------------------------------------------------
create or replace view site_pm_snapshot
with (security_invoker = true)
as
with latest as (
  select distinct on (site_code) id, site_code, taken_at, filename
  from snapshots
  where kind = 'pm12'
  order by site_code, taken_at desc
)
select
  l.site_code,
  l.taken_at  as snapshot_taken_at,
  l.filename  as snapshot_filename,
  r.id, r.snapshot_id, r.task_no, r.due_date, r.site, r.building_code,
  r.equipment, r.name, r."interval", r.status, r.assigned_to_name,
  r.open_date, r.category, r.est_labor_hours, r.suite, r.labor_hours,
  r.equipment_category, r.updated_at_cmms, r.object_id, r.pm_type,
  r.cmms_type, r.created_at
from latest l
join pm_rows r on r.snapshot_id = l.id;

create or replace view site_wo_snapshot
with (security_invoker = true)
as
with latest as (
  select distinct on (site_code) id, site_code, taken_at, filename
  from snapshots
  where kind = 'wo'
  order by site_code, taken_at desc
)
select
  l.site_code,
  l.taken_at  as snapshot_taken_at,
  l.filename  as snapshot_filename,
  r.id, r.snapshot_id, r.wo_id, r.status, r.assigned_to_name, r.submitted_by,
  r.category, r.building_code, r.description, r.floor, r.issue_type,
  r.submitted_date, r.required_due_date, r.last_note, r.tenant, r.created_for,
  r.suite, r.groups, r.ticket_type, r.updated_at_cmms, r.completion_date,
  r.billable_total, r.object_id, r.is_open, r.created_at
from latest l
join wo_rows r on r.snapshot_id = l.id;

create or replace view site_labor_snapshot
with (security_invoker = true)
as
with ranked as (
  select
    s.site_code, s.taken_at, s.filename,
    r.id, r.snapshot_id, r.assigned_to_name, r.labor_hours, r.week_start, r.created_at,
    row_number() over (
      partition by s.site_code, r.week_start, r.assigned_to_name
      order by s.taken_at desc
    ) as rn
  from snapshots s
  join labor_rows r on r.snapshot_id = s.id
  where s.kind = 'labor'
)
select
  site_code,
  taken_at  as snapshot_taken_at,
  filename  as snapshot_filename,
  id, snapshot_id, assigned_to_name, labor_hours, week_start, created_at
from ranked
where rn = 1;

create or replace view site_labor_daily
with (security_invoker = true)
as
with daily_eod as (
  select distinct on (s.site_code, lr.assigned_to_name, (s.taken_at at time zone 'America/New_York')::date)
    s.site_code,
    lr.assigned_to_name as tech,
    (s.taken_at at time zone 'America/New_York')::date as day_et,
    lr.week_start,
    lr.labor_hours as wtd_hours
  from labor_rows lr
  join snapshots s on s.id = lr.snapshot_id
  where s.kind = 'labor'
  order by s.site_code, lr.assigned_to_name, (s.taken_at at time zone 'America/New_York')::date, s.taken_at desc
)
select
  site_code,
  tech as assigned_to_name,
  day_et,
  week_start,
  greatest(
    (wtd_hours - coalesce(lag(wtd_hours) over (partition by site_code, tech, week_start order by day_et), 0))::numeric(10,2),
    0::numeric(10,2)
  ) as hours_that_day
from daily_eod;

grant select on site_pm_snapshot, site_wo_snapshot, site_labor_snapshot, site_labor_daily
  to authenticated, service_role;

------------------------------------------------------------------
-- 3. UPark views = the 'upark' slice, same columns as before
------------------------------------------------------------------
create or replace view current_pm_snapshot as
select
  snapshot_taken_at, snapshot_filename, id, snapshot_id, task_no, due_date, site,
  building_code, equipment, name, "interval", status, assigned_to_name, open_date,
  category, est_labor_hours, suite, labor_hours, equipment_category, updated_at_cmms,
  object_id, pm_type, created_at
from site_pm_snapshot
where site_code = 'upark';
alter view current_pm_snapshot set (security_invoker = true);

create or replace view current_wo_snapshot as
select
  snapshot_taken_at, snapshot_filename, id, snapshot_id, wo_id, status, assigned_to_name,
  submitted_by, category, building_code, description, floor, issue_type, submitted_date,
  required_due_date, last_note, tenant, created_for, suite, groups, ticket_type,
  updated_at_cmms, completion_date, billable_total, object_id, is_open, created_at
from site_wo_snapshot
where site_code = 'upark';
alter view current_wo_snapshot set (security_invoker = true);

create or replace view current_labor_snapshot as
select
  snapshot_taken_at, snapshot_filename, id, snapshot_id, assigned_to_name,
  labor_hours, week_start, created_at
from site_labor_snapshot
where site_code = 'upark';
alter view current_labor_snapshot set (security_invoker = true);

create or replace view labor_daily as
select assigned_to_name, day_et, week_start, hours_that_day
from site_labor_daily
where site_code = 'upark';
alter view labor_daily set (security_invoker = true);

-- pm_variance_recent: expose site_code (appended column) so the hook can
-- filter; existing consumers select named columns and are unaffected.
create or replace view pm_variance_recent as
select
  task_no, task_name, assigned_to_name, site, building_code, pm_type,
  est_labor_hours, labor_hours,
  labor_hours - est_labor_hours as variance_hours,
  case when est_labor_hours is null or est_labor_hours = 0 then null
       else ((labor_hours - est_labor_hours) / est_labor_hours * 100)::numeric(6,1)
  end as variance_pct,
  completed_on,
  site_code
from pm_close_events
where labor_hours is not null and est_labor_hours is not null and est_labor_hours > 0;
alter view pm_variance_recent set (security_invoker = true);

------------------------------------------------------------------
-- 4. roster view for the pollers, any site
------------------------------------------------------------------
create or replace view v_site_active_engineers
with (security_invoker = true)
as
select
  coalesce(s.code, 'upark') as site_code,
  u.id            as user_id,
  u.full_name,
  u.role,
  ep.cmms_assignee_name,
  ep.cove_user_id,
  ep.home_site_id
from users u
join engineer_profiles ep on ep.user_id = u.id
left join sites s on s.id = ep.home_site_id
where u.role in ('engineer', 'manager')
  and u.active;

grant select on v_site_active_engineers to authenticated, service_role;

commit;
