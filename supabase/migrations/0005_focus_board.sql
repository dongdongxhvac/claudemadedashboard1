-- Migration 0005 — focus_board_items (Phase 2, table G subset).
-- A unified pinned-items feed; Phase 2 wires only the "announcement" kind via UI,
-- but the schema is the full plan version so future kinds (alarm/priority/reminder)
-- and targeting fields land without another migration.

create table if not exists focus_board_items (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'announcement'
                 check (kind in ('announcement','alarm','priority','reminder')),
  title        text,
  body         text not null,
  level        text not null default 'info'
                 check (level in ('info','warn','urgent','critical')),
  pinned       boolean not null default false,
  starts_at    timestamptz default now(),
  expires_at   timestamptz,
  target_buildings uuid[],
  target_users     uuid[],
  meta         jsonb,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists focus_board_items_starts_at_idx
  on focus_board_items(starts_at desc, created_at desc);

alter table focus_board_items enable row level security;

-- Phase 2: any authenticated user can read and write. Phase 3 narrows this
-- (engineers + clients = read; managers + admins = full CRUD).
create policy "phase2_auth_select" on focus_board_items
  for select to authenticated using (true);
create policy "phase2_auth_insert" on focus_board_items
  for insert to authenticated with check (true);
create policy "phase2_auth_update" on focus_board_items
  for update to authenticated using (true) with check (true);
create policy "phase2_auth_delete" on focus_board_items
  for delete to authenticated using (true);

alter publication supabase_realtime add table focus_board_items;
