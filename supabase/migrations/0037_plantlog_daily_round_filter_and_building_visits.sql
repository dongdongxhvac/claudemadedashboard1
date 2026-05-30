-- §06 Daily round efficiency: refine "daily round only" definition + add a
-- per-engineer-per-day-per-building visits view to power a new drill-down
-- breakdown of "how long an engineer spent at each building."
--
-- Two changes:
--
-- 1. Extend v_plantlog_user_daily_span's exclusion set.
--    Previously only water tests/treatment. Now also drops weekly & monthly
--    rounds (caught via activity_name OR log_name), so the daily-round span
--    truly reflects daily-round effort.
--
-- 2. New v_plantlog_user_building_daily_visits view.
--    Computes contiguous visits per (engineer, day, building) using a 30-min
--    gap threshold: same building + < 30 min gap = same visit; otherwise
--    starts a new visit. Reports total visit time, visit count, entry count,
--    and first/last entry times per (engineer, day, building).
--    Same exclusion filter as the span view so totals reconcile.

-- ---- 1. Tighten daily-round filter on existing span view ----------------
CREATE OR REPLACE VIEW public.v_plantlog_user_daily_span AS
  SELECT
    user_name,
    (performed_at_utc AT TIME ZONE 'America/New_York')::date AS et_day,
    MIN(performed_at_utc) AS first_entry_utc,
    MAX(performed_at_utc) AS last_entry_utc,
    COUNT(*) AS entries,
    EXTRACT(EPOCH FROM (MAX(performed_at_utc) - MIN(performed_at_utc)))::int AS span_seconds
  FROM public.plantlog_log_records
  WHERE COALESCE(activity_name, '') NOT ILIKE '%water test%'
    AND COALESCE(activity_name, '') NOT ILIKE '%water treatment%'
    AND COALESCE(activity_name, '') NOT ILIKE '%weekly%'
    AND COALESCE(activity_name, '') NOT ILIKE '%monthly%'
    AND COALESCE(log_name,      '') NOT ILIKE '%weekly%'
    AND COALESCE(log_name,      '') NOT ILIKE '%monthly%'
  GROUP BY user_name, (performed_at_utc AT TIME ZONE 'America/New_York')::date;

-- ---- 2. New per-building-visit view -------------------------------------
CREATE OR REPLACE VIEW public.v_plantlog_user_building_daily_visits AS
WITH eligible AS (
  SELECT
    user_name,
    building_inferred AS building,
    (performed_at_utc AT TIME ZONE 'America/New_York')::date AS et_day,
    performed_at_utc
  FROM public.plantlog_log_records
  WHERE building_inferred IS NOT NULL
    AND COALESCE(activity_name, '') NOT ILIKE '%water test%'
    AND COALESCE(activity_name, '') NOT ILIKE '%water treatment%'
    AND COALESCE(activity_name, '') NOT ILIKE '%weekly%'
    AND COALESCE(activity_name, '') NOT ILIKE '%monthly%'
    AND COALESCE(log_name,      '') NOT ILIKE '%weekly%'
    AND COALESCE(log_name,      '') NOT ILIKE '%monthly%'
),
flagged AS (
  -- Mark a "new visit" boundary whenever:
  --   * building changes from the prev row for the same engineer, OR
  --   * day changes, OR
  --   * gap from prev entry > 30 minutes (1800 s)
  SELECT
    user_name, building, et_day, performed_at_utc,
    CASE
      WHEN LAG(building)          OVER w IS NULL                    THEN 1
      WHEN LAG(building)          OVER w <> building                THEN 1
      WHEN LAG(et_day)            OVER w <> et_day                  THEN 1
      WHEN EXTRACT(EPOCH FROM (performed_at_utc
            - LAG(performed_at_utc) OVER w)) > 1800                 THEN 1
      ELSE 0
    END AS is_visit_start
  FROM eligible
  WINDOW w AS (PARTITION BY user_name ORDER BY performed_at_utc)
),
visit_id AS (
  -- Running sum of visit-starts yields a stable visit_id per row.
  SELECT
    *,
    SUM(is_visit_start) OVER (PARTITION BY user_name ORDER BY performed_at_utc) AS visit_id
  FROM flagged
),
visit_spans AS (
  -- One row per (user, building, day, visit) with that visit's span.
  SELECT
    user_name, et_day, building, visit_id,
    MIN(performed_at_utc) AS visit_start_utc,
    MAX(performed_at_utc) AS visit_end_utc,
    COUNT(*) AS visit_entries,
    EXTRACT(EPOCH FROM (MAX(performed_at_utc) - MIN(performed_at_utc)))::int AS visit_seconds
  FROM visit_id
  GROUP BY user_name, et_day, building, visit_id
)
-- Roll visits up to per (user, day, building).
SELECT
  user_name,
  et_day,
  building,
  COUNT(*)::int AS visits,
  SUM(visit_entries)::int AS entries,
  MIN(visit_start_utc) AS first_entry_utc,
  MAX(visit_end_utc)   AS last_entry_utc,
  SUM(visit_seconds)::int AS total_visit_seconds
FROM visit_spans
GROUP BY user_name, et_day, building;
