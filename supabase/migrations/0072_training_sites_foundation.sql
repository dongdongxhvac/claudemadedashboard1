-- Migration 0072 — Training Phase A: sites foundation + roster site tagging.
--
-- Stands up the multi-site concept the Training & Competency feature needs.
-- Until now "site" was only implied by building codes; the org runs two:
--   UPark     (12 techs / 14 buildings)
--   Binney St (19 techs / 28 buildings) -- brand new, seeded via CSV import.
--
-- Additive only (new table + two nullable FK columns). Existing buildings and
-- engineer_profiles are backfilled to UPark, since every record currently in
-- the system is UPark (Binney has never been entered). No existing query,
-- hook, or RLS policy changes -- per the isolate-new-features rule.

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- 'upark', 'binney'
  name        text not null,
  address     text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into sites (code, name, sort_order) values
  ('upark',  'UPark',     1),
  ('binney', 'Binney St', 2)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- site tagging on existing tables (nullable FK, additive)
-- ---------------------------------------------------------------------------
alter table buildings         add column if not exists site_id      uuid references sites(id);
alter table engineer_profiles add column if not exists home_site_id uuid references sites(id);

create index if not exists buildings_site_idx         on buildings(site_id);
create index if not exists engineer_profiles_site_idx on engineer_profiles(home_site_id);

-- Backfill: everything currently in the system is UPark.
update buildings
   set site_id = (select id from sites where code = 'upark')
 where site_id is null;

update engineer_profiles
   set home_site_id = (select id from sites where code = 'upark')
 where home_site_id is null;

-- ---------------------------------------------------------------------------
-- RLS -- sites are low-sensitivity reference data.
--   read : any authenticated user (everyone needs site context to navigate)
--   write: admin or manager (the training supervisor manages the roster)
-- ---------------------------------------------------------------------------
alter table sites enable row level security;

create policy "sites_auth_select" on sites
  for select to authenticated using (true);

create policy "sites_admin_manager_write" on sites
  for all to authenticated
  using (current_user_role() in ('admin','manager'))
  with check (current_user_role() in ('admin','manager'));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table sites;
