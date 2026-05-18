import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type RoundStop = {
  id: string;
  building_id: string;
  sequence: number;
  short_code: string | null;
  code: string;
  name: string;
};

export type RoundAssignment = {
  id: string;
  user_id: string;
  full_name: string | null;
  starts_on: string;
};

export type Round = {
  id: string;
  name: string;
  shift_id: string | null;
  sort_order: number;
  active: boolean;
  estimated_minutes: number | null;
  stops: RoundStop[];
  current: RoundAssignment | null;
};

const KEY = ['rounds'];

type RoundsRow = {
  id: string;
  name: string;
  shift_id: string | null;
  sort_order: number;
  active: boolean;
  estimated_minutes: number | null;
  round_stops: {
    id: string; building_id: string; sequence: number;
    buildings: { short_code: string | null; code: string; name: string } | null;
  }[];
  round_assignments: {
    id: string; user_id: string; starts_on: string; ends_on: string | null;
    users: { full_name: string | null } | null;
  }[];
};

export function useRounds() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Round[]> => {
      const { data, error } = await supabase
        .from('rounds')
        .select(`
          id, name, shift_id, sort_order, active, estimated_minutes,
          round_stops ( id, building_id, sequence, buildings ( short_code, code, name ) ),
          round_assignments ( id, user_id, starts_on, ends_on, users ( full_name ) )
        `)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as RoundsRow[]).map((r) => {
        const stops: RoundStop[] = (r.round_stops ?? [])
          .map((s) => ({
            id: s.id,
            building_id: s.building_id,
            sequence: s.sequence,
            short_code: s.buildings?.short_code ?? null,
            code: s.buildings?.code ?? '',
            name: s.buildings?.name ?? '',
          }))
          .sort((a, b) => a.sequence - b.sequence);
        const open = (r.round_assignments ?? []).find((a) => a.ends_on === null) ?? null;
        const current: RoundAssignment | null = open
          ? {
              id: open.id,
              user_id: open.user_id,
              full_name: open.users?.full_name ?? null,
              starts_on: open.starts_on,
            }
          : null;
        return {
          id: r.id,
          name: r.name,
          shift_id: r.shift_id,
          sort_order: r.sort_order,
          active: r.active,
          estimated_minutes: r.estimated_minutes,
          stops,
          current,
        } satisfies Round;
      });
    },
    staleTime: 30_000,
  });
}

export function useRoundsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('rounds-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds'             }, () => qc.invalidateQueries({ queryKey: KEY }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'round_stops'        }, () => qc.invalidateQueries({ queryKey: KEY }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'round_assignments'  }, () => qc.invalidateQueries({ queryKey: KEY }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

// ============================================================================
// Round CRUD
// ============================================================================

export function useCreateRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; shift_id: string | null; sort_order: number }) => {
      const { data, error } = await supabase
        .from('rounds')
        .insert({
          name: input.name.trim() || 'New round',
          shift_id: input.shift_id,
          sort_order: input.sort_order,
          active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Pick<Round, 'name' | 'shift_id' | 'sort_order' | 'estimated_minutes' | 'active'>>;
    }) => {
      const { data, error } = await supabase
        .from('rounds')
        .update({ ...input.patch, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const { error } = await supabase.from('rounds').delete().eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// ============================================================================
// Stop mutations
// ============================================================================

export function useAddStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { round_id: string; building_id: string }) => {
      // Sequence = max(existing) + 1.
      const { data: maxRow } = await supabase
        .from('round_stops')
        .select('sequence')
        .eq('round_id', input.round_id)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();
      const next = (maxRow?.sequence ?? 0) + 1;
      const { error } = await supabase
        .from('round_stops')
        .insert({ round_id: input.round_id, building_id: input.building_id, sequence: next });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { stop_id: string }) => {
      const { error } = await supabase.from('round_stops').delete().eq('id', input.stop_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useReorderStops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ordered_stop_ids: string[] }) => {
      // One UPDATE per row; small N (≤ ~10 buildings per round) makes this fine.
      for (let i = 0; i < input.ordered_stop_ids.length; i++) {
        const { error } = await supabase
          .from('round_stops')
          .update({ sequence: i + 1 })
          .eq('id', input.ordered_stop_ids[i]);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// ============================================================================
// Assignment mutations (close-open pattern, mirroring useBuildingAssignments)
// ============================================================================

export function useAssignRoundEngineer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { round_id: string; user_id: string }) => {
      // 1) Close any currently-open assignment.
      const today = new Date().toISOString().slice(0, 10);
      const { error: closeErr } = await supabase
        .from('round_assignments')
        .update({ ends_on: today })
        .eq('round_id', input.round_id)
        .is('ends_on', null);
      if (closeErr) throw closeErr;
      // 2) Open a new one for the chosen engineer.
      const { error: openErr } = await supabase
        .from('round_assignments')
        .insert({ round_id: input.round_id, user_id: input.user_id });
      if (openErr) throw openErr;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUnassignRoundEngineer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { round_id: string }) => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from('round_assignments')
        .update({ ends_on: today })
        .eq('round_id', input.round_id)
        .is('ends_on', null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
