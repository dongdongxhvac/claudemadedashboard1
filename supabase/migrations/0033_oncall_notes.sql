-- Migration 0033 — Editable sticky notes for the On-call tab header.
--
-- 3 fixed slots (numbered 1..3) that admin/lead/manager can edit inline.
-- Used as a scratch area for context that doesn't fit in a proposal note:
-- standing PTOs, swap reminders, coverage caveats, etc.
--
-- Read: any authenticated user.
-- Write: admin OR lead OR manager (same group that can propose changes).

create table if not exists oncall_notes (
  slot               int primary key check (slot in (1,2,3)),
  body               text not null default '',
  updated_at         timestamptz not null default now(),
  updated_by_user_id uuid references users(id)
);

-- Seed the 3 fixed rows idempotently
insert into oncall_notes (slot) values (1), (2), (3)
  on conflict (slot) do nothing;

alter table oncall_notes enable row level security;

create policy "oncall_notes_auth_select" on oncall_notes
  for select to authenticated using (true);

create policy "oncall_notes_admin_lead_manager_write" on oncall_notes
  for all to authenticated
  using       (current_user_role() = 'admin' or current_user_is_lead() or current_user_is_manager())
  with check  (current_user_role() = 'admin' or current_user_is_lead() or current_user_is_manager());

alter publication supabase_realtime add table oncall_notes;
