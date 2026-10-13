-- Migration 0147 — a 'todo' status for winterization tasks.
--
-- User 2026-10-13: "make a to do status in winterization". Statuses now
-- follow the season instead of 'filled' doubling as "not started":
--   drain  todo → drained (fall)   → filled (spring refill)
--   mode   todo → winter  (fall)   → summer (spring changeover)
-- 'todo' is the default for new tasks; rows whose status was never set
-- (status_at is null — the 0145/0146 defaults) become 'todo'.

alter table public.winterization_tasks
  drop constraint if exists winterization_tasks_status_check,
  drop constraint if exists winterization_tasks_status_kind_chk;

alter table public.winterization_tasks
  alter column status set default 'todo';

update public.winterization_tasks
   set status = 'todo'
 where status_at is null;

alter table public.winterization_tasks
  add constraint winterization_tasks_status_check
    check (status in ('todo', 'filled', 'drained', 'summer', 'winter')),
  add constraint winterization_tasks_status_kind_chk check (
    (kind = 'drain' and status in ('todo', 'filled', 'drained')) or
    (kind = 'mode'  and status in ('todo', 'summer', 'winter'))
  );
