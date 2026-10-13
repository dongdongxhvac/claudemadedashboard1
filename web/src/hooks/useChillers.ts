// Chillers — the chiller status board (migration 0149). One row per
// chiller (16 across UPark); status is one of the shop's four states —
// open (running), punching (tubes being punched), rat race (the chemical
// run on a closed chiller), closed — and status_at / status_by record the
// last change. TV2's Chillers tile shows
// the board; the UPark manager page's §14 card sets statuses and adds /
// removes chillers.
//
// Separate from every other hook on purpose (isolate-new-features rule):
// its own query key, its own realtime channel.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';

export type ChillerStatus = 'open' | 'punching' | 'rat_race' | 'closed';

/** Display / sort order: running first, closed last (user 2026-10-13). */
export const CHILLER_STATUSES: ChillerStatus[] = ['open', 'punching', 'rat_race', 'closed'];
export const CHILLER_STATUS_LABEL: Record<ChillerStatus, string> = {
  open: 'Open', punching: 'Punching', rat_race: 'Rat race', closed: 'Closed',
};
export const CHILLER_STATUS_HINT: Record<ChillerStatus, string> = {
  open: 'running', punching: 'tubes being punched', rat_race: 'chemical run on a closed chiller', closed: 'off',
};
/** By status (open → punching → rat race → closed), then list order. */
export function sortChillers(rows: Chiller[]): Chiller[] {
  const rank = (s: ChillerStatus) => CHILLER_STATUSES.indexOf(s);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || a.sort_order - b.sort_order);
}

export type Chiller = {
  id: string;
  building_code: string;
  name: string | null;
  sort_order: number;
  status: ChillerStatus;
  status_at: string | null;
  status_by: string | null;
  status_by_name: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const KEY = ['chillers'];

export function useChillers() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Chiller[]> => {
      const { data, error } = await supabase
        .from('chillers')
        .select('id, building_code, name, sort_order, status, status_at, status_by, note, created_at, updated_at, status_by_user:status_by(full_name)')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      type Row = Omit<Chiller, 'status_by_name'> & {
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
export function useChillersRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`chillers-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chillers' }, () => {
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

/** Set a chiller's status; stamps the date and the signed-in engineer. A
 *  filtered-out update (RLS) returns 0 rows → error, so the UI never
 *  reports success on a no-op. */
export function useSetChillerStatus() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { id: string; status: ChillerStatus }) => {
      const { data, error } = await supabase
        .from('chillers')
        .update({ status: input.status, status_at: new Date().toISOString(), status_by: me?.id ?? null })
        .eq('id', input.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to update this chiller.');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useAddChiller() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { building_code: string; name: string | null; sort_order: number }) => {
      const { data, error } = await supabase
        .from('chillers')
        .insert({ ...input, created_by: me?.id ?? null })
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to add chillers.');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useDeleteChiller() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('chillers')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to remove this chiller.');
      return data[0];
    },
    onSuccess: inv,
  });
}
