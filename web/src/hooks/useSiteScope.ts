// Site scope for the UPark-side panels (§12 PtoPanel, CoverageForecastPanel).
//
// The Binney St seed (migration 0093) put a second site's engineers into the
// shared users/engineer_profiles tables. UPark's panels list/count ALL
// engineers, so without a filter every Binney tech would appear in UPark's
// staffing roll, balances and coverage forecast. This hook returns the set of
// user_ids homed at UPark; consumers filter their lists with it.
//
// NULL home_site_id is treated as UPark on purpose: migration 0072 backfilled
// every pre-existing row to UPark, but the UPark admin add-user flow leaves
// the column NULL for newly added people — excluding them would silently hide
// a new UPark hire from the roll.
//
// Fails OPEN: while loading (or if the sites lookup errors) it returns
// undefined and consumers render unfiltered, matching pre-scope behavior.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type SiteCode = 'upark' | 'binney';

/** Who can see which site's manager/admin pages.
 *  - admin + director roam every site (canSeeAllSites)
 *  - everyone else is fenced to their engineer_profiles.home_site
 *  - NULL home_site_id resolves to 'upark' (same historical-default rule as
 *    useUparkUserIds below)
 *  Navigation-level gating only — RLS stays role-based. */
export function useMySiteAccess(): {
  isLoading: boolean;
  canSeeAllSites: boolean;
  homeSite: SiteCode;
  /** The viewer's home site UUID (falls back to the UPark id when unhomed). */
  homeSiteId: string | null;
} {
  const q = useQuery({
    queryKey: ['my_site_access'],
    queryFn: async (): Promise<{ role: string | null; homeSiteCode: string | null; homeSiteId: string | null }> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { role: null, homeSiteCode: null, homeSiteId: null };
      const [meRes, sitesRes] = await Promise.all([
        supabase
          .from('users')
          .select('role, engineer_profiles(home_site_id)')
          .eq('auth_user_id', auth.user.id)
          .maybeSingle(),
        supabase.from('sites').select('id, code'),
      ]);
      if (meRes.error) throw meRes.error;
      if (sitesRes.error) throw sitesRes.error;
      type EpRow = { home_site_id: string | null };
      const raw = meRes.data as { role: string; engineer_profiles: EpRow | EpRow[] | null } | null;
      const ep = Array.isArray(raw?.engineer_profiles) ? raw?.engineer_profiles[0] : raw?.engineer_profiles;
      const codeById = new Map((sitesRes.data ?? []).map((s) => [s.id as string, s.code as string]));
      const uparkId = (sitesRes.data ?? []).find((s) => s.code === 'upark')?.id ?? null;
      return {
        role: raw?.role ?? null,
        homeSiteCode: ep?.home_site_id ? (codeById.get(ep.home_site_id) ?? null) : null,
        homeSiteId: ep?.home_site_id ?? (uparkId as string | null),
      };
    },
    staleTime: 60_000,
  });
  const role = q.data?.role;
  return {
    isLoading: q.isLoading,
    canSeeAllSites: role === 'admin' || role === 'director',
    homeSite: q.data?.homeSiteCode === 'binney' ? 'binney' : 'upark',
    homeSiteId: q.data?.homeSiteId ?? null,
  };
}

/** Resolve a site code ('upark' | 'binney') to its UUID. undefined while
 *  loading, null when the sites row is missing. */
export function useSiteIdByCode(code: SiteCode | undefined): string | null | undefined {
  const q = useQuery({
    queryKey: ['site_id_by_code', code ?? null],
    enabled: !!code,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('sites').select('id').eq('code', code!).maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    staleTime: Infinity,
  });
  if (!code) return undefined;
  return q.isLoading ? undefined : (q.data ?? null);
}

/** Home-site code of ANOTHER user (public.users id). NULL home_site_id — or a
 *  missing profile — resolves to 'upark', the historical default. Used by the
 *  engineer profile page's site fence. */
export function useHomeSiteCodeOf(userId: string | null | undefined): {
  isLoading: boolean;
  siteCode: SiteCode | null;
} {
  const q = useQuery({
    queryKey: ['home_site_of', userId ?? null],
    enabled: !!userId,
    queryFn: async (): Promise<string | null> => {
      const [profRes, sitesRes] = await Promise.all([
        supabase.from('engineer_profiles').select('home_site_id').eq('user_id', userId!).maybeSingle(),
        supabase.from('sites').select('id, code'),
      ]);
      if (profRes.error) throw profRes.error;
      if (sitesRes.error) throw sitesRes.error;
      const codeById = new Map((sitesRes.data ?? []).map((s) => [s.id as string, s.code as string]));
      return profRes.data?.home_site_id ? (codeById.get(profRes.data.home_site_id) ?? null) : null;
    },
    staleTime: 60_000,
  });
  return {
    isLoading: !!userId && q.isLoading,
    siteCode: q.isLoading ? null : q.data === 'binney' ? 'binney' : 'upark',
  };
}

/** Building ids homed at UPark (NULL site_id = UPark, matching the 0072
 *  backfill default). Used to keep the shared /buildings KB index — and any
 *  other UPark-facing building list — free of other sites' rows. Fails open
 *  (undefined) while loading. */
export function useUparkBuildingIds(): Set<string> | undefined {
  const q = useQuery({
    queryKey: ['upark_building_ids'],
    queryFn: async (): Promise<string[]> => {
      const [siteRes, bldgRes] = await Promise.all([
        supabase.from('sites').select('id').eq('code', 'upark').maybeSingle(),
        supabase.from('buildings').select('id, site_id'),
      ]);
      if (siteRes.error) throw siteRes.error;
      if (bldgRes.error) throw bldgRes.error;
      const uparkId = siteRes.data?.id ?? null;
      return (bldgRes.data ?? [])
        .filter((b) => b.site_id === null || (uparkId !== null && b.site_id === uparkId))
        .map((b) => b.id as string);
    },
    staleTime: 60_000,
  });
  return useMemo(() => (q.data ? new Set(q.data) : undefined), [q.data]);
}

export function useUparkUserIds(): Set<string> | undefined {
  const q = useQuery({
    queryKey: ['upark_user_ids'],
    queryFn: async (): Promise<string[]> => {
      const [siteRes, profRes] = await Promise.all([
        supabase.from('sites').select('id').eq('code', 'upark').maybeSingle(),
        supabase.from('engineer_profiles').select('user_id, home_site_id'),
      ]);
      if (siteRes.error) throw siteRes.error;
      if (profRes.error) throw profRes.error;
      const uparkId = siteRes.data?.id ?? null;
      return (profRes.data ?? [])
        .filter((p) => p.home_site_id === null || (uparkId !== null && p.home_site_id === uparkId))
        .map((p) => p.user_id as string);
    },
    staleTime: 60_000,
  });
  return useMemo(() => (q.data ? new Set(q.data) : undefined), [q.data]);
}
