-- Migration 0020 — Labor snapshot history per week.
--
-- The original current_labor_snapshot (migration 0003) returned rows from
-- only the most-recent labor snapshot. That worked when labor CSVs covered
-- the current week, but it discards prior weeks' settled totals the moment a
-- new snapshot lands — breaking week-over-week comparisons in §00.
--
-- Replacement: for each (week_start, assigned_to_name) keep the rows from the
-- most recent snapshot that reported that pair. Older weeks stay visible
-- forever; within a week, the latest snapshot wins.

create or replace view current_labor_snapshot as
with ranked as (
  select
    s.id        as src_snapshot_id,
    s.taken_at,
    s.filename,
    r.id,
    r.snapshot_id,
    r.assigned_to_name,
    r.labor_hours,
    r.week_start,
    r.created_at,
    row_number() over (
      partition by r.week_start, r.assigned_to_name
      order by s.taken_at desc
    ) as rn
  from snapshots s
  join labor_rows r on r.snapshot_id = s.id
  where s.kind = 'labor'
)
select
  taken_at        as snapshot_taken_at,
  filename        as snapshot_filename,
  id,
  snapshot_id,
  assigned_to_name,
  labor_hours,
  week_start,
  created_at
from ranked
where rn = 1;

alter view current_labor_snapshot set (security_invoker = true);
