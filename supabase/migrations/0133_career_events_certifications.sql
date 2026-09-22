-- Migration 0133 — Career timeline + certifications on the engineer profile.
--
-- Per user 2026-09-22: "make profile and training as career/event tracker".
-- The profile (/engineer/:id/profile) gets a dated, newest-first CAREER
-- TIMELINE and a MILESTONES & CERTIFICATIONS card. Most timeline rows are
-- derived client-side from tables that already exist (users.hiring_date,
-- new_hire_* training records, pm_completions, oncall_rotations, overtime
-- signups, PTO counts, user_account_events — web/src/lib/careerTimeline.ts).
-- Two things need storage of their own:
--
--   career_events   dated per-person events: free-form rows written by
--                   admins / managers / leads ("promoted to Lead",
--                   "commendation from tenant") and rows written by a
--                   trigger on engineer_profiles whenever level, title or
--                   discipline changes (old → new in meta) — those changes
--                   had no date until now.
--   certifications  one row per license / certification (EPA 608, OSHA,
--                   boiler / HVAC license …) with issued / expiry dates and
--                   an optional scanned file in the PRIVATE storage bucket
--                   'certifications' (path <user_id>/<uuid>.<ext>).
--
-- Visibility (per user): the person themself — only while their profile is
-- shared (engineer_profiles.visible_to_self) — plus admin / manager /
-- director / lead. Rows marked visibility = 'managers' are for manager-ish
-- eyes only (current_user_can_manage_users(): is_manager or role in
-- manager / admin / director) — never the person, never a plain lead.
-- Writes: admin anywhere; manager / lead for people homed at their own site
-- (same fence as 0125 / 0128). No mentor clause — a mentor signs training,
-- not careers.
--
-- engineer_profiles.badges / .certifications (0006) stay as they are: unused
-- by any writer, superseded by these tables.
--
-- Rollback: drop trigger engineer_profiles_career_log_trg on engineer_profiles;
-- drop function engineer_profiles_career_log(); drop table certifications;
-- drop table career_events; drop the four "certifications_*" policies on
-- storage.objects and delete from storage.buckets where id = 'certifications';
-- drop function current_user_can_edit_career(uuid), current_user_can_view_career(uuid).

-- ── helpers ───────────────────────────────────────────────────────────────

