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
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, authLink } from '../lib/supabase';

export default function SetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [status, setStatus]     = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage]   = useState<string | null>(null);

  if (loading) {
    return <div className="p-8 text-gray-500">Loading...</div>;
  }

  if (!session) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Link expired or invalid</h1>
        <p className="text-sm text-gray-600 mb-1">
          This sign-in link can only be used once and expires after a short time.
          Ask your admin or manager to generate a new invite link.
        </p>
        {authLink.errorDescription && (
          <p className="text-sm text-red-600 mb-1">{authLink.errorDescription.replace(/\+/g, ' ')}</p>
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
