-- Migration 0076 — Weekly Update Report (forecast meeting agenda).
--
-- Imported from "2026-06-05 Upark Forecast Meeting.xlsx" (sheet "Weekly
-- Agenda (2)"). That spreadsheet is the running agenda the team reviews
-- at the weekly forecast meeting — a single living list of open items
-- that persist week to week until marked complete. This table is the
-- editable, Excel-like home for it on the admin dashboard.
--
-- Columns mirror the spreadsheet:
--   location    — building short_code OR free text ("Engine" = central
--                 plant, which is not a real buildings row). Kept as FREE
--                 TEXT (not a strict FK) so the weekly editor stays as
--                 flexible as Excel — type any location, including ad-hoc
--                 ones. The UI offers a datalist of known short_codes.
--   priority    — the "P1 Priority" column (e.g. "P1"); usually null.
--   description — short title.
--   activity    — the long "Activity Reports" notes.
--   item_date   — the date column.
--   status      — pending / in_progress / complete / blocked / on_hold.
--   assignee    — responsible party (CW, CWS, BMR, vendor name, etc.).
--
-- Only the INCOMPLETE rows from the spreadsheet (status in_progress, plus
-- blank-status rows that still have real content) are seeded — 30 rows.
-- Completed items were intentionally excluded per the import request.
--
-- Edit-gated to admin / lead via current_user_can_edit_kb(); everyone
-- authenticated can read.

create table if not exists weekly_updates (
  id           uuid primary key default gen_random_uuid(),
  location     text,
  priority     text,
  description  text,
  activity     text,
  item_date    date,
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','complete','blocked','on_hold')),
  assignee     text,
  sort_order   int not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references users(id)
);

create index if not exists weekly_updates_active_idx
  on weekly_updates(active, sort_order)
  where active;

-- Touch updated_at on every UPDATE so the panel can show freshness.
create or replace function public.touch_weekly_updates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_weekly_updates on weekly_updates;
create trigger trg_touch_weekly_updates
  before update on weekly_updates
  for each row execute function public.touch_weekly_updates_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — read open to all authenticated; write gated to admin / lead.
-- ----------------------------------------------------------------------------
alter table weekly_updates enable row level security;

create policy "wu_auth_select" on weekly_updates
  for select to authenticated using (true);

create policy "wu_kb_editor_insert" on weekly_updates
  for insert to authenticated
  with check (current_user_can_edit_kb());

create policy "wu_kb_editor_update" on weekly_updates
  for update to authenticated
  using (current_user_can_edit_kb())
  with check (current_user_can_edit_kb());

create policy "wu_kb_editor_delete" on weekly_updates
  for delete to authenticated
  using (current_user_can_edit_kb());

alter publication supabase_realtime add table weekly_updates;

-- ----------------------------------------------------------------------------
-- Seed — 30 incomplete rows imported from the 2026-06-05 forecast meeting.
-- Idempotent guard: only seed when the table is empty so re-running the
-- migration doesn't duplicate.
-- ----------------------------------------------------------------------------
insert into weekly_updates (location, priority, description, activity, item_date, status, assignee, sort_order)
select * from (values
  ('20', null, 'RTU Schedule', 'RTU1 M-W-F 9A-3, RTU2 T-T 9A-3P, RTU3 on fridays and turn on on Mondays', null::date, 'pending', null, 0),
  ('26', null, 'Air Compressors', 'Add PMs for Leak check & add spot checks to rounds?', null::date, 'pending', null, 10),
  ('26', null, 'Air Compressor 1, WO', '26 AC1 lock out on "blocking air fault" 3 times. A service call was placed with Comairco due to compressor 1 going into shutdown from a “block air safety". 5/15/2026, Parts will be shipped 6/26/2026', '2026-05-15'::date, 'in_progress', 'Comairco', 20),
  ('26', null, 'MAU3 VFD2', 'missed enable error 2021,might need to schedule a shutdown to replace the enable relays or socket 6/5/2026 VFD2 is replaced in May', '2026-06-05'::date, 'in_progress', 'CW', 30),
  ('35', null, 'P2.1 VFD HOA status, WO', '35 P2.1 VFD showing in hand for 1 year. it hasn''t run since Nov 2025. please investigate.', '2026-06-01'::date, 'in_progress', 'Albireo', 40),
  ('35', null, 'AHU1.1a, WO', 'AHU1.1a HW coil has a pinpoint leak', '2026-05-08'::date, 'in_progress', 'BMR/Hemal', 50),
  ('40', null, 'Steam HX 2.6', 'Steam HX 2.6 leaking condensate through HPS y-strainer flange. Tightening did not stop the leak, WO', '2026-06-01'::date, 'in_progress', 'CWS', 60),
  ('40', null, 'PH CW Insulation', 'Jie to provide pricing for materials to insulate domestic make up line', null::date, 'pending', null, 70),
  ('65', null, 'RTU Make Up Meters', 'get quote to install water meters to RTU make up lines', null::date, 'pending', null, 80),
  ('75', null, 'AHU 3 Mixing Dampers', 'Confirm operation', null::date, 'pending', null, 90),
  ('75', null, 'Vacuum pump 1, WO', 'pump gear is bad', '2026-06-01'::date, 'in_progress', 'Comairco', 100),
  ('75', null, 'HV1 freeze stat Alarm, WO', null, '2026-06-01'::date, 'in_progress', 'Siemens', 110),
  ('75', null, 'AHU1 chilled water valve transducer, WO', null, '2026-05-22'::date, 'in_progress', 'CWS', 120),
  ('300', null, 'GEF6, WO', 'Fan being rebuilt by larson', '2026-06-01'::date, 'in_progress', 'Larson/cws', 130),
  ('300', null, 'AHU5 BMS, WO', 'programming issue on AHU5 occupancy switch that is goble command control all AHUs', '2026-06-01'::date, 'in_progress', 'Albireo', 140),
  ('300', null, 'GEF1, WO', 'Fan being rebuilt by larson', '2026-06-01'::date, 'in_progress', 'Larson/cws', 150),
  ('300', null, 'AHU5 HR, WO', 'HR Coil 2nd pass/3, VIC connection need to be redone. off by Sean', '2026-06-01'::date, 'in_progress', 'Hamel', 160),
  ('350', null, 'AHU RF Welding', 'ARC drafting proposal(s)', null::date, 'pending', null, 170),
  ('65', null, 'RTU1 CTB spray pump leak, WO', 'wait for weather colder to do the pump rebuilt', '2026-06-04'::date, 'in_progress', 'CWS', 180),
  ('65', null, 'Boiler control project, WO', 'run wires to boiler inet and outlet temp sensor', null::date, 'in_progress', 'CWS', 190),
  ('65', null, 'RTU1 SF2 WO', 'vfd need to repalce', '2026-05-25'::date, 'in_progress', 'Gaston', 200),
  ('Engine', null, 'EAHU 2C EF 1 & 2', 'Isolation dampers cross connected.  Identify if BMS or VFD is sending signal to isolation dampers.', null::date, 'pending', null, 210),
  ('20', null, 'RTU3 gas line, WO', 'RTU 3 Gas isolation plug valve leaking in open position. Confirm leak on the shutoff valve', '2026-06-01'::date, 'in_progress', 'patriot', 220),
  ('88', null, 'AHU1 Freeze stat, WO', 'need to schedule a shutdown to replace freeze stat', '2026-06-01'::date, 'in_progress', 'CWS', 230),
  ('88', null, 'Boiler control project, WO', null, '2026-06-01'::date, 'in_progress', 'CWS', 240),
  ('Engine', null, 'Chilled water bypass, WO', 'Engine, Chilled Water bypass valve alarm.4/16/2026, conversion setting is adjust to avoid 10% spot which casuse valve to seize. 4/19/26. high torqe version of  actuator is ordered and in hand.6/1/26', '2026-04-16'::date, 'in_progress', 'CWS', 250),
  ('35', null, 'Fuel pump, WO', 'Connect Boilers and Isolation VBMR contacted Hamel for another follow up. Hamel will plan to replace this strainer with a new one. Replacement status TBDalves to BMS for BMS control', '2026-06-01'::date, 'in_progress', 'Hamel', 260),
  ('45', null, 'AHU6 Endswitch, WO', 'update from Mark and Dariusz', '2026-06-01'::date, 'in_progress', 'CWS', 270),
  ('45', null, 'RO system, WO', 'RO system water meter replacement.', '2026-06-01'::date, 'in_progress', 'CWS', 280),
  ('350', null, 'AHU BMS network down', null, '2026-06-01'::date, 'in_progress', 'Siemens', 290)
) as seed(location, priority, description, activity, item_date, status, assignee, sort_order)
where not exists (select 1 from weekly_updates);
