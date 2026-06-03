-- Migration 0065 — Extend KB search past-fix body to include LOTO context.
--
-- After 0064 we record who applied/removed the LOTO. Including that in
-- search results lets future engineers find "did the same fix involve a
-- lockout?" and "who applied the lock on the last AHU2 freeze stat fix?"
-- alongside the resolution text.
--
-- Only the past-fix (kind='issue') UNION branch changes; equipment / parts
-- / section branches are identical to 0062.

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
  where b.active and length(coalesce(bsn.body, '')) > 0

  union all

  -- Past-fix branch with WO-creator + LOTO context bundled into body
  select
    b.id, b.short_code, b.name,
    'issue' as kind,
    i.id    as entity_id,
    concat_ws(' — ',
      coalesce(eq.short_name, eq.full_name),
      i.detail) as title,
    concat_ws(' · ',
      'closed ' || to_char(i.closed_at, 'YYYY-MM-DD'),
      upper(replace(i.status, '_', '-')),
      nullif('WO ' || coalesce(i.wo_number, ''), 'WO '),
      nullif('opened by ' || coalesce(i.wo_created_by, ''), 'opened by '),
      nullif('RSP ' || coalesce(i.rsp, ''), 'RSP '),
      case
        when i.loto_applied_at is not null
          then 'LOTO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') ||
               coalesce(' by ' || ua.full_name, '') ||
               coalesce(' → off ' || to_char(i.loto_removed_at, 'YYYY-MM-DD'), '')
        else null
      end,
      'Resolution: ' || i.resolution) as body
  from public.equipment_issues i
  join public.building_equipment eq on eq.id = i.equipment_id
  join public.buildings b on b.id = eq.building_id
  left join public.users ua on ua.id = i.loto_applied_by
  where i.closed_at is not null
    and length(coalesce(i.resolution, '')) > 0
    and b.active;

alter view public.v_buildings_kb_search set (security_invoker = true);
