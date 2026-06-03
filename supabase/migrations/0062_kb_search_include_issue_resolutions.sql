-- Migration 0062 — Add closed equipment_issues to the cross-building KB
-- search view.
--
-- After 0061 closed issues carry a `resolution` text — that's the most
-- searchable institutional knowledge the system collects. The next
-- engineer hitting the same MAU-boiler freeze-stat fault should be able
-- to type "freeze stat" into the /buildings KB search bar and find the
-- old resolution ("swapped FzS, wrong PN, ordered from CWS") immediately.
--
-- We surface CLOSED issues only — open ones are already visible on §10.1
-- + the building detail page, so showing them in search would be noise.
-- Title is the issue detail (the original problem); body bundles the
-- status label, WO #, and the resolution text.

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

  -- 3. Section notes
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

  -- 4. Closed equipment issues with resolutions (the new searchable layer)
  select
    b.id, b.short_code, b.name,
    'issue' as kind,
    i.id    as entity_id,
    -- Title: "AHU2 — SF2/Fan3 VFD burn out" (equipment + original detail)
    concat_ws(' — ',
      coalesce(eq.short_name, eq.full_name),
      i.detail) as title,
    -- Body: status label + WO# + RSP + the resolution itself
    concat_ws(' · ',
      'closed ' || to_char(i.closed_at, 'YYYY-MM-DD'),
      upper(replace(i.status, '_', '-')),
      nullif('WO ' || coalesce(i.wo_number, ''), 'WO '),
      nullif('RSP ' || coalesce(i.rsp, ''), 'RSP '),
      'Resolution: ' || i.resolution) as body
  from public.equipment_issues i
  join public.building_equipment eq on eq.id = i.equipment_id
  join public.buildings b on b.id = eq.building_id
  where i.closed_at is not null
    and length(coalesce(i.resolution, '')) > 0
    and b.active;

alter view public.v_buildings_kb_search set (security_invoker = true);
