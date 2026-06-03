-- Migration 0064 — LOTO tracking + WO creator on equipment_issues.
--
-- LOTO (Lockout/Tagout, OSHA 29 CFR 1910.147) is the practice of physically
-- locking equipment in a de-energized state before service. Two safety-
-- critical facts the system should record:
--   * Who applied the lock (must be a trained, authorized employee)
--   * When the lock came off — and that work hasn't been declared
--     "complete" with a lock still attached
--
-- V1 model: single LOTO event per issue. ~80% of work is one engineer +
-- one lock; group LOTO (multiple engineers each with their own personal
-- lock on the same hasp) is rare and can be added as a child table later
-- without rewriting V1 fields.
--
-- wo_created_by: free text — the WO might be opened by an engineer in
-- COVE, OR by a vendor on their side ("CWS opened CM3834 for us"). Free
-- text covers both; not a FK to users.

alter table equipment_issues
  add column if not exists wo_created_by    text,
  add column if not exists loto_applied_at  timestamptz,
  add column if not exists loto_applied_by  uuid references users(id),
  add column if not exists loto_removed_at  timestamptz,
  add column if not exists loto_removed_by  uuid references users(id);

-- Defensive checks:
--   * loto_applied_by must accompany loto_applied_at (and vice versa) —
--     can't have one without the other
--   * loto_removed_at can't exist without loto_applied_at
--   * removed timestamp must be after applied timestamp
alter table equipment_issues
  drop constraint if exists equipment_issues_loto_applied_paired;
alter table equipment_issues
  add constraint equipment_issues_loto_applied_paired
  check (
    (loto_applied_at is null and loto_applied_by is null)
    or (loto_applied_at is not null and loto_applied_by is not null)
  );

alter table equipment_issues
  drop constraint if exists equipment_issues_loto_removed_after_applied;
alter table equipment_issues
  add constraint equipment_issues_loto_removed_after_applied
  check (
    loto_removed_at is null
    or (loto_applied_at is not null and loto_removed_at >= loto_applied_at)
  );

alter table equipment_issues
  drop constraint if exists equipment_issues_loto_removed_paired;
alter table equipment_issues
  add constraint equipment_issues_loto_removed_paired
  check (
    (loto_removed_at is null and loto_removed_by is null)
    or (loto_removed_at is not null and loto_removed_by is not null)
  );

-- Helpful index for the "all issues with LOTO active" query (§10.1 sub-filter).
create index if not exists equipment_issues_loto_active_idx
  on equipment_issues(loto_applied_at)
  where loto_applied_at is not null and loto_removed_at is null;

-- v_building_equipment_status — surface the new LOTO + WO-creator fields,
-- with loto_applied_by joined to users.full_name for compact UI display.
drop view if exists v_building_equipment_status;

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
  i.wo_created_by,
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
