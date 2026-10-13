-- Migration 0146 — winterization tasks carry a STATUS, not a tick.
--
-- User 2026-10-13: "make winterization item add status, filled, drained
-- or winter and summer mode for 88. record date and engineer name."
--
--   kind   'drain'  — a drain-down: status 'filled' (normal) → 'drained'
--          'mode'   — a seasonal changeover (88's cooling-tower make-up
--                     float): status 'summer' → 'winter'
--   status_at / status_by — when the status was last set and by whom.
--
-- 'drained' and 'winter' are the winterized states (what TV2 counts as
-- done). The 0145 tick (done_at / done_by) folds into the new columns —
-- a ticked drain-down becomes 'drained' at that time by that person — and
-- the old columns are dropped so there is one truth.

alter table public.winterization_tasks
  add column kind      text not null default 'drain'
    check (kind in ('drain', 'mode')),
  add column status    text not null default 'filled'
    check (status in ('filled', 'drained', 'summer', 'winter')),
  add column status_at timestamptz,
  add column status_by uuid references users(id) on delete set null;

-- 88's float adjustment is a summer/winter changeover.
update public.winterization_tasks
   set kind = 'mode', status = 'summer'
 where task ilike '%float%';

-- Fold the tick in.
update public.winterization_tasks
   set status    = case when kind = 'mode' then 'winter' else 'drained' end,
       status_at = done_at,
       status_by = done_by
 where done_at is not null;

alter table public.winterization_tasks
  drop column done_at,
  drop column done_by;

-- A status must match its kind.
alter table public.winterization_tasks
  add constraint winterization_tasks_status_kind_chk check (
    (kind = 'drain' and status in ('filled', 'drained')) or
    (kind = 'mode'  and status in ('summer', 'winter'))
  );
