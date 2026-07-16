-- Migration 0102 — split pto_cal_recipients into two lists via a kind column.
--
--   kind = 'feed'   — SHARED calendar sync inboxes (Binney: the Power
--                     Automate feed, currently jie.lao). ADMIN-ONLY writes.
--                     Emptying it silently stops the group calendar sync.
--   kind = 'invite' — PERSONAL calendar .ics invite extras (on top of the
--                     built-in home managers + requester). admin/manager
--                     writes, as before.
--
-- notify-pto v19 reads the kinds separately: Binney sends the body-only
-- PTO_DATA feed email to 'feed' rows, and (only when BINNEY_LIVE) .ics
-- invites to home managers + 'invite' rows. UPark ignores 'feed' rows until
-- it gets its own PA flow.
--
-- Rollback:
--   -- drop policy if exists pto_cal_recipients_write_feed on pto_cal_recipients;
--   -- drop policy if exists pto_cal_recipients_write_invite on pto_cal_recipients;
--   -- create policy pto_cal_recipients_write on pto_cal_recipients
--   --   for all to authenticated
--   --   using (current_user_role() in ('admin', 'manager'))
--   --   with check (current_user_role() in ('admin', 'manager'));
--   -- alter table pto_cal_recipients drop column kind;

alter table pto_cal_recipients
  add column if not exists kind text not null default 'invite'
  check (kind in ('invite', 'feed'));

-- Binney's jie.lao row is the PA feed inbox, not an invite extra.
update pto_cal_recipients r
set kind = 'feed'
from sites s
where s.id = r.site_id
  and s.code = 'binney'
  and lower(r.email) = 'jie.lao@cwservices.com';

-- Replace the single write policy with per-kind policies.
drop policy if exists pto_cal_recipients_write on pto_cal_recipients;

create policy pto_cal_recipients_write_invite on pto_cal_recipients
  for all to authenticated
  using (kind = 'invite' and current_user_role() in ('admin', 'manager'))
  with check (kind = 'invite' and current_user_role() in ('admin', 'manager'));

create policy pto_cal_recipients_write_feed on pto_cal_recipients
  for all to authenticated
  using (kind = 'feed' and current_user_role() = 'admin')
  with check (kind = 'feed' and current_user_role() = 'admin');
