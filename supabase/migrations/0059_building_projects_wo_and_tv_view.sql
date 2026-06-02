-- Migration 0059 — building_projects.wo_number + TV-facing view.
--
-- Two changes:
--
-- 1. New wo_number column. Optional free-text ticket / WO reference so a
--    project can link back to its tracking system entry (CM-1234, PR-5678,
--    JIRA-XYZ, etc.). Matches the wo_number field already on
--    building_equipment so the manager UX is consistent.
--
-- 2. v_building_projects_active — flat list of active projects joined with
--    the parent building's short_code + name. Drives the new TV-side
--    ProjectsTvPanel that mirrors the equipment-attention stripe format.

alter table public.building_projects
  add column if not exists wo_number text;

create or replace view public.v_building_projects_active as
select
  p.id,
  p.building_id,
  b.short_code   as building_short_code,
  b.name         as building_name,
  p.title,
  p.detail,
  p.rsp,
  p.wo_number,
  p.sort_order,
  p.created_at,
  p.updated_at
from public.building_projects p
join public.buildings b on b.id = p.building_id
where p.active and b.active;

alter view public.v_building_projects_active set (security_invoker = true);
