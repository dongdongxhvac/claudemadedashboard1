import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PmRow = {
  snapshot_taken_at: string;
  snapshot_filename: string;
  task_no: string | null;
  due_date: string | null;
  building_code: string | null;
  equipment: string | null;
  equipment_category: string | null;
  name: string | null;
  status: string | null;
  assigned_to_name: string | null;
  est_labor_hours: number | null;
  labor_hours: number | null;
  updated_at_cmms: string | null;
  pm_type: 'Major' | 'Filter Swap' | 'Test/Record' | 'Minor' | null;
  cmms_type: string | null;
  object_id: string | null;
};

export type WoRow = {
  wo_id: string | null;
  status: string | null;
  assigned_to_name: string | null;
  description: string | null;
  building_code: string | null;
  is_open: boolean | null;
};

export type LaborRow = {
  assigned_to_name: string | null;
  labor_hours: number | null;
  week_start: string | null;
};

export function useCurrentPmRows() {
  return useQuery({
    queryKey: ['current_pm_snapshot'],
    queryFn: async (): Promise<PmRow[]> => {
      // Supabase REST caps at 1000 rows per request by default; PM snapshots are ~1300+
      // rows. Paginate with .range() until we get a short page.
      const pageSize = 1000;
      let from = 0;
      const all: PmRow[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('current_pm_snapshot')
          .select('*')
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

export function useCurrentWoRows() {
  return useQuery({
    queryKey: ['current_wo_snapshot'],
    queryFn: async (): Promise<WoRow[]> => {
      const { data, error } = await supabase
        .from('current_wo_snapshot')
        .select('*');
      if (error) throw error;
      return (data ?? []) as WoRow[];
    },
    staleTime: 30_000,
  });
}

export function useCurrentLaborRows() {
  return useQuery({
    queryKey: ['current_labor_snapshot'],
    queryFn: async (): Promise<LaborRow[]> => {
      const { data, error } = await supabase
        .from('current_labor_snapshot')
        .select('*');
      if (error) throw error;
      return (data ?? []) as LaborRow[];
    },
    staleTime: 30_000,
  });
}
