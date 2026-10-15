-- Migration 0148 — winterization tasks: the to-do IS the action.
--
-- User 2026-10-13: "to do as action, like tower need to be filled, or
-- need to be drained; record someone done it". So a task carries the
-- ACTION that needs doing and who did it, instead of a state label:
--   action   drain | fill          (kind 'drain')
--            winter | summer       (kind 'mode' — 88's CT make-up float)
--   done_at / done_by   null = still to do; set = done, by whom, when.
-- Setting a new action (spring: fill) clears done_at — a fresh to-do.
--
-- 0146/0147's status folds in: todo → the fall action, not done;
-- drained/filled/winter/summer → that action, done at status_at by
-- status_by. The status columns are then dropped — one truth.

alter table public.winterization_tasks
  add column action  text not null default 'drain'
    check (action in ('drain', 'fill', 'winter', 'summer')),
  add column done_at timestamptz,
  add column done_by uuid references users(id) on delete set null;

update public.winterization_tasks
   set action  = case status
                   when 'todo'    then case when kind = 'mode' then 'winter' else 'drain' end
                   when 'drained' then 'drain'
                   when 'filled'  then 'fill'
                   when 'winter'  then 'winter'
                   when 'summer'  then 'summer'
                 end,
       done_at = case when status = 'todo' then null else status_at end,
       done_by = case when status = 'todo' then null else status_by end;

alter table public.winterization_tasks
  drop constraint if exists winterization_tasks_status_check,
  drop constraint if exists winterization_tasks_status_kind_chk,
  drop column status,
  drop column status_at,
  drop column status_by;

-- An action must match its kind.
alter table public.winterization_tasks
  add constraint winterization_tasks_action_kind_chk check (
    (kind = 'drain' and action in ('drain', 'fill')) or
    (kind = 'mode'  and action in ('winter', 'summer'))
  );
