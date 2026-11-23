-- 0169 — PM audit: Cove's labor report per person per day (manager, 2026-11-23).
--
-- The Week tab's day columns were added up from the labor entries on the
-- tasks we hold. A day logged on work we do not hold — an open work order,
-- mostly: Cove gives those hours only when the order closes — showed as 0,
-- got a red mark and turned the name yellow. Found on one engineer's
-- Wednesday: Cove's report had 8.5 h for him, the column had none.
--
-- The labor report itself knows every hour by the day it was worked. The
-- labor poller now asks it one day at a time (read-only, both sites) and
-- upserts audit_day_hours; the Week tab reads its day columns from there and
-- falls back to the entries for a day the table does not have.
--
-- Backfill once per site:
--   COVE_SITE=upark  .venv/bin/python labor_poller.py backfill-audit-days 190
--   COVE_SITE=binney .venv/bin/python labor_poller.py backfill-audit-days 190

begin;

create table if not exists public.audit_day_hours (
  site_code        text        not null,
  day              date        not null,   -- Eastern calendar day the work was done
  assigned_to_name text        not null,
  hours            numeric     not null,
  as_of            timestamptz not null default now(),
  primary key (site_code, day, assigned_to_name)
);

comment on table public.audit_day_hours is
  'Cove labor report total per person per Eastern calendar day (the day the work was done). Upserted by watcher/labor_poller.py; the PM audit Week tab reads its day columns from here.';

alter table public.audit_day_hours enable row level security;

drop policy if exists audit_day_hours_select on public.audit_day_hours;
create policy audit_day_hours_select on public.audit_day_hours
  for select to authenticated
  using (
    public.current_user_role() = any (array['admin', 'manager', 'director', 'tv'])
    or public.current_user_is_lead()
    or (public.current_user_role() = 'engineer' and assigned_to_name = public.current_user_cmms_name())
  );

revoke all on public.audit_day_hours from public, anon, authenticated;
grant select on public.audit_day_hours to authenticated;
grant all on public.audit_day_hours to service_role;

commit;
