-- Migration 0100 — Binney PTO calendar invites go to the O365 group.
--
-- (0098/0099 are reserved for the pending Binney PTO backfill import.)
--
-- Manager request 2026-07-14: stop sending the Binney PTO calendar invite to
-- every manager + the requester individually; send it ONLY to the CW Binney
-- Engineering O365 group, which owns a shared group calendar. notify-pto
-- (v12) now treats Binney's pto_cal_recipients rows as the WHOLE invite list
-- (UPark keeps managers + requester + extras). This migration seeds the
-- group address; the list stays manager-editable from the Binney PTO panel.
--
-- NOTE: the invite is sent from the Binney Gmail account, which is OUTSIDE
-- the CUSHWAKE1 tenant — the group must have "let people outside the
-- organization email this group" enabled or delivery silently fails.
--
-- Rollback:
--   -- delete from pto_cal_recipients
--   --  where lower(email) = 'cwbinneyengineeringcws-overheadsupporto365group@cushwake1.onmicrosoft.com';

insert into pto_cal_recipients (site_id, email, note)
select s.id,
       'cwbinneyengineeringcws-overheadsupporto365group@cushwake1.onmicrosoft.com',
       'CW Binney Engineering O365 group - sole invite recipient (manager 2026-07-14)'
from sites s
where s.code = 'binney'
on conflict do nothing;
