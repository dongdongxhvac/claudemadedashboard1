-- Migration 0165 — master switch for writing to Cove from the dashboard. OFF.
--
-- Decision 2026-11-18 (management, liability): the dashboard must not write
-- to Cove. The only write path is the "Assign PMs · Cove" panel (0156):
-- panel → pm_assign_requests → pm_assign_watcher.py → Cove UpdatePMTask.
-- Nothing is deleted. One Vault flag turns every layer off, and back on:
--
--     COVE_WRITE_ENABLED   'true' = on · anything else, or missing = OFF
--
--   * cove_write_enabled()   the single read of that flag (fail closed);
--   * pm_assign_requests     refuses every INSERT while it is off — a
--                            trigger, so it holds for the service role too,
--                            plus the same test in the RLS policy;
--   * the panel              calls cove_write_enabled() and renders nothing;
--   * pm_assign_watcher.py   calls it first and never contacts Cove.
--
-- To switch it back on (only on an explicit management decision):
--     select set_app_secret('COVE_WRITE_ENABLED', 'true');
-- and re-enable the VM timer (watcher/README.md). To switch off again:
--     select set_app_secret('COVE_WRITE_ENABLED', 'false');
--
-- Reading Cove (the pm12 / wo12 / labor / escort pollers) is not affected.

begin;

create or replace function public.cove_write_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret = 'true'
       from vault.decrypted_secrets
      where name = 'COVE_WRITE_ENABLED'
      order by created_at desc
      limit 1),
    false);
$$;

comment on function public.cove_write_enabled() is
  'Master switch for dashboard → Cove writes (Vault COVE_WRITE_ENABLED = ''true''). Off unless explicitly on. See migration 0165.';

revoke all on function public.cove_write_enabled() from public;
revoke all on function public.cove_write_enabled() from anon;
grant execute on function public.cove_write_enabled() to authenticated;
grant execute on function public.cove_write_enabled() to service_role;

-- No new request can be queued while the switch is off — whoever asks.
create or replace function public.pm_assign_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.cove_write_enabled() then
    raise exception 'Writing to Cove from the dashboard is switched off (COVE_WRITE_ENABLED).'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists pm_assign_requests_guard on public.pm_assign_requests;
create trigger pm_assign_requests_guard
  before insert on public.pm_assign_requests
  for each row execute function public.pm_assign_requests_guard();

drop policy if exists pm_assign_insert on public.pm_assign_requests;
create policy pm_assign_insert on public.pm_assign_requests
  for insert to authenticated
  with check (public.cove_write_enabled() and public.current_user_can_manage_users() and status = 'pending');

-- Anything still waiting is closed out so the watcher has nothing to pick up.
update public.pm_assign_requests
   set status = 'error', finished_at = now(),
       detail = 'Not sent: writing to Cove from the dashboard was switched off on 2026-11-18.'
 where status in ('pending', 'running');

-- The flag itself, explicitly off.
select public.set_app_secret('COVE_WRITE_ENABLED', 'false');

commit;
