import { createClient } from '@supabase/supabase-js';

// Invite/recovery action links land with a hash like
//   #access_token=...&type=invite  (or #error_code=otp_expired&error_description=...)
// supabase-js parses AND STRIPS that hash while creating the session, so the
// type must be captured here — before createClient below runs. App.tsx's
// AuthLinkRedirect reads this to steer the user onto /set-password.
export const authLink: {
  type: 'invite' | 'recovery' | null;
  errorCode: string | null;
  errorDescription: string | null;
  consumed: boolean;
} = (() => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const rawType = params.get('type');
  return {
    type: rawType === 'invite' || rawType === 'recovery' ? rawType : null,
    errorCode: params.get('error_code'),
    errorDescription: params.get('error_description'),
    consumed: false,
  };
})();

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local');
}

/** Every Supabase call goes out with `cache: 'no-store'`. Found 2026-10-30
 *  on the shop wall (Pi 5, Chromium 151): the browser answered the
 *  kiosk's own profile query from its HTTP disk cache — no request ever
 *  reached Supabase (NetLog: HTTP_CACHE_OPEN_OR_CREATE_ENTRY → READ_DATA,
 *  no HTTP_STREAM_REQUEST) — so the gate acted on a months-old copy of the
 *  Shop TV row, sat on TV0 and ignored the admin card. PostgREST sends no
 *  Cache-Control, which leaves the decision to browser heuristics; data
 *  endpoints must never be served from the cache, so say so explicitly. */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: noStoreFetch },
});
