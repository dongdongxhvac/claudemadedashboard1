import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsMobile } from './useIsMobile';

export type Me = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  full_name: string;
  role: 'engineer' | 'manager' | 'client' | 'admin' | 'director' | 'tv';
  access_level: number;
  hiring_date: string | null;
  avatar_url: string | null;
  active: boolean;
  preferences: Record<string, unknown>;
  is_lead: boolean;
  is_manager: boolean;
};

/** An auth error that means "nobody is signed in" rather than "couldn't
 *  ask": no stored session, or the server rejected the token outright.
 *  Anything else (DNS, Wi-Fi still coming up, a 5xx, a timeout) is
 *  transient and must surface as a query error so React Query retries —
 *  returning null for those stranded the wall on the wrong board (2026-10-30:
 *  the Pi booted with the session not yet refreshable, `me` settled as null,
 *  TvLayoutGate fell back to the URL's board and never asked again). */
function isSignedOutError(e: { name?: string; status?: number }): boolean {
  if (e.name === 'AuthSessionMissingError') return true;
  return e.name === 'AuthApiError' && (e.status === 401 || e.status === 403);
}

/** Fetch the current authenticated user's row in public.users. Null when not
 *  signed in or not linked. `resilient` is for the wall: keep retrying a
 *  failed lookup (short backoff), re-ask every 30 s until a profile is in
 *  hand, and again on reconnect, so a flaky boot can't pin the kiosk to a
 *  board the admin page has switched off. */
export function useMe(opts?: { resilient?: boolean }) {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr && !isSignedOutError(authErr)) throw authErr;
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from('users')
        .select('*, engineer_profiles(is_lead)')
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown> & {
        engineer_profiles: { is_lead: boolean } | { is_lead: boolean }[] | null;
      };
      const ep = Array.isArray(row.engineer_profiles) ? row.engineer_profiles[0] : row.engineer_profiles;
      return { ...(row as unknown as Me), is_lead: ep?.is_lead ?? false };
    },
    staleTime: 60_000,
    ...(opts?.resilient ? {
      retry: 6,
      retryDelay: (attempt: number) => Math.min(10_000, 1000 * 2 ** attempt),
      refetchOnReconnect: true,
      // Poll fast while there is no profile (boot race, network blip); once
      // one is in hand the realtime subscription + the hourly check carry it.
      refetchInterval: (q: { state: { data?: Me | null } }) => (q.state.data ? 60 * 60_000 : 30_000),
    } : {}),
  });
}

export function useIsAdmin(): boolean {
  return useMe().data?.role === 'admin';
}

export function useIsManager(): boolean {
  return useMe().data?.is_manager === true;
}

/** How much of the User Profiles roster the current user may edit.
 *    'all'       — admin: any user, any role.
 *    'engineers' — manager-ish (role manager/director, or is_manager flag):
 *                  may add + edit ENGINEER users only. Mirrors the DB policies
 *                  users_manager_insert_engineer / users_manager_update_engineer
 *                  (migration 0124) — the UI locks the role picker to
 *                  Engineer, the DB refuses anything else.
 *    'none'      — everyone else (leads get view-only).
 *  Kept as a fixed value derived from the row, not a boolean, so callers
 *  can't accidentally treat "can add engineers" as "can add admins". */
export type ManageScope = 'all' | 'engineers' | 'none';
export function manageScopeFor(me: { role: string; is_manager?: boolean | null } | null | undefined): ManageScope {
  if (!me) return 'none';
  if (me.role === 'admin') return 'all';
  if (me.role === 'manager' || me.role === 'director' || me.is_manager === true) return 'engineers';
  return 'none';
}

/** Admin OR a lead engineer — the audience for the Admin panel (read/write
 *  capabilities still gated per-tab via canEditUsers). */
export function useCanAccessAdmin(): boolean {
  const me = useMe().data;
  if (!me) return false;
  return me.role === 'admin' || me.is_lead === true;
}

/** Buildings-KB edit gate: admin/lead AND a desk-size viewport. Phones are
 *  read-only on /buildings (per user 2026-07-29) — the KB's edit affordances
 *  are desktop-density, and shop edits belong on a PC. Scope: the /buildings
 *  surface only; dashboard/admin panels keep plain useCanAccessAdmin. */
export function useCanEditBuildings(): boolean {
  const canAccessAdmin = useCanAccessAdmin();
  const isMobile = useIsMobile();
  return canAccessAdmin && !isMobile;
}

/** Who may OPEN the /admin page at all — mirrors Admin.tsx's canAccess
 *  (admin | lead | manager-ish, managers view-only). Used for the header
 *  "Admin" link on the manager pages. Deliberately separate from
 *  useCanAccessAdmin above, which many panels use as an EDIT gate — widening
 *  that one would hand managers edit powers across the buildings KB. */
export function useCanOpenAdminPage(): boolean {
  const me = useMe().data;
  if (!me) return false;
  return me.role === 'admin' || me.role === 'manager' || me.role === 'director'
    || me.is_manager === true || me.is_lead === true;
}
