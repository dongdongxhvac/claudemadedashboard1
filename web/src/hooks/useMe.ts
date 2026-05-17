import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Me = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  full_name: string;
  role: 'engineer' | 'manager' | 'client' | 'admin';
  access_level: number;
  hiring_date: string | null;
  avatar_url: string | null;
  active: boolean;
  preferences: Record<string, unknown>;
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
        .select('*')
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as Me | null) ?? null;
    },
    staleTime: 60_000,
  });
}

export function useIsAdmin(): boolean {
  return useMe().data?.role === 'admin';
}
