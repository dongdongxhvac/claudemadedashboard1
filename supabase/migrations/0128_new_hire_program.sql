-- Migration 0128 — New-hire 8-week program (Plan B): the mentor's sign-off
-- sheet made live. User Profiles rehaul, phase 1.
--
-- The PROGRAM itself (8 weeks × verified items, 9 PM reps @ 2×, 2 LOTO
-- evals, weekly COVE audits, Level-1 certification) is a code-defined
-- constant — web/src/lib/newHireProgram.ts — transcribed from
-- seed/… → web/public/training/new-hire/new_hire_8_week_plan.html
-- (the printed schedule + sign-off sheet). Item keys are stable strings
-- ('w2.chiller_36', 'rep.exhaust_fan', 'cove.4', 'cert.mentor'); only
-- PROGRESS lives in the DB. Moving the definition into a table later is a
-- mechanical import of the same keys.
--
-- Three tables, all additive, nothing on engineer_profiles changes
-- (cove_user_id / cmms_assignee_name untouched — pollers unaffected):
--
--   new_hire_enrollments  one row per enrolled user: program key, start
--                         date, mentor, status. PK = user_id (one active
--                         program per person; re-enrolling resets).
--   new_hire_checkoffs    (user_id, item_key) presence = verified. Carries
--                         who verified, when, and a note. Used for the
--                         weekly items, weekly initials ('week.N'), COVE
--                         audits ('cove.N') and cert signatures ('cert.X').
--   new_hire_rep_logs     one row per completed rep / eval occurrence
--                         ('rep.water_treatment', 'eval.loto'), with date
--                         + note (building, mentor, job). Count = tally.
--
-- Who writes: admin anywhere; managers (current_user_can_manage_users) and
-- leads for people homed at their own site (same fence as 0125); and the
-- enrollment's MENTOR for their own new hire regardless of role — the
-- mentor is usually a senior engineer, not a lead. The new hire themselves
-- only reads (it's a mentor record; their own signature is recorded by the
-- mentor from the paper sheet). Everyone authenticated can read.

-- ── enrollments ───────────────────────────────────────────────────────────

create table if not exists new_hire_enrollments (
  user_id          uuid primary key references users(id) on delete cascade,
  program_key      text not null default 'upark_l1_plan_b',
  start_date       date,
  mentor_user_id   uuid references users(id) on delete set null,
  status           text not null default 'active'
                   check (status in ('active', 'completed', 'paused', 'withdrawn')),
  notes            text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table new_hire_enrollments is
  'New-hire training program enrollment (one per user). Program definition '
  'lives in web/src/lib/newHireProgram.ts; progress in new_hire_checkoffs / '
  'new_hire_rep_logs. Status completed = Level-1 certification signed.';

create index if not exists new_hire_enrollments_mentor_idx
  on new_hire_enrollments (mentor_user_id);

-- updated_at bump (reuses the app's convention of a tiny per-table trigger)
create or replace function new_hire_enrollments_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists new_hire_enrollments_touch_trg on new_hire_enrollments;
create trigger new_hire_enrollments_touch_trg
  before update on new_hire_enrollments
  for each row execute function new_hire_enrollments_touch();

-- ── helper: may the caller edit this person's program? ───────────────────
-- (Defined AFTER new_hire_enrollments: SQL-language bodies are validated at
--  CREATE time, so the table it reads must already exist.)

create or replace function current_user_can_edit_new_hire(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- admin: anywhere
    coalesce(current_user_role() = 'admin', false)
    -- manager / lead: own site only (NULL home site = UPark, as in 0125)
    or (
      (coalesce(current_user_can_manage_users(), false) or coalesce(current_user_is_lead(), false))
      and user_home_site_id(p_user_id) = current_user_home_site_id()
    )
    -- the assigned mentor, for their own new hire
    or exists (
      select 1
        from new_hire_enrollments e
        join users me on me.auth_user_id = auth.uid() and me.active
       where e.user_id = p_user_id
         and e.mentor_user_id = me.id
    );
$$;
revoke all on function current_user_can_edit_new_hire(uuid) from public;
grant execute on function current_user_can_edit_new_hire(uuid) to authenticated;

-- ── check-offs ────────────────────────────────────────────────────────────

create table if not exists new_hire_checkoffs (
  user_id      uuid not null references new_hire_enrollments(user_id) on delete cascade,
  item_key     text not null,
  done_at      timestamptz not null default now(),
  verified_by  uuid references users(id) on delete set null,
  note         text,
  primary key (user_id, item_key)
);

comment on table new_hire_checkoffs is
  'Presence of (user_id, item_key) = that program item is verified. Keys: '
  'wN.<item> weekly verified items, week.N weekly initials, cove.N weekly '
  'COVE ≥35h audit, cert.new_hire|mentor|manager certification signatures.';

-- ── rep / eval logs ───────────────────────────────────────────────────────

create table if not exists new_hire_rep_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references new_hire_enrollments(user_id) on delete cascade,
  rep_key      text not null,
  occurred_on  date not null default current_date,
  note         text,
  logged_by    uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table new_hire_rep_logs is
  'One row per completed PM rep / LOTO eval occurrence (rep.<name>, '
  'eval.loto). Tally per key vs the program target (2×).';

create index if not exists new_hire_rep_logs_user_idx
  on new_hire_rep_logs (user_id, rep_key);

-- ── RLS ───────────────────────────────────────────────────────────────────

alter table new_hire_enrollments enable row level security;
alter table new_hire_checkoffs   enable row level security;
alter table new_hire_rep_logs    enable row level security;

drop policy if exists nhe_read  on new_hire_enrollments;
drop policy if exists nhe_write on new_hire_enrollments;
create policy nhe_read on new_hire_enrollments
  for select to authenticated using (true);
-- Enrolling (INSERT) has no mentor row yet, so the mentor clause can't
-- apply — only admin / own-site manager / own-site lead may enroll.
-- UPDATE/DELETE additionally admit the mentor (via the helper).
create policy nhe_write on new_hire_enrollments
  for all to authenticated
  using (current_user_can_edit_new_hire(user_id))
  with check (current_user_can_edit_new_hire(user_id));

drop policy if exists nhc_read  on new_hire_checkoffs;
drop policy if exists nhc_write on new_hire_checkoffs;
create policy nhc_read on new_hire_checkoffs
  for select to authenticated using (true);
create policy nhc_write on new_hire_checkoffs
  for all to authenticated
  using (current_user_can_edit_new_hire(user_id))
  with check (current_user_can_edit_new_hire(user_id));

drop policy if exists nhr_read  on new_hire_rep_logs;
drop policy if exists nhr_write on new_hire_rep_logs;
create policy nhr_read on new_hire_rep_logs
  for select to authenticated using (true);
create policy nhr_write on new_hire_rep_logs
  for all to authenticated
  using (current_user_can_edit_new_hire(user_id))
  with check (current_user_can_edit_new_hire(user_id));

grant select, insert, update, delete on new_hire_enrollments, new_hire_checkoffs, new_hire_rep_logs to authenticated;
grant all on new_hire_enrollments, new_hire_checkoffs, new_hire_rep_logs to service_role;
