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

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
