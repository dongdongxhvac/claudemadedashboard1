-- 0112: let admins (and directors) review/publish admin proposals.
--
-- current_user_is_manager() gates the propose/publish/reject RPCs for the
-- on-call / buildings / rounds tabs (0031/0032/0034/0035/0092) and the
-- oncall_notes write policy (0033). It read ONLY users.is_manager, so a
-- role='admin' account could propose a schedule but never publish it —
-- surfaced 2026-07-28 when the admin's on-call re-anchor draft sat stuck on
-- "Withdraw" with no Publish button (and the RPC would have refused anyway).
--
-- Flipping is_manager=true on admin accounts is NOT an option: that flag
-- also drives PTO notification recipients (0094 / notify-pto) and other
-- direct users.is_manager reads. Instead widen this function to the same
-- "manager-ish" rule the credential edge functions already use:
-- is_manager OR role in ('admin', 'director').
--
-- Semantics note: the name stays (RLS policies + 6 RPCs reference it);
-- read it as "current user can act as a manager".

create or replace function current_user_is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(u.is_manager, false)
         or u.role in ('admin', 'director')
  from users u
  where u.auth_user_id = auth.uid() and u.active
  limit 1;
$$;
