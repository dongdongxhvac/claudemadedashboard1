-- Migration 0004 — Add `cmms_type` column to pm_rows for the new "Type" CSV column
-- (the one with values like "On-Demand" / "Scheduled" / etc. that the user just
-- added to their CMMS export bookmark). Nullable so past CSVs without the
-- column still ingest cleanly.

alter table pm_rows add column if not exists cmms_type text;
create index if not exists pm_rows_cmms_type_idx on pm_rows(cmms_type) where cmms_type is not null;
