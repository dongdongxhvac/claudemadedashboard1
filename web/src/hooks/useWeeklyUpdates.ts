// Weekly Update Report — the running forecast-meeting agenda, editable
// like a spreadsheet on the admin dashboard. Imported from the
// "Upark Forecast Meeting" xlsx (migration 0076).
//
// CRUD shape mirrors building_projects in useBuildingKb.ts: a query +
// useUpsert (onConflict id) + useDelete (soft delete via active=false).
// Edits commit per-field on blur, so the upsert input is a Partial.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export const WEEKLY_STATUSES = [
  'pending',
  'in_progress',
  'complete',
  'blocked',
  'on_hold',
] as const;
export type WeeklyStatus = (typeof WEEKLY_STATUSES)[number];

export const WEEKLY_STATUS_LABELS: Record<WeeklyStatus, string> = {
  pending:     'Pending',
  in_progress: 'In progress',
  complete:    'Complete',
  blocked:     'Blocked',
  on_hold:     'On hold',
};

/** good = done, warn = active/waiting, bad = blocked, neutral = pending.
 *  Drives the status pill color in the grid. */
export function weeklyStatusTone(s: WeeklyStatus): 'good' | 'warn' | 'bad' | 'neutral' {
  if (s === 'complete') return 'good';
  if (s === 'in_progress') return 'warn';
  if (s === 'blocked') return 'bad';
  if (s === 'on_hold') return 'neutral';
  return 'neutral'; // pending
}

/** True for statuses that count as "still open" — drives the default
 *  "incomplete only" filter (matches what was imported). */
export function isWeeklyOpen(s: WeeklyStatus): boolean {
  return s !== 'complete';
}

export type WeeklyUpdate = {
  id: string;
  location: string | null;
  priority: string | null;
  description: string | null;
  activity: string | null;
  item_date: string | null;   // YYYY-MM-DD
  status: WeeklyStatus;
  assignee: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

const KEY = ['weekly_updates'];

/** All active rows, ordered by sort_order then created. */
export function useWeeklyUpdates() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WeeklyUpdate[]> => {
      const { data, error } = await supabase
        .from('weekly_updates')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as WeeklyUpdate[];
    },
    staleTime: 30_000,
  });
}

/** Insert OR update a row. Pass id to update, omit to insert.
 *  Per-field commits send a Partial with just the touched column(s). */
export function useUpsertWeeklyUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<WeeklyUpdate>) => {
      const row = { ...input, updated_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from('weekly_updates')
        .upsert(row, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return data as WeeklyUpdate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/** Soft-delete: flip active=false so the row drops out of the grid but
 *  history survives. */
export function useDeleteWeeklyUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('weekly_updates')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

/** Realtime: any change to weekly_updates re-fetches the grid so multiple
 *  admin tabs stay in sync. Unique channel suffix avoids the
 *  "cannot add postgres_changes callbacks after subscribe()" crash. */
export function useWeeklyUpdatesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`wu-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_updates' },
        () => qc.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}
