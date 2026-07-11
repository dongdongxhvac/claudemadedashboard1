-- Migration 0093 — Binney St data seed (Phase 0 of the Binney first pass).
--
-- Seeds the second site's real data, provided by the user on 2026-07-10:
--   * 28 buildings (client: BioMed Realty)
--   * 24 CWS engineers (roster screenshots from the Binney CMMS user list;
--     cmms_assignee_name preserves the EXACT display string from that system —
--     including 'batkinson', 'enardone', 'pedro cuevas', 'Justin McCarrthy' —
--     so future CMMS ingestion can match on it)
--   * 4 shifts encoding the Binney 4×10 two-crew schedule:
--     Sun–Wed crew and Wed–Sat crew (Wednesday overlap), each with a
--     6:00–16:30 and a 7:30–18:00 start. The Binney PTO panel derives crew
--     work-days from these shift NAME prefixes ('Sun-Wed', 'Wed-Sat') —
--     rename them and the staffing roll falls back to everyday scheduling.
--
-- Deliberately NOT seeded (per user decisions 2026-07-10):
--   * Jie Lao (already in the system), the shared Intern/on-call mailbox,
--     BioMed Realty client staff, ChemAqua vendor.
--   * pto_balances — vacation/sick/holiday allotments arrive next week as an
--     Excel sheet from the Binney manager.
--   * shift assignments — engineer_profiles.shift_id stays NULL until the
--     manager assigns crews in /binney/admin.
--
-- Idempotent: buildings ON CONFLICT (code); users guarded by email NOT EXISTS;
-- profiles upsert fills only NULL columns; shifts guarded by name NOT EXISTS.
--
-- Rollback (manual, run in order):
--   -- delete from engineer_profiles where home_site_id = (select id from sites where code='binney');
--   -- delete from users where lower(email) in (<the 24 emails below>);
--   -- delete from buildings where site_id = (select id from sites where code='binney');
--   -- delete from shifts where name in ('Sun-Wed 6A','Sun-Wed 7:30A','Wed-Sat 6A','Wed-Sat 7:30A');

begin;

do $$
declare
  v_site uuid;
