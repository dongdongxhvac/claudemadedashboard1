-- Migration 0096 — manager-editable PTO calendar-invite recipient lists.
--
-- Replaces the Vault-key config (PTO_CAL_TO_UPARK / PTO_CAL_TO_BINNEY) with a
-- real table so managers can add/remove addresses (client emails included)
-- from the PTO panel without SQL. The notify-pto edge function (v7) reads
-- this table via service role; a PTO_CAL_TO_<SITE> env secret still overrides
-- everything for QA. The old Vault keys become unused.
--
-- RLS: read for admin/manager/director (the manager-area audience);
-- write for admin/manager — so the Binney manager can maintain the Binney
-- list without dashboard-admin rights.
--
-- Rollback:
--   -- drop table if exists pto_cal_recipients;

create table if not exists pto_cal_recipients (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references sites(id),
  email      text not null,
  note       text,
  created_at timestamptz not null default now()
);

create unique index if not exists pto_cal_recipients_site_email_uniq
  on pto_cal_recipients (site_id, lower(email));

alter table pto_cal_recipients enable row level security;

create policy pto_cal_recipients_read on pto_cal_recipients
  for select to authenticated
  using (current_user_role() in ('admin', 'manager', 'director'));

create policy pto_cal_recipients_write on pto_cal_recipients
  for all to authenticated
  using (current_user_role() in ('admin', 'manager'))
  with check (current_user_role() in ('admin', 'manager'));

-- Seed with the current (test) UPark list so behavior doesn't change on
-- deploy. Binney starts empty — its manager adds the group address in-app.
insert into pto_cal_recipients (site_id, email, note)
select s.id, v.email, v.note
from sites s
join (values
  ('bmrupark55@gmail.com',     'Mark — test recipient'),
  ('jie.lao@cwservices.com',   'Jie — test recipient')
) as v(email, note) on true
where s.code = 'upark'
on conflict do nothing;
