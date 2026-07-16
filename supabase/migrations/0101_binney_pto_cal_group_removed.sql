-- Migration 0101 — Binney PTO invites: drop the O365 group address.
--
-- Supersedes migration 0100, which seeded the group as the sole invite
-- recipient. That architecture didn't survive contact with M365/Mimecast:
-- accepting an .ics only books a PERSONAL calendar, Outlook blocks importing
-- to a shared calendar, and Mimecast strips the .ics in transit. So direct
-- invites can't populate the group calendar at all.
--
-- The working path (built 2026-07-15, laptop session) is instead:
--   notify-pto emails jie.lao@cwservices.com with a machine-readable
--   `PTO_DATA|...` line in the BODY (survives Mimecast; attachments don't)
--   → a Power Automate flow ("PTO to Binney shared calendar", cloud-only)
--   parses that line and writes the event onto the group calendar via the
--   Office 365 Groups connector.
--
-- So Binney's pto_cal_recipients must contain ONLY the inbox that feeds the
-- flow. Leaving the group address here emails ~24 group members an invite
-- with the raw PTO_DATA line in it (subscription is ON for the group) — the
-- exact spam the design is meant to avoid. Verified live via dry_run
-- 2026-07-15: the group WAS still receiving; this removes it.
--
-- Rollback (only if the PA flow is abandoned AND direct group invites are
-- somehow made to work):
--   -- insert into pto_cal_recipients (site_id, email, note)
--   -- select id, 'cwbinneyengineeringcws-overheadsupporto365group@cushwake1.onmicrosoft.com',
--   --        'CW Binney Engineering O365 group'
--   -- from sites where code = 'binney';

delete from pto_cal_recipients r
using sites s
where s.id = r.site_id
  and s.code = 'binney'
  and lower(r.email) = 'cwbinneyengineeringcws-overheadsupporto365group@cushwake1.onmicrosoft.com';
