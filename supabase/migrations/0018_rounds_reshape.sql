-- Migration 0018 — Phase 4 step 6: rounds reshape for multi-building walks.
--
-- The original `rounds` table (migration 0012) modeled a round as ONE building
-- with a checklist. Real operations are different: an engineer walks several
-- buildings in sequence ("morning route"). Reshape:
--   * drop rounds.building_id (table is empty)
--   * add rounds.shift_id + sort_order
--   * new table round_stops (round_id, building_id, sequence)
--   * partial unique index: at most one open assignment per round
--
-- After this, rounds + round_assignments + round_stops together represent:
--   "Engineer X walks buildings [A, B, C] during the 7am shift."

-- 1) Drop the legacy single-building FK. rounds has 0 rows in prod.
alter table rounds drop column if exists building_id;

-- 2) Tie a round to a shift + give it a stable position in the UI.
alter table rounds add column if not exists shift_id   uuid references shifts(id) on delete set null;
alter table rounds add column if not exists sort_order int  not null default 0;

create index if not exists rounds_shift_idx on rounds(shift_id, sort_order) where active;

-- 3) Multi-building stops in sequence.
create table if not exists round_stops (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  building_id  uuid not null references buildings(id) on delete cascade,
  sequence     int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (round_id, building_id)
);
create index if not exists round_stops_round_idx on round_stops(round_id, sequence);

alter table round_stops enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'p4_auth_select' and tablename = 'round_stops') then
    create policy "p4_auth_select" on round_stops for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'p4_admin_write' and tablename = 'round_stops') then
    create policy "p4_admin_write" on round_stops for all to authenticated
      using (current_user_role() = 'admin')
      with check (current_user_role() = 'admin');
  end if;
end $$;

-- 4) Add round_stops to realtime publication (idempotent).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'round_stops'
  ) then
    alter publication supabase_realtime add table round_stops;
  end if;
end $$;

-- 5) Enforce at most one open assignment per round. (round_assignments already
--    has unique(round_id, user_id, starts_on) from 0012 — that prevents dup
--    same-day inserts but doesn't enforce single-engineer-per-round.)
create unique index if not exists round_assignments_one_open_idx
  on round_assignments(round_id) where ends_on is null;
