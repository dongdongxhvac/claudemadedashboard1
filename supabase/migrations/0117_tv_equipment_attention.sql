-- 0117_tv_equipment_attention.sql
-- Repo-tracks a view created live on 2026-08-05. Data layer for the
-- shop-TV "Equipment Attention" panel: open equipment issues formatted
-- for display (status label, WO, rsp, age-in-days, LOTO), DOWN-CM first
-- then oldest. Read granted to anon so a kiosk page can pull it without
-- auth. Contains no PII (equipment + issue text only).
--
-- NOTE ordering: age_days recomputes against CURRENT_DATE on every read.

CREATE OR REPLACE VIEW public.tv_equipment_attention AS
SELECT
  e.id                                   AS equipment_id,
  COALESCE(e.short_name, e.full_name)    AS name,
  e.full_name,
  e.category,
  e.is_critical,
  b.name                                 AS building,
  i.status                               AS issue_status,   -- down_cm | degraded
  CASE i.status
    WHEN 'down_cm'  THEN 'DOWN — CM'
    WHEN 'degraded' THEN 'DEGRADED'
    ELSE upper(i.status)
  END                                    AS status_label,
  i.detail,
  i.wo_number,
  i.rsp,
  i.status_date,
  (CURRENT_DATE - i.status_date)         AS age_days,
  NULLIF(i.loto_type,'na')               AS loto_type,       -- isoto | rloto | null
  i.loto_applied_at,
  (CASE i.status WHEN 'down_cm' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END) AS sev_rank
FROM public.building_equipment e
JOIN public.equipment_issues i
  ON i.equipment_id = e.id AND i.closed_at IS NULL
LEFT JOIN public.buildings b ON b.id = e.building_id
WHERE e.active
ORDER BY sev_rank, i.status_date;

GRANT SELECT ON public.tv_equipment_attention TO anon, authenticated;
