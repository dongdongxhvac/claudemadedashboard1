-- Migration 0002 — Phase 1 lockdown + realtime + storage
-- Enable RLS on all CSV tables (no policies = no anon/authenticated access).
-- The watcher uses the service-role key, which bypasses RLS — so ingest still works.
-- Add snapshots + ingestion_log to realtime publication so the UI can subscribe.
-- Create the csv-archive Storage bucket for raw CSV file archiving.

ALTER TABLE public.snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_rows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_rows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_rows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_log ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.snapshots,
  public.ingestion_log;

INSERT INTO storage.buckets (id, name, public)
VALUES ('csv-archive', 'csv-archive', false)
ON CONFLICT (id) DO NOTHING;
