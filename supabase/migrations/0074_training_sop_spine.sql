-- Migration 0074 — Training Phase 1: the SOP spine (equipment_tasks + sops) + is_critical.
--
-- First real lock of the training redesign. The atomic unit a tech is scored /
-- signed-off on is an EQUIPMENT TASK (equipment x facet x task). An equipment SOP
-- attaches to a task. `sops` also carries independent site- and building-level
-- rows with NO inheritance (an equipment SOP never falls back to a building one).
-- `is_critical` flags the assets whose problems define coverage (Phase 4 gap
-- report). Additive; reuses the building KB. Writes gated by
-- current_user_can_edit_kb() (admin OR lead) — same gate as building_equipment.

-- ---------------------------------------------------------------------------
-- is_critical on equipment (the one readiness-relevant add)
-- ---------------------------------------------------------------------------
alter table building_equipment
  add column if not exists is_critical boolean not null default false;

-- ---------------------------------------------------------------------------
-- equipment_tasks — the atomic unit (equipment x facet x task)
-- ---------------------------------------------------------------------------
create table if not exists equipment_tasks (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references building_equipment(id) on delete cascade,
  facet         text not null check (facet in ('pm','reset','support','knowledge')),
  name          text not null,
  sort_order    int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users(id),
  unique (equipment_id, facet, name)
);
create index if not exists equipment_tasks_eq_idx
  on equipment_tasks(equipment_id, facet, sort_order) where active;

-- ---------------------------------------------------------------------------
-- sops — three INDEPENDENT levels (site / building / equipment-task), no inherit.
-- Exactly one anchor non-null, and it must match the declared level.
-- ---------------------------------------------------------------------------
create table if not exists sops (
  id                 uuid primary key default gen_random_uuid(),
  level              text not null check (level in ('site','building','equipment')),
  site_id            uuid references sites(id) on delete cascade,
  building_id        uuid references buildings(id) on delete cascade,
  equipment_task_id  uuid references equipment_tasks(id) on delete cascade,
  title              text,
  body               text,
  tools              text,
  safety_loto        text check (safety_loto in ('rloto','gloto','isoto','na')),
  frequency          text,
  version            int  not null default 1,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references users(id),
  constraint sops_one_anchor check (
    (case when site_id           is not null then 1 else 0 end)
  + (case when building_id       is not null then 1 else 0 end)
  + (case when equipment_task_id is not null then 1 else 0 end) = 1
  ),
  constraint sops_level_match check (
    (level = 'site'      and site_id           is not null) or
    (level = 'building'  and building_id       is not null) or
    (level = 'equipment' and equipment_task_id is not null)
  )
);
create index if not exists sops_eqtask_idx   on sops(equipment_task_id) where active;
create index if not exists sops_building_idx on sops(building_id)       where active;
create index if not exists sops_site_idx     on sops(site_id)           where active;

-- ---------------------------------------------------------------------------
-- RLS — read: any authenticated; write: KB editors (admin OR lead).
-- Mirrors the building_projects policy shape (0058).
-- ---------------------------------------------------------------------------
alter table equipment_tasks enable row level security;
alter table sops            enable row level security;

create policy "eqtasks_auth_select" on equipment_tasks
  for select to authenticated using (true);
create policy "eqtasks_kb_insert" on equipment_tasks
  for insert to authenticated with check (current_user_can_edit_kb());
create policy "eqtasks_kb_update" on equipment_tasks
  for update to authenticated using (current_user_can_edit_kb()) with check (current_user_can_edit_kb());
create policy "eqtasks_kb_delete" on equipment_tasks
  for delete to authenticated using (current_user_can_edit_kb());

create policy "sops_auth_select" on sops
  for select to authenticated using (true);
create policy "sops_kb_insert" on sops
  for insert to authenticated with check (current_user_can_edit_kb());
create policy "sops_kb_update" on sops
  for update to authenticated using (current_user_can_edit_kb()) with check (current_user_can_edit_kb());
create policy "sops_kb_delete" on sops
  for delete to authenticated using (current_user_can_edit_kb());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table equipment_tasks;
alter publication supabase_realtime add table sops;
