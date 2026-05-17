-- Migration 0011 — Clear auth_user_id when admin changes the email on an
-- already-linked user. Without this, changing email on a linked user leaves
-- auth_user_id pointing at the OLD auth.users row, and the engineer can't
-- sign in with the new email (trigger A requires auth_user_id IS NULL to link).
--
-- Trigger order: this trigger ('trg_clear_...') runs BEFORE
-- 'trg_on_public_user_email_change_link' (Postgres BEFORE triggers fire in
-- alphabetical order: 'c' < 'o'). So:
--   1. clear_auth_link_on_email_change clears auth_user_id when email changes
--   2. on_public_user_email_change_link then looks for an auth.users row
--      with the NEW email and links if found
-- Net effect: changing the email gracefully unlinks the old auth account and
-- re-links to a new one if it exists, otherwise leaves auth_user_id null
-- pending the next sign-in with the new email.

create or replace function clear_auth_link_on_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.auth_user_id is not null
     and OLD.email is distinct from NEW.email
     and NEW.email is not null
  then
    NEW.auth_user_id := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_clear_auth_link_on_email_change on users;
create trigger trg_clear_auth_link_on_email_change
  before update of email on users
  for each row execute function clear_auth_link_on_email_change();
