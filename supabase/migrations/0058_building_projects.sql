-- Migration 0058 — building_projects: per-building project log.
--
-- Lightweight project entries the lead engineer captures alongside the
-- equipment catalog. Three primary fields per the spec — title, detail,
-- rsp — plus the usual id / building_id / timestamps / soft-delete.
--
-- Differs from §10.1 equipment status:
--   equipment status = "this specific asset is broken right now"
--   project          = "this is the higher-level initiative" (HVAC upgrade,
--                       lighting retrofit, leak investigation, etc.)
--
-- RLS mirrors building_equipment: all authenticated SELECT, edit gated to
-- admin / manager / lead via current_user_can_edit_kb().

create table if not exists building_projects (
  id          uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id) on delete cascade,
  title       text not null,
  detail      text,
  rsp         text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id)
);

create index if not exists building_projects_building_idx
  on building_projects(building_id, sort_order)
  where active;

alter table building_projects enable row level security;

create policy "bp_proj_auth_select" on building_projects
  for select to authenticated using (true);

create policy "bp_proj_kb_editor_insert" on building_projects
  for insert to authenticated
  with check (current_user_can_edit_kb());

create policy "bp_proj_kb_editor_update" on building_projects
  for update to authenticated
  using (current_user_can_edit_kb())
  with check (current_user_can_edit_kb());

create policy "bp_proj_kb_editor_delete" on building_projects
  for delete to authenticated
  using (current_user_can_edit_kb());

alter publication supabase_realtime add table building_projects;
