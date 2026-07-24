-- 0107 - Binney PTO: future-dated schedule + confirmed final balances.
-- Only dates AFTER 2026-07-23 are imported (no history). Balances are the
-- managers' confirmed year-end remaining; allotment is reconstructed as
-- (confirmed remaining + future booked hours) so v_pto_summary displays the
-- confirmed number while the booked dates still appear on the calendar.
-- Robert Knowlton keeps his existing approved 2026-07-22 vacation (allotment +10h).

alter table public.pto_requests disable trigger pto_requests_notify_trg;

insert into public.pto_requests
  (user_id, type, starts_on, ends_on, hours, status, request_source,
   request_source_detail, submitted_by, submitted_at, reviewed_by, reviewed_at, cap_override)
values
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 'vacation', date '2026-12-05', date '2026-12-05', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 'vacation', date '2026-12-09', date '2026-12-12', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 'vacation', date '2026-12-16', date '2026-12-19', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 'vacation', date '2026-12-23', date '2026-12-23', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 'holiday', date '2026-12-26', date '2026-12-26', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 'vacation', date '2026-12-30', date '2026-12-31', 20.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('146d470e-e59c-4ff6-bc73-6834e321621d'::uuid, 'vacation', date '2026-08-13', date '2026-08-13', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a22f4eeb-3fdf-4a8c-be56-8f657392cbd2'::uuid, 'vacation', date '2026-08-05', date '2026-08-08', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a22f4eeb-3fdf-4a8c-be56-8f657392cbd2'::uuid, 'sick', date '2026-08-12', date '2026-08-15', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a22f4eeb-3fdf-4a8c-be56-8f657392cbd2'::uuid, 'sick', date '2026-08-19', date '2026-08-22', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('a22f4eeb-3fdf-4a8c-be56-8f657392cbd2'::uuid, 'sick', date '2026-08-26', date '2026-08-29', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('1825a522-c189-4bf5-90aa-f640487a56c3'::uuid, 'vacation', date '2026-08-17', date '2026-08-21', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('1825a522-c189-4bf5-90aa-f640487a56c3'::uuid, 'vacation', date '2026-08-28', date '2026-08-28', 8.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('1825a522-c189-4bf5-90aa-f640487a56c3'::uuid, 'vacation', date '2026-11-25', date '2026-11-25', 8.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('1825a522-c189-4bf5-90aa-f640487a56c3'::uuid, 'vacation', date '2026-12-23', date '2026-12-23', 8.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('1825a522-c189-4bf5-90aa-f640487a56c3'::uuid, 'vacation', date '2026-12-28', date '2026-12-31', 32.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('cff211b2-3b47-497b-a764-2aee3dbc26cc'::uuid, 'vacation', date '2026-07-29', date '2026-08-01', 40.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('49c26a50-9015-421f-a5e3-847039f2e6da'::uuid, 'vacation', date '2026-10-15', date '2026-10-17', 30.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('b0b5b25e-d37c-457c-a743-ac67d67a232e'::uuid, 'sick', date '2026-08-26', date '2026-08-28', 30.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('b0b5b25e-d37c-457c-a743-ac67d67a232e'::uuid, 'holiday', date '2026-08-29', date '2026-08-29', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('b0b5b25e-d37c-457c-a743-ac67d67a232e'::uuid, 'sick', date '2026-09-02', date '2026-09-03', 20.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('b0b5b25e-d37c-457c-a743-ac67d67a232e'::uuid, 'vacation', date '2026-09-05', date '2026-09-05', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('2662db30-c93d-4671-8a3b-0822c2d3afc8'::uuid, 'vacation', date '2026-08-16', date '2026-08-16', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true),
  ('952aa98f-a125-482d-a8cd-f449e3a0ffd6'::uuid, 'holiday', date '2026-09-06', date '2026-09-06', 10.00, 'approved', 'other', 'PTO tracker 2026 - future schedule import 2026-07-23', (select id from public.users where email = 'jie.lao@cwservices.com'), now(), (select id from public.users where email = 'jie.lao@cwservices.com'), now(), true);

alter table public.pto_requests enable trigger pto_requests_notify_trg;

insert into public.pto_balances (user_id, year, vacation_alloted, sick_alloted, holiday_alloted, notes)
values
  ('a0af0c06-f4bd-417e-a1c3-9323195df83f'::uuid, 2026, 120.00, 10.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('146d470e-e59c-4ff6-bc73-6834e321621d'::uuid, 2026, 70.00, 80.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('37c8dd4d-6c7a-4b13-84ce-ac9dcf01c6ac'::uuid, 2026, 30.00, 50.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('a22f4eeb-3fdf-4a8c-be56-8f657392cbd2'::uuid, 2026, 40.00, 160.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('c600ed5f-356a-48de-b0fc-9b1ecd56e59d'::uuid, 2026, 50.00, 70.00, 0.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('7b9e13d3-959e-4e51-b865-20fb7c203382'::uuid, 2026, 40.00, 160.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('9200ebd8-fea3-4e5d-9874-b0c5846c227f'::uuid, 2026, 80.00, 20.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('a15c8171-e98d-4689-8d49-259e5be23973'::uuid, 2026, 10.00, 0.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('be36ec24-3838-4443-b4de-ef5f416b7e94'::uuid, 2026, 0.00, 30.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('75382092-c91b-4ad1-ab74-e29d9cff9dd3'::uuid, 2026, 50.00, 50.00, 0.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('098254de-600c-4ac7-a432-907ccf40c27c'::uuid, 2026, 80.00, 70.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('807243e0-9a0f-4522-8c61-41617065a0f6'::uuid, 2026, 20.00, 0.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('1825a522-c189-4bf5-90aa-f640487a56c3'::uuid, 2026, 104.00, 52.00, 8.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('c734fa63-3bb7-47c0-9aa7-360a45fe74ca'::uuid, 2026, 20.00, 0.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('0c176e08-99cf-452b-a8d2-2f4290b717c2'::uuid, 2026, 40.00, 90.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('cff211b2-3b47-497b-a764-2aee3dbc26cc'::uuid, 2026, 40.00, 130.00, 0.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('49c26a50-9015-421f-a5e3-847039f2e6da'::uuid, 2026, 80.00, 120.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('b0b5b25e-d37c-457c-a743-ac67d67a232e'::uuid, 2026, 10.00, 90.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('2662db30-c93d-4671-8a3b-0822c2d3afc8'::uuid, 2026, 60.00, 50.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('77f75ded-da45-49fd-b7e8-2cccf8a5d387'::uuid, 2026, 80.00, 0.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours'),
  ('952aa98f-a125-482d-a8cd-f449e3a0ffd6'::uuid, 2026, 0.00, 90.00, 10.00, 'Confirmed final balance 2026-07-23; allotment = confirmed remaining + future booked hours')
on conflict (user_id, year) do update set
  vacation_alloted = excluded.vacation_alloted,
  sick_alloted     = excluded.sick_alloted,
  holiday_alloted  = excluded.holiday_alloted,
  notes            = excluded.notes,
  updated_at       = now();
