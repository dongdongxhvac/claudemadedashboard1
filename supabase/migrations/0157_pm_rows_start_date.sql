-- Migration 0157 — PM start date on the Assign PMs panel.
--
-- pm12_poller discovers Cove's start-date field on GQLPMTask each run
-- (introspection, else a probe of candidate names) and writes it here;
-- the Binney site view exposes it. Null until the poller finds the field.

begin;

alter table pm_rows add column if not exists start_date date;
comment on column pm_rows.start_date is
  'Cove PM start date (field name discovered by pm12_poller.detect_start_field). Null if Cove has none.';

-- Same view again with start_date appended (create or replace allows
-- appending). current_pm_snapshot (UPark) lists its columns, untouched.
create or replace view site_pm_snapshot
with (security_invoker = true)
as
with latest as (
  select distinct on (site_code) id, site_code, taken_at, filename
  from snapshots
  where kind = 'pm12'
  order by site_code, taken_at desc
)
select
  l.site_code,
  l.taken_at  as snapshot_taken_at,
  l.filename  as snapshot_filename,
  r.id, r.snapshot_id, r.task_no, r.due_date, r.site, r.building_code,
  r.equipment, r.name, r."interval", r.status, r.assigned_to_name,
  r.open_date, r.category, r.est_labor_hours, r.suite, r.labor_hours,
  r.equipment_category, r.updated_at_cmms, r.object_id, r.pm_type,
  r.cmms_type, r.created_at,
  r.cove_task_id,
  r.start_date
from latest l
join pm_rows r on r.snapshot_id = l.id;

commit;
