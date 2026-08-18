-- Migration 0126 — v_upark_active_engineers: the app's roster of active
-- UPark engineers, for the PM/WO pollers' roster check.
--
-- Background (2026-08-18): the pm12/wo12 pollers filter Cove server-side by
-- a hardcoded list of Cove assignee IDs captured 2026-05-19. Austin Myette
-- was hired 06-22 — after the capture — so his 61 open PMs never reached
-- the dashboard (0 rows in every snapshot for ~8 weeks) and nothing flagged
-- it. The pollers now compare the assignee names they fetched against this
-- view and log a 'warn' row to ingestion_log for anyone with 0 PMs, so the
-- next new hire surfaces on the first poll instead of silently vanishing.
--
-- NULL home_site_id = UPark, same rule as useSiteScope / 0125.
-- SECURITY INVOKER (0039 convention); the pollers read it with the service
-- role. Grant to authenticated too so an admin surface can show it later.

create or replace view v_upark_active_engineers
with (security_invoker = true)
as
select
  u.id            as user_id,
  u.full_name,
  ep.cmms_assignee_name,
  ep.home_site_id
from users u
join engineer_profiles ep on ep.user_id = u.id
left join sites s on s.id = ep.home_site_id
where u.role = 'engineer'
  and u.active
  and coalesce(s.code, 'upark') = 'upark';

grant select on v_upark_active_engineers to authenticated, service_role;
