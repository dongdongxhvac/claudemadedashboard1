-- Migration 0008 — Auto-link auth.users to public.users by email.
--
-- Workflow:
--   1. Admin sets users.email on the engineer row in the Admin tab.
--   2. Engineer signs in via magic link → Supabase inserts an auth.users row.
--   3. The trigger below sets public.users.auth_user_id = auth.users.id.
--   4. From then on, the engineer's session.auth.uid() resolves to their
--      public.users row, and RLS scopes their reads.
--
-- Linking is by lower(email). If admin updates the email later we re-look-up
-- against existing auth.users so the order admin-sets-email vs
-- engineer-signs-in doesn't matter.
--
-- SECURITY DEFINER so the function can write public.users.auth_user_id
-- regardless of who triggered it (the auth.users trigger runs as the
-- supabase_auth_admin role).

-- ---- A: on auth.users insert, link any matching public.users row -----------
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
  where lower(email) = lower(NEW.email)
    and auth_user_id is null;
  return NEW;
end;
$$;

drop trigger if exists trg_on_auth_user_created_link_public on auth.users;
create trigger trg_on_auth_user_created_link_public
  after insert on auth.users
  for each row execute function on_auth_user_created_link_public();

-- ---- B: on public.users.email change, look up existing auth.users ---------
create or replace function on_public_user_email_change_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.auth_user_id is not null then return NEW; end if;
  if NEW.email is null then return NEW; end if;
  -- Only act if email is new (or was null before) and there's a candidate.
  if TG_OP = 'UPDATE' and lower(coalesce(OLD.email, '')) = lower(NEW.email) then
    return NEW;
  end if;
  NEW.auth_user_id := (
    select id from auth.users where lower(email) = lower(NEW.email) limit 1
  );
  return NEW;
end;
$$;

drop trigger if exists trg_on_public_user_email_change_link on public.users;
create trigger trg_on_public_user_email_change_link
  before insert or update of email on public.users
  for each row execute function on_public_user_email_change_link();

-- ---- One-time backfill: link any existing email pairs (only Don's right now) ----
update public.users u
set auth_user_id = a.id
from auth.users a
where lower(u.email) = lower(a.email)
  and u.auth_user_id is null;
