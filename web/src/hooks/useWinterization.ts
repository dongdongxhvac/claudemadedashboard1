// Winterization — the shop's "Cold Weather Prep" whiteboard as data
// (migrations 0145 / 0146 / 0147). One row per building task per season;
// each task has a KIND and a STATUS that follows the season:
//   drain  — todo → drained (fall) → filled (spring)      a drain-down
//   mode   — todo → winter  (fall) → summer (spring)      88's CT make-up float
// status_at / status_by record the last change. TV2's Winterization tile
// reads the current season; the UPark manager page's card sets statuses
// and adds / removes tasks.
//
// Separate from every other hook on purpose (isolate-new-features rule):
// its own query key, its own realtime channel.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';

export type WinterizationKind = 'drain' | 'mode';
export type WinterizationStatus = 'todo' | 'filled' | 'drained' | 'summer' | 'winter';

/** In season order: not started → fall state → spring state. */
export const WINTERIZATION_STATUSES: Record<WinterizationKind, WinterizationStatus[]> = {
  drain: ['todo', 'drained', 'filled'],
  mode:  ['todo', 'winter', 'summer'],
};
export const WINTERIZATION_STATUS_LABEL: Record<WinterizationStatus, string> = {
  todo: 'To do', filled: 'Filled', drained: 'Drained', summer: 'Summer mode', winter: 'Winter mode',
};
/** The winterized states — what the wall counts as done for the season. */
export function isWinterized(status: WinterizationStatus): boolean {
  return status === 'drained' || status === 'winter';
}
/** Colour family for a status: 'wait' = still to do, 'good' = winterized,
 *  'off' = back in its spring / summer state. */
export function winterizationTone(status: WinterizationStatus): 'wait' | 'good' | 'off' {
  if (status === 'todo') return 'wait';
  return isWinterized(status) ? 'good' : 'off';
}

export type WinterizationTask = {
  id: string;
  season: string;
  building_code: string;
  task: string;
  sort_order: number;
  kind: WinterizationKind;
  status: WinterizationStatus;
  status_at: string | null;
  status_by: string | null;
  status_by_name: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** The winter season a date belongs to: Aug–Jul, named by its first year
 *  ("2026-27"). August is early enough that the fall list exists before the
 *  first cold snap and late enough that last winter's list has aged out. */
export function currentWinterSeason(now: Date = new Date()): string {
  const y = now.getFullYear();
  const start = now.getMonth() >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const KEY = ['winterization_tasks'];

export function useWinterizationTasks(season: string) {
  return useQuery({
    queryKey: [...KEY, season],
    queryFn: async (): Promise<WinterizationTask[]> => {
      const { data, error } = await supabase
        .from('winterization_tasks')
        .select('id, season, building_code, task, sort_order, kind, status, status_at, status_by, note, created_at, updated_at, status_by_user:status_by(full_name)')
        .eq('season', season)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      type Row = Omit<WinterizationTask, 'status_by_name'> & {
        status_by_user: { full_name: string } | { full_name: string }[] | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const u = Array.isArray(r.status_by_user) ? r.status_by_user[0] : r.status_by_user;
        const { status_by_user: _drop, ...rest } = r;
        void _drop;
        return { ...rest, status_by_name: u?.full_name ?? null };
      });
    },
    staleTime: 30_000,
  });
}

/** Follow status changes live (the wall and the manager page both). */
export function useWinterizationRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`winterization-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'winterization_tasks' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

/** Set a task's status; stamps the date and the signed-in engineer. A
 *  filtered-out update (RLS) returns 0 rows → error, so the UI never
 *  reports success on a no-op. */
export function useSetWinterizationStatus() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { id: string; status: WinterizationStatus }) => {
      const { data, error } = await supabase
        .from('winterization_tasks')
        .update({ status: input.status, status_at: new Date().toISOString(), status_by: me?.id ?? null })
        .eq('id', input.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to update this task.');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useAddWinterizationTask() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { season: string; building_code: string; task: string; sort_order: number; kind: WinterizationKind }) => {
      const { data, error } = await supabase
        .from('winterization_tasks')
        .insert({
          ...input,
          status: 'todo',
          created_by: me?.id ?? null,
        })
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to add tasks.');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useDeleteWinterizationTask() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('winterization_tasks')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to remove this task.');
      return data[0];
    },
    onSuccess: inv,
  });
}
