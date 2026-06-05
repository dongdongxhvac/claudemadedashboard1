import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Training-view data hooks. These are intentionally SEPARATE from the shared
// useBuildings / useEngineers hooks: those have no site columns and are used
// all over the app, so per the isolate-new-features rule we don't touch them.
// Everything here is read-only mirroring of existing dashboard data, grouped
// by site. All site-dependent queries require migration 0072 (sites table +
// buildings.site_id + engineer_profiles.home_site_id); callers gate them on
// useSites() succeeding so nothing crashes before the migration is applied.

export type Site = {
  id: string;
  code: string;       // 'upark' | 'binney'
  name: string;
  sort_order: number;
};

export type TrainingBuilding = {
  id: string;
  code: string;
  short_code: string | null;
  name: string;
  client_company: string | null;
  site_id: string | null;
};

export type TrainingTech = {
  user_id: string;
  full_name: string;
  email: string | null;
  discipline: string | null;
  level: number;
  title: string | null;
  is_lead: boolean;
  home_site_id: string | null;
};

/** Sites list. Fails fast (retry: false) when the table doesn't exist yet so
 *  the page can show a "apply 0072" setup note instead of spinning. */
export function useSites() {
  return useQuery({
    queryKey: ['training', 'sites'],
    queryFn: async (): Promise<Site[]> => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, code, name, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Site[];
    },
    retry: false,
    staleTime: 10 * 60_000,
  });
}

export function useTrainingBuildings(enabled: boolean) {
  return useQuery({
    queryKey: ['training', 'buildings'],
    enabled,
    queryFn: async (): Promise<TrainingBuilding[]> => {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, code, short_code, name, client_company, site_id')
        .eq('active', true)
        .order('short_code', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as TrainingBuilding[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useTrainingRoster(enabled: boolean) {
  return useQuery({
    queryKey: ['training', 'roster'],
    enabled,
    queryFn: async (): Promise<TrainingTech[]> => {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, full_name, email, role,
          engineer_profiles!inner ( discipline, level, title, is_lead, home_site_id )
        `)
        .eq('role', 'engineer')
        .order('full_name');
      if (error) throw error;
      type EP = {
        discipline: string | null;
        level: number;
        title: string | null;
        is_lead: boolean;
        home_site_id: string | null;
      };
      type Row = {
        id: string;
        full_name: string;
        email: string | null;
        engineer_profiles: EP | EP[] | null;
      };
      return (data as unknown as Row[]).map((r) => {
        const ep = Array.isArray(r.engineer_profiles) ? r.engineer_profiles[0] : r.engineer_profiles;
        return {
          user_id: r.id,
          full_name: r.full_name,
          email: r.email,
          discipline: ep?.discipline ?? null,
          level: ep?.level ?? 1,
          title: ep?.title ?? null,
          is_lead: ep?.is_lead ?? false,
          home_site_id: ep?.home_site_id ?? null,
        } satisfies TrainingTech;
      });
    },
    staleTime: 60_000,
  });
}
