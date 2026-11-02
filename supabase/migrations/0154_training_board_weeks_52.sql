-- Review sessions can run past week 8 (user 2026-11-02, "+ week" on the board):
-- lift the week cap on the board rows and their change log from 8 to 52.
-- Applied live on 2026-11-02 via the Supabase MCP.
alter table training_board drop constraint training_board_week_check,
  add constraint training_board_week_check check (week between 0 and 52);
alter table training_board_log drop constraint training_board_log_week_check,
  add constraint training_board_log_week_check check (week between 0 and 52);
