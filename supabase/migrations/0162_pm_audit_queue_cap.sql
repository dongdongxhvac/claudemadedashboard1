-- 0162 — PM audit: cap the flagged part of the weekly review queue.
--
-- Applied 2026-11-17 (Supabase migration `pm_audit_queue_cap`). Dry-run first in
-- a rolled-back block against live data: week of 2026-11-09 → UPark 15 flagged + 5 random, Binney 20 + 5
-- (45 rows, all 24 techs covered, at most 2 per tech); a re-run adds nothing.
--
-- Why: once pm_task_details was backfilled, 322 of that week's 338 closes
-- carried at least one flag (280 low photos, 207 thin note, 202 desk close),
-- so "queue every flagged close" would hand the manager 300+ rows a week
-- instead of the ~40 the Monday review is sized for.
--
-- What changes in build_pm_audit_queue:
--   * Flagged rows: each tech's worst p_flagged_per_tech closes (default 2),
--     then at most p_flagged_per_site per site (default 20), taking every
--     tech's worst close before anyone's second. "Worst" = most flags, then
--     Majors, then the longest estimated job; ties broken by a per-week hash.
--   * Rows already queued as flagged rank first, so re-running a week never
--     grows it past the cap.
--   * Random picks top the site up to p_random_per_site instead of adding
--     that many again on every run (the old function added 5 more each time).
--
-- What does not change: the scorecard's rates come from v_pm_audit_flags, so
-- every flagged close still counts against the tech whether it was queued or
-- not. The cron job's two-argument call keeps working (new arguments default).
--
-- The old two-argument function must be dropped first: CREATE OR REPLACE with
-- a longer argument list would add an overload and make that call ambiguous.

begin;

drop function public.build_pm_audit_queue(date, integer);

create function public.build_pm_audit_queue(
  p_week_start date,
  p_random_per_site integer default 5,
  p_flagged_per_tech integer default 2,
  p_flagged_per_site integer default 20
) returns table(site_code text, flagged integer, random integer)
language plpgsql security definer set search_path = public
as $fn$
begin
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
           count(*) filter (where q.reason = 'random')::int
    from public.pm_audit_queue q where q.week_start = p_week_start
    group by q.site_code;
end $fn$;

-- Optional, separate decision: today anyone signed in (and the anon key) can
-- call this SECURITY DEFINER function over the API. Only pg_cron needs it.
-- revoke execute on function public.build_pm_audit_queue(date, integer, integer, integer) from public, anon, authenticated;

commit;
