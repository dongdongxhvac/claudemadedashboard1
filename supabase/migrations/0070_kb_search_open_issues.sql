-- Migration 0070 — Add OPEN equipment_issues to KB search.
--
-- User direction 2026-06-04: searching for "CWS", "Albireo", "Hemal" etc.
-- should surface ALL the work currently on that party, not just the
-- closed history. Up until this point the v_buildings_kb_search view
-- only had a past-fix branch for closed issues with resolution text —
-- open work was invisible to the cross-building search bar.
--
-- This migration adds a 5th UNION branch (`kind = 'open_issue'`) that
-- exposes title + body for every OPEN issue. Body bundles status, WO #,
-- RSP, opened-on date, and LOTO context so an RSP search hits regardless
-- of whether the value is in the WO chain, RSP field, or LOTO applier.
--
-- Identical column shape as the existing 'issue' (past-fix) branch so
-- the React side only has to recognize one new kind.

create or replace view public.v_buildings_kb_search as
  -- 1. Equipment cards
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

  -- 2. Parts catalog
  select b.id, b.short_code, b.name,
    'part' as kind,
    p.id   as entity_id,
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

  -- 3. Section notes (Overview / Mechanical / Control / ...)
  select b.id, b.short_code, b.name,
    'section'      as kind,
    null::uuid     as entity_id,
    bsn.section_key as title,
    bsn.body       as body
  from public.building_section_notes bsn
  join public.buildings b on b.id = bsn.building_id
  where b.active and length(coalesce(bsn.body, '')) > 0

  union all

  -- 4. Closed equipment_issues — past-fix history
  select b.id, b.short_code, b.name,
    'issue' as kind,
    i.id    as entity_id,
    concat_ws(' — ',
      coalesce(eq.short_name, eq.full_name),
      i.detail) as title,
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
  where i.closed_at is not null and length(coalesce(i.resolution, '')) > 0 and b.active

  union all

  -- 5. OPEN equipment_issues — active work. Searching "CWS" / "Hemal" /
  -- "Albireo" now finds the RSP column AND any LOTO-applied-by match,
  -- not just closed history.
  select b.id, b.short_code, b.name,
    'open_issue' as kind,
    i.id         as entity_id,
    concat_ws(' — ',
      coalesce(eq.short_name, eq.full_name),
      i.detail) as title,
    concat_ws(' · ',
      'opened ' || to_char(i.created_at, 'YYYY-MM-DD'),
      upper(replace(i.status, '_', '-')),
      nullif('WO ' || coalesce(i.wo_number, ''), 'WO '),
      nullif('RSP ' || coalesce(i.rsp, ''), 'RSP '),
      case
        when i.loto_type = 'rloto'  then 'rLOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') || coalesce(' by ' || ua.full_name, '')
        when i.loto_type = 'gloto'  then 'gLOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') || coalesce(' by ' || ua.full_name, '')
        when i.loto_type = 'isoto'  then 'ISOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') || coalesce(' by ' || ua.full_name, '')
        else null
      end) as body
  from public.equipment_issues i
  join public.building_equipment eq on eq.id = i.equipment_id
  join public.buildings b on b.id = eq.building_id
  left join public.users ua on ua.id = i.loto_applied_by
  where i.closed_at is null and eq.active and b.active;

alter view public.v_buildings_kb_search set (security_invoker = true);
