import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Discipline } from './useEngineers';

export type EngineerProfileFull = {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  hiring_date: string | null;
  cmms_assignee_name: string | null;
  discipline: Discipline | null;
  level: number;
  xp: number;
  skill_tree: Record<string, unknown>;
  certifications: string[];
  badges: unknown[];
  visible_to_self: boolean;
  notes: string | null;
};

export type CompletionEntry = {
  task_no: string;
  pm_type: string | null;
  labor_hours: number | null;
  first_seen_at: string;
  cmms_assignee_name: string | null;
};

/** Fetch one engineer's full profile + their completion history. */
export function useEngineerProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['engineer_profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: u, error: ue } = await supabase
        .from('users')
        .select(`
          id, full_name, email, phone, hiring_date,
          engineer_profiles!inner (
            cmms_assignee_name, discipline, level, xp, skill_tree,
            certifications, badges, visible_to_self, notes
          )
        `)
        .eq('id', userId!)
        .eq('role', 'engineer')
        .maybeSingle();
      if (ue) throw ue;
      if (!u) return null;

      // engineer_profiles may come back as array or object depending on PostgREST shape.
      type EP = EngineerProfileFull;
      const epRaw = (u as { engineer_profiles: unknown }).engineer_profiles;
      const ep = (Array.isArray(epRaw) ? epRaw[0] : epRaw) as Omit<EP,
        'user_id' | 'full_name' | 'email' | 'phone' | 'hiring_date'>;

      const profile: EP = {
        user_id: (u as { id: string }).id,
        full_name: (u as { full_name: string }).full_name,
        email: (u as { email: string | null }).email,
        phone: (u as { phone: string | null }).phone,
        hiring_date: (u as { hiring_date: string | null }).hiring_date,
        ...ep,
      };

      const { data: comps, error: ce } = await supabase
        .from('pm_completions')
        .select('task_no, pm_type, labor_hours, first_seen_at, cmms_assignee_name')
        .eq('user_id', userId!)
        .order('first_seen_at', { ascending: false })
        .limit(30);
      if (ce) throw ce;

      return { profile, completions: (comps ?? []) as CompletionEntry[] };
    },
    staleTime: 30_000,
  });
}
