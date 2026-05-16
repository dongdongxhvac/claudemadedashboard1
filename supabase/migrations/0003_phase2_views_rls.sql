-- Migration 0003 — Phase 2: views for the Manager UI + RLS policies for authenticated reads
-- Adds:
--   * current_pm_snapshot / current_labor_snapshot / current_wo_snapshot — "latest snapshot per kind" rows
--   * RLS policies allowing any authenticated user to SELECT from snapshot data
--     (Phase 3 will refine per-role: engineer scoped to own data, client scoped to own buildings, etc.)

-- =============================================================================
-- Views: latest snapshot per kind, joined onto the row tables
-- =============================================================================

create or replace view current_pm_snapshot as
with latest as (
  select id, taken_at, filename
  from snapshots
  where kind = 'pm12'
  order by taken_at desc
  limit 1
)
select
  l.taken_at as snapshot_taken_at,
  l.filename as snapshot_filename,
  r.*
from latest l
join pm_rows r on r.snapshot_id = l.id;

create or replace view current_labor_snapshot as
with latest as (
  select id, taken_at, filename
  from snapshots
  where kind = 'labor'
  order by taken_at desc
  limit 1
)
select
  l.taken_at as snapshot_taken_at,
  l.filename as snapshot_filename,
  r.*
from latest l
join labor_rows r on r.snapshot_id = l.id;

create or replace view current_wo_snapshot as
with latest as (
  select id, taken_at, filename
  from snapshots
  where kind = 'wo'
  order by taken_at desc
  limit 1
)
select
  l.taken_at as snapshot_taken_at,
  l.filename as snapshot_filename,
  r.*
from latest l
join wo_rows r on r.snapshot_id = l.id;

-- Run views as the invoker, not the view owner — so RLS on the base tables
-- is enforced for the calling user. (Default in PG15+ is invoker, but being explicit.)
alter view current_pm_snapshot    set (security_invoker = true);
alter view current_labor_snapshot set (security_invoker = true);
alter view current_wo_snapshot    set (security_invoker = true);

-- =============================================================================
-- RLS policies — Phase 2: any authenticated user can SELECT
-- Phase 3 will tighten these per role (engineer / manager / client / admin).
-- =============================================================================

create policy "phase2_auth_select" on snapshots
  for select to authenticated using (true);

create policy "phase2_auth_select" on pm_rows
  for select to authenticated using (true);

create policy "phase2_auth_select" on labor_rows
  for select to authenticated using (true);

create policy "phase2_auth_select" on wo_rows
  for select to authenticated using (true);

create policy "phase2_auth_select" on ingestion_log
  for select to authenticated using (true);
