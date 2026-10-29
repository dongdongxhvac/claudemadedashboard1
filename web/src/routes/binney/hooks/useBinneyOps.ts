// Binney St ops data — buildings by cluster, site_reference docs (rounds
// rotation, weekend PM plan) and weekend_plans. Migration 0154. Binney-only
// per the isolate-new-features rule; query keys are binney_-prefixed.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useBinneySiteId } from './useBinneySiteId';
import type { Cluster, PmPlan, RoundsRotation, WeekendPlan, WeekendRounds, PlanItem } from '../../../lib/binneyRounds';

const SITE = 'binney';

// ── buildings ──────────────────────────────────────────────────────────────

export type BinneyBuilding = {
  id: string;
  code: string;
  name: string;
  short_code: string | null;
  active: boolean;
  cluster: Cluster | null;
  rounds_group: string | null;
  updated_at: string | null;
};

const KEY_BUILDINGS = ['binney_buildings'];

export function useBinneyBuildings() {
  const siteQ = useBinneySiteId();
  return useQuery({
    queryKey: [...KEY_BUILDINGS, siteQ.data ?? null],
    enabled: !!siteQ.data,
    queryFn: async (): Promise<BinneyBuilding[]> => {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, code, name, short_code, active, cluster, rounds_group, updated_at')
        .eq('site_id', siteQ.data!)
        .order('code');
      if (error) throw error;
      return (data ?? []) as BinneyBuilding[];
    },
    staleTime: 60_000,
  });
}

export function useUpdateBuildingCluster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; cluster: Cluster | null; rounds_group: string | null }) => {
      const { data, error } = await supabase
        .from('buildings')
        .update({ cluster: input.cluster, rounds_group: input.rounds_group, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Not permitted to edit this building (outside your site or role scope).');
      return data[0];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_BUILDINGS }),
  });
}

// ── dedicated building engineers (building_assignments, role primary) ──────

export type BinneyDedicated = { building_id: string; building_code: string; user_id: string };

const KEY_DEDICATED = ['binney_dedicated'];

/** Open (ends_on IS NULL) primary building assignments at Binney — the
 *  "dedicated to AIP" kind of tech. Read-only here; seeded by 0154. */
export function useBinneyDedicated() {
  const siteQ = useBinneySiteId();
  return useQuery({
    queryKey: [...KEY_DEDICATED, siteQ.data ?? null],
    enabled: !!siteQ.data,
    queryFn: async (): Promise<BinneyDedicated[]> => {
      const { data, error } = await supabase
        .from('building_assignments')
        .select('building_id, user_id, role_in_building, ends_on, buildings!inner(code, site_id)')
        .eq('buildings.site_id', siteQ.data!)
        .eq('role_in_building', 'primary')
        .is('ends_on', null);
      if (error) throw error;
      type Row = { building_id: string; user_id: string; buildings: { code: string } | { code: string }[] | null };
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const b = Array.isArray(r.buildings) ? r.buildings[0] : r.buildings;
        return { building_id: r.building_id, building_code: b?.code ?? '?', user_id: r.user_id };
      });
    },
    staleTime: 60_000,
  });
}

// ── site_reference ─────────────────────────────────────────────────────────

const KEY_REF = ['binney_site_reference'];

export function useSiteReference<T>(key: 'rounds_rotation' | 'pm_plan') {
  return useQuery({
    queryKey: [...KEY_REF, key],
    queryFn: async (): Promise<{ value: T; updated_at: string } | null> => {
      const { data, error } = await supabase
        .from('site_reference')
        .select('value, updated_at')
        .eq('site_code', SITE)
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return data ? { value: data.value as T, updated_at: data.updated_at as string } : null;
    },
    staleTime: 60_000,
  });
}

export function useUpsertSiteReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: 'rounds_rotation' | 'pm_plan'; value: RoundsRotation | PmPlan }) => {
      const { data, error } = await supabase
        .from('site_reference')
        .upsert({ site_code: SITE, key: input.key, value: input.value, updated_at: new Date().toISOString() }, { onConflict: 'site_code,key' })
        .select('key');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Not permitted to edit this reference (managers at Binney and admins only).');
      return data[0];
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [...KEY_REF, vars.key] }),
  });
}

// ── weekend_plans ──────────────────────────────────────────────────────────

const KEY_PLANS = ['binney_weekend_plans'];

export function useWeekendPlans(limit = 26) {
  return useQuery({
    queryKey: [...KEY_PLANS, limit],
    queryFn: async (): Promise<WeekendPlan[]> => {
      const { data, error } = await supabase
        .from('weekend_plans')
        .select('*')
        .eq('site_code', SITE)
        .order('weekend_start', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as WeekendPlan[];
    },
    staleTime: 30_000,
  });
}

export type WeekendPlanInput = {
  id?: string;
  weekend_start: string;
  manager_on_call: string | null;
  notes: PlanItem[];
  rounds: WeekendRounds;
  saturday_items: PlanItem[];
  sunday_items: PlanItem[];
  reminders: PlanItem[];
};

export function useUpsertWeekendPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WeekendPlanInput) => {
      const row = { ...input, site_code: SITE, updated_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from('weekend_plans')
        .upsert(row, { onConflict: 'site_code,weekend_start' })
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Not permitted to save weekend plans (managers at Binney and admins only).');
      return data[0];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PLANS }),
  });
}

export function useDeleteWeekendPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('weekend_plans').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Not permitted to delete this plan.');
      return data[0];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_PLANS }),
  });
}
