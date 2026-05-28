import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useImpersonation } from '../lib/impersonationContext';

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

function rowToMe(data: Record<string, unknown> & {
  engineer_profiles: { is_lead: boolean } | { is_lead: boolean }[] | null;
}): Me {
  const ep = Array.isArray(data.engineer_profiles) ? data.engineer_profiles[0] : data.engineer_profiles;
  return { ...(data as unknown as Me), is_lead: ep?.is_lead ?? false };
}

const SELECT = '*, engineer_profiles(is_lead)';

/** The REAL signed-in user — always keyed off the auth session, never
 *  impersonated. Used to gate who may impersonate (admins only). */
export function useRealMe(): UseQueryResult<Me | null> {
  return useQuery({
    queryKey: ['me', 'real'],
    queryFn: async (): Promise<Me | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from('users')
        .select(SELECT)
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToMe(data as never);
    },
    staleTime: 60_000,
  });
}

/** The EFFECTIVE user. Normally identical to useRealMe, but when a real admin
 *  is impersonating, this resolves to the impersonated user's row so the whole
 *  app re-renders as them (routing, assigned data, capabilities). */
export function useMe(): UseQueryResult<Me | null> {
  const real = useRealMe();
  const { impersonatedUserId } = useImpersonation();
  // Only real admins may impersonate; ignore the override otherwise.
  const targetId = real.data?.role === 'admin' ? impersonatedUserId : null;

  const impersonated = useQuery({
    queryKey: ['me', 'impersonated', targetId],
    enabled: !!targetId,
    queryFn: async (): Promise<Me | null> => {
      const { data, error } = await supabase
        .from('users')
        .select(SELECT)
        .eq('id', targetId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return rowToMe(data as never);
    },
    staleTime: 60_000,
  });

  return targetId ? impersonated : real;
}

export function useIsAdmin(): boolean {
  return useMe().data?.role === 'admin';
}

export function useIsManager(): boolean {
  return useMe().data?.is_manager === true;
}

/** Admin OR a lead engineer — the audience for the Admin panel (read/write
 *  capabilities still gated per-tab via canEditUsers). Reflects the EFFECTIVE
 *  user, so it hides admin affordances while impersonating a non-admin. */
export function useCanAccessAdmin(): boolean {
  const me = useMe().data;
  if (!me) return false;
  return me.role === 'admin' || me.is_lead === true;
}
