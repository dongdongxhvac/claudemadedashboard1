-- Migration 0061 — Resolution + closed_by on equipment_issues.
--
-- Closing an issue should explain HOW it was fixed, not just WHEN. That
-- string becomes searchable institutional knowledge over time — the next
-- engineer hitting the same MAU-boiler freeze-stat fault should be able
-- to read "swapped the FzS, calibrated, was the wrong part number for the
-- run — order PN xxx from CWS" instead of starting from scratch.
--
-- Resolution is REQUIRED on close (NOT NULL constrained via partial check
-- "if closed_at is set, resolution must be too"). closed_by stamps the
-- user who marked it resolved so the record carries accountability.

alter table equipment_issues
  add column if not exists resolution text,
  add column if not exists closed_by  uuid references users(id);

-- Whenever closed_at is set, resolution must be present. Open rows are
-- exempt. This lets existing data (no resolution on the 3 backfilled
-- rows) stay valid as long as they stay open.
alter table equipment_issues
  drop constraint if exists equipment_issues_resolution_required_on_close;
alter table equipment_issues
  add constraint equipment_issues_resolution_required_on_close
  check (
    closed_at is null
    or (resolution is not null and length(trim(resolution)) > 0)
  );
