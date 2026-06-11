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
  updated_at_cmms: string | null;
  submitted_date: string | null;
};

/** Days since the WO's last Cove update (updated_at_cmms, falling back
 *  to submitted_date). Null when neither timestamp exists. */
export function woDaysSinceUpdate(r: WoRow, now: Date = new Date()): number | null {
  const ts = r.updated_at_cmms ?? r.submitted_date;
  if (!ts) return null;
  const ms = now.getTime() - new Date(ts).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

/** Flag threshold shared by §02, /tv, and the watcher email (v_wo_stale). */
export const WO_STALE_DAYS = 7;

export function isWoStale(r: WoRow, now: Date = new Date()): boolean {
  const d = woDaysSinceUpdate(r, now);
  return d !== null && d >= WO_STALE_DAYS;
}

export type LaborRow = {
  assigned_to_name: string | null;
  labor_hours: number | null;
  week_start: string | null;
  snapshot_taken_at: string | null;
};

// One row per (tech, ET day). Hours actually logged that day, derived from
// labor_rows end-of-day cumulative deltas. See labor_daily view DDL.
export type LaborDailyRow = {
  assigned_to_name: string | null;
  day_et: string;           // YYYY-MM-DD
  week_start: string;       // YYYY-MM-DD
  hours_that_day: number;
};

export type PmCloseEvent = {
  task_no: string | null;
  completed_on: string;     // ISO timestamp
  assigned_to_name: string | null;
  site: string | null;
  building_code: string | null;
  pm_type: string | null;
  labor_hours: number | null;
  task_name: string | null;
};

// Closed PMs where both estimated and actual labor are populated.
// Negative variance = closed faster than estimated; positive = took longer.
export type PmVarianceRow = {
  task_no: string | null;
  task_name: string | null;
  assigned_to_name: string | null;
  site: string | null;
  building_code: string | null;
  pm_type: string | null;
  est_labor_hours: number;
  labor_hours: number;
  variance_hours: number;
  variance_pct: number | null;
  completed_on: string;
};

export type WoCloseEvent = {
  wo_id: string | null;
  completed_on: string;
  assigned_to_name: string | null;
  building_code: string | null;
  category: string | null;
  description: string | null;
  billable_total: number | null;
  labor_hours: number | null;
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

// Per-tech, per-ET-day actual labor hours. Use this (not useCurrentLaborRows)
// for any rolling-window math — current_labor_snapshot returns cumulative WTD
// totals which double-count when summed across overlapping weeks.
export function useLaborDaily(daysBack: number = 40) {
  return useQuery({
    queryKey: ['labor_daily', daysBack],
    queryFn: async (): Promise<LaborDailyRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('labor_daily')
        .select('*')
        .gte('day_et', sinceStr);
      if (error) throw error;
      return (data ?? []) as LaborDailyRow[];
    },
    staleTime: 30_000,
  });
}

// PM closes with both estimated and actual labor hours, for actual-vs-estimate
// analysis. Returns at most `daysBack` of history.
export function usePmVariance(daysBack: number = 30) {
  return useQuery({
    queryKey: ['pm_variance_recent', daysBack],
    queryFn: async (): Promise<PmVarianceRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('pm_variance_recent')
        .select('*')
        .gte('completed_on', since.toISOString())
        .order('completed_on', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PmVarianceRow[];
    },
    staleTime: 60_000,
  });
}

// WO close events log. Mirrors useRecentPmCloses but for work orders.
export function useRecentWoCloses(daysBack: number = 40) {
  return useQuery({
    queryKey: ['wo_close_events', daysBack],
    queryFn: async (): Promise<WoCloseEvent[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('wo_close_events')
        .select('wo_id, completed_on, assigned_to_name, building_code, category, description, billable_total, labor_hours')
        .gte('completed_on', since.toISOString())
        .order('completed_on', { ascending: false });
      if (error) throw error;
      return (data ?? []) as WoCloseEvent[];
    },
    staleTime: 30_000,
  });
}

// PM close events log. Replaces "filter pm_rows by status=Completed" — that
// table no longer holds completed rows after the Phase 5.5 schema split.
export function useRecentPmCloses(daysBack: number = 40) {
  return useQuery({
    queryKey: ['pm_close_events', daysBack],
    queryFn: async (): Promise<PmCloseEvent[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('pm_close_events')
        .select('task_no, completed_on, assigned_to_name, site, building_code, pm_type, labor_hours, task_name')
        .gte('completed_on', since.toISOString());
      if (error) throw error;
      return (data ?? []) as PmCloseEvent[];
    },
    staleTime: 30_000,
  });
}
