-- 0108 - Binney PTO: extend the future-import cutoff back to July 12.
--
-- Imports the tracker dates in the window 2026-07-13 .. 2026-07-23 that 0107
-- skipped (it only took dates after 07-23). Balances stay displaying the
-- managers' confirmed numbers: each new balance-type day bumps that person's
-- allotment by the same hours, so v_pto_summary remaining is unchanged.
--
-- Robert Knowlton's 07-22 vacation is intentionally NOT inserted here - it
-- already exists (his real approved row, kept in 0107 with his allotment
-- already +10h). Re-inserting would violate pto_requests_no_overlap.
-- Pedro Cuevas' 07-15 is jury_duty: imported for the calendar, no balance effect.

alter table public.pto_requests disable trigger pto_requests_notify_trg;

insert into public.pto_requests
  (user_id, type, starts_on, ends_on, hours, status, request_source,
   request_source_detail, submitted_by, submitted_at, reviewed_by, reviewed_at, cap_override)
values
  ('7b9e13d3-959e-4e51-b865-20fb7c203382'::uuid, 'vacation',  date '2026-07-15', date '2026-07-18', 40.00, 'approved', 'other', 'PTO tracker 2026 - window 07-13..07-23 import', (select id from public.users where email='jie.lao@cwservices.com'), now(), (select id from public.users where email='jie.lao@cwservices.com'), now(), true),
  ('9200ebd8-fea3-4e5d-9874-b0c5846c227f'::uuid, 'sick',      date '2026-07-15', date '2026-07-15', 10.00, 'approved', 'other', 'PTO tracker 2026 - window 07-13..07-23 import', (select id from public.users where email='jie.lao@cwservices.com'), now(), (select id from public.users where email='jie.lao@cwservices.com'), now(), true),
  ('be36ec24-3838-4443-b4de-ef5f416b7e94'::uuid, 'sick',      date '2026-07-14', date '2026-07-14', 10.00, 'approved', 'other', 'PTO tracker 2026 - window 07-13..07-23 import', (select id from public.users where email='jie.lao@cwservices.com'), now(), (select id from public.users where email='jie.lao@cwservices.com'), now(), true),
  ('098254de-600c-4ac7-a432-907ccf40c27c'::uuid, 'vacation',  date '2026-07-17', date '2026-07-18', 20.00, 'approved', 'other', 'PTO tracker 2026 - window 07-13..07-23 import', (select id from public.users where email='jie.lao@cwservices.com'), now(), (select id from public.users where email='jie.lao@cwservices.com'), now(), true),
  ('807243e0-9a0f-4522-8c61-41617065a0f6'::uuid, 'vacation',  date '2026-07-13', date '2026-07-15', 30.00, 'approved', 'other', 'PTO tracker 2026 - window 07-13..07-23 import', (select id from public.users where email='jie.lao@cwservices.com'), now(), (select id from public.users where email='jie.lao@cwservices.com'), now(), true),
  ('49c26a50-9015-421f-a5e3-847039f2e6da'::uuid, 'jury_duty', date '2026-07-15', date '2026-07-15', 10.00, 'approved', 'other', 'PTO tracker 2026 - window 07-13..07-23 import', (select id from public.users where email='jie.lao@cwservices.com'), now(), (select id from public.users where email='jie.lao@cwservices.com'), now(), true);

alter table public.pto_requests enable trigger pto_requests_notify_trg;

-- Bump allotments by the newly-used hours so displayed remaining is unchanged.
update public.pto_balances set vacation_alloted = vacation_alloted + 40, updated_at = now()
  where user_id = '7b9e13d3-959e-4e51-b865-20fb7c203382'::uuid and year = 2026;   -- Gary Li  vac
update public.pto_balances set sick_alloted     = sick_alloted     + 10, updated_at = now()
  where user_id = '9200ebd8-fea3-4e5d-9874-b0c5846c227f'::uuid and year = 2026;   -- Hector Rivera  sick
update public.pto_balances set sick_alloted     = sick_alloted     + 10, updated_at = now()
  where user_id = 'be36ec24-3838-4443-b4de-ef5f416b7e94'::uuid and year = 2026;   -- Herbert Pinto  sick
update public.pto_balances set vacation_alloted = vacation_alloted + 20, updated_at = now()
  where user_id = '098254de-600c-4ac7-a432-907ccf40c27c'::uuid and year = 2026;   -- Joe Medeiros  vac
update public.pto_balances set vacation_alloted = vacation_alloted + 30, updated_at = now()
  where user_id = '807243e0-9a0f-4522-8c61-41617065a0f6'::uuid and year = 2026;   -- John Nardone  vac
