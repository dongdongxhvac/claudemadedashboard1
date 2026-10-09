-- 0139 — Tracker: per-engineer log + professional traits + skills checklist.
--
-- Replaces the Profile / Training links in the admin roster and the engineer
-- header (user 2026-10-09). Three small tables, all keyed by users.id:
--
--   tracker_entries   one row per thing an engineer did, dated. kind:
--                       shop · reading · wo · problem · pm · event
--                     spirit — the manager's call on HOW it was done:
--                       straight    — did the assigned job, straightforward
--                       help_team   — stepped up / volunteered / helped the team
--                     recorded_by is who wrote it (the engineer themselves or
--                     a lead/manager); status self → verified like work_records.
--   tracker_traits    one row per (user, trait): the "licensed tech is a
--                     professional" scorecard, 0-4 per trait + note. Trait keys
--                     live in web/src/lib/tracker.ts (learning, follow_direction,
--                     reliable, communication, responsibility, skills,
--                     experience, knowledge). Only leads/managers write.
--   tracker_skills    one row per (user, skill): the hands-on checklist
--                     (actuator replacement, LOTO, belt tension SOP, …). Skill
--                     keys live in web/src/lib/tracker.ts. status:
--                       not_started · learning · done · verified
--                     sop_text holds the write-up for "write down SOP" items.
--
-- Access reuses 0133's helpers: current_user_can_view_career(user_id) to read,
-- current_user_can_edit_career(user_id) to write; the person always reads
-- their own rows and may add/edit their own UNVERIFIED entries.

-- ── tracker_entries ──────────────────────────────────────────────────────

create table if not exists tracker_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  occurred_on   date not null default current_date,
  kind          text not null check (kind in ('shop','reading','wo','problem','pm','event')),
  title         text not null check (length(title) between 1 and 160),
  spirit        text check (spirit in ('straight','help_team')),
  note          text check (note is null or length(note) <= 2000),
  status        text not null default 'self' check (status in ('self','verified')),
  verified_by   uuid references users(id) on delete set null,
  verified_at   timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tracker_entries_verified_stamp check (
    (status = 'verified' and verified_by is not null and verified_at is not null)
    or (status = 'self' and verified_by is null and verified_at is null)
  )
);

create index if not exists tracker_entries_user_date_idx on tracker_entries (user_id, occurred_on desc);

drop trigger if exists tracker_entries_set_updated_at on tracker_entries;
create trigger tracker_entries_set_updated_at
  before update on tracker_entries
  for each row execute function tg_work_records_set_updated_at();

alter table tracker_entries enable row level security;

drop policy if exists te_read on tracker_entries;
create policy te_read on tracker_entries
  for select to authenticated
  using (user_id = current_user_id() or current_user_can_view_career(user_id));

drop policy if exists te_insert on tracker_entries;
create policy te_insert on tracker_entries
  for insert to authenticated
  with check (
    (user_id = current_user_id() and status = 'self' and created_by = current_user_id())
    or current_user_can_edit_career(user_id)
  );

drop policy if exists te_update on tracker_entries;
create policy te_update on tracker_entries
  for update to authenticated
  using ((user_id = current_user_id() and status = 'self') or current_user_can_edit_career(user_id))
  with check ((user_id = current_user_id() and status = 'self') or current_user_can_edit_career(user_id));

drop policy if exists te_delete on tracker_entries;
create policy te_delete on tracker_entries
  for delete to authenticated
  using ((user_id = current_user_id() and status = 'self') or current_user_can_edit_career(user_id));

grant select, insert, update, delete on tracker_entries to authenticated;

-- ── tracker_traits ───────────────────────────────────────────────────────

create table if not exists tracker_traits (
  user_id     uuid not null references users(id) on delete cascade,
  trait       text not null check (length(trait) between 1 and 40),
  score       smallint check (score is null or score between 0 and 4),
  note        text check (note is null or length(note) <= 1000),
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, trait)
);

drop trigger if exists tracker_traits_set_updated_at on tracker_traits;
create trigger tracker_traits_set_updated_at
  before update on tracker_traits
  for each row execute function tg_work_records_set_updated_at();

alter table tracker_traits enable row level security;

drop policy if exists tt_read on tracker_traits;
create policy tt_read on tracker_traits
  for select to authenticated
  using (user_id = current_user_id() or current_user_can_view_career(user_id));

drop policy if exists tt_write on tracker_traits;
create policy tt_write on tracker_traits
  for insert to authenticated
  with check (current_user_can_edit_career(user_id));

drop policy if exists tt_update on tracker_traits;
create policy tt_update on tracker_traits
  for update to authenticated
  using (current_user_can_edit_career(user_id))
  with check (current_user_can_edit_career(user_id));

drop policy if exists tt_delete on tracker_traits;
create policy tt_delete on tracker_traits
  for delete to authenticated
  using (current_user_can_edit_career(user_id));

grant select, insert, update, delete on tracker_traits to authenticated;

-- ── tracker_skills ───────────────────────────────────────────────────────

create table if not exists tracker_skills (
  user_id     uuid not null references users(id) on delete cascade,
  skill       text not null check (length(skill) between 1 and 60),
  status      text not null default 'not_started' check (status in ('not_started','learning','done','verified')),
  done_on     date,
  sop_text    text check (sop_text is null or length(sop_text) <= 8000),
  note        text check (note is null or length(note) <= 1000),
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, skill)
);

drop trigger if exists tracker_skills_set_updated_at on tracker_skills;
create trigger tracker_skills_set_updated_at
  before update on tracker_skills
  for each row execute function tg_work_records_set_updated_at();

alter table tracker_skills enable row level security;

drop policy if exists ts_read on tracker_skills;
create policy ts_read on tracker_skills
  for select to authenticated
  using (user_id = current_user_id() or current_user_can_view_career(user_id));

-- the person may write their own row as long as it is not marked verified
-- (the SOP write-up is theirs to type); leads/managers write anything
drop policy if exists ts_write on tracker_skills;
create policy ts_write on tracker_skills
  for insert to authenticated
  with check (
    (user_id = current_user_id() and status <> 'verified')
    or current_user_can_edit_career(user_id)
  );

drop policy if exists ts_update on tracker_skills;
create policy ts_update on tracker_skills
  for update to authenticated
  using ((user_id = current_user_id() and status <> 'verified') or current_user_can_edit_career(user_id))
  with check ((user_id = current_user_id() and status <> 'verified') or current_user_can_edit_career(user_id));

drop policy if exists ts_delete on tracker_skills;
create policy ts_delete on tracker_skills
  for delete to authenticated
  using (current_user_can_edit_career(user_id));

grant select, insert, update, delete on tracker_skills to authenticated;
