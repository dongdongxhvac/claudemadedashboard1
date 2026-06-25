-- Migration 0084 — recreate the missing rounds_notes table.
--
-- The table from migration 0036 is absent in the live DB (its
-- create-table never persisted), which 404'd useRoundsNotes(). Because
-- RoundsTab's seed effect bails unless BOTH rounds and notes load, the
-- compose draft never seeded → editing showed a blank round set even
-- though 6 live rounds exist. The publish_rounds_proposal RPC also
-- writes here, so publishing was broken too (published_ever = 0).

create table if not exists rounds_notes (
  slot               int primary key check (slot in (1,2)),
  body               text not null default '',
  updated_at         timestamptz not null default now(),
  updated_by_user_id uuid references users(id)
);

insert into rounds_notes (slot) values (1), (2)
  on conflict (slot) do nothing;

alter table rounds_notes enable row level security;

drop policy if exists "rounds_notes_auth_select" on rounds_notes;
create policy "rounds_notes_auth_select" on rounds_notes
  for select to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table rounds_notes;
exception when duplicate_object then null;
end $$;
