-- 0106 — Database-level double-booking backstop for pto_requests.
--
-- The client-side findOwnOverlaps guard (commit 0e325c2) refuses overlapping
-- PTO in all six entry forms, but nothing stopped a double-booking that came
-- in via direct SQL / the REST API, via a race between two simultaneous
-- submits, or via a form submitted before existing rows finished loading.
-- This adds an exclusion constraint so overlaps are impossible from every path.
--
-- It mirrors the UI rules exactly:
--   * only active bookings block  (status in pending/approved)
--   * partial-day rows (out_from/out_until set) are exempt, so a morning
--     appointment and an afternoon call-out still stack legally
--   * denied/cancelled rows never block — they are history, not bookings

-- 1. Clear the two pre-existing duplicates: Edwin Sepulveda has a sick AND a
--    vacation entry both approved on 2026-02-05 and again on 2026-05-13, each
--    double-charging his balance. Keep vacation, cancel the sick rows —
--    cancelling (not deleting) preserves the audit trail and stops them
--    counting in v_pto_summary. Mute the notify trigger so this cleanup does
--    not fire retraction emails / calendar cancellations to Edwin + managers.
alter table public.pto_requests disable trigger pto_requests_notify_trg;

update public.pto_requests r
set status      = 'cancelled',
    review_note = 'Duplicate of same-day vacation; cancelled 2026-07-22 during double-booking cleanup'
from public.users u
where u.id = r.user_id
  and u.full_name = 'Edwin Sepulveda'
  and r.type      = 'sick'
  and r.status    = 'approved'
  and r.starts_on in (date '2026-02-05', date '2026-05-13');

alter table public.pto_requests enable trigger pto_requests_notify_trg;

-- 2. btree_gist provides the gist equality opclass for user_id (uuid).
create extension if not exists btree_gist;

-- 3. The backstop. daterange is inclusive of both ends; && is range overlap.
--    The WHERE predicate makes the exemptions above authoritative in the DB.
alter table public.pto_requests
  add constraint pto_requests_no_overlap
  exclude using gist (
    user_id                                with =,
    daterange(starts_on, ends_on, '[]')    with &&
  )
  where (status in ('pending', 'approved')
         and out_from  is null
         and out_until is null);
