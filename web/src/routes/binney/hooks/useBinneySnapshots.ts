// Binney St reads of the Cove snapshot tables (migration 0152 added
// site_code + the site_* views). Mirrors hooks/useCurrentSnapshots but
// scoped to site_code = 'binney' and with its own query keys, so the UPark
// realtime invalidation and the UPark views stay untouched.
//
// No realtime channel yet — the Binney pollers run hourly, so a 60 s
// refetch is plenty and avoids wiring a second Supabase channel.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { PmRow, WoRow, LaborDailyRow, PmCloseEvent } from '../../../hooks/useCurrentSnapshots';

const SITE = 'binney';
const REFETCH_MS = 60_000;

/** Open PMs from the latest Binney pm12 snapshot (paginated past the 1000-row cap). */
export function useBinneyPmRows() {
  return useQuery({
    queryKey: ['binney_pm_snapshot'],
    queryFn: async (): Promise<PmRow[]> => {
      const pageSize = 1000;
      let from = 0;
      const all: PmRow[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('site_pm_snapshot')
          .select('*')
          .eq('site_code', SITE)
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
    refetchInterval: REFETCH_MS,
  });
}

/** Open WOs from the latest Binney wo snapshot. */
export function useBinneyWoRows() {
  return useQuery({
    queryKey: ['binney_wo_snapshot'],
    queryFn: async (): Promise<WoRow[]> => {
      const { data, error } = await supabase
        .from('site_wo_snapshot')
        .select('wo_id, status, assigned_to_name, description, building_code, is_open, updated_at_cmms, submitted_date')
        .eq('site_code', SITE);
      if (error) throw error;
      return (data ?? []) as WoRow[];
    },
    staleTime: 30_000,
    refetchInterval: REFETCH_MS,
  });
}

/** Per-tech, per-ET-day labor hours for Binney (site_labor_daily). */
export function useBinneyLaborDaily(daysBack: number = 14) {
  return useQuery({
    queryKey: ['binney_labor_daily', daysBack],
    queryFn: async (): Promise<LaborDailyRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('site_labor_daily')
        .select('assigned_to_name, day_et, week_start, hours_that_day')
        .eq('site_code', SITE)
        .gte('day_et', since.toISOString().slice(0, 10));
      if (error) throw error;
      return (data ?? []) as LaborDailyRow[];
    },
    staleTime: 30_000,
    refetchInterval: REFETCH_MS,
  });
}

/** PM close events logged by the Binney pm12 poller. */
export function useBinneyPmCloses(daysBack: number = 14) {
  return useQuery({
    queryKey: ['binney_pm_close_events', daysBack],
    queryFn: async (): Promise<PmCloseEvent[]> => {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const { data, error } = await supabase
        .from('pm_close_events')
        .select('task_no, completed_on, assigned_to_name, site, building_code, pm_type, labor_hours, task_name')
        .eq('site_code', SITE)
        .gte('completed_on', since.toISOString());
      if (error) throw error;
      return (data ?? []) as PmCloseEvent[];
    },
    staleTime: 30_000,
    refetchInterval: REFETCH_MS,
  });
}

/** taken_at of the newest Binney snapshot of each kind — drives the
 *  "PM 2h · Labor < 1h" data-age meta. Null = that poller has never run. */
export function useBinneySnapshotAges() {
  return useQuery({
    queryKey: ['binney_snapshot_ages'],
    queryFn: async (): Promise<{ pm12: string | null; wo: string | null; labor: string | null }> => {
      const out = { pm12: null as string | null, wo: null as string | null, labor: null as string | null };
      for (const kind of ['pm12', 'wo', 'labor'] as const) {
        const { data, error } = await supabase
          .from('snapshots')
          .select('taken_at')
          .eq('site_code', SITE)
          .eq('kind', kind)
          .order('taken_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        out[kind] = data?.[0]?.taken_at ?? null;
      }
      return out;
    },
    staleTime: 30_000,
    refetchInterval: REFETCH_MS,
  });
}
