import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type AssignmentRole = 'primary' | 'backup' | 'manager';

export type BuildingAssignment = {
  id: string;
  building_id: string;
  user_id: string;
  role_in_building: AssignmentRole;
  starts_on: string;
  ends_on: string | null;
  notes: string | null;
};

const KEY = ['building_assignments'];

/** Current (un-ended) assignments only. Past assignments are kept for history
 *  but the Buildings tab works with the current snapshot. */
export function useCurrentBuildingAssignments() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<BuildingAssignment[]> => {
      const { data, error } = await supabase
        .from('building_assignments')
        .select('id, building_id, user_id, role_in_building, starts_on, ends_on, notes')
        .is('ends_on', null);
      if (error) throw error;
      return (data ?? []) as BuildingAssignment[];
    },
    staleTime: 30_000,
  });
}

export function useBuildingAssignmentsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('building-assignments-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'building_assignments' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

/** Insert a new assignment (primary or backup). Caller should end the prior
 *  primary first if reassigning, otherwise the partial unique index will fire. */
export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      building_id: string;
      user_id: string;
      role_in_building: AssignmentRole;
      notes?: string | null;
    }) => {
      const { error, data } = await supabase
        .from('building_assignments')
        .insert({
          building_id: input.building_id,
          user_id: input.user_id,
          role_in_building: input.role_in_building,
          notes: input.notes ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** End an assignment (sets ends_on = today). Preferred over hard delete so the
 *  building_assignments table doubles as audit history. */
export function useEndAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; ends_on?: string }) => {
      const ends_on = input.ends_on ?? new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from('building_assignments')
        .update({ ends_on })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Hard delete — only used when the admin is undoing a just-made mistake. */
export function useDeleteAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('building_assignments')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Update shift_id or is_lead on engineer_profiles. Used by Buildings tab to
 *  move an engineer between shifts or toggle the lead-engineer flag. */
export function useUpdateEngineerShiftAndLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      patch: { shift_id?: string | null; is_lead?: boolean };
    }) => {
      const { error, data } = await supabase
        .from('engineer_profiles')
        .update({ ...input.patch, updated_at: new Date().toISOString() })
        .eq('user_id', input.user_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engineers'] });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
