import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  loading: boolean;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  // Track the signed-in auth user so we can drop cached queries whenever the
  // identity changes. React Query keys like ['my_engineer_context'] aren't
  // scoped to the auth user, so without this a sign-out → sign-in (or account
  // switch) in the same tab would serve the previous user's data until it went
  // stale — e.g. a Binney engineer briefly showing a UPark engineer's dashboard.
  const prevUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      prevUserId.current = data.session?.user?.id ?? null;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const newUserId = s?.user?.id ?? null;
      if (prevUserId.current !== undefined && prevUserId.current !== newUserId) {
        queryClient.clear();
      }
      prevUserId.current = newUserId;
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const signInWithMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Land on the role-aware home, which redirects based on the user's role.
      options: { emailRedirectTo: window.location.origin + '/' },
    });
    return { error: error?.message ?? null };
  };

  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ session, loading, signInWithMagicLink, signInWithPassword, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be inside <AuthProvider>');
  return v;
}
