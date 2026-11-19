-- 0166 — PM audit: how each person spent the week (manager, 2026-11-19).
--
-- Where the hours come from. Cove logs labor as entries on a task: hours,
-- the day the work was done, and who did it. Two things make the entries the
-- only honest basis for "how the week was spent":
--   * half of all entries (5,153 of 10,587) are logged by someone other than
--     the task's assignee, so "who closed it" says little about who worked;
--   * Binney's building rounds and UPark's "unscheduled tasks" live on
--     monthly tasks that collect hours all month and close at month end.
-- pm_task_details already stores each task's Cove history, labor entries
-- included; the poller now also pulls open and on-demand tasks that carry
-- labor (watcher/pm12_poller.py), so the entries are there during the month.
--
--   pm_task_details.site_code / cmms_type   which site, recurring | on_demand
--   v_audit_labor_items       one row per labor entry on a PM task, plus one
--                             per closed work order (Cove gives WO hours only
--                             as a total at close, on the assignee)
--   v_tech_week_site_hours    the labor report's weekly total per person and
--                             site, as of that week's last poll
--
-- Both views are security_invoker (the caller's RLS applies) with no anon grant.

begin;

alter table public.pm_task_details
  add column if not exists site_code text,
  add column if not exists cmms_type text;

update public.pm_task_details d
   set site_code = coalesce(d.site_code, c.site_code),
       cmms_type = coalesce(d.cmms_type, c.cmms_type)
  from (select distinct on (task_no) task_no, site_code, cmms_type
          from public.pm_close_events order by task_no, completed_on desc) c
 where c.task_no = d.task_no and (d.site_code is null or d.cmms_type is null);

create view public.v_audit_labor_items with (security_invoker = true) as
with pm as (
  select 'pm'::text as kind,
         coalesce(d.site_code, ce.site_code) as site_code,
         d.task_no,
         d.task_name,
         coalesce(d.cmms_type, ce.cmms_type) as cmms_type,
         d.building_name as building,
         d.assignee_name,
         d.status = 'completed' as task_closed,
         btrim(concat(h.e -> 'laborItem' -> 'performedBy' ->> 'firstName', ' ', h.e -> 'laborItem' -> 'performedBy' ->> 'lastName')) as performer,
         (h.e -> 'laborItem' ->> 'hours')::numeric as hours,
         (h.e -> 'laborItem' ->> 'performedAt')::timestamptz as performed_at
    from public.pm_task_details d
    cross join lateral jsonb_array_elements(d.history) h(e)
    left join lateral (
      select c.site_code, c.cmms_type from public.pm_close_events c
       where c.task_no = d.task_no order by c.completed_on desc limit 1
    ) ce on true
   where jsonb_typeof(d.history) = 'array'
     and h.e ->> 'eventType' = 'labor_item_added'
     and h.e -> 'laborItem' ->> 'performedAt' is not null
     and h.e -> 'laborItem' ->> 'hours' is not null
), wo as (
  select 'wo'::text, w.site_code, w.wo_id, w.description, 'work_order'::text, w.building_code,
         w.assigned_to_name, true, w.assigned_to_name, w.labor_hours, w.completed_on
    from public.wo_close_events w
   where coalesce(w.labor_hours, 0) > 0 and w.completed_on is not null
), items as (
  select * from pm union all select * from wo
)
select i.kind, i.site_code, i.task_no, i.task_name, i.cmms_type, i.building, i.assignee_name, i.task_closed,
       i.performer, i.hours, i.performed_at,
       (i.performed_at at time zone 'America/New_York')::date as day_local,
       date_trunc('week', i.performed_at at time zone 'America/New_York')::date as week_start,
       -- What kind of work the task is, from its name (same list as BUCKETS in web/src/lib/pmAudit.ts).
       case
         when i.kind = 'wo' then 'work_order'
         when i.task_name ~* '\mbms\M' then 'bms'
         when i.task_name ~* 'round' then 'rounds'
         when i.task_name ~* 'escort' then 'escort'
         when i.task_name ~* 'meeting|training|coverage' then 'meeting'
         when i.task_name ~* 'unscheduled' then 'unscheduled'
         when i.cmms_type = 'recurring' then 'pm'
         else 'on_demand'
       end as bucket
  from items i;

create view public.v_tech_week_site_hours with (security_invoker = true) as
select x.site_code, x.assigned_to_name, x.week_start, x.labor_hours as week_hours, x.taken_at as as_of
  from (
    select distinct on (l.assigned_to_name, l.week_start, s.site_code)
           l.assigned_to_name, l.week_start, s.site_code, l.labor_hours, s.taken_at
      from public.labor_rows l
      join public.snapshots s on s.id = l.snapshot_id
     where s.kind = 'labor'
     order by l.assigned_to_name, l.week_start, s.site_code, s.taken_at desc
  ) x;

revoke all on public.v_audit_labor_items, public.v_tech_week_site_hours from public, anon;
grant select on public.v_audit_labor_items, public.v_tech_week_site_hours to authenticated, service_role;

commit;
