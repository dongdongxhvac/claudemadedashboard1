-- Migration 0154 — Binney St clusters · dedicated managers · rounds rotation ·
-- weekend PM plan · weekend plans (manager view "Clusters · Rounds · Weekend").
--
-- Source: five documents from the Binney managers, 2026-10-29 —
--   1. roster by manager (Ed Nardone = East, Andrew Balbo = West) with
--      Employee ID + C&W Services ID per engineer;
--   2. the building-rounds rotation sheet (Week A / Week B grids, the
--      Wednesday A/B Sat-Sun alternation, cluster building lists with
--      round points + hours, floater/lead/engineer duties);
--   3. "Weekend Plans 10/24/26–10/25/26" (the weekly manager hand-out);
--   4. the weekend PM planning table (East / Floating / West crews with
--      PM-hour budgets);
--   5. the building list per manager (+ 21 Erie → West W2 per Don).
--
-- Schema:
--   engineer_profiles  + cluster ('east'|'west'), manager_user_id (the
--                        dedicated manager — a users.id WITHOUT a foreign
--                        key: a second users↔engineer_profiles relationship
--                        makes every PostgREST embed of engineer_profiles
--                        from users ambiguous (PGRST201) and broke the
--                        roster hooks + useMe + three edge functions for ~10
--                        minutes on 2026-10-29 until the FK was dropped),
--                        employee_id, cw_services_id.
--   buildings          + cluster, rounds_group ('E1','E2','W1','W2'; NULL =
--                        no round). A building's manager is the manager
--                        whose profile cluster matches — not stored twice.
--                      + managers may UPDATE buildings at their home site
--                        (was admin/lead only).
--   site_reference     (site_code, key) → jsonb. Reference documents that
--                        change rarely: 'rounds_rotation', 'pm_plan'.
--   weekend_plans      one row per site per weekend (Saturday date) — the
--                        weekly hand-out, structured.
--
-- RLS: everyone authenticated reads; admins write anywhere; managers
-- (current_user_can_manage_users) write rows of their HOME site only.
--
-- Rollback (manual):
--   drop table weekend_plans; drop table site_reference;
--   alter table buildings drop column cluster, drop column rounds_group;
--   drop policy buildings_manager_site_update on buildings;
--   alter table engineer_profiles drop column cluster, drop column manager_user_id,
--     drop column employee_id, drop column cw_services_id;
--
-- Applied to production 2026-10-29 19:33 UTC (as 0154_binney_clusters_ops);
-- the manager_user_id FK was dropped at 19:45 UTC — this file is the
-- resulting state. Never add a FK from engineer_profiles to users other
-- than user_id (see above).

begin;

-- ── 1. engineer_profiles ────────────────────────────────────────────────────

alter table engineer_profiles
  add column if not exists cluster          text check (cluster in ('east', 'west')),
  add column if not exists manager_user_id  uuid,  -- users.id, deliberately no FK (see header)
  add column if not exists employee_id      text,
  add column if not exists cw_services_id   text;

comment on column engineer_profiles.cluster is
  'Binney: east (Kendall / Ed Nardone) or west (301 / Andrew Balbo). NULL at UPark.';
comment on column engineer_profiles.manager_user_id is
  'Dedicated manager (users.id, no FK on purpose: a second users↔engineer_profiles relationship makes PostgREST embeds ambiguous — PGRST201). Binney: set from the roster-by-manager sheet 2026-10-29.';

-- Safety net for re-runs on a database where the FK already exists.
alter table engineer_profiles drop constraint if exists engineer_profiles_manager_user_id_fkey;

create index if not exists engineer_profiles_manager_idx on engineer_profiles(manager_user_id)
  where manager_user_id is not null;

-- ── 2. buildings ────────────────────────────────────────────────────────────

alter table buildings
  add column if not exists cluster       text check (cluster in ('east', 'west')),
  add column if not exists rounds_group  text;

comment on column buildings.rounds_group is
  'Binney rounds cluster the building is walked under: E1, E2, W1, W2. NULL = not on a round.';

-- Managers may edit buildings at their own site (cluster / rounds group from
-- the manager view). Admin + lead keep p4_admin_or_lead_write.
drop policy if exists buildings_manager_site_update on buildings;
create policy buildings_manager_site_update on buildings
  for update to authenticated
  using (current_user_can_manage_users() and site_id = current_user_home_site_id())
  with check (current_user_can_manage_users() and site_id = current_user_home_site_id());

