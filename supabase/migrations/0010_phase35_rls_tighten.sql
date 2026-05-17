-- Migration 0010 — Phase 3.5: lock down read scope per role.
--
-- Until now, any authenticated user could read every pm_rows / labor_rows /
-- wo_rows / ingestion_log row. The frontend was filtering to "mine" client-side,
-- which is fine for UX but lets a curious engineer pull data on colleagues via
-- the API. Now the database itself does the scoping.
--
-- Rules per table:
--   pm_rows / labor_rows / wo_rows:
--     admin/manager  → all rows
--     engineer       → rows where assigned_to_name = own cmms_assignee_name
--     client         → none (Phase 6 will add building scope)
--   ingestion_log:
--     admin/manager only
--   snapshots:
--     unchanged — metadata is non-sensitive and required for current_*_snapshot
--     view joins to work under security_invoker.
--   current_*_snapshot views:
--     unchanged — they're security_invoker so they honor the base RLS above.

-- ---- helper: current engineer's CMMS name ---------------------------------
create or replace function current_user_cmms_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ep.cmms_assignee_name
  from engineer_profiles ep
  join users u on u.id = ep.user_id
  where u.auth_user_id = auth.uid() and u.active
  limit 1
$$;

-- ---- pm_rows --------------------------------------------------------------
drop policy if exists "phase2_auth_select" on pm_rows;
create policy "phase3_role_select" on pm_rows
  for select to authenticated
  using (
    current_user_role() in ('admin','manager')
    or (current_user_role() = 'engineer' and assigned_to_name = current_user_cmms_name())
  );

-- ---- labor_rows -----------------------------------------------------------
drop policy if exists "phase2_auth_select" on labor_rows;
create policy "phase3_role_select" on labor_rows
  for select to authenticated
  using (
    current_user_role() in ('admin','manager')
    or (current_user_role() = 'engineer' and assigned_to_name = current_user_cmms_name())
  );

-- ---- wo_rows --------------------------------------------------------------
drop policy if exists "phase2_auth_select" on wo_rows;
create policy "phase3_role_select" on wo_rows
  for select to authenticated
  using (
    current_user_role() in ('admin','manager')
    or (current_user_role() = 'engineer' and assigned_to_name = current_user_cmms_name())
  );

-- ---- ingestion_log: admin/manager only ------------------------------------
drop policy if exists "phase2_auth_select" on ingestion_log;
create policy "phase3_role_select" on ingestion_log
  for select to authenticated
  using (current_user_role() in ('admin','manager'));

-- snapshots stays open for authenticated reads (metadata only). The PM/labor/WO
-- joins through current_*_snapshot views inherit scoping from the row tables.
