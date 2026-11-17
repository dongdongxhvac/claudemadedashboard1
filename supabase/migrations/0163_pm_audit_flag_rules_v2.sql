-- 0163 — PM audit: flag rules v2 (manager's call, 2026-11-17).
--
-- Bad PMs (flagged for review):
--   * desk_close is gone — nobody runs the Cove timer (median start→complete
--     across 1,414 closes was 0.7 min), so the timing says nothing.
--   * no_photos (was low_photos): fires only when a PM that expects photos has
--     NO photo and NO thick note. One photo clears it; the per-type minimum
--     counts (3 for a Major) no longer matter, only "expects photos" (> 0).
--   * steps_unexplained (was steps_incomplete + thin_note): fires only when
--     steps are left unchecked AND the note does not explain it. A thin note
--     alone no longer flags; unchecked steps with a real note no longer flag.
--   * low_labor unchanged; batch_close now uses the same "no photo, no thick
--     note" test.
-- Good PMs (queued for recognition): has a photo or a thick note (>= 100
--   characters) and carries no flag. PM-UNP-23356 is the model: no photos,
--   7 of 8 steps, and a 499-character note saying what was done and why the
--   strainer waits.
--
-- Also fixed while both views are rebuilt:
--   * They ran as their owner, so anyone holding the public (anon) key could
--     read every row — tech names, close notes, per-tech rates — with no
--     login. They are now security_invoker (the caller's RLS applies, as
--     docs/pm-audit.md §2 always said) and anon has no grant.
--   * v_pm_audit_scorecard joined every close to its flags, so a close with 3
--     flags was counted 3 times in closed / reviewed / pass and weighted 3x in
--     the rates. Now one row per close.
--
-- Queue: reason 'good' joins 'flagged' and 'random'; build_pm_audit_queue
-- gains p_good_per_site (default 5: every tech's best one first).

begin;

alter table public.pm_audit_queue drop constraint pm_audit_queue_reason_check;
alter table public.pm_audit_queue add constraint pm_audit_queue_reason_check
  check (reason = any (array['flagged'::text, 'good'::text, 'random'::text]));

drop view public.v_pm_audit_scorecard;
drop view public.v_pm_audit_flags;

create view public.v_pm_audit_flags with (security_invoker = true) as
with base as (
  select ce.task_no, ce.site_code, ce.building_code, ce.equipment, ce.equipment_category, ce.task_name,
         ce.assigned_to_name, ce.completed_on,
         (ce.completed_on at time zone 'America/New_York')::date as completed_date_local,
         date_trunc('week', ce.completed_on at time zone 'America/New_York')::date as week_start,
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
    (select h.week_hours from public.v_tech_week_hours h
      where h.assigned_to_name = b.assigned_to_name and h.week_start = b.week_start) as tech_week_hours
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

create view public.v_pm_audit_scorecard with (security_invoker = true) as
select a.site_code, a.tech, a.week_start, a.closed, a.with_details, a.flagged, a.good,
  round(100.0 * a.photo_ok / nullif(a.photo_need, 0), 0) as photo_rate_pct,
  round(100.0 * a.steps_ok / nullif(a.steps_need, 0), 0) as steps_rate_pct,
  round(100.0 * a.note_ok / nullif(a.with_details, 0), 0) as note_rate_pct,
  a.week_hours, a.reviewed, a.pass, a.coach, a.fail,
  round(100.0 * a.pass / nullif(a.reviewed, 0), 0) as pass_rate_pct,
  case greatest(a.n_no_photos, a.n_steps, a.n_batch, a.n_labor)
    when 0 then null
    when a.n_no_photos then 'no_photos'
    when a.n_steps then 'steps_unexplained'
    when a.n_batch then 'batch_close'
    else 'low_labor'
  end as top_flag
from (
  select f.site_code, f.assigned_to_name as tech, f.week_start,
    count(*) as closed,
    count(*) filter (where f.has_details) as with_details,
    count(*) filter (where f.flag_count > 0) as flagged,
    count(*) filter (where f.good) as good,
    count(*) filter (where f.has_details and f.min_photos > 0) as photo_need,
    count(*) filter (where f.has_details and f.min_photos > 0 and f.has_photo) as photo_ok,
    count(*) filter (where f.has_details and coalesce(f.steps_total, 0) > 0) as steps_need,
    count(*) filter (where f.has_details and coalesce(f.steps_total, 0) > 0 and not f.steps_open) as steps_ok,
    count(*) filter (where f.has_details and not f.note_thin) as note_ok,
    max(f.tech_week_hours) as week_hours,
    count(r.id) as reviewed,
    count(r.id) filter (where r.verdict = 'pass') as pass,
    count(r.id) filter (where r.verdict = 'coach') as coach,
    count(r.id) filter (where r.verdict = 'fail') as fail,
    count(*) filter (where f.f_no_photos) as n_no_photos,
    count(*) filter (where f.f_steps_unexplained) as n_steps,
    count(*) filter (where f.f_batch_close) as n_batch,
    count(*) filter (where f.f_low_labor) as n_labor
  from public.v_pm_audit_flags f
  left join public.pm_audit_reviews r on r.task_no = f.task_no and r.week_start = f.week_start
  group by f.site_code, f.assigned_to_name, f.week_start
) a;

revoke all on public.v_pm_audit_flags, public.v_pm_audit_scorecard from public, anon;
grant select on public.v_pm_audit_flags, public.v_pm_audit_scorecard to authenticated, service_role;

drop function public.build_pm_audit_queue(date, integer, integer, integer);

create function public.build_pm_audit_queue(
  p_week_start date,
  p_random_per_site integer default 5,
  p_flagged_per_tech integer default 2,
  p_flagged_per_site integer default 20,
  p_good_per_site integer default 5
) returns table(site_code text, flagged integer, good integer, random integer)
language plpgsql security definer set search_path = public
as $fn$
begin
  -- Flagged: each tech's worst p_flagged_per_tech, then at most p_flagged_per_site
  -- per site, every tech's worst one first. Already-queued rows rank first, so a
  -- re-run never grows past the cap.
  insert into public.pm_audit_queue (week_start, task_no, site_code, reason, flags)
  select p_week_start, s.task_no, s.site_code, 'flagged', s.flags
  from (
    select t.*, row_number() over (partition by t.site_code
             order by t.queued desc, t.tech_rn, t.flag_count desc, t.major desc, t.est desc nulls last, t.tie) as site_rn
    from (
      select f.task_no, f.site_code, f.flags, f.flag_count,
             (f.pm_type = 'Major') as major, f.est_labor_hours as est,
             md5(f.task_no || p_week_start::text) as tie,
             (q.task_no is not null) as queued,
             row_number() over (partition by f.site_code, f.assigned_to_name
               order by (q.task_no is not null) desc, f.flag_count desc, (f.pm_type = 'Major') desc,
                        f.est_labor_hours desc nulls last, md5(f.task_no || p_week_start::text)) as tech_rn
      from public.v_pm_audit_flags f
      left join public.pm_audit_queue q
        on q.week_start = p_week_start and q.task_no = f.task_no and q.reason = 'flagged'
      where f.week_start = p_week_start and f.flag_count > 0
    ) t
    where t.tech_rn <= p_flagged_per_tech
  ) s
  where s.site_rn <= p_flagged_per_site
  on conflict (week_start, task_no) do update set flags = excluded.flags;

  -- Good: at most p_good_per_site per site, every tech's best one first.
  -- Best = photo and thick note together, then the longest note, then most photos.
  insert into public.pm_audit_queue (week_start, task_no, site_code, reason, flags)
  select p_week_start, s.task_no, s.site_code, 'good', '{}'
  from (
    select t.*, row_number() over (partition by t.site_code
             order by t.queued desc, t.tech_rn, t.both desc, t.note_chars desc, t.photos desc, t.tie) as site_rn
    from (
      select f.task_no, f.site_code,
             (f.has_photo and f.note_thick) as both, f.note_chars, coalesce(f.photo_count, 0) as photos,
             md5(f.task_no || p_week_start::text) as tie,
             (q.task_no is not null) as queued,
             row_number() over (partition by f.site_code, f.assigned_to_name
               order by (q.task_no is not null) desc, (f.has_photo and f.note_thick) desc, f.note_chars desc,
                        coalesce(f.photo_count, 0) desc, md5(f.task_no || p_week_start::text)) as tech_rn
      from public.v_pm_audit_flags f
      left join public.pm_audit_queue q
        on q.week_start = p_week_start and q.task_no = f.task_no and q.reason = 'good'
      where f.week_start = p_week_start and f.good
    ) t
  ) s
  where s.site_rn <= p_good_per_site
  on conflict do nothing;

  -- Random: top each site up to p_random_per_site from the unflagged closes not queued yet.
  insert into public.pm_audit_queue (week_start, task_no, site_code, reason, flags)
  select p_week_start, x.task_no, x.site_code, 'random', '{}'
  from (
    select f.task_no, f.site_code,
           row_number() over (partition by f.site_code order by md5(f.task_no || p_week_start::text)) as rn,
           (select count(*) from public.pm_audit_queue q
             where q.week_start = p_week_start and q.site_code = f.site_code and q.reason = 'random') as have
    from public.v_pm_audit_flags f
    where f.week_start = p_week_start and f.flag_count = 0
      and not exists (select 1 from public.pm_audit_queue q where q.week_start = p_week_start and q.task_no = f.task_no)
  ) x
  where x.rn <= p_random_per_site - x.have
  on conflict do nothing;

  return query
    select q.site_code,
           count(*) filter (where q.reason = 'flagged')::int,
           count(*) filter (where q.reason = 'good')::int,
           count(*) filter (where q.reason = 'random')::int
    from public.pm_audit_queue q where q.week_start = p_week_start
    group by q.site_code;
end $fn$;

commit;
