-- 0152 — 8-Week Tracker board (training_board).
--
-- Per user 2026-10-23: the paper "8-Week Tracker" (print-station document
-- `tracker`: page 1 board of 35 items in 6 sections, pages 2–3 weekly log,
-- page 4 first meeting + invite) becomes a live form in the admin Tracker
-- drawer (Admin › User Profiles → Tracker → "Training"). The mentor /
-- lead / manager ticks items, writes notes, dates and hours during the
-- weekly review and presses Save; the weekly log rows and the invite body
-- are generated from what was saved (web/src/lib/trainingBoard.ts).
--
-- One row per (person, program, item, week):
--   item_key   slug of the item text on the board (reword = new key), or
--              meta.invite (week N: {when,title}) / meta.first_meeting (week 0)
--   week       1..8 = the program week the entry belongs to (the week chip
--              chosen when saving; defaults to the week since
--              new_hire_enrollments.start_date); 0 = not week-bound
--   status     done · more_work · next_week (null = nothing decided that week)
--   note       the short note written next to the item
--   value      per control — hours8 {hours} · count {n} · labels {ticks[]}
--              · areas {areas[]} · date/check/note {on} · meta rows
-- The board shows the latest week's status/note per item; weekly-log row W
-- is exactly the rows of week W. Nothing is derived server-side.
--
-- Access: admin-side only — read current_user_can_view_career(user_id),
-- write current_user_can_edit_career(user_id) (0133: admin anywhere,
-- same-site manager / lead). The person does not get their own rows
-- (no self clause) — the board is the mentor's record, not a self-report.
--
-- Rollback: drop table training_board.

create table if not exists training_board (
  user_id      uuid not null references users(id) on delete cascade,
  program_key  text not null default 'upark_l1_plan_b',
  item_key     text not null check (length(item_key) between 1 and 80),
  week         smallint not null default 0 check (week between 0 and 8),
  status       text check (status in ('done', 'more_work', 'next_week')),
  note         text check (note is null or length(note) <= 1000),
  value        jsonb not null default '{}'::jsonb,
  entered_on   date not null default current_date,
  updated_by   uuid references users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, program_key, item_key, week)
);

comment on table training_board is
  '8-Week Tracker board (print-station doc `tracker`): one row per (person, program, item, week) — '
  'status done/more_work/next_week, note, control value (hours, counts, ticks, areas, date). '
  'Board = latest week per item; weekly log row W = rows of week W. Mentor/lead/manager/admin write.';

create index if not exists training_board_user_week_idx
  on training_board (user_id, program_key, week);

drop trigger if exists training_board_set_updated_at on training_board;
create trigger training_board_set_updated_at
  before update on training_board
  for each row execute function tg_work_records_set_updated_at();

alter table training_board enable row level security;
drop policy if exists tb_read   on training_board;
drop policy if exists tb_insert on training_board;
drop policy if exists tb_update on training_board;
drop policy if exists tb_delete on training_board;

create policy tb_read on training_board
  for select to authenticated
  using (current_user_can_view_career(user_id));

create policy tb_insert on training_board
  for insert to authenticated
  with check (current_user_can_edit_career(user_id));

create policy tb_update on training_board
  for update to authenticated
  using (current_user_can_edit_career(user_id))
  with check (current_user_can_edit_career(user_id));

create policy tb_delete on training_board
  for delete to authenticated
  using (current_user_can_edit_career(user_id));

grant select, insert, update, delete on training_board to authenticated;
grant all on training_board to service_role;
