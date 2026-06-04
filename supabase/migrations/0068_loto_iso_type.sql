-- Migration 0068 — Distinguish LOTO vs ISO on equipment_issues.
--
-- Per user direction 2026-06-04: every isolation event is EITHER lockout-
-- tagout OR mechanical isolation, not both. Up until now the UI lumped
-- them under "LOTO / ISO" — engineers had no way to record which it was.
--
-- New `loto_type` column:
--   'loto' — Lockout / Tagout (electrical, padlock + tag on disconnect)
--   'iso'  — Mechanical isolation (valve closed, line drained, etc.)
--
-- Required whenever loto_applied_at is set. Existing rows default to
-- 'loto' (the more common case at UPark and our safest assumption).
--
-- View rebuilds expose loto_type so §10.1 / TV stripe can show the
-- specific label.

-- Drop dependent views before structural changes.
drop view if exists v_building_equipment_status;
drop view if exists v_buildings_kb_search;

alter table equipment_issues
  add column if not exists loto_type text;

-- Backfill: anything currently LOTO-applied → 'loto' (safe default).
update equipment_issues
   set loto_type = 'loto'
 where loto_applied_at is not null
   and loto_type is null;

-- CHECK: loto_type must be loto or iso (or null when nothing applied).
alter table equipment_issues
  drop constraint if exists equipment_issues_loto_type_valid;
alter table equipment_issues
  add constraint equipment_issues_loto_type_valid
  check (loto_type is null or loto_type in ('loto', 'iso'));

-- CHECK: if loto_applied_at is set, loto_type MUST be set.
alter table equipment_issues
  drop constraint if exists equipment_issues_loto_type_required;
alter table equipment_issues
  add constraint equipment_issues_loto_type_required
  check (
    loto_applied_at is null
    or loto_type is not null
  );

-- Rebuild v_building_equipment_status with loto_type exposed.
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

-- Rebuild v_buildings_kb_search — past-fix branch labels the specific
-- type ("LOTO" vs "ISO") in the resolution body.
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
      case when i.loto_applied_at is not null
        then upper(coalesce(i.loto_type, 'loto')) || ' ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') ||
             coalesce(' by ' || ua.full_name, '') ||
             coalesce(' → off ' || to_char(i.loto_removed_at, 'YYYY-MM-DD'), '')
        else null end,
      'Resolution: ' || i.resolution) as body
  from public.equipment_issues i
  join public.building_equipment eq on eq.id = i.equipment_id
  join public.buildings b on b.id = eq.building_id
  left join public.users ua on ua.id = i.loto_applied_by
  where i.closed_at is not null and length(coalesce(i.resolution, '')) > 0 and b.active;

alter view public.v_buildings_kb_search set (security_invoker = true);
