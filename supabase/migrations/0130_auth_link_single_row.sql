-- Migration 0130 — auth→public link picks ONE public.users row.
--
-- 0008's after-insert trigger on auth.users linked EVERY public.users row
-- whose email matched. users.auth_user_id is UNIQUE (0006), so two rows
-- with the same email (a seed leftover "Piotr Olszewski1", inactive, beside
-- the real row) made the second UPDATE violate the index, the auth insert
-- rolled back, and admin-invite-link returned 500 for that one person
-- (2026-09-10). Now the trigger links exactly one row: active first, then
-- the oldest — and admin-set-password / admin-invite-link's own drift
-- re-link keeps working unchanged.
--
-- Rollback: re-run the function body from 0008 (multi-row UPDATE).

create or replace function on_auth_user_created_link_public()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.email is null then return NEW; end if;
  update public.users
  set auth_user_id = NEW.id, updated_at = now()
  where id = (
    select id from public.users
    where lower(email) = lower(NEW.email)
      and auth_user_id is null
    order by active desc, created_at asc
    limit 1
  );
  return NEW;
end;
$$;
