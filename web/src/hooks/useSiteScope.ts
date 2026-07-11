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
