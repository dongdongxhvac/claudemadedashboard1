-- Migration 0017 — Every public.users row must have an engineer_profiles
-- row, regardless of role. The "profile" table holds discipline / level /
-- title / shift / notes for any user, not just engineers. Without this,
-- non-engineer users (admins, managers, clients) wouldn't appear in the
-- User Profiles tab because the join is INNER.

create or replace function ensure_engineer_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into engineer_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_engineer_profile_trg on users;
create trigger ensure_engineer_profile_trg
  after insert on users
  for each row execute function ensure_engineer_profile();

-- Backfill any existing users missing a profile (e.g. Don Lao, role=admin).
insert into engineer_profiles (user_id)
select u.id from users u
left join engineer_profiles ep on ep.user_id = u.id
where ep.user_id is null;
