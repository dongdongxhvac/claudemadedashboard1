// Winterization — the shop's "Cold Weather Prep" whiteboard as data
// (migrations 0145–0148). One row per building task per season. The
// to-do IS the action: each task carries what needs doing and who did it.
//   kind 'drain' — action drain | fill          (a drain-down / refill)
//   kind 'mode'  — action winter | summer       (88's CT make-up float)
//   done_at / done_by — null = still to do; set = done, by whom, when.
// Setting a new action clears done — a fresh to-do (fall: drain; spring:
// fill). TV2's Winterization tile reads the current season; the UPark
// manager page's card sets actions, marks them done, adds / removes tasks.
//
// Separate from every other hook on purpose (isolate-new-features rule):
// its own query key, its own realtime channel.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';

export type WinterizationKind = 'drain' | 'mode';
export type WinterizationAction = 'drain' | 'fill' | 'winter' | 'summer';

export const WINTERIZATION_ACTIONS: Record<WinterizationKind, WinterizationAction[]> = {
  drain: ['drain', 'fill'],
  mode:  ['winter', 'summer'],
};
/** The action as a to-do ("Drain") and as done ("Drained"). */
export const WINTERIZATION_ACTION_LABEL: Record<WinterizationAction, { todo: string; done: string }> = {
  drain:  { todo: 'Drain',       done: 'Drained' },
  fill:   { todo: 'Fill',        done: 'Filled' },
  winter: { todo: 'Winter mode', done: 'Winter mode' },
  summer: { todo: 'Summer mode', done: 'Summer mode' },
};
/** The fall actions — a task done on one of these is winterized. */
export function isWinterAction(action: WinterizationAction): boolean {
  return action === 'drain' || action === 'winter';
}
/** The first to-do of a season for a kind. */
export function defaultAction(kind: WinterizationKind): WinterizationAction {
  return kind === 'mode' ? 'winter' : 'drain';
}

export type WinterizationTask = {
  id: string;
  season: string;
  building_code: string;
  task: string;
  sort_order: number;
  kind: WinterizationKind;
  action: WinterizationAction;
  done_at: string | null;
  done_by: string | null;
  done_by_name: string | null;
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
        .select('id, season, building_code, task, sort_order, kind, action, done_at, done_by, note, created_at, updated_at, done_by_user:done_by(full_name)')
        .eq('season', season)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      type Row = Omit<WinterizationTask, 'done_by_name'> & {
        done_by_user: { full_name: string } | { full_name: string }[] | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const u = Array.isArray(r.done_by_user) ? r.done_by_user[0] : r.done_by_user;
        const { done_by_user: _drop, ...rest } = r;
        void _drop;
        return { ...rest, done_by_name: u?.full_name ?? null };
      });
    },
    staleTime: 30_000,
  });
}

/** Follow changes live (the wall and the manager page both). */
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

/** Set what a task needs next; that is a fresh to-do, so done clears. A
 *  filtered-out update (RLS) returns 0 rows → error, so the UI never
 *  reports success on a no-op. */
export function useSetWinterizationAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (input: { id: string; action: WinterizationAction }) => {
      const { data, error } = await supabase
        .from('winterization_tasks')
        .update({ action: input.action, done_at: null, done_by: null })
        .eq('id', input.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to update this task.');
      return data[0];
    },
    onSuccess: inv,
  });
}

/** Mark the current action done (stamps the date and the signed-in
 *  engineer) or not done. */
export function useMarkWinterizationDone() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { id: string; done: boolean }) => {
      const { data, error } = await supabase
        .from('winterization_tasks')
        .update(input.done
          ? { done_at: new Date().toISOString(), done_by: me?.id ?? null }
          : { done_at: null, done_by: null })
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
        .insert({ ...input, action: defaultAction(input.kind), created_by: me?.id ?? null })
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
