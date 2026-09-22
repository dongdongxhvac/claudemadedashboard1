-- Migration 0132 — more than one training program per person.
--
-- Per user 2026-09-22: a second program ("Licensed HVAC Development") in
-- the same format as the 8-week new-hire program — its own Print Station
-- with its own Master Sign-Off Sheet — assignable alongside it. Programs
-- are a code list (web/src/lib/programs.ts: key, title, print station
-- path); everything else is per (person, program):
--
--   new_hire_enrollments   PK user_id  →  PK (user_id, program_key)
--   new_hire_checkoffs     + program_key; PK (user_id, program_key, item_key);
--                          FK (user_id, program_key) → enrollments
--   new_hire_rep_logs      + program_key; FK (user_id, program_key) → enrollments
--   new_hire_doc_activity  already carries program_key (0131) — unchanged
--
-- Existing rows keep program_key 'upark_l1_plan_b' (the column default), so
-- nothing recorded so far moves. RLS is unchanged: the policies call
-- current_user_can_edit_new_hire(user_id), which admits admin, own-site
-- manager/lead, and the MENTOR of any of that person's programs — a mentor
-- on the new-hire program can therefore also sign the HVAC sheet for the
-- same person. Acceptable for the crew size; tighten to (user, program) if
-- that ever matters.
--
-- Rollback (only if no second-program rows exist): drop the composite keys
-- and FKs, re-add PK user_id on enrollments and the single-column FKs.

-- ── enrollments: composite key ────────────────────────────────────────────
alter table new_hire_checkoffs drop constraint if exists new_hire_checkoffs_user_id_fkey;
alter table new_hire_rep_logs  drop constraint if exists new_hire_rep_logs_user_id_fkey;
alter table new_hire_enrollments drop constraint if exists new_hire_enrollments_pkey;
alter table new_hire_enrollments add primary key (user_id, program_key);

-- ── check-offs ────────────────────────────────────────────────────────────
alter table new_hire_checkoffs add column if not exists program_key text not null default 'upark_l1_plan_b';
alter table new_hire_checkoffs drop constraint if exists new_hire_checkoffs_pkey;
alter table new_hire_checkoffs add primary key (user_id, program_key, item_key);
alter table new_hire_checkoffs
  add constraint new_hire_checkoffs_enrollment_fkey
  foreign key (user_id, program_key) references new_hire_enrollments(user_id, program_key) on delete cascade;

comment on column new_hire_checkoffs.program_key is
  'Program the check-off belongs to (web/src/lib/programs.ts). Item keys come from that program''s sign-off sheet.';

-- ── rep logs ──────────────────────────────────────────────────────────────
alter table new_hire_rep_logs add column if not exists program_key text not null default 'upark_l1_plan_b';
alter table new_hire_rep_logs
  add constraint new_hire_rep_logs_enrollment_fkey
  foreign key (user_id, program_key) references new_hire_enrollments(user_id, program_key) on delete cascade;
drop index if exists new_hire_rep_logs_user_idx;
create index if not exists new_hire_rep_logs_user_idx on new_hire_rep_logs (user_id, program_key, rep_key);

comment on table new_hire_enrollments is
  'Training program assignments, one row per (person, program). Programs: '
  'web/src/lib/programs.ts (key, title, print station). Progress in '
  'new_hire_checkoffs / new_hire_rep_logs / new_hire_doc_activity, all keyed '
  'by (user_id, program_key). Status completed = certification signed.';
