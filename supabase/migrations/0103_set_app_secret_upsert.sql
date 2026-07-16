-- Migration 0103 — set_app_secret: upsert instead of insert-only.
--
-- vault.create_secret() throws 23505 when the name already exists, so
-- set_app_secret could seed a secret but never CHANGE it — which breaks the
-- BINNEY_LIVE launch switch (notify-pto v19 header documents
-- `select set_app_secret('BINNEY_LIVE', 'true'|'false')` as the flip).
-- Found the moment the switch was flipped twice. Now updates in place when
-- the name exists.
--
-- Rollback: re-apply the 0078 version (create-only).

create or replace function public.set_app_secret(k text, v text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name = k;
  if sid is null then
    perform vault.create_secret(v, k);
  else
    perform vault.update_secret(sid, v);
  end if;
end;
$$;
