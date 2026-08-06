-- 0115_shifts_crew.sql
-- Repo-tracks a change applied live on 2026-07-15 (chat session
-- "add_shift_crew"). Weekend-crew attribute on shifts: Sun-Wed shifts are
-- the 'sunday' crew, Wed-Sat shifts the 'saturday' crew, Mon-Fri stays
-- NULL. Drives the two-sided Saturday/Sunday split in the Binney PTO and
-- profile views. Idempotent — safe to run where already applied.

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS crew text;

UPDATE public.shifts
SET crew = CASE
  WHEN name LIKE 'Sun-Wed%' THEN 'sunday'
  WHEN name LIKE 'Wed-Sat%' THEN 'saturday'
  ELSE NULL
END
WHERE crew IS DISTINCT FROM CASE
  WHEN name LIKE 'Sun-Wed%' THEN 'sunday'
  WHEN name LIKE 'Wed-Sat%' THEN 'saturday'
  ELSE NULL
END;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_crew_chk;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_crew_chk
  CHECK (crew IS NULL OR crew IN ('saturday','sunday'));
