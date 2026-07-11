// Binney St site lookup. Migration 0072 creates the sites row with
// gen_random_uuid(), so the UUID differs per environment and must never be
// hardcoded — resolve it at runtime from sites.code = 'binney'. Cached
// indefinitely (site rows don't change), one retry on transient failure.
//
// data === undefined → still loading. data === null → sites table has no
// 'binney' row (broken seed); consumers should render a friendly empty state.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export function useBinneySiteId() {
  return useQuery({
    queryKey: ['binney_site_id'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('sites')
        .select('id')
        .eq('code', 'binney')
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    staleTime: Infinity,
    retry: 1,
  });
}
