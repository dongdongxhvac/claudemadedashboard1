-- Migration 0131 — New-hire training: engineer activity on handouts.
--
-- The 8-week program (0128) records what the MENTOR verifies. This adds the
-- engineer's own trail on the handouts served from /training/…:
--
--   new_hire_doc_activity   one row per event, self-recorded from the engineer
--                           training page (/upark/training/new-hire):
--                             kind = 'opened' — the handout was opened in the
--                                    viewer (at most one row per doc per day)
--                             kind = 'quiz'   — a handout quiz was fully
--                                    answered: score / total + the inner
--                                    document title
--
-- Per-handout MENTOR sign-off needs no schema: new_hire_checkoffs.item_key is
-- free-form and now also carries 'doc.<key>.reviewed' / 'doc.<key>.quiz'
-- (same RLS as every other check-off — admin / own-site manager+lead / mentor).
--
-- The handout list itself lives in web/public/training/manifest.json (doc
-- keys are permanent; activity + check-offs are keyed on them).
--
-- No FK to new_hire_enrollments: handouts and quizzes are open to every
-- engineer, enrolled or not.

-- ── helper: the caller's public.users.id ──────────────────────────────────
-- Same family as current_user_role() / current_user_home_site_id(); body
-- mirrors mro_current_user_id() (0090).
create or replace function current_user_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from users where auth_user_id = auth.uid() and active limit 1;
$$;
revoke all on function current_user_id() from public;
grant execute on function current_user_id() to authenticated;

-- ── activity ──────────────────────────────────────────────────────────────

create table if not exists new_hire_doc_activity (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  program_key  text not null default 'upark_l1_plan_b',
  doc_key      text not null,                        -- manifest doc key
  kind         text not null check (kind in ('opened', 'quiz')),
  quiz_title   text not null default '',             -- inner document <title>
  score        int  check (score >= 0),
  total        int  check (total > 0),
  day          date not null default current_date,   -- dedupe key for 'opened'
  at           timestamptz not null default now(),
  constraint new_hire_doc_activity_quiz_has_score
    check (kind <> 'quiz' or (score is not null and total is not null and score <= total))
);

comment on table new_hire_doc_activity is
  'Engineer self-recorded activity on new-hire handouts (manifest doc keys): '
  'opened (once per doc per day) and quiz (score/total, fully answered). '
  'Mentor verification stays in new_hire_checkoffs (doc.<key>.reviewed / .quiz).';

create index if not exists new_hire_doc_activity_user_idx
  on new_hire_doc_activity (user_id, doc_key, at desc);

create unique index if not exists new_hire_doc_activity_opened_once_a_day
  on new_hire_doc_activity (user_id, doc_key, day)
  where kind = 'opened';

-- ── RLS ───────────────────────────────────────────────────────────────────

alter table new_hire_doc_activity enable row level security;

drop policy if exists nhda_read   on new_hire_doc_activity;
drop policy if exists nhda_insert on new_hire_doc_activity;
drop policy if exists nhda_delete on new_hire_doc_activity;

-- Everyone authenticated can read (mentors/managers see the trail; the
-- roster can show a pill without N+1) — same as 0128.
create policy nhda_read on new_hire_doc_activity
  for select to authenticated using (true);

-- Only your own rows, and only as yourself.
create policy nhda_insert on new_hire_doc_activity
  for insert to authenticated
  with check (user_id = current_user_id());

-- Cleanup of a bogus attempt: whoever may edit this person's program.
create policy nhda_delete on new_hire_doc_activity
  for delete to authenticated
  using (current_user_can_edit_new_hire(user_id));

grant select, insert, delete on new_hire_doc_activity to authenticated;
grant all on new_hire_doc_activity to service_role;