create or replace function current_user_can_view_career(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    coalesce(current_user_role() in ('admin', 'manager', 'director'), false)
    or coalesce(current_user_can_manage_users(), false)
    or coalesce(current_user_is_lead(), false)
    -- the person, while their profile is shared with them
    or exists (
      select 1 from engineer_profiles ep
       where ep.user_id = p_user_id
         and ep.user_id = current_user_id()
         and ep.visible_to_self
    );
$$;
revoke all on function current_user_can_view_career(uuid) from public;
grant execute on function current_user_can_view_career(uuid) to authenticated;

create or replace function current_user_can_edit_career(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    coalesce(current_user_role() = 'admin', false)
    or (
      (coalesce(current_user_can_manage_users(), false) or coalesce(current_user_is_lead(), false))
      and user_home_site_id(p_user_id) = current_user_home_site_id()
    );
$$;
revoke all on function current_user_can_edit_career(uuid) from public;
grant execute on function current_user_can_edit_career(uuid) to authenticated;

-- ── career_events ─────────────────────────────────────────────────────────

create table if not exists career_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  kind         text not null,                         -- level | title | discipline | promotion | award | note | custom …
  occurred_on  date not null default current_date,
  title        text not null,
  detail       text,
  meta         jsonb not null default '{}'::jsonb,    -- trigger rows: {field, old, new, xp?}
  visibility   text not null default 'public' check (visibility in ('public', 'managers')),
  created_by   uuid references users(id) on delete set null,   -- null = system (trigger under the service role)
  created_at   timestamptz not null default now()
);

comment on table career_events is
  'Dated per-person career events for the profile timeline: admin / manager / lead '
  'free-form rows + engineer_profiles trigger rows (level / title / discipline '
  'changes, old→new in meta). Derived events (training, PMs, on-call …) are '
  'computed client-side in web/src/lib/careerTimeline.ts, not stored.';

create index if not exists career_events_user_idx
  on career_events (user_id, occurred_on desc, created_at desc);

-- level / title / discipline changes → dated rows. Runs under the XP watcher
-- (service role, auth.uid() null → created_by null) as well as admin edits.
create or replace function engineer_profiles_career_log()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.level is distinct from old.level then
    insert into career_events (user_id, kind, title, meta, created_by)
    values (new.user_id, 'level', format('Level %s → %s', old.level, new.level),
            jsonb_build_object('field', 'level', 'old', old.level, 'new', new.level, 'xp', new.xp),
            current_user_id());
  end if;
  if new.title is distinct from old.title then
    insert into career_events (user_id, kind, title, meta, created_by)
    values (new.user_id, 'title', format('Title: %s', coalesce(new.title, '—')),
            jsonb_build_object('field', 'title', 'old', old.title, 'new', new.title),
            current_user_id());
  end if;
  if new.discipline is distinct from old.discipline then
    insert into career_events (user_id, kind, title, meta, created_by)
    values (new.user_id, 'discipline', format('Discipline: %s', coalesce(new.discipline, '—')),
            jsonb_build_object('field', 'discipline', 'old', old.discipline, 'new', new.discipline),
            current_user_id());
  end if;
  return new;
end;
$$;

-- trigger-only: not callable through the API
revoke all on function engineer_profiles_career_log() from public, anon, authenticated;

drop trigger if exists engineer_profiles_career_log_trg on engineer_profiles;
create trigger engineer_profiles_career_log_trg
  after update of level, title, discipline on engineer_profiles
  for each row execute function engineer_profiles_career_log();

alter table career_events enable row level security;
drop policy if exists ce_read   on career_events;
drop policy if exists ce_write  on career_events;
drop policy if exists ce_insert on career_events;
drop policy if exists ce_update on career_events;
drop policy if exists ce_delete on career_events;

-- NB: one policy per command, never "for all" — a FOR ALL policy's USING
-- clause also grants SELECT, which would let a same-site lead read the
-- managers-only rows the read policy hides from them.
create policy ce_read on career_events
  for select to authenticated
  using (
    current_user_can_view_career(user_id)
    and (visibility = 'public' or coalesce(current_user_can_manage_users(), false))
  );

create policy ce_insert on career_events
  for insert to authenticated
  with check (
    current_user_can_edit_career(user_id)
    and (visibility = 'public' or coalesce(current_user_can_manage_users(), false))
  );

create policy ce_update on career_events
  for update to authenticated
  using (
    current_user_can_edit_career(user_id)
    and (visibility = 'public' or coalesce(current_user_can_manage_users(), false))
  )
  with check (
    current_user_can_edit_career(user_id)
    and (visibility = 'public' or coalesce(current_user_can_manage_users(), false))
  );

create policy ce_delete on career_events
  for delete to authenticated
  using (
    current_user_can_edit_career(user_id)
    and (visibility = 'public' or coalesce(current_user_can_manage_users(), false))
  );

grant select, insert, update, delete on career_events to authenticated;
grant all on career_events to service_role;

-- ── certifications ────────────────────────────────────────────────────────

create table if not exists certifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null,                       -- "EPA 608 Universal"
  issuer       text,                                -- "EPA", "OSHA", "Mass. Board of …"
  number       text,                                -- license / certificate number
  issued_on    date,
  expires_on   date,                                -- null = does not expire
  file_path    text,                                -- storage bucket 'certifications': <user_id>/<uuid>.<ext>
  note         text,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint certifications_dates_chk
    check (issued_on is null or expires_on is null or expires_on >= issued_on)
);

comment on table certifications is
  'Licenses / certifications per person — the profile''s Milestones & '
  'certifications card and the roster''s expiring line. '
  'engineer_profiles.certifications text[] (0006) is legacy and unused.';

create index if not exists certifications_user_idx   on certifications (user_id, expires_on);
create index if not exists certifications_expiry_idx on certifications (expires_on) where expires_on is not null;

create or replace function certifications_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists certifications_touch_trg on certifications;
create trigger certifications_touch_trg
  before update on certifications
  for each row execute function certifications_touch();

alter table certifications enable row level security;
drop policy if exists cert_read   on certifications;
drop policy if exists cert_write  on certifications;
drop policy if exists cert_insert on certifications;
drop policy if exists cert_update on certifications;
drop policy if exists cert_delete on certifications;

create policy cert_read on certifications
  for select to authenticated
  using (current_user_can_view_career(user_id));

create policy cert_insert on certifications
  for insert to authenticated
  with check (current_user_can_edit_career(user_id));

create policy cert_update on certifications
  for update to authenticated
  using (current_user_can_edit_career(user_id))
  with check (current_user_can_edit_career(user_id));

create policy cert_delete on certifications
  for delete to authenticated
  using (current_user_can_edit_career(user_id));

grant select, insert, update, delete on certifications to authenticated;
grant all on certifications to service_role;

-- ── storage: private bucket for scanned certificates ──────────────────────
-- Path convention <user_id>/<uuid>.<ext> lets the policies resolve the person
-- from the object name; a malformed path fails the uuid cast → rejected.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certifications', 'certifications', false, 15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "certifications_read"   on storage.objects;
drop policy if exists "certifications_insert" on storage.objects;
drop policy if exists "certifications_update" on storage.objects;
drop policy if exists "certifications_delete" on storage.objects;

create policy "certifications_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'certifications'
         and public.current_user_can_view_career(((storage.foldername(name))[1])::uuid));

create policy "certifications_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'certifications'
              and public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid));

create policy "certifications_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'certifications'
         and public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'certifications'
              and public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid));

create policy "certifications_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'certifications'
         and public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid));
