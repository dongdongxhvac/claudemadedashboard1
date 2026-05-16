-- Migration 0001 — CSV ingest tables (Phase 1, Tables A)
-- Storage of every PM12 / Labor / WO snapshot dropped into CSV DB/

CREATE TABLE snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('pm12','labor','wo')),
  taken_at     timestamptz NOT NULL,
  filename     text NOT NULL,
  source_path  text,
  row_count    int DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX snapshots_kind_filename_uk ON snapshots(kind, filename);
CREATE INDEX snapshots_taken_at_idx ON snapshots(taken_at DESC);

CREATE TABLE pm_rows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id         uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  task_no             text,
  due_date            date,
  site                text,
  building_code       text,
  equipment           text,
  name                text,
  interval            text,
  status              text,
  assigned_to_name    text,
  open_date           date,
  category            text,
  est_labor_hours     numeric,
  suite               text,
  labor_hours         numeric,
  equipment_category  text,
  updated_at_cmms     timestamptz,
  object_id           text,
  pm_type             text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_rows_snapshot_idx     ON pm_rows(snapshot_id);
CREATE INDEX pm_rows_snapshot_due_idx ON pm_rows(snapshot_id, due_date);
CREATE INDEX pm_rows_assignee_idx     ON pm_rows(assigned_to_name);
CREATE INDEX pm_rows_building_idx     ON pm_rows(building_code);
CREATE INDEX pm_rows_status_idx       ON pm_rows(status);
CREATE INDEX pm_rows_object_idx       ON pm_rows(object_id);

CREATE TABLE labor_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id       uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  assigned_to_name  text,
  labor_hours       numeric,
  week_start        date,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX labor_rows_snapshot_idx ON labor_rows(snapshot_id);
CREATE INDEX labor_rows_assignee_idx ON labor_rows(assigned_to_name);
CREATE INDEX labor_rows_week_idx     ON labor_rows(week_start);

CREATE TABLE wo_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id       uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  wo_id             text,
  status            text,
  assigned_to_name  text,
  submitted_by      text,
  category          text,
  building_code     text,
  description       text,
  floor             text,
  issue_type        text,
  submitted_date    timestamptz,
  required_due_date date,
  last_note         text,
  tenant            text,
  created_for       text,
  suite             text,
  groups            text,
  ticket_type       text,
  updated_at_cmms   timestamptz,
  completion_date   timestamptz,
  billable_total    numeric,
  object_id         text,
  is_open           boolean,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_rows_snapshot_idx ON wo_rows(snapshot_id);
CREATE INDEX wo_rows_assignee_idx ON wo_rows(assigned_to_name);
CREATE INDEX wo_rows_building_idx ON wo_rows(building_code);
CREATE INDEX wo_rows_status_idx   ON wo_rows(status);
CREATE INDEX wo_rows_open_idx     ON wo_rows(is_open) WHERE is_open;

CREATE TABLE ingestion_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     text NOT NULL,
  kind         text,
  status       text NOT NULL CHECK (status IN ('ok','error','skipped')),
  rows         int,
  error_msg    text,
  snapshot_id  uuid REFERENCES snapshots(id) ON DELETE SET NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_log_at_idx ON ingestion_log(at DESC);
