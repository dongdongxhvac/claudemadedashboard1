-- Migration 0066 — Simplify equipment_issues per user direction 2026-06-04:
--   * Drop wo_created_by — WO# is just a pointer to COVE; COVE owns the
--     "created by" attribution. Don't duplicate.
--   * LOTO / ISO timestamps become date-only — engineers record "lock
--     applied today by Don" not "today at 3:47:22 PM." Less friction.
--     ("LOTO / ISO" since the same tracking covers electrical lockouts
--     AND mechanical isolations.)
--
-- View v_building_equipment_status + v_buildings_kb_search both rebuild
-- with the new column shape (no wo_created_by, date types on LOTO fields).

-- Drop dependent views first so column changes don't cascade-error.
drop view if exists v_building_equipment_status;
drop view if exists v_buildings_kb_search;

-- Drop wo_created_by — no replacement, just gone.
alter table equipment_issues
  drop column if exists wo_created_by;

-- Drop the CHECK constraints that reference loto_applied_at /
-- loto_removed_at; we'll rebuild them after the column type change.
alter table equipment_issues
  drop constraint if exists equipment_issues_loto_applied_paired,
  drop constraint if exists equipment_issues_loto_removed_paired,
  drop constraint if exists equipment_issues_loto_removed_after_applied;

-- Drop the partial index that references loto_applied_at — index will
-- be recreated against the date column at the end.
drop index if exists equipment_issues_loto_active_idx;

-- Change timestamptz -> date. The cast loses sub-day precision (intended).
alter table equipment_issues
  alter column loto_applied_at  type date using loto_applied_at::date,
  alter column loto_removed_at  type date using loto_removed_at::date;

-- Re-add the CHECKs against the date columns.
alter table equipment_issues
  add constraint equipment_issues_loto_applied_paired
  check (
    (loto_applied_at is null and loto_applied_by is null)
    or (loto_applied_at is not null and loto_applied_by is not null)
  );

alter table equipment_issues
  add constraint equipment_issues_loto_removed_paired
  check (
    (loto_removed_at is null and loto_removed_by is null)
    or (loto_removed_at is not null and loto_removed_by is not null)
  );

alter table equipment_issues
  add constraint equipment_issues_loto_removed_after_applied
  check (
    loto_removed_at is null
    or (loto_applied_at is not null and loto_removed_at >= loto_applied_at)
  );

create index if not exists equipment_issues_loto_active_idx
  on equipment_issues(loto_applied_at)
  where loto_applied_at is not null and loto_removed_at is null;

-- Rebuild v_building_equipment_status (no wo_created_by; date LOTO fields).
create view v_building_equipment_status as
select
  i.id,
  i.equipment_id,
  eq.building_id,
  b.short_code   as building_short_code,
  b.name         as building_name,
  eq.full_name,
  eq.short_name,
  eq.category,
  i.status,
  i.detail       as status_detail,
  i.status_date,
  i.wo_number,
  i.rsp,
  i.loto_applied_at,
  i.loto_applied_by,
  u.full_name    as loto_applied_by_name,
  i.loto_removed_at,
  i.created_at   as last_status_change_at
from equipment_issues i
join building_equipment eq on eq.id = i.equipment_id
join buildings b           on b.id  = eq.building_id
left join users u          on u.id  = i.loto_applied_by
where i.closed_at is null
  and eq.active
  and b.active;

alter view v_building_equipment_status set (security_invoker = true);

-- Rebuild v_buildings_kb_search (past-fix branch drops 'opened by' segment).
create view public.v_buildings_kb_search as
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
      nullif('RSP ' || coalesce(i.rsp, ''), 'RSP '),
      case
        when i.loto_applied_at is not null
          then 'LOTO/ISO ' || to_char(i.loto_applied_at, 'YYYY-MM-DD') ||
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
