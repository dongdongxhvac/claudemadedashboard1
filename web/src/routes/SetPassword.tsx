// /set-password — landing page for invite + password-reset action links.
//
// An admin/manager generates a link in User Profiles (admin-invite-link edge
// function); opening it creates a session from the URL hash (supabase-js
// detectSessionInUrl) and AuthLinkRedirect in App.tsx steers here. The user
// picks their own password, then continues to their role-appropriate home.
//
// Deliberately a bare route: neither Protected (an expired link arrives with
// NO session and must still render the explanation) nor PublicOnly (a fresh
// link arrives WITH a session and must not bounce to the dashboard).
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, authLink } from '../lib/supabase';

export default function SetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  // Preferred link shape: ?token_hash=...&type=invite|recovery pointing at
  // THIS page. The token is only consumed when the user clicks Continue
  // (verifyOtp) — so browser preloading / chat link previews, which load
  // pages but never click, can't burn the one-time token. The legacy
  // action_link shape (session arrives via URL hash) still works below.
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const rawType   = params.get('type');
  const otpType: 'invite' | 'recovery' = rawType === 'invite' ? 'invite' : 'recovery';
  const [verifyState, setVerifyState] = useState<'idle' | 'working' | 'failed'>('idle');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [status, setStatus]     = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage]   = useState<string | null>(null);

  if (loading) {
    return <div className="p-8 text-gray-500">Loading...</div>;
  }

  if (!session && tokenHash && verifyState !== 'failed') {
    const verify = async () => {
      setVerifyState('working');
      const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash });
      if (error) {
        setVerifyState('failed');
        setVerifyError(error.message);
        return;
      }
      // Session is now set (AuthProvider picks it up); drop the token from
      // the URL so a refresh doesn't retry a spent token.
      navigate('/set-password', { replace: true });
    };
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          {otpType === 'invite' ? 'Welcome — activate your account' : 'Reset your password'}
        </h1>
        <p className="text-sm text-gray-600 mb-4">
          Click continue to verify this link, then choose your password.
        </p>
        <button
          type="button"
          onClick={verify}
          disabled={verifyState === 'working'}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded px-3 py-2 text-sm font-medium"
        >
          {verifyState === 'working' ? 'Verifying…' : 'Continue'}
        </button>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Link expired or invalid</h1>
        <p className="text-sm text-gray-600 mb-1">
          This sign-in link can only be used once and expires after a short time.
          Ask your admin or manager to generate a new invite link.
        </p>
        {(verifyError ?? authLink.errorDescription) && (
          <p className="text-sm text-red-600 mb-1">
            {(verifyError ?? authLink.errorDescription!).replace(/\+/g, ' ')}
          </p>
        )}
        <p className="text-sm text-gray-600 mt-3">
          Already have a password?{' '}
          <Link to="/login" className="text-purple-700 hover:underline">Sign in</Link>
        </p>
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setStatus('error'); setMessage('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setStatus('error'); setMessage('Passwords do not match.'); return; }
    setStatus('saving');
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Set your password</h1>
      <p className="text-sm text-gray-600 mb-4">
        Signed in as <span className="font-medium">{session.user.email}</span>.
        Choose the password you'll use to sign in from now on.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-gray-700 mb-1">New password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="At least 8 characters"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm text-gray-700 mb-1">Confirm password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Same password again"
          />
        </div>
        {status === 'error' && message && (
          <p className="text-sm text-red-600">{message}</p>
        )}
        <button
          type="submit"
          disabled={status === 'saving'}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded px-3 py-2 text-sm font-medium"
        >
          {status === 'saving' ? 'Saving…' : 'Save password & continue'}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
