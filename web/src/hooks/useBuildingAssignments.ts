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

/** Make `user_id` the new primary on `building_id`. Ends any existing open
 *  primary on the same building (sets ends_on=today) before inserting the new
 *  row. If `user_id` is already the open primary, this is a no-op. */
export function useAssignPrimary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { building_id: string; user_id: string; notes?: string | null }) => {
      const { data: existing, error: qe } = await supabase
        .from('building_assignments')
        .select('id, user_id')
        .eq('building_id', input.building_id)
        .eq('role_in_building', 'primary')
        .is('ends_on', null);
      if (qe) throw qe;

      const today = new Date().toISOString().slice(0, 10);
      const open = (existing ?? []) as { id: string; user_id: string }[];
      if (open.some((r) => r.user_id === input.user_id)) return; // already primary

      if (open.length > 0) {
        const { error } = await supabase
          .from('building_assignments')
          .update({ ends_on: today })
          .in('id', open.map((r) => r.id));
        if (error) throw error;
      }

      const { error: ie } = await supabase
        .from('building_assignments')
        .insert({
          building_id: input.building_id,
          user_id: input.user_id,
          role_in_building: 'primary',
          notes: input.notes ?? null,
        });
      if (ie) throw ie;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Change role on an existing assignment row. If changing to 'primary', the
 *  partial unique index will reject the update if another open primary exists
 *  on the same building — caller should use useAssignPrimary in that case. */
export function useChangeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; role: AssignmentRole }) => {
      const { error } = await supabase
        .from('building_assignments')
        .update({ role_in_building: input.role })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