begin
  select id into v_site from sites where code = 'binney';
  if v_site is null then
    raise exception 'sites.code=''binney'' not found — apply migration 0072 first';
  end if;

  ------------------------------------------------------------------
  -- Buildings (code = full name per UPark convention; short_code =
  -- street number + street initial so it can't collide with UPark's
  -- bare-number short codes).
  ------------------------------------------------------------------
  insert into buildings (code, name, short_code, client_company, site_id)
  values
    ('500 Kendall',             '500 Kendall',             '500K', 'BioMed Realty', v_site),
    ('65 Grove',                '65 Grove',                '65G',  'BioMed Realty', v_site),
    ('Assembly Innovation Park','Assembly Innovation Park','AIP',  'BioMed Realty', v_site),
    ('25 Moulton',              '25 Moulton',              '25M',  'BioMed Realty', v_site),
    ('27 Moulton',              '27 Moulton',              '27M',  'BioMed Realty', v_site),
    ('33 Moulton',              '33 Moulton',              '33M',  'BioMed Realty', v_site),
    ('47 Moulton',              '47 Moulton',              '47M',  'BioMed Realty', v_site),
    ('51 Moulton',              '51 Moulton',              '51M',  'BioMed Realty', v_site),
    ('61 Moulton',              '61 Moulton',              '61M',  'BioMed Realty', v_site),
    ('215 First St',            '215 First St',            '215F', 'BioMed Realty', v_site),
    ('150 Second St',           '150 Second St',           '150S', 'BioMed Realty', v_site),
    ('11 Hurley',               '11 Hurley',               '11H',  'BioMed Realty', v_site),
    ('5 Middlesex',             '5 Middlesex',             '5MX',  'BioMed Realty', v_site),
    ('40 Erie',                 '40 Erie',                 '40E',  'BioMed Realty', v_site),
    ('58 Charles',              '58 Charles',              '58C',  'BioMed Realty', v_site),
    ('134 Coolidge',            '134 Coolidge',            '134C', 'BioMed Realty', v_site),
    ('200 Sidney',              '200 Sidney',              '200S', 'BioMed Realty', v_site),
    ('270 Albany',              '270 Albany',              '270A', 'BioMed Realty', v_site),
    ('325 Vassar',              '325 Vassar',              '325V', 'BioMed Realty', v_site),
    ('Fresh Pond 45 Moulton',   'Fresh Pond 45 Moulton',   '45M',  'BioMed Realty', v_site),
    ('650 Kendall',             '650 Kendall',             '650K', 'BioMed Realty', v_site),
    ('675 Kendall',             '675 Kendall',             '675K', 'BioMed Realty', v_site),
    ('320 Bent',                '320 Bent',                '320B', 'BioMed Realty', v_site),
    ('301 Binney',              '301 Binney',              '301B', 'BioMed Realty', v_site),
    ('210 Broadway',            '210 Broadway',            '210B', 'BioMed Realty', v_site),
    ('50 Hampshire',            '50 Hampshire',            '50H',  'BioMed Realty', v_site),
    ('60 Hampshire',            '60 Hampshire',            '60H',  'BioMed Realty', v_site),
    ('450 Kendall',             '450 Kendall',             '450K', 'BioMed Realty', v_site)
  on conflict (code) do nothing;

  ------------------------------------------------------------------
  -- Shifts — Binney 4×10 crew schedule. sort_order 100+ keeps them
  -- after UPark's shifts in every ordered dropdown.
  ------------------------------------------------------------------
  insert into shifts (name, start_time, end_time, sort_order)
  select v.name, v.start_time::time, v.end_time::time, v.sort_order
  from (values
    ('Sun-Wed 6A',    '06:00', '16:30', 100),
    ('Sun-Wed 7:30A', '07:30', '18:00', 101),
    ('Wed-Sat 6A',    '06:00', '16:30', 102),
    ('Wed-Sat 7:30A', '07:30', '18:00', 103)
  ) as v(name, start_time, end_time, sort_order)
  where not exists (select 1 from shifts s where s.name = v.name);

  ------------------------------------------------------------------
  -- Engineers: users + engineer_profiles (home_site_id = Binney).
  -- The users-insert trigger auto-creates an empty profile row; the
  -- upsert below fills it without clobbering later manual edits.
  ------------------------------------------------------------------
  create temp table _binney_roster (
    full_name text, email text, cmms text
  ) on commit drop;

  insert into _binney_roster values
    ('Alberto Pires',    'alberto.pires@cwservices.com',     'Alberto Pires'),
    ('Andrew Balbo',     'andrew.balbo@cwservices.com',      'Andrew Balbo'),
    ('Angelo Furtado',   'angelo.furtado@cwservices.com',    'Angelo Furtado'),
    ('Robert Atkinson',  'robert.atkinson@cwservices.com',   'batkinson'),
    ('Colin Reilly',     'colin.reilly@cwservices.com',      'Colin Reilly'),
    ('Danjel Sallaku',   'danjel.sallaku@cwservices.com',    'Danjel Sallaku'),
    ('Edward Twyman',    'edward.twyman@cwservices.com',     'Edward Twyman'),
    ('Edward Nardone',   'edward.nardone@cwservices.com',    'enardone'),
    ('Gary Li',          'gary.li@cwservices.com',           'Gary Li'),
    ('Hector Rivera',    'hector.rivera1@cwservices.com',    'Hector Rivera'),
    ('Herayre Donoyan',  'herayre.donoyan@cwservices.com',   'Herayre Donoyan'),
    ('Herbert Pinto',    'herbert.pinto@cwservices.com',     'Herbert Pinto'),
    ('Imtiyaz Khalifa',  'imtiyaz.khalifa@cwservices.com',   'Imtiyaz Khalifa'),
    ('Joe Medeiros',     'jose.medeiros@cwservices.com',     'Joe Medeiros'),
    ('John Nardone',     'john.nardone@cwservices.com',      'John Nardone'),
    ('Justin McCarthy',  'justin.mccarthy@cwservices.com',   'Justin McCarrthy'),
    ('Justin McGaffigan','justin.mcgaffigan@cwservices.com', 'Justin Mcgaffigan'),
    ('Kevin Caro',       'kevin.caro@cwservices.com',        'Kevin Caro'),
    ('Michael Perkins',  'michael.perkins1@cwservices.com',  'Michael Perkins'),
    ('Pedro Cuevas',     'pedro.cuevas@cwservices.com',      'pedro cuevas'),
    ('Peyton McGaffigan','peyton.mcgaffigan@cwservices.com', 'Peyton Mcgaffigan'),
    ('Richard Fidler',   'richard.fidler1@cwservices.com',   'Richard Fidler'),
    ('Robert Knowlton',  'robert.knowlton@cwservices.com',   'Robert Knowlton'),
    ('Tommy McGovern',   'tommy.mcgovern@cwservices.com',    'Tommy McGovern');

  insert into users (full_name, email, role, active)
  select r.full_name, r.email, 'engineer', true
  from _binney_roster r
  where not exists (select 1 from users u where lower(u.email) = lower(r.email));

  insert into engineer_profiles (user_id, home_site_id, cmms_assignee_name)
  select u.id, v_site, r.cmms
  from _binney_roster r
  join users u on lower(u.email) = lower(r.email)
  on conflict (user_id) do update set
    home_site_id       = coalesce(engineer_profiles.home_site_id, excluded.home_site_id),
    cmms_assignee_name = coalesce(engineer_profiles.cmms_assignee_name, excluded.cmms_assignee_name),
    updated_at         = now();
end $$;

commit;
