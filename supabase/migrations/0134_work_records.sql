-- 0134 — Work records: engineers record their own day-to-day, leads verify.
--
-- Backs the rebuilt engineer profile (2026-09-23): everything on that page is
-- a dated entry of what was done, at which building, and how independently.
-- Rolled up per building × task for job distribution; read top-to-bottom for
-- career check-ins. Nothing is a typed-in score.
--
--   work_records      one row per entry. kind:
--                       knowledge  — building HVAC set-up explained (in the
--                                    office, hand drawing presented) or a
--                                    plant walk; no independence mark
--                       skill      — a task done (motor/pump rebuild, alignment,
--                                    cooling tower cleaning support, BMS op…)
--                       problem    — troubleshooting / no-SOP problem solved
--                       major_pm   — major off-hour PM or off-hour repair
--                       training   — a course / program completed
--                     independence (skill / problem / major_pm only):
--                       with_lead · solo · solo_clean (solo, no operation
--                       interruption — the "rule of thumb" bar from training)
--                     status: self (recorded by the engineer, unverified) →
--                       verified (lead / manager confirmed; stamps verified_by).
--   ot_availability   one row per engineer: days they're usually available for
--                     OT, nights / early yes-no, preferred notice. Set by the
--                     engineer on their own page; counts come from §11 posts.
--   storage bucket    'work-records' (PRIVATE): <user_id>/<uuid>.<ext> — the
--                     photo of the hand drawing / the job. Same path→person
--                     rule as the 'certifications' bucket (0133).
--
-- Access reuses 0133's helpers:
--   current_user_can_view_career(user_id) — admin/manager/director, leads,
--     user-managers, or the person while visible_to_self. Work records ADD
--     "the person themselves, always" — an engineer must see what they
--     recorded even before their profile is shared with them.
--   current_user_can_edit_career(user_id) — admin, or same-site manager/lead.
--     Only these can verify.

-- ── work_records ─────────────────────────────────────────────────────────

create table if not exists work_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  occurred_on   date not null default current_date,
  building_id   uuid references buildings(id) on delete set null,
  kind          text not null check (kind in ('knowledge','skill','problem','major_pm','training')),
  task          text not null check (length(task) between 1 and 160),
  independence  text check (independence in ('with_lead','solo','solo_clean')),
  note          text check (note is null or length(note) <= 2000),
  photo_path    text,                       -- storage bucket 'work-records'
  status        text not null default 'self' check (status in ('self','verified')),
  verified_by   uuid references users(id) on delete set null,
  verified_at   timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- knowledge / training entries carry no independence mark
  constraint work_records_independence_kind check (
    (kind in ('knowledge','training') and independence is null)
    or kind in ('skill','problem','major_pm')
  ),
  -- verified rows must say who / when; self rows must not
  constraint work_records_verified_stamp check (
    (status = 'verified' and verified_by is not null and verified_at is not null)
    or (status = 'self' and verified_by is null and verified_at is null)
  )
);

create index if not exists work_records_user_date_idx on work_records (user_id, occurred_on desc);
create index if not exists work_records_building_idx  on work_records (building_id);

create or replace function tg_work_records_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists work_records_set_updated_at on work_records;
create trigger work_records_set_updated_at
  before update on work_records
  for each row execute function tg_work_records_set_updated_at();

alter table work_records enable row level security;

-- read: career viewers, or the person themselves (always)
drop policy if exists wr_read on work_records;
create policy wr_read on work_records
  for select to authenticated
  using (user_id = current_user_id() or current_user_can_view_career(user_id));

-- insert: the person records themselves (status must be 'self', created_by =
-- them), or a same-site lead/manager records for them (any status)
drop policy if exists wr_insert on work_records;
create policy wr_insert on work_records
  for insert to authenticated
  with check (
    (user_id = current_user_id() and status = 'self' and created_by = current_user_id())
    or current_user_can_edit_career(user_id)
  );

-- update: the person may edit their own UNVERIFIED rows and cannot verify;
-- leads/managers may edit anything for their site, including verifying
drop policy if exists wr_update on work_records;
create policy wr_update on work_records
  for update to authenticated
  using (
    (user_id = current_user_id() and status = 'self')
    or current_user_can_edit_career(user_id)
  )
  with check (
    (user_id = current_user_id() and status = 'self')
    or current_user_can_edit_career(user_id)
  );

drop policy if exists wr_delete on work_records;
create policy wr_delete on work_records
  for delete to authenticated
  using (
    (user_id = current_user_id() and status = 'self')
    or current_user_can_edit_career(user_id)
  );

grant select, insert, update, delete on work_records to authenticated;

-- ── ot_availability ───────────────────────────────────────────────────────

create table if not exists ot_availability (
  user_id     uuid primary key references users(id) on delete cascade,
  days        text[] not null default '{}',   -- subset of {mon,tue,wed,thu,fri,sat,sun}
  nights      boolean not null default false,
  early       boolean not null default false, -- before 6am
  notice      text check (notice is null or length(notice) <= 80),
  note        text check (note is null or length(note) <= 500),
  updated_at  timestamptz not null default now(),
  constraint ot_availability_days_valid check (days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[])
);

drop trigger if exists ot_availability_set_updated_at on ot_availability;
create trigger ot_availability_set_updated_at
  before update on ot_availability
  for each row execute function tg_work_records_set_updated_at();

alter table ot_availability enable row level security;

drop policy if exists ota_read on ot_availability;
create policy ota_read on ot_availability
  for select to authenticated
  using (user_id = current_user_id() or current_user_can_view_career(user_id));

drop policy if exists ota_write on ot_availability;
create policy ota_write on ot_availability
  for insert to authenticated
  with check (user_id = current_user_id() or current_user_can_edit_career(user_id));

drop policy if exists ota_update on ot_availability;
create policy ota_update on ot_availability
  for update to authenticated
  using (user_id = current_user_id() or current_user_can_edit_career(user_id))
  with check (user_id = current_user_id() or current_user_can_edit_career(user_id));

grant select, insert, update on ot_availability to authenticated;

-- ── storage: private bucket for record photos (hand drawings, the job) ────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-records', 'work-records', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "work_records_read"   on storage.objects;
drop policy if exists "work_records_insert" on storage.objects;
drop policy if exists "work_records_update" on storage.objects;
drop policy if exists "work_records_delete" on storage.objects;

create policy "work_records_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'work-records'
         and (((storage.foldername(name))[1])::uuid = current_user_id()
              or public.current_user_can_view_career(((storage.foldername(name))[1])::uuid)));

create policy "work_records_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'work-records'
              and (((storage.foldername(name))[1])::uuid = current_user_id()
                   or public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid)));

create policy "work_records_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'work-records'
         and (((storage.foldername(name))[1])::uuid = current_user_id()
              or public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid)))
  with check (bucket_id = 'work-records'
              and (((storage.foldername(name))[1])::uuid = current_user_id()
                   or public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid)));

create policy "work_records_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'work-records'
         and (((storage.foldername(name))[1])::uuid = current_user_id()
              or public.current_user_can_edit_career(((storage.foldername(name))[1])::uuid)));
