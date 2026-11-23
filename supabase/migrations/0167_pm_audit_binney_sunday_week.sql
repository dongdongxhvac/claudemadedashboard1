-- 0167 — PM audit: Binney's week runs Sunday to Saturday (manager, 2026-11-23).
--
-- Binney works Sun-Wed and Wed-Sat shifts, so a Monday-Sunday week cuts the
-- Sunday crew's week in two. The manager asked for Binney's Week tab, review
-- queue and scorecard to count Sunday-Saturday; UPark stays Monday-Sunday.
--
-- The week KEY does not change: `week_start` everywhere in the audit is still
-- a Monday, at both sites, so the address, the queue, the reviews and every
-- join keep working. What changes is which days fall under a key:
--
--     UPark   key 2026-11-09  =  Mon Nov 9  ... Sun Nov 15
--     Binney  key 2026-11-09  =  Sun Nov 8  ... Sat Nov 14   (starts the day before)
--
-- audit_week_key(site, instant) is the one place that says so. The flags
-- view (so the scorecard view and build_pm_audit_queue, which read it) and
-- the labor-entry view now ask it instead of date_trunc('week').
--
-- The labor report's weekly total has to follow. The labor poller stores
-- running totals per Monday week (labor_rows), which other panels read, so
-- those stay as they are; for Binney the poller now also asks Cove for the
-- Sunday-Saturday window and upserts it into audit_week_hours (read-only
-- toward Cove). v_tech_week_site_hours and the flags' tech_week_hours take a
-- site's week from audit_week_hours when it is there, else from the polls.
--
-- Not in this file (data, run once after the backfill of audit_week_hours):
--   delete from pm_audit_queue where site_code = 'binney';
--   select build_pm_audit_queue(w) for each queued week.
-- No reviews existed when this was applied.

begin;

-- Not SET search_path / not plpgsql on purpose: a plain SQL function is
-- inlined into the views, so the per-row cost is the same as date_trunc.
create or replace function public.audit_week_key(p_site text, p_at timestamptz)
returns date language sql immutable parallel safe as $fn$
  select case when p_site = 'binney'
    then date_trunc('week', (p_at at time zone 'America/New_York') + interval '1 day')::date
    else date_trunc('week', p_at at time zone 'America/New_York')::date
  end
$fn$;

comment on function public.audit_week_key(text, timestamptz) is
  'PM audit week key (always a Monday) for an instant at a site. UPark: the Monday-Sunday week. Binney: the Sunday-Saturday week that starts the day before the key.';

create table if not exists public.audit_week_hours (
  site_code        text        not null,
  week_start       date        not null,   -- the audit week key (a Monday), see audit_week_key
  assigned_to_name text        not null,
  week_hours       numeric     not null,
  as_of            timestamptz not null default now(),
  primary key (site_code, week_start, assigned_to_name)
);

comment on table public.audit_week_hours is
  'Cove labor report total per person for a site''s audit week, where that week is not Monday-Sunday (Binney: Sunday-Saturday). Upserted by watcher/labor_poller.py.';

alter table public.audit_week_hours enable row level security;

drop policy if exists audit_week_hours_select on public.audit_week_hours;
create policy audit_week_hours_select on public.audit_week_hours
  for select to authenticated
  using (
    public.current_user_role() = any (array['admin', 'manager', 'director', 'tv'])
    or public.current_user_is_lead()
    or (public.current_user_role() = 'engineer' and assigned_to_name = public.current_user_cmms_name())
  );

revoke all on public.audit_week_hours from public, anon, authenticated;
grant select on public.audit_week_hours to authenticated;
grant all on public.audit_week_hours to service_role;

