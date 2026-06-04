-- Migration 0069 — Expand loto_type to 4 values.
--
-- User direction 2026-06-04: tighten the isolation taxonomy.
--
--   rloto  — Red LOTO   (full energized lockout-tagout, red lock + tag)
--   gloto  — Green LOTO (out-of-service tag, equipment de-energized first)
--   isoto  — Isolation + tagout (mechanical isolation: valve / drain)
--   na     — Not applicable (no isolation required for this issue)
--
-- N/A becomes an explicit value rather than NULL — engineers actively
-- acknowledge "I thought about isolation, none needed" instead of leaving
-- the field empty.
--
-- Data migration:
--   * existing 'loto' → 'rloto' (red is the more common LOTO at UPark)
--   * existing 'iso'  → 'isoto'
--   * existing NULL   → 'na'    (explicit acknowledgment)
--
-- Constraint shape:
--   loto_type must be one of the 4 values (no longer nullable).
--   When loto_type ∈ {rloto, gloto, isoto}, applied_at + applied_by MUST be set.
--   When loto_type = 'na', applied_at + applied_by MUST be NULL.

-- Drop dependent views first (they'll be recreated with the same shape).
drop view if exists v_building_equipment_status;
drop view if exists v_buildings_kb_search;

-- Drop the existing loto_type constraints so the data migration can run.
alter table equipment_issues
  drop constraint if exists equipment_issues_loto_type_valid;
alter table equipment_issues
  drop constraint if exists equipment_issues_loto_type_required;

-- Migrate existing values.
update equipment_issues set loto_type = 'rloto' where loto_type = 'loto';
update equipment_issues set loto_type = 'isoto' where loto_type = 'iso';
update equipment_issues set loto_type = 'na'    where loto_type is null;

-- Make NOT NULL + default 'na' so new rows ALWAYS have a type.
alter table equipment_issues
  alter column loto_type set default 'na';
alter table equipment_issues
  alter column loto_type set not null;

-- Tighten the value check.
alter table equipment_issues
  add constraint equipment_issues_loto_type_valid
  check (loto_type in ('rloto', 'gloto', 'isoto', 'na'));

-- Pairing rules: active types ↔ applied_at + applied_by set; 'na' ↔ both null.
alter table equipment_issues
  add constraint equipment_issues_loto_type_pairing
  check (
    (loto_type = 'na'
      and loto_applied_at is null
      and loto_applied_by is null)
    or
    (loto_type in ('rloto', 'gloto', 'isoto')
      and loto_applied_at is not null
      and loto_applied_by is not null)
  );

-- Recreate v_building_equipment_status with loto_type unchanged in shape.
create view v_building_equipment_status as
select
  i.id, i.equipment_id, eq.building_id,
  b.short_code   as building_short_code,
  b.name         as building_name,
  eq.full_name, eq.short_name, eq.category,
  i.status, i.detail as status_detail, i.status_date,
  i.wo_number, i.rsp,
  i.loto_applied_at, i.loto_applied_by, i.loto_type,
  u.full_name as loto_applied_by_name,
  i.loto_removed_at,
  i.created_at as last_status_change_at
from equipment_issues i
join building_equipment eq on eq.id = i.equipment_id
join buildings b           on b.id  = eq.building_id
left join users u          on u.id  = i.loto_applied_by
where i.closed_at is null and eq.active and b.active;

alter view v_building_equipment_status set (security_invoker = true);

-- Rebuild kb_search past-fix body with the new LOTO type labels.
create view public.v_buildings_kb_search as
  select b.id as building_id, b.short_code as building_short_code, b.name as building_name,
    'equipment' as kind, eq.id as entity_id, eq.full_name as title,
    concat_ws(' · ', eq.category, eq.location_note, eq.parts_notes, eq.common_issues, eq.troubleshooting) as body
  from public.building_equipment eq join public.buildings b on b.id = eq.building_id
  where eq.active and b.active
  union all
  select b.id, b.short_code, b.name, 'part' as kind, p.id as entity_id, p.name as title,
    concat_ws(' · ', p.part_type, p.spec, p.location_note, ('qty ' || coalesce(p.quantity::text, '—'))) as body
  from public.building_parts p join public.buildings b on b.id = p.building_id
  where p.active and b.active
  union all
  select b.id, b.short_code, b.name, 'section' as kind, null::uuid as entity_id,
    bsn.section_key as title, bsn.body as body
  from public.building_section_notes bsn join public.buildings b on b.id = bsn.building_id
  where b.active and length(coalesce(bsn.body, '')) > 0
  union all
  select b.id, b.short_code, b.name, 'issue' as kind, i.id as entity_id,
    concat_ws(' — ', coalesce(eq.short_name, eq.full_name), i.detail) as title,
    concat_ws(' · ',
      'closed ' || to_char(i.closed_at, 'YYYY-MM-DD'),
      upper(replace(i.status, '_', '-')),
      nullif('WO ' || coalesce(i.wo_number, ''), 'WO '),
      nullif('RSP ' || coalesce(i.rsp, ''), 'RSP '),
      case
        when i.loto_type = 'rloto'  then 'rLOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') || coalesce(' by ' || ua.full_name, '') || coalesce(' → off ' || to_char(i.loto_removed_at, 'YYYY-MM-DD'), '')
        when i.loto_type = 'gloto'  then 'gLOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') || coalesce(' by ' || ua.full_name, '') || coalesce(' → off ' || to_char(i.loto_removed_at, 'YYYY-MM-DD'), '')
        when i.loto_type = 'isoto'  then 'ISOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') || coalesce(' by ' || ua.full_name, '') || coalesce(' → off ' || to_char(i.loto_removed_at, 'YYYY-MM-DD'), '')
        else null
      end,
      'Resolution: ' || i.resolution) as body
  from public.equipment_issues i
  join public.building_equipment eq on eq.id = i.equipment_id
  join public.buildings b on b.id = eq.building_id
  left join public.users ua on ua.id = i.loto_applied_by
  where i.closed_at is not null and length(coalesce(i.resolution, '')) > 0 and b.active;

alter view public.v_buildings_kb_search set (security_invoker = true);