-- ── 3. site_reference ───────────────────────────────────────────────────────

create table if not exists site_reference (
  site_code   text not null,
  key         text not null,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null,
  primary key (site_code, key)
);

alter table site_reference enable row level security;

drop policy if exists site_reference_auth_select on site_reference;
create policy site_reference_auth_select on site_reference
  for select to authenticated using (true);

drop policy if exists site_reference_manager_write on site_reference;
create policy site_reference_manager_write on site_reference
  for all to authenticated
  using (
    current_user_role() = 'admin'
    or (current_user_can_manage_users()
        and site_code = (select code from sites where id = current_user_home_site_id()))
  )
  with check (
    current_user_role() = 'admin'
    or (current_user_can_manage_users()
        and site_code = (select code from sites where id = current_user_home_site_id()))
  );

-- ── 4. weekend_plans ────────────────────────────────────────────────────────

create table if not exists weekend_plans (
  id               uuid primary key default gen_random_uuid(),
  site_code        text not null,
  weekend_start    date not null,                       -- the Saturday
  manager_on_call  text,
  notes            jsonb not null default '[]'::jsonb,  -- [{text, level:'info'|'alert'}]
  rounds           jsonb not null default '{}'::jsonb,  -- {saturday:{E1:'Gary',…}, sunday:{…}}
  saturday_items   jsonb not null default '[]'::jsonb,  -- [{text, level}]
  sunday_items     jsonb not null default '[]'::jsonb,
  reminders        jsonb not null default '[]'::jsonb,  -- [{text, level:'info'|'alert'|'warning'}]
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (site_code, weekend_start)
);

alter table weekend_plans enable row level security;

drop policy if exists weekend_plans_auth_select on weekend_plans;
create policy weekend_plans_auth_select on weekend_plans
  for select to authenticated using (true);

drop policy if exists weekend_plans_manager_write on weekend_plans;
create policy weekend_plans_manager_write on weekend_plans
  for all to authenticated
  using (
    current_user_role() = 'admin'
    or (current_user_can_manage_users()
        and site_code = (select code from sites where id = current_user_home_site_id()))
  )
  with check (
    current_user_role() = 'admin'
    or (current_user_can_manage_users()
        and site_code = (select code from sites where id = current_user_home_site_id()))
  );

-- ── 5. Seed — Binney ────────────────────────────────────────────────────────

do $$
declare
  v_site   uuid;
  v_ed     uuid;
  v_andrew uuid;