create or replace view public.v_pm_audit_flags with (security_invoker = true) as
with base as (
  select ce.task_no, ce.site_code, ce.building_code, ce.equipment, ce.equipment_category, ce.task_name,
         ce.assigned_to_name, ce.completed_on,
         (ce.completed_on at time zone 'America/New_York')::date as completed_date_local,
         public.audit_week_key(ce.site_code, ce.completed_on) as week_start,
         ce.labor_hours, ce.est_labor_hours,
         public.classify_pm(ce.task_name) as pm_type,
         d.cove_task_id, d.started_at, d.completed_at, d.close_note, d.note_count,
         d.steps_total, d.steps_checked, d.photo_count, d.attachment_count,
         d.first_attachment_at, d.last_attachment_at,
         d.cove_task_id is not null as has_details
  from public.pm_close_events ce
  left join lateral (
    select d1.* from public.pm_task_details d1
    where d1.task_no = ce.task_no
    order by d1.completed_at desc nulls last
    limit 1
  ) d on true
  where ce.cmms_type = 'recurring'
), ruled as (
  select b.*,
    coalesce(
      (select r.min_photos from public.pm_audit_rules r
        where r.active and r.match_kind = 'template' and (r.site_code is null or r.site_code = b.site_code) and b.task_name ~* r.pattern
        order by r.priority limit 1),
      (select r.min_photos from public.pm_audit_rules r
        where r.active and r.match_kind = 'pm_type' and (r.site_code is null or r.site_code = b.site_code) and r.pattern = b.pm_type
        order by r.priority limit 1),
      1) as min_photos,
    coalesce(
      (select r.min_note_chars from public.pm_audit_rules r
        where r.active and r.match_kind = 'template' and (r.site_code is null or r.site_code = b.site_code) and b.task_name ~* r.pattern
        order by r.priority limit 1),
      (select r.min_note_chars from public.pm_audit_rules r
        where r.active and r.match_kind = 'pm_type' and (r.site_code is null or r.site_code = b.site_code) and r.pattern = b.pm_type
        order by r.priority limit 1),
      15) as min_note_chars,
    (select r.note_must_match from public.pm_audit_rules r
      where r.active and r.match_kind = 'template' and (r.site_code is null or r.site_code = b.site_code) and b.task_name ~* r.pattern
        and r.note_must_match is not null
      order by r.priority limit 1) as note_must_match,
    (select count(*) from public.pm_close_events o
      where o.cmms_type = 'recurring' and o.assigned_to_name = b.assigned_to_name and o.task_no <> b.task_no
        and o.completed_on >= b.completed_on - interval '5 minutes'
        and o.completed_on <= b.completed_on + interval '5 minutes') as closes_within_5m,
    -- the person's labor-report total for the same week: from audit_week_hours where
    -- the site's week is stored there (Binney, Sunday-Saturday), else the Monday-week poll
    case when exists (select 1 from public.audit_week_hours a
                       where a.site_code = b.site_code and a.week_start = b.week_start)
      then (select a.week_hours from public.audit_week_hours a
             where a.site_code = b.site_code and a.week_start = b.week_start
               and a.assigned_to_name = b.assigned_to_name)
      else (select h.week_hours from public.v_tech_week_hours h
             where h.assigned_to_name = b.assigned_to_name and h.week_start = b.week_start)
    end as tech_week_hours
  from base b
), noted as (
  select r.*,
    length(btrim(coalesce(r.close_note, ''))) as note_chars,
    lower(btrim(coalesce(r.close_note, ''))) in (select s.phrase from public.pm_audit_note_stoplist s) as note_boilerplate,
    r.note_must_match is not null and coalesce(r.close_note, '') !~ r.note_must_match as note_no_reading
  from ruled r
), ev as (
  select n.*,
    n.has_details and coalesce(n.photo_count, 0) >= 1 as has_photo,
    -- "thick" = 100+ characters across every note on the task (top ~10 % of notes)
    n.has_details and n.note_chars >= 100 as note_thick,
    -- under the PM's own note minimum, boilerplate, or missing the reading it must record
    n.has_details and n.min_note_chars > 0
      and (n.note_chars < n.min_note_chars or n.note_boilerplate or n.note_no_reading) as note_thin,
    n.has_details and coalesce(n.steps_total, 0) > 0 and coalesce(n.steps_checked, 0) < n.steps_total as steps_open
  from noted n
), fl as (
  select e.*,
    e.has_details and e.min_photos > 0 and not e.has_photo and not e.note_thick as f_no_photos,
    -- unchecked steps are fine when the note says why; "says why" needs at least a
    -- short real sentence even on PM types with no note minimum of their own
    e.steps_open and (e.note_chars < greatest(e.min_note_chars, 15) or e.note_boilerplate or e.note_no_reading) as f_steps_unexplained,
    coalesce(e.est_labor_hours, 0) >= 0.5 and e.labor_hours is not null
      and e.labor_hours < 0.25 * e.est_labor_hours and coalesce(e.tech_week_hours, 0) < 30 as f_low_labor,
    coalesce(e.est_labor_hours, 0) >= 0.5 and e.closes_within_5m >= 4
      and e.has_details and e.min_photos > 0 and not e.has_photo and not e.note_thick as f_batch_close
  from ev e
)
select
  task_no, site_code, building_code, equipment, equipment_category, task_name, assigned_to_name,
  completed_on, completed_date_local, week_start, labor_hours, est_labor_hours, pm_type,
  cove_task_id, started_at, completed_at, close_note, note_count,
  steps_total, steps_checked, photo_count, attachment_count, first_attachment_at, last_attachment_at,
  has_details, min_photos, min_note_chars, note_must_match, closes_within_5m, tech_week_hours,
  note_chars, note_boilerplate, has_photo, note_thick, note_thin, steps_open,
  f_no_photos, f_steps_unexplained, f_low_labor, f_batch_close,
  array_remove(array[
    case when f_no_photos then 'no_photos' end,
    case when f_steps_unexplained then 'steps_unexplained' end,
    case when f_low_labor then 'low_labor' end,
    case when f_batch_close then 'batch_close' end], null) as flags,
  f_no_photos::int + f_steps_unexplained::int + f_low_labor::int + f_batch_close::int as flag_count,
  (has_photo or note_thick)
    and not (f_no_photos or f_steps_unexplained or f_low_labor or f_batch_close) as good
from fl;

create or replace view public.v_audit_labor_items with (security_invoker = true) as
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

create or replace view public.v_tech_week_site_hours with (security_invoker = true) as
select x.site_code, x.assigned_to_name, x.week_start, x.labor_hours as week_hours, x.taken_at as as_of
  from (
    select distinct on (l.assigned_to_name, l.week_start, s.site_code)
           l.assigned_to_name, l.week_start, s.site_code, l.labor_hours, s.taken_at
      from public.labor_rows l
      join public.snapshots s on s.id = l.snapshot_id
     where s.kind = 'labor'
     order by l.assigned_to_name, l.week_start, s.site_code, s.taken_at desc
  ) x
 where not exists (select 1 from public.audit_week_hours a
                    where a.site_code = x.site_code and a.week_start = x.week_start)
union all
select a.site_code, a.assigned_to_name, a.week_start, a.week_hours, a.as_of
  from public.audit_week_hours a;

commit;
