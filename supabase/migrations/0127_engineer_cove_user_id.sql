-- Migration 0127 — engineer_profiles.cove_user_id: the engineer's Cove
-- (CMMS) user ID, so the pm12/wo12 pollers build their assignee filter
-- from the roster instead of a hardcoded list in Python.
--
-- Background: the pollers filter Cove server-side by assignee ID. Until now
-- that list was captured once (2026-05-19) and hardcoded in two files; a
-- hire made after that (Austin Myette, 06-22) was invisible for ~8 weeks
-- and adding him meant editing Python + redeploying the VM. With the ID on
-- the profile, adding a hire is a single field in the Admin › User Profiles
-- drawer, and the roster is the source of truth.
--
-- The pollers ALSO backfill this column: every fetched task carries
-- assignee.id, so any roster profile whose cmms_assignee_name matches a
-- fetched assignee and has no cove_user_id yet gets it stamped. The 12
-- legacy IDs self-populate on the first poll after deploy — no manual entry.
--
-- Cove IDs are 10-char base62 (e.g. DVQ8HxDTKS). Unique per person, so a
-- partial unique index guards against pasting one person's ID onto two
-- profiles (which would silently double-count in the pollers' filter).

alter table engineer_profiles
  add column if not exists cove_user_id text;

comment on column engineer_profiles.cove_user_id is
  'Cove (CMMS) user ID. Drives the pm12/wo12 pollers'' assignee filter — a '
  'new hire needs this (or the poller-side legacy list) to have their PMs/'
  'WOs reach the dashboard. Auto-backfilled by the pollers when a fetched '
  'assignee''s name matches cmms_assignee_name. Found in the URL of the '
  'person''s assignee filter in Cove: ...%22id%22%3A%22<ID>%22...';

create unique index if not exists engineer_profiles_cove_user_id_uniq
  on engineer_profiles (cove_user_id)
  where cove_user_id is not null;

-- Roster view (0126) exposes it so the pollers can read the ID list and
-- know which profiles still need backfill. DROP + CREATE (not OR REPLACE):
-- Postgres only allows appending view columns, and the new column reads
-- better next to cmms_assignee_name. Nothing depends on the view yet.
drop view if exists v_upark_active_engineers;
create view v_upark_active_engineers
with (security_invoker = true)
as
select
  u.id            as user_id,
  u.full_name,
  ep.cmms_assignee_name,
  ep.cove_user_id,
  ep.home_site_id
from users u
join engineer_profiles ep on ep.user_id = u.id
left join sites s on s.id = ep.home_site_id
where u.role = 'engineer'
  and u.active
  and coalesce(s.code, 'upark') = 'upark';

grant select on v_upark_active_engineers to authenticated, service_role;

-- Seed the one ID we know for certain today (from Cove's own URL, 08-18).
-- The other 12 legacy IDs backfill from the pollers' fetch on first run.
update engineer_profiles ep
   set cove_user_id = 'DVQ8HxDTKS'
  from users u
 where u.id = ep.user_id
   and u.full_name = 'Austin Myette'
   and ep.cove_user_id is null;
