-- Drop the 30-min gap rule from v_plantlog_user_building_daily_visits.
-- Visits now split only on building change (or day change), never on time
-- gaps. Rationale: a long quiet stretch at one building is still "one visit"
-- to that building, not two; the gap-based split was conflating "long stay"
-- with "left and came back."
--
-- Replaces the version installed by migration 0037.

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
  -- A "new visit" boundary is ONLY when:
  --   * building changes from the prev row for the same engineer, OR
  --   * day changes (same engineer crossing midnight)
  -- Time gaps no longer split visits.
  SELECT
    user_name, building, et_day, performed_at_utc,
    CASE
      WHEN LAG(building) OVER w IS NULL                       THEN 1
      WHEN LAG(building) OVER w <> building                   THEN 1
      WHEN LAG(et_day)   OVER w <> et_day                     THEN 1
      ELSE 0
    END AS is_visit_start
  FROM eligible
  WINDOW w AS (PARTITION BY user_name ORDER BY performed_at_utc)
),
visit_id AS (
  SELECT
    *,
    SUM(is_visit_start) OVER (PARTITION BY user_name ORDER BY performed_at_utc) AS visit_id
  FROM flagged
),
visit_spans AS (
  SELECT
    user_name, et_day, building, visit_id,
    MIN(performed_at_utc) AS visit_start_utc,
    MAX(performed_at_utc) AS visit_end_utc,
    COUNT(*) AS visit_entries,
    EXTRACT(EPOCH FROM (MAX(performed_at_utc) - MIN(performed_at_utc)))::int AS visit_seconds
  FROM visit_id
  GROUP BY user_name, et_day, building, visit_id
)
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
