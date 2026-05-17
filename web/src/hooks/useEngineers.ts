import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Discipline = 'M' | 'E' | 'P' | 'BMS' | 'FLS';
export const DISCIPLINES: { value: Discipline; label: string }[] = [
  { value: 'M',   label: 'Mechanical' },
  { value: 'E',   label: 'Electrical' },
  { value: 'P',   label: 'Plumbing' },
  { value: 'BMS', label: 'Building Mgmt System' },
  { value: 'FLS', label: 'Fire / Life Safety' },
];

export type EngineerRow = {
  user_id: string;
  full_name: string;
  email: string | null;
  active: boolean;
  cmms_assignee_name: string | null;
  discipline: Discipline | null;
  level: number;
  xp: number;
  visible_to_self: boolean;
  notes: string | null;
  updated_at: string;
};

const KEY = ['engineers'];

export function useEngineers() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<EngineerRow[]> => {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, full_name, email, active,
          engineer_profiles!inner (
            cmms_assignee_name, discipline, level, xp,
            visible_to_self, notes, updated_at
          )
        `)
        .eq('role', 'engineer')
        .order('full_name');
      if (error) throw error;
      // Supabase types the join result as an array even though it's 1:1.
      type Profile = {
        cmms_assignee_name: string | null; discipline: Discipline | null;
        level: number; xp: number; visible_to_self: boolean;
        notes: string | null; updated_at: string;
      };
      type Joined = {
        id: string; full_name: string; email: string | null; active: boolean;
        engineer_profiles: Profile | Profile[] | null;
      };
      return (data as unknown as Joined[])
        .map((r) => {
          const ep = Array.isArray(r.engineer_profiles)
            ? r.engineer_profiles[0]
            : r.engineer_profiles;
          if (!ep) return null;
          return {
            user_id: r.id,
            full_name: r.full_name,
            email: r.email,
            active: r.active,
            cmms_assignee_name: ep.cmms_assignee_name,
            discipline: ep.discipline,
            level: ep.level,
            xp: ep.xp,
            visible_to_self: ep.visible_to_self,
            notes: ep.notes,
            updated_at: ep.updated_at,
          } satisfies EngineerRow;
        })
        .filter((r): r is EngineerRow => r !== null);
    },
    staleTime: 30_000,
  });
}

export function useUpdateEngineerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      patch: Partial<Pick<EngineerRow, 'discipline' | 'level' | 'notes' | 'visible_to_self'>>;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
