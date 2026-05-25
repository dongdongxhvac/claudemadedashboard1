import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Me = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  full_name: string;
  role: 'engineer' | 'manager' | 'client' | 'admin' | 'director' | 'tv';
  access_level: number;
  hiring_date: string | null;
  avatar_url: string | null;
  active: boolean;
  preferences: Record<string, unknown>;
  is_lead: boolean;
  is_manager: boolean;
};

/** Fetch the current authenticated user's row in public.users. Null when not linked. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from('users')
        .select('*, engineer_profiles(is_lead)')
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown> & {
        engineer_profiles: { is_lead: boolean } | { is_lead: boolean }[] | null;
      };
      const ep = Array.isArray(row.engineer_profiles) ? row.engineer_profiles[0] : row.engineer_profiles;
      return { ...(row as unknown as Me), is_lead: ep?.is_lead ?? false };
    },
    staleTime: 60_000,
  });
}

export function useIsAdmin(): boolean {
  return useMe().data?.role === 'admin';
}

export function useIsManager(): boolean {
  return useMe().data?.is_manager === true;
}

/** Admin OR a lead engineer — the audience for the Admin panel (read/write
 *  capabilities still gated per-tab via canEditUsers). */
export function useCanAccessAdmin(): boolean {
  const me = useMe().data;
  if (!me) return false;
  return me.role === 'admin' || me.is_lead === true;
}
