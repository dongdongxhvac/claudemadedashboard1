-- 0102 — Add PTO types: leave, short_term, jury_duty.
--
-- Extends the pto_request_type enum. These are manager-loggable absence types
-- that do NOT carry a balance allotment (unlike vacation/sick/holiday) and do
-- NOT count toward the 2-engineer vacation cap. They surface on the coverage
-- heatmap (non-counting marker) and in each engineer's PTO year log.
--
-- Engineer self-serve exposes only: vacation, sick, holiday (floater),
-- jury_duty. The rest are manager-add only.
--
-- ALTER TYPE ... ADD VALUE is idempotent-guarded with IF NOT EXISTS so a
-- re-run is safe.

alter type public.pto_request_type add value if not exists 'leave';
alter type public.pto_request_type add value if not exists 'short_term';
alter type public.pto_request_type add value if not exists 'jury_duty';
