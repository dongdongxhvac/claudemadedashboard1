-- 0116_engineer_roster_v.sql
-- Repo-tracks a view created live on 2026-07-15. Single reusable roster
-- read for frontend filters (site, crew, lead, shift, hire date) so the
-- PTO balances page and the profile page split Saturday/Sunday crews from
-- one source instead of re-deriving. Matches live definition verbatim.

CREATE OR REPLACE VIEW public.engineer_roster_v AS
SELECT
  u.id            AS user_id,
  u.full_name,
  u.email,
  u.active,
  u.is_manager,
  u.hiring_date,
  s.code          AS site,
  sh.name         AS shift_name,
  sh.crew,
  ep.title,
  ep.is_lead
FROM public.users u
LEFT JOIN public.engineer_profiles ep ON ep.user_id = u.id
LEFT JOIN public.sites  s  ON ep.home_site_id = s.id
LEFT JOIN public.shifts sh ON ep.shift_id = sh.id;
