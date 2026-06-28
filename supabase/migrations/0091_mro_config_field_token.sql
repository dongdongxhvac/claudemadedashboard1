-- Migration 0091 — MRO config (lets the field link be managed in-app).
--
-- Small key/value store so admins/managers can enable / rotate / disable
-- the login-free field-capture token from the dashboard instead of a
-- Supabase env secret. The field-upload function reads the token via the
-- service role (bypasses RLS); admins read it to build the share link.

create table if not exists mro_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table mro_config enable row level security;

create policy "mro_config_billing" on mro_config
  for all to authenticated
  using (mro_can_bill()) with check (mro_can_bill());
