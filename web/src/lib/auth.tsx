import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  loading: boolean;
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

  // Max session age: force a fresh login 7 days after the last real sign-in
  // (per user 2026-07-28) — Supabase refresh tokens otherwise keep a session
  // alive forever. Checked against auth's last_sign_in_at, which updates on
  // password/magic-link sign-ins but NOT on silent token refreshes. The TV
  // kiosk account (users.role = 'tv') is exempt so the shop displays survive
  // unattended. Fails OPEN on the role lookup: wrongly keeping a session
  // beats locking everyone out on a flaky query. Note last_sign_in_at is
  // per-user, not per-device — signing in on your phone resets the desktop's
  // clock too; close enough for the intent.
  useEffect(() => {
    if (!session) return;
    const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    let cancelled = false;
    const check = async () => {
      const lastSignIn = session.user.last_sign_in_at;
      if (!lastSignIn) return;
      const age = Date.now() - new Date(lastSignIn).getTime();
      if (!Number.isFinite(age) || age <= MAX_SESSION_AGE_MS) return;
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      if (cancelled || error) return;
      if (data?.role === 'tv') return;
      await supabase.auth.signOut();
    };
    check();
    const t = setInterval(check, 60 * 60 * 1000); // catch long-lived tabs
    return () => { cancelled = true; clearInterval(t); };
  }, [session]);

  // Magic-link sign-in was removed 2026-07-28 (user request) — Mimecast
  // blocks emailed links on work inboxes and the 7-day session cap would
  // have made the round-trip weekly. Passwords + invite links only.
  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ session, loading, signInWithPassword, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be inside <AuthProvider>');
  return v;
}
