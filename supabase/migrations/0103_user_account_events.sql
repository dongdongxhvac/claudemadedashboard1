-- 0103 — User account activity log (invite links, password sets, sign-ins).
--
-- Backs the "Account activity" panel + admin activity feed in the User
-- Profiles tabs (both sites) and the Last sign-in column.
--
--   * Credential events are written ONLY by the service role (edge functions
--     admin-invite-link / admin-set-password) — no client insert policy.
--   * Sign-ins are recorded by a trigger on auth.users: GoTrue bumps
--     last_sign_in_at on every real sign-in (password, magic link, invite
--     acceptance), and this project's auth.audit_log_entries is empty
--     (audit retention off), so the trigger is the reliable source.
--   * Reads are gated to admin/manager/director roles or the is_manager
--     permission flag — matching the invite-link feature's actor gate.

create table public.user_account_events (
  id             uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.users(id) on delete cascade,
  actor_user_id  uuid references public.users(id) on delete set null,
  event          text not null check (event in (
    'invite_link_generated', 'reset_link_generated',
    'password_set', 'auth_account_created', 'signed_in'
  )),
  detail         text,
  created_at     timestamptz not null default now()
);

create index user_account_events_target_idx
  on public.user_account_events (target_user_id, created_at desc);
create index user_account_events_created_idx
  on public.user_account_events (created_at desc);

alter table public.user_account_events enable row level security;

-- Managers+ can read; nobody writes from the client (service role bypasses RLS).
create policy user_account_events_manager_read on public.user_account_events
  for select using (
    exists (
      select 1 from public.users me
      where me.auth_user_id = auth.uid()
        and me.active
        and (me.role in ('admin','manager','director') or me.is_manager)
    )
  );

-- Record a sign-in whenever GoTrue bumps last_sign_in_at.
create or replace function public.on_auth_user_signin_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pub_id uuid;
begin
  select id into pub_id from public.users where auth_user_id = new.id;
  if pub_id is not null then
    insert into public.user_account_events (target_user_id, event)
    values (pub_id, 'signed_in');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_signin_log_trg
  after update of last_sign_in_at on auth.users
  for each row
  when (old.last_sign_in_at is distinct from new.last_sign_in_at)
  execute function public.on_auth_user_signin_log();

-- Last sign-in per user, for the User Profiles table column. SECURITY DEFINER
-- because auth.users is not client-readable; internally gated to managers+.
create or replace function public.get_auth_activity()
returns table (user_id uuid, last_sign_in_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select u.id, au.last_sign_in_at
  from public.users u
  join auth.users au on au.id = u.auth_user_id
  where exists (
    select 1 from public.users me
    where me.auth_user_id = auth.uid()
      and me.active
      and (me.role in ('admin','manager','director') or me.is_manager)
  );
$$;

grant execute on function public.get_auth_activity() to authenticated;
