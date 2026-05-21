// Fetches the current engineer's own PMs + WOs from current snapshots,
// plus their engineer_profile (for cmms_assignee_name + visible_to_self).
// Client-side filtering by assignee name — Phase 3 RLS tightening is a
// follow-up; current RLS is permissive (any authenticated user reads all).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { PmRow, WoRow, LaborRow, PmCloseEvent } from './useCurrentSnapshots';

export type MyContext = {
  user_id: string;
  cmms_assignee_name: string | null;
  visible_to_self: boolean;
  discipline: string | null;
  level: number;
  xp: number;
};

/** Lookup the current user's engineer_profile (returns null if they're not an engineer). */
export function useMyEngineerContext() {
  return useQuery({
    queryKey: ['my_engineer_context'],
    queryFn: async (): Promise<MyContext | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;

      const { data: u, error: ue } = await supabase
        .from('users')
        .select('id, role, engineer_profiles!inner(cmms_assignee_name, visible_to_self, discipline, level, xp)')
        .eq('auth_user_id', auth.user.id)
        .eq('role', 'engineer')
        .maybeSingle();
      if (ue) throw ue;
      if (!u) return null;

      const raw = (u as { engineer_profiles: unknown }).engineer_profiles;
      const ep = (Array.isArray(raw) ? raw[0] : raw) as {
        cmms_assignee_name: string | null;
        visible_to_self: boolean;
        discipline: string | null;
        level: number;
        xp: number;
      };
      return {
        user_id: (u as { id: string }).id,
        cmms_assignee_name: ep.cmms_assignee_name,
        visible_to_self: ep.visible_to_self,
        discipline: ep.discipline,
        level: ep.level,
        xp: ep.xp,
      };
    },
    staleTime: 60_000,
  });
}

/** Current PM snapshot rows filtered to the given assignee. */
export function useMyPmRows(cmmsName: string | null | undefined) {
  return useQuery({
    queryKey: ['my_pm_rows', cmmsName],
    enabled: !!cmmsName,
    queryFn: async (): Promise<PmRow[]> => {
      const pageSize = 1000;
      let from = 0;
      const all: PmRow[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('current_pm_snapshot')
          .select('*')
          .eq('assigned_to_name', cmmsName!)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as PmRow[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    staleTime: 30_000,
  });
}

/** Current WO snapshot rows filtered to the given assignee. */
export function useMyWoRows(cmmsName: string | null | undefined) {
  return useQuery({
    queryKey: ['my_wo_rows', cmmsName],
    enabled: !!cmmsName,
    queryFn: async (): Promise<WoRow[]> => {
      const { data, error } = await supabase
        .from('current_wo_snapshot')
        .select('*')
        .eq('assigned_to_name', cmmsName!);
      if (error) throw error;
      return (data ?? []) as WoRow[];
    },
    staleTime: 30_000,
  });
}

/** PM close events for the given assignee in the last N days. Replaces the
 *  pre-Phase-5.5 pattern of filtering current_pm_snapshot by status='Completed'
 *  (which no longer returns Completed rows after the schema split). */
export function useMyPmCloses(cmmsName: string | null | undefined, daysBack: number = 14) {
  return useQuery({
    queryKey: ['my_pm_closes', cmmsName, daysBack],
    enabled: !!cmmsName,
    queryFn: async (): Promise<PmCloseEvent[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('pm_close_events')
        .select('task_no, completed_on, assigned_to_name, site, building_code, pm_type, labor_hours, task_name')
        .eq('assigned_to_name', cmmsName!)
        .gte('completed_on', since.toISOString());
      if (error) throw error;
      return (data ?? []) as PmCloseEvent[];
    },
    staleTime: 30_000,
  });
}

/** Current Labor snapshot rows filtered to the given assignee. */
export function useMyLaborRows(cmmsName: string | null | undefined) {
  return useQuery({
    queryKey: ['my_labor_rows', cmmsName],
    enabled: !!cmmsName,
    queryFn: async (): Promise<LaborRow[]> => {
      const { data, error } = await supabase
        .from('current_labor_snapshot')
        .select('*')
        .eq('assigned_to_name', cmmsName!);
      if (error) throw error;
      return (data ?? []) as LaborRow[];
    },
    staleTime: 30_000,
  });
}
