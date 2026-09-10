-- Migration 0129 — pto_cal_recipients: uniqueness per (site, email, KIND).
--
-- 0096 made (site_id, lower(email)) unique, before 0119 split the table into
-- two lists (kind = 'invite' personal .ics extras / 'feed' shared-calendar
-- sync inboxes). One inbox legitimately sits on BOTH lists — at UPark
-- jie.lao is an invite extra AND (notify-pto v27, 2026-09-08) the Power
-- Automate feed inbox for the group calendar — but the old index refused
-- the second row. The admin panel already de-duplicates per list, so the
-- index simply catches up with the model.
--
-- Rollback:
--   drop index if exists pto_cal_recipients_site_email_kind_uniq;
--   create unique index pto_cal_recipients_site_email_uniq
--     on public.pto_cal_recipients (site_id, lower(email));

drop index if exists public.pto_cal_recipients_site_email_uniq;

create unique index if not exists pto_cal_recipients_site_email_kind_uniq
  on public.pto_cal_recipients (site_id, lower(email), kind);
