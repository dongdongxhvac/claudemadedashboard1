-- Migration 0047 — Partial-day PTO time range.
--
-- Adds optional out_from / out_until time columns to pto_requests so
-- requests can express "late start" / "early leave" / "mid-day window"
-- in addition to whole-day off.
--
-- Semantics:
--   out_from  = time the engineer LEAVES (start of off-time)
--   out_until = time the engineer RETURNS (end of off-time)
--
--   out_from = null AND out_until = null → full day off (legacy default)
--   out_from = null AND out_until = X    → "in at X" (late start)
--   out_from = X    AND out_until = null → "out at X" (early leave)
--   out_from = X    AND out_until = Y    → "out X–Y" (mid-day window)
--
-- The chip on the Coverage and PTO panels renders the label by inspecting
-- these two values; full-day rows render unchanged.

alter table public.pto_requests
  add column if not exists out_from  time,
  add column if not exists out_until time;

-- Sanity check: when both are set, out_until must be after out_from.
-- Tolerate the no-cross-midnight assumption (engineers can't be off
-- 11pm Mon → 3am Tue as one row; that's two PTO rows).
alter table public.pto_requests
  drop constraint if exists pto_requests_out_window_order;
alter table public.pto_requests
  add constraint pto_requests_out_window_order
  check (out_from is null or out_until is null or out_until > out_from);

-- v_pto_requests_enriched needs the new columns exposed for the React panels.
-- DROP + CREATE because Postgres refuses CREATE OR REPLACE when columns are added.
drop view if exists public.v_pto_requests_enriched;

create view public.v_pto_requests_enriched as
  select
    r.id,
    r.user_id,
    u.full_name as user_full_name,
    r.type,
    r.starts_on,
    r.ends_on,
    (r.ends_on - r.starts_on + 1) as days,
    r.hours,
    r.status,
    r.reason,
    r.out_from,
    r.out_until,
    r.request_source,
    r.request_source_detail,
    r.submitted_by,
    sub.full_name as submitted_by_name,
    r.submitted_at,
    r.reviewed_by,
    rev.full_name as reviewed_by_name,
    r.reviewed_at,
    r.review_note,
    r.cap_override,
    r.cap_override_reason,
    r.created_at,
    r.updated_at
  from public.pto_requests r
    left join public.users u   on u.id = r.user_id
    left join public.users sub on sub.id = r.submitted_by
    left join public.users rev on rev.id = r.reviewed_by;

alter view public.v_pto_requests_enriched set (security_invoker = true);
