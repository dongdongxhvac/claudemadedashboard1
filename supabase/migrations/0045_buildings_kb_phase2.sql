-- Migration 0045 — Building KB Phase 2.
--
-- Adds 4 capabilities to /buildings:
--   1. building_parts          — structured per-equipment / per-building parts catalog
--   2. building_vendor_visits  — vendor access/escort log (one per vendor/building/day)
--   3. building_equipment.photo_url + bucket policy — photo attachments
--   4. v_buildings_kb_search   — flat search view for cross-building search
--
-- Edit-gating: parts + vendor-visit writes use current_user_can_edit_kb()
-- (admin OR is_lead), same as 0044. Vendor visits are openable to all
-- authenticated users — engineers escort vendors and need to log directly.

-- ----------------------------------------------------------------------------
-- 1) building_parts — structured parts catalog
-- ----------------------------------------------------------------------------
-- equipment_id is nullable so building-level inventory (e.g. "store of MERV
-- 13 filters") can live in the same table without forcing every part to
-- belong to a specific piece of equipment.
create table if not exists building_parts (
  id              uuid primary key default gen_random_uuid(),
  building_id     uuid not null references buildings(id) on delete cascade,
  equipment_id    uuid references building_equipment(id) on delete set null,
  name            text not null,
  part_type       text check (part_type in
    ('filter','belt','oil','seal','bearing','fuse','sensor','other')),
  spec            text,        -- "20x25x4 MERV 13", "B-67", "SAE 30"
  quantity        int,         -- nullable — sometimes we just know "we have some"
  location_note   text,        -- "shelf B, mech room"
  sort_order      int not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id)
);

create index if not exists building_parts_building_idx
  on building_parts(building_id, sort_order) where active;
create index if not exists building_parts_equipment_idx
  on building_parts(equipment_id) where active;

alter table building_parts enable row level security;

create policy "bp_auth_select" on building_parts
  for select to authenticated using (true);
create policy "bp_kb_editor_insert" on building_parts
  for insert to authenticated with check (current_user_can_edit_kb());
create policy "bp_kb_editor_update" on building_parts
  for update to authenticated
  using (current_user_can_edit_kb()) with check (current_user_can_edit_kb());
create policy "bp_kb_editor_delete" on building_parts
  for delete to authenticated using (current_user_can_edit_kb());

alter publication supabase_realtime add table building_parts;

-- ----------------------------------------------------------------------------
-- 2) building_vendor_visits — vendor escort / PM / CM log
-- ----------------------------------------------------------------------------
-- Unique constraint enforces one entry per vendor per building per day —
-- prevents accidental double-logs of the same visit. Different vendors
-- can both visit the same building on the same day.
create table if not exists building_vendor_visits (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references buildings(id) on delete cascade,
  vendor_name  text not null,
  visit_type   text not null check (visit_type in ('escort','PM','CM')),
  visit_date   date not null,
  note         text,
  logged_by    uuid references users(id),
  created_at   timestamptz not null default now(),
  constraint building_vendor_visits_uniq unique (building_id, vendor_name, visit_date)
);

create index if not exists building_vendor_visits_building_idx
  on building_vendor_visits(building_id, visit_date desc);
create index if not exists building_vendor_visits_vendor_idx
  on building_vendor_visits(vendor_name, visit_date desc);

alter table building_vendor_visits enable row level security;

create policy "bvv_auth_select" on building_vendor_visits
  for select to authenticated using (true);
-- Vendor visits are open INSERT for any authenticated user — engineers
-- escort vendors in the field and need to log directly.
create policy "bvv_auth_insert" on building_vendor_visits
  for insert to authenticated with check (true);
-- UPDATE/DELETE locked to kb editors (admin/lead) — engineers can only
-- log new visits, not retroactively edit history.
create policy "bvv_kb_editor_update" on building_vendor_visits
  for update to authenticated
  using (current_user_can_edit_kb()) with check (current_user_can_edit_kb());
create policy "bvv_kb_editor_delete" on building_vendor_visits
  for delete to authenticated using (current_user_can_edit_kb());

alter publication supabase_realtime add table building_vendor_visits;

-- ----------------------------------------------------------------------------
-- 3) building_equipment.photo_url
-- ----------------------------------------------------------------------------
-- Holds the Supabase Storage public URL of an uploaded equipment photo.
-- Single photo per equipment in V1; multi-photo can move to a child table
-- if/when the use case warrants it.
alter table building_equipment
  add column if not exists photo_url text;

-- ----------------------------------------------------------------------------
-- 4) v_buildings_kb_search — flat search view
-- ----------------------------------------------------------------------------
-- One row per "searchable thing" (building, equipment, part, section note).
-- The /buildings index queries this with ilike for cross-building search:
--   "where do we keep B-67 belts?" → matches building_parts.spec
--   "anything about chiller startup?" → matches building_section_notes.body
-- Keeping this denormalised view simple — no tsvector / GIN yet. The
-- dataset is small (15 buildings × ~50 entities = ~750 rows), so plain
-- ilike scans run in <50ms.
create or replace view v_buildings_kb_search as
  select
    b.id          as building_id,
    b.short_code  as building_short_code,
    b.name        as building_name,
    'equipment'   as kind,
    eq.id         as entity_id,
    eq.name       as title,
    concat_ws(' · ',
      eq.category,
      eq.location_note,
      eq.parts_notes,
      eq.common_issues,
      eq.troubleshooting) as body
  from building_equipment eq
  join buildings b on b.id = eq.building_id
  where eq.active and b.active

  union all

  select
    b.id, b.short_code, b.name,
    'part' as kind,
    p.id  as entity_id,
    p.name as title,
    concat_ws(' · ',
      p.part_type,
      p.spec,
      p.location_note,
      ('qty ' || coalesce(p.quantity::text, '—'))) as body
  from building_parts p
  join buildings b on b.id = p.building_id
  where p.active and b.active

  union all

  select
    b.id, b.short_code, b.name,
    'section' as kind,
    null::uuid as entity_id,
    bsn.section_key as title,
    bsn.body as body
  from building_section_notes bsn
  join buildings b on b.id = bsn.building_id
  where b.active and length(coalesce(bsn.body, '')) > 0;

alter view v_buildings_kb_search set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 5) Storage bucket for photos
-- ----------------------------------------------------------------------------
-- Public bucket (read open to everyone) — internal tool, photos aren't
-- sensitive. Uploads restricted to kb-editors via storage policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'building-kb-photos',
  'building-kb-photos',
  true,
  10485760,   -- 10 MB cap per file
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS — read public, upload/update/delete to kb editors only.
drop policy if exists "kb_photos_public_read"     on storage.objects;
drop policy if exists "kb_photos_editor_insert"   on storage.objects;
drop policy if exists "kb_photos_editor_update"   on storage.objects;
drop policy if exists "kb_photos_editor_delete"   on storage.objects;

create policy "kb_photos_public_read" on storage.objects
  for select using (bucket_id = 'building-kb-photos');

create policy "kb_photos_editor_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'building-kb-photos' and current_user_can_edit_kb());

create policy "kb_photos_editor_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'building-kb-photos' and current_user_can_edit_kb())
  with check (bucket_id = 'building-kb-photos' and current_user_can_edit_kb());

create policy "kb_photos_editor_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'building-kb-photos' and current_user_can_edit_kb());