begin
  select id into v_site from sites where code = 'binney';
  if v_site is null then
    raise notice 'sites.code=binney not found — skipping Binney seed';
    return;
  end if;

  select u.id into v_ed from users u join engineer_profiles ep on ep.user_id = u.id
   where ep.home_site_id = v_site and lower(u.full_name) = 'edward nardone' limit 1;
  select u.id into v_andrew from users u join engineer_profiles ep on ep.user_id = u.id
   where ep.home_site_id = v_site and lower(u.full_name) = 'andrew balbo' limit 1;

  -- Managers carry their own cluster (that is how a building finds its manager).
  update engineer_profiles set cluster = 'east', updated_at = now() where user_id = v_ed;
  update engineer_profiles set cluster = 'west', updated_at = now() where user_id = v_andrew;

  -- Engineers: cluster + dedicated manager + HR ids (roster sheet, 2026-10-29).
  -- Names are the users.full_name spellings already in the DB.
  create temp table _binney_cluster (full_name text, cluster text, employee_id text, cw_id text)
    on commit drop;
  insert into _binney_cluster values
    ('Angelo Furtado',    'east', '100167231', '6006558'),
    ('Herbert Pinto',     'east', '100237150', '6120785'),
    ('Danjel Sallaku',    'east', '100198213', '6045758'),
    ('Kevin Caro',        'east', '100191530', '6035088'),
    ('Pedro Cuevas',      'east', '100148017', '5979910'),
    ('Richard Fidler',    'east', '100100363', '5726777'),
    ('Peyton McGaffigan', 'east', '100232755', '6113288'),
    ('Edward Twyman',     'east', '100152826', '5992401'),
    ('Gary Li',           'east', '100218238', '6086958'),
    ('Joe Medeiros',      'east', '100096448', '5169690'),
    ('Kyle Gillespie',    'east', null,        null),
    ('Colin Reilly',      'west', '100150946', '5987484'),
    ('Michael Perkins',   'west', '100216759', '6082907'),
    ('Robert Knowlton',   'west', '100230600', '6110197'),
    ('Hector Rivera',     'west', '100196139', '6040431'),
    ('Imtiyaz Khalifa',   'west', '100227351', '6102470'),
    ('Alberto Pires',     'west', '100131254', '5943410'),
    ('Justin McGaffigan', 'west', '100237096', '6120203'),
    ('John Nardone',      'west', '100153279', '5993241'),
    ('Tommy McGovern',    'west', '100188369', '6032046'),
    ('Herayre Donoyan',   'west', '100230601', '6110583'),
    -- Justin McCarthy: dedicated to Assembly Innovation Park (E2), Mon–Fri —
    -- East per Don 2026-10-29 (the roster sheet had listed him under Balbo).
    ('Justin McCarthy',   'east', '100106677', '5891552'),
    ('Marco Morales',     'west', null,        null);

  update engineer_profiles ep
     set cluster         = c.cluster,
         manager_user_id = case c.cluster when 'east' then v_ed else v_andrew end,
         employee_id     = coalesce(ep.employee_id, c.employee_id),
         cw_services_id  = coalesce(ep.cw_services_id, c.cw_id),
         updated_at      = now()
    from _binney_cluster c
    join users u on lower(u.full_name) = lower(c.full_name)
   where ep.user_id = u.id
     and ep.home_site_id = v_site;

  -- Buildings new to the list: 585 Kendall (touring started 10/24), 320 Charles
  -- (both manager sheets say 320, the 0093 seed had 58 Charles), 21 Erie.
  insert into buildings (code, name, short_code, client_company, site_id)
  values
    ('585 Kendall', '585 Kendall', '585K', 'BioMed Realty', v_site),
    ('320 Charles', '320 Charles', '320C', 'BioMed Realty', v_site),
    ('21 Erie',     '21 Erie',     '21E',  'BioMed Realty', v_site)
  on conflict (code) do nothing;

  -- Cluster + rounds group per building (rounds sheet). 210 Broadway is struck
  -- through on both sheets → West, no round. 21 Erie → West W2 (pencilled next
  -- to 40 Erie on the sheet; confirmed by Don 2026-10-29).
  update buildings b set cluster = v.cluster, rounds_group = v.grp, updated_at = now()
    from (values
      ('450 Kendall',              'east', 'E1'),
      ('500 Kendall',              'east', 'E1'),
      ('650 Kendall',              'east', 'E1'),
      ('675 Kendall',              'east', 'E1'),
      ('585 Kendall',              'east', 'E1'),
      ('215 First St',             'east', 'E2'),
      ('150 Second St',            'east', 'E2'),
      ('11 Hurley',                'east', 'E2'),
      ('Assembly Innovation Park', 'east', 'E2'),
      ('21 Erie',                  'west', 'W2'),
      ('301 Binney',               'west', 'W1'),
      ('320 Bent',                 'west', 'W1'),
      ('320 Charles',              'west', 'W1'),
      ('50 Hampshire',             'west', 'W1'),
      ('60 Hampshire',             'west', 'W1'),
      ('210 Broadway',             'west', null),
      ('Fresh Pond 45 Moulton',    'west', 'W2'),
      ('47 Moulton',               'west', 'W2'),
      ('51 Moulton',               'west', 'W2'),
      ('61 Moulton',               'west', 'W2'),
      ('65 Grove',                 'west', 'W2'),
      ('134 Coolidge',             'west', 'W2'),
      ('200 Sidney',               'west', 'W2'),
      ('40 Erie',                  'west', 'W2'),
      ('325 Vassar',               'west', 'W2'),
      ('270 Albany',               'west', 'W2')
    ) as v(code, cluster, grp)
   where b.code = v.code and b.site_id = v_site;

  -- Dedicated building engineer: Justin McCarthy ↔ Assembly Innovation Park
  -- (role 'primary' in building_assignments — the existing model for a tech
  -- stationed at one building). Idempotent: skipped if an open row exists.
  insert into building_assignments (building_id, user_id, role_in_building, starts_on, notes)
  select b.id, u.id, 'primary', current_date, 'Dedicated to AIP (East · E2), Mon–Fri — per Don 2026-10-29'
    from buildings b
    join users u on lower(u.full_name) = 'justin mccarthy'
    join engineer_profiles ep on ep.user_id = u.id and ep.home_site_id = v_site
   where b.code = 'Assembly Innovation Park' and b.site_id = v_site
     and not exists (
       select 1 from building_assignments ba
        where ba.building_id = b.id and ba.user_id = u.id
          and ba.role_in_building = 'primary' and ba.ends_on is null
     );

  -- Rounds rotation sheet (Week A / Week B). Names as written on the sheet;
  -- the UI resolves them to profiles (Herb/Herbert, Rick/Ricky = Richard,
  -- Harry = Herayre, Mike = Michael, Bob = Robert K., Ed = Ed Twyman).
  insert into site_reference (site_code, key, value) values ('binney', 'rounds_rotation', $json$
  {
    "anchor_sunday": "2026-10-18",
    "anchor_week": "A",
    "wednesday_rule": { "A": "saturday", "B": "sunday" },
    "groups": [
      { "code": "E1",   "label": "Cluster E1", "cluster": "east" },
      { "code": "E2",   "label": "Cluster E2", "cluster": "east" },
      { "code": "EBMS", "label": "East BMS",   "cluster": "east" },
      { "code": "W1",   "label": "Cluster W1", "cluster": "west" },
      { "code": "W2",   "label": "Cluster W2", "cluster": "west" },
      { "code": "WBMS", "label": "West BMS",   "cluster": "west" }
    ],
    "weeks": {
      "A": {
        "sun": { "E1": "FLOATER", "E2": "FLOATER", "EBMS": "FLOATER", "W1": "FLOATER", "W2": "FLOATER", "WBMS": "FLOATER" },
        "mon": { "E1": "Kevin", "E2": "Herbert", "EBMS": "Rick", "W1": "Tommy", "W2": "Harry", "WBMS": "John" },
        "tue": { "E1": "Kevin", "E2": "Herbert", "EBMS": "Rick", "W1": "Tommy", "W2": "Harry", "WBMS": "John" },
        "wed": { "E1": "Kevin/Gary", "E2": "Herbert/Joe", "EBMS": "Rick/Ed", "W1": "Tommy/Hector", "W2": "Harry/Mike", "WBMS": "John/Alberto" },
        "thu": { "E1": "Gary", "E2": "Joe", "EBMS": "Ed", "W1": "Hector", "W2": "Mike", "WBMS": "Alberto" },
        "fri": { "E1": "Gary", "E2": "Joe", "EBMS": "Ed", "W1": "Hector", "W2": "Mike", "WBMS": "Alberto" },
        "sat": { "E1": "FLOATER", "E2": "FLOATER", "EBMS": "FLOATER", "W1": "FLOATER", "W2": "FLOATER", "WBMS": "FLOATER" }
      },
      "B": {
        "sun": { "E1": "FLOATER", "E2": "FLOATER", "EBMS": "FLOATER", "W1": "FLOATER", "W2": "FLOATER", "WBMS": "FLOATER" },
        "mon": { "E1": "Herbert", "E2": "Kevin", "EBMS": "Rick", "W1": "Harry", "W2": "Tommy", "WBMS": "John" },
        "tue": { "E1": "Herbert", "E2": "Kevin", "EBMS": "Rick", "W1": "Harry", "W2": "Tommy", "WBMS": "John" },
        "wed": { "E1": "Herbert/Joe", "E2": "Kevin/Gary", "EBMS": "Rick/Ed", "W1": "Harry/Mike", "W2": "Tommy/Hector", "WBMS": "John/Alberto" },
        "thu": { "E1": "Joe", "E2": "Gary", "EBMS": "Ed", "W1": "Mike", "W2": "Hector", "WBMS": "Alberto" },
        "fri": { "E1": "Joe", "E2": "Gary", "EBMS": "Ed", "W1": "Mike", "W2": "Hector", "WBMS": "Alberto" },
        "sat": { "E1": "FLOATER", "E2": "FLOATER", "EBMS": "FLOATER", "W1": "FLOATER", "W2": "FLOATER", "WBMS": "FLOATER" }
      }
    },
    "trainees": { "E1": "Kyle", "W1": "Marco" },
    "group_stats": {
      "E1": { "points": 186, "hours": 3.1 },
      "E2": { "points": 203, "hours": 3.4 },
      "W1": { "points": 304, "hours": 5 },
      "W2": { "points": 374, "hours": 6.1 }
    },
    "cluster_stats": {
      "east": { "points": 389, "hours": 6.5 },
      "west": { "points": 676, "hours": 11 }
    },
    "roles": [
      { "role": "Floater",  "duty": "PMs · no round · fills a round when there is a gap" },
      { "role": "Lead",     "duty": "round · major PMs" },
      { "role": "Engineer", "duty": "round · PMs" }
    ],
    "weekend_staffing": {
      "saturday": { "floaters": 4, "leads": 2 },
      "sunday":   { "floaters": 4, "leads": 1 }
    },
    "note": "Sat/Sun plan comes from the manager week to week."
  }
  $json$::jsonb)
  on conflict (site_code, key) do nothing;

  -- Weekend PM planning table: who works which weekend day per group and
  -- the PM-hour budget per engineer per month (136 h/month = 4 days × 4
  -- weeks × 8.5 h; the remainder is rounds).
  insert into site_reference (site_code, key, value) values ('binney', 'pm_plan', $json$
  {
    "groups": [
      { "key": "east",     "label": "East (Kendall)", "manager": "Ed Nardone",
        "saturday": ["Ed", "Gary", "Joe"], "sunday": ["Ricky", "Kevin", "Herbert"],
        "pm_hours": 99, "month_hours": 594 },
      { "key": "floating", "label": "Floating", "manager": null,
        "saturday": ["Angelo", "Danjel", "Pedro", "Peyton"], "sunday": ["Colin", "Bob", "Imtiyaz", "Justin McGaffigan"],
        "pm_hours": 118.5, "month_hours": 948 },
      { "key": "west",     "label": "West (301)", "manager": "Andrew Balbo",
        "saturday": ["Alberto", "Hector", "Mike"], "sunday": ["John", "Tommy", "Harry"],
        "pm_hours": 86, "month_hours": 516 }
    ],
    "totals": { "month_hours": 2058, "days_per_week": 4, "weeks": 4, "hours_per_day": 8.5, "hours_per_month": 136 }
  }
  $json$::jsonb)
  on conflict (site_code, key) do nothing;

  -- Weekend Plans 10/24/26–10/25/26 (the hand-out).
  insert into weekend_plans (site_code, weekend_start, manager_on_call, notes, rounds, saturday_items, sunday_items, reminders)
  values ('binney', '2026-10-24', 'Ed',
    $json$[
      { "text": "Diverting condensate to drains at 675 and 650 currently.", "level": "info" },
      { "text": "215 1st – Check 2nd floor Sarepta mechanical space.", "level": "info" },
      { "text": "NEW PlantLog, please continue providing feedback on the new setup for rounds and we will adjust.", "level": "info" },
      { "text": "We can now start touring 585 Kendall. If you enter the building, please wear a hard hat and high visibility vest. Do not touch any equipment, it has not been officially turned over to us. Please walk the building when you have time and start getting familiar, especially east side guys. Plant log rounds are active.", "level": "alert" }
    ]$json$::jsonb,
    $json${
      "saturday": { "E1": "Gary", "E2": "Joe", "EBMS": "Ed", "W1": "Pedro", "W2": "Peyton", "WBMS": "Angelo" },
      "sunday":   { "E1": "Herb/Kyle", "E2": "Kevin", "EBMS": "Rick", "W1": "Harry", "W2": "Justin", "WBMS": "Imtiyaz" }
    }$json$::jsonb,
    $json$[
      { "text": "Q4 AHU PMs – 50 Hamp/210 Broadway – Alberto, Mike, Hector. We are pulling finals this quarter. All PM tasks are on the schedule.", "level": "info" },
      { "text": "Replace condenser fan motor for RTU-1 at 210 – Danjel.", "level": "info" }
    ]$json$::jsonb,
    $json$[
      { "text": "Q4 AHU PMs – 60 Hamp, 134 Coolidge (rescheduled from “Nor-Easter”), tasks are on the schedule.", "level": "info" }
    ]$json$::jsonb,
    $json$[
      { "text": "Cooling tower cleanings are currently underway. If you currently don't know how to drain/swap/isolate a cooling tower, please try to work with one of the technicians assigned to these cleanings to learn the process.", "level": "alert" },
      { "text": "If a PM is delayed due to parts/rescheduling, please write NOTES & PUT ON HOLD!!!!", "level": "info" },
      { "text": "WARNING – Check labor hours in shop/office and correct as needed (if your name is highlighted yellow) no later than 10/26/26 at 6am. If there are any hours on the labor report that don't match up to the report that you run, please send us a screenshot.", "level": "warning" },
      { "text": "Both crews – Disciplinary action will be implemented for any hours not up to date (8.5/day) on Monday 10/26/26.", "level": "warning" }
    ]$json$::jsonb)
  on conflict (site_code, weekend_start) do nothing;
end $$;

commit;
