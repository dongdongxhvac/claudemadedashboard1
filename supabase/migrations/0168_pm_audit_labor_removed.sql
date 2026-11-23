-- 0168 — PM audit: a labor entry removed in Cove is no longer counted (2026-11-23).
--
-- v_audit_labor_items counted every `labor_item_added` event in a task's
-- history and ignored `labor_item_removed`, so an entry typed by mistake and
-- deleted (138 so far — one task had nine added in 30 ms and eight removed)
-- still showed as hours, and as a double entry on the Week tab. A removal
-- event carries the entry's person, hours and performed-at but no id, so it
-- cancels one added entry with the same three on the same task.
--
-- `labor_item_updated` (190 events) also carries no id and cannot be tied to
-- the entry it changed; those entries still count at the hours first typed.
--
-- Same columns as before; security_invoker; no anon grant.

begin;

create or replace view public.v_audit_labor_items with (security_invoker = true) as
with ev as (
  -- every labor entry ever added to a PM task, and every one later removed
  select d.task_no, d.task_name, d.site_code as d_site, d.cmms_type as d_type,
         d.building_name, d.assignee_name, d.status,
         h.e ->> 'eventType' = 'labor_item_removed' as is_removed,
         coalesce(h.e -> 'laborItem' -> 'performedBy' ->> 'id', '') as performer_id,
         btrim(concat(h.e -> 'laborItem' -> 'performedBy' ->> 'firstName', ' ', h.e -> 'laborItem' -> 'performedBy' ->> 'lastName')) as performer,
         (h.e -> 'laborItem' ->> 'hours')::numeric as hours,
         (h.e -> 'laborItem' ->> 'performedAt')::timestamptz as performed_at,
         h.ord
    from public.pm_task_details d
    cross join lateral jsonb_array_elements(d.history) with ordinality h(e, ord)
   where jsonb_typeof(d.history) = 'array'
     and h.e ->> 'eventType' in ('labor_item_added', 'labor_item_removed')
     and h.e -> 'laborItem' ->> 'performedAt' is not null
     and h.e -> 'laborItem' ->> 'hours' is not null
), netted as (
  -- a removal names the entry only by person, hours and time, so it cancels
  -- one added entry with the same three on the same task
  select ev.*,
         row_number() over (partition by ev.task_no, ev.performer_id, ev.performer, ev.hours, ev.performed_at, ev.is_removed order by ev.ord) as rn,
         count(*) filter (where ev.is_removed) over (partition by ev.task_no, ev.performer_id, ev.performer, ev.hours, ev.performed_at) as removed
    from ev
), pm as (
  select 'pm'::text as kind,
         coalesce(n.d_site, ce.site_code) as site_code,
         n.task_no,
         n.task_name,
         coalesce(n.d_type, ce.cmms_type) as cmms_type,
         n.building_name as building,
         n.assignee_name,
         n.status = 'completed' as task_closed,
         n.performer,
         n.hours,
         n.performed_at
    from netted n
    left join lateral (
      select c.site_code, c.cmms_type from public.pm_close_events c
       where c.task_no = n.task_no order by c.completed_on desc limit 1
    ) ce on true
   where not n.is_removed and n.rn > n.removed
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
       public.audit_week_key(i.site_code, i.performed_at) as week_start,
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

commit;
