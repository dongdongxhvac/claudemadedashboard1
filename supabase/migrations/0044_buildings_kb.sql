-- Migration 0044 — Building Knowledge Base (Phase 14)
--
-- Captures per-building institutional knowledge:
--   * Free-form rich text per category (mechanical / control / electrical /
--     plumbing / inventory / access / troubleshooting / overview)
--   * Structured equipment list with name, category, location, parts,
--     common issues, and troubleshooting steps
--
-- The goal is a phone-accessible record so an engineer in the field can
-- pull up "what to check first when HWP-3 acts up at 26 Landsdowne" instead
-- of calling the lead. Edit-gated to admin OR is_lead; read open to all
-- authenticated users.

-- ----------------------------------------------------------------------------
-- 1) Helper: current_user_can_edit_kb()
-- ----------------------------------------------------------------------------
-- Predicate used by RLS write policies. Mirrors the React-side
-- useCanAccessAdmin() (role='admin' OR is_lead=true) so client and server
-- gates agree. Stable + SECURITY DEFINER so it can be reused inside RLS
-- without exploding into N subqueries per row.

create or replace function current_user_can_edit_kb()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(u.role = 'admin' or ep.is_lead = true, false)
  from users u
  left join engineer_profiles ep on ep.user_id = u.id
  where u.auth_user_id = auth.uid() and u.active
  limit 1;
$$;

grant execute on function current_user_can_edit_kb() to authenticated;

-- ----------------------------------------------------------------------------
-- 2) building_section_notes — free-form rich text per category
-- ----------------------------------------------------------------------------
create table if not exists building_section_notes (
  building_id  uuid not null references buildings(id) on delete cascade,
  section_key  text not null check (section_key in
    ('overview','mechanical','control','electrical','plumbing',
     'inventory','access','troubleshooting')),
  body         text not null default '',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  primary key (building_id, section_key)
);

alter table building_section_notes enable row level security;

create policy "bsn_auth_select" on building_section_notes
  for select to authenticated using (true);

create policy "bsn_kb_editor_insert" on building_section_notes
  for insert to authenticated
  with check (current_user_can_edit_kb());

create policy "bsn_kb_editor_update" on building_section_notes
  for update to authenticated
  using (current_user_can_edit_kb())
  with check (current_user_can_edit_kb());

create policy "bsn_kb_editor_delete" on building_section_notes
  for delete to authenticated
  using (current_user_can_edit_kb());

alter publication supabase_realtime add table building_section_notes;

-- ----------------------------------------------------------------------------
-- 3) building_equipment — structured equipment list
-- ----------------------------------------------------------------------------
create table if not exists building_equipment (
  id              uuid primary key default gen_random_uuid(),
  building_id     uuid not null references buildings(id) on delete cascade,
  name            text not null,
  category        text check (category in
    ('mechanical','control','electrical','plumbing','other')),
  location_note   text,
  parts_notes     text,
  common_issues   text,
  troubleshooting text,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id)
);

create index if not exists building_equipment_building_idx
  on building_equipment(building_id, sort_order)
  where active;

alter table building_equipment enable row level security;

create policy "be_auth_select" on building_equipment
  for select to authenticated using (true);

create policy "be_kb_editor_insert" on building_equipment
  for insert to authenticated
  with check (current_user_can_edit_kb());

create policy "be_kb_editor_update" on building_equipment
  for update to authenticated
  using (current_user_can_edit_kb())
  with check (current_user_can_edit_kb());

create policy "be_kb_editor_delete" on building_equipment
  for delete to authenticated
  using (current_user_can_edit_kb());

alter publication supabase_realtime add table building_equipment;
