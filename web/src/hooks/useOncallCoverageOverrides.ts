// Sandbox hooks for the Temp Coverage experiment tab.
//
// Backed by oncall_coverage_overrides_sandbox (NOT the live oncall_* tables).
// Reads are open to all authed users; writes are admin/manager/lead via RLS.
//
// Drop the table to nuke the experiment.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OverrideKind = 'week' | 'day';

export type CoverageOverride = {
  id: string;
  original_user_id: string;
  cover_user_id: string;
  kind: OverrideKind;
  starts_on: string;   // YYYY-MM-DD
  ends_on:   string;   // YYYY-MM-DD
  reason: string | null;
  created_by: string | null;
  created_at: string;
  // Shared between the 2 rows of a Swap. NULL for single-direction overrides.
  swap_pair_id: string | null;
};

const KEY = ['oncall_coverage_overrides_sandbox'];

export function useCoverageOverrides() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CoverageOverride[]> => {
      const { data, error } = await supabase
        .from('oncall_coverage_overrides_sandbox')
        .select('*')
        .order('starts_on', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CoverageOverride[];
    },
    staleTime: 30_000,
  });
}

export function useCoverageOverridesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('oncall-coverage-overrides-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'oncall_coverage_overrides_sandbox' },
        () => qc.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

export type CreateCoverageInput = {
  original_user_id: string;
  cover_user_id:    string;
  kind:             OverrideKind;
  starts_on:        string;
  ends_on:          string;
  reason?:          string | null;
  swap_pair_id?:    string | null;
};

export function useCreateCoverageOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCoverageInput) => {
      const auth = await supabase.auth.getUser();
      const { data: meRow } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', auth.data.user?.id ?? '')
        .maybeSingle();
      const { data, error } = await supabase
        .from('oncall_coverage_overrides_sandbox')
        .insert({
          original_user_id: input.original_user_id,
          cover_user_id:    input.cover_user_id,
          kind:             input.kind,
          starts_on:        input.starts_on,
          ends_on:          input.ends_on,
          reason:           input.reason ?? null,
          swap_pair_id:     input.swap_pair_id ?? null,
          created_by:       meRow?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCoverageOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('oncall_coverage_overrides_sandbox')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
