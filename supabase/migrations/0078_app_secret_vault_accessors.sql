-- Migration 0078 — Vault accessors for edge-function credentials.
--
-- get_app_secret: service-role-only reader over supabase_vault. Lets an
-- edge function (email-report) fetch credentials like the Gmail app
-- password without project-level env secrets. Vault encrypts at rest.
--
-- set_app_secret: service-role-only writer, so credentials can be seeded
-- through PostgREST RPC without the value ever appearing in a migration
-- file or commit. Both are EXECUTE-revoked from anon/authenticated.
--
-- NOTE: the email-report function prefers real edge-function secrets
-- (GMAIL_USER / GMAIL_APP_PASSWORD via Dashboard → Project Settings →
-- Edge Functions); these accessors are the fallback path.

create or replace function public.get_app_secret(k text)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = k
  order by created_at desc
  limit 1;
$$;

revoke all on function public.get_app_secret(text) from public;
revoke all on function public.get_app_secret(text) from anon;
revoke all on function public.get_app_secret(text) from authenticated;
grant execute on function public.get_app_secret(text) to service_role;

create or replace function public.set_app_secret(k text, v text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform vault.create_secret(v, k);
end;
$$;

revoke all on function public.set_app_secret(text, text) from public;
revoke all on function public.set_app_secret(text, text) from anon;
revoke all on function public.set_app_secret(text, text) from authenticated;
grant execute on function public.set_app_secret(text, text) to service_role;
