-- Migration 0049 — Fix v_buildings_kb_search after the name→full_name rename.
--
-- Migration 0048 renamed building_equipment.name to full_name, but the
-- v_buildings_kb_search view (introduced in 0045) was still selecting
-- eq.name as title. Any query against that view, including the existing
-- Equipment tab's `.order('name')` clause, surfaced
-- "column building_equipment.name does not exist".
--
-- Same body otherwise — just swaps eq.name for eq.full_name.

create or replace view public.v_buildings_kb_search as
  select
    b.id          as building_id,
    b.short_code  as building_short_code,
    b.name        as building_name,
    'equipment'   as kind,
    eq.id         as entity_id,
    eq.full_name  as title,
    concat_ws(' · ',
      eq.category,
      eq.location_note,
      eq.parts_notes,
      eq.common_issues,
      eq.troubleshooting) as body
  from public.building_equipment eq
  join public.buildings b on b.id = eq.building_id
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
  from public.building_parts p
  join public.buildings b on b.id = p.building_id
  where p.active and b.active

  union all

  select
    b.id, b.short_code, b.name,
    'section' as kind,
    null::uuid as entity_id,
    bsn.section_key as title,
    bsn.body as body
  from public.building_section_notes bsn
  join public.buildings b on b.id = bsn.building_id
  where b.active and length(coalesce(bsn.body, '')) > 0;

alter view public.v_buildings_kb_search set (security_invoker = true);
