-- 0153 — 8-Week Tracker board: change log (training_board_log).
--
-- Per user 2026-10-26: every change on the board is logged — status,
-- score (1–4), mark (missed / checked / good), note, hours, and a reset —
-- and the weekly log's Review column lists those changes as dated lines
-- ("Oct 26 · 10 HVAC — score 2 → 3"). training_board keeps the current
-- state (0152); this table is the append-only trail, written by the same
-- Save that writes the state (web/src/hooks/useTrainingBoard.ts).
--
--   field   status · score · mark · note · hours · value · reset
--   old/new text as shown (null when unset)
--   week    the week chip the change belongs to (0 = meta rows)
--
-- Access: same as training_board — manager-and-above read, writes also
-- site-fenced. Insert only from the app; nothing updates or deletes a log
-- line (a mistaken entry is corrected by the next change, which is logged).
--
-- Rollback: drop table training_board_log.

create table if not exists training_board_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  program_key  text not null default 'upark_l1_plan_b',
  item_key     text not null check (length(item_key) between 1 and 80),
  week         smallint not null default 0 check (week between 0 and 8),
  field        text not null check (field in ('status', 'score', 'mark', 'note', 'hours', 'value', 'reset')),
  old          text,
  new          text,
  changed_on   date not null default current_date,
  changed_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table training_board_log is
  '8-Week Tracker board change trail: one line per changed field per Save (status / score / mark / note / hours / value / reset). '
  'The weekly log Review column lists these as dated lines. Append-only.';

create index if not exists training_board_log_user_idx
  on training_board_log (user_id, program_key, week, created_at);

alter table training_board_log enable row level security;
drop policy if exists tbl_read   on training_board_log;
drop policy if exists tbl_insert on training_board_log;

create policy tbl_read on training_board_log
  for select to authenticated
  using (coalesce(current_user_can_manage_users(), false));

create policy tbl_insert on training_board_log
  for insert to authenticated
  with check (current_user_can_edit_career(user_id) and coalesce(current_user_can_manage_users(), false));

grant select, insert on training_board_log to authenticated;
grant all on training_board_log to service_role;
