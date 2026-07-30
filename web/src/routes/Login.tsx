import { useState } from 'react';
import { useAuth } from '../lib/auth';

// Password-only since 2026-07-28 (user request): the magic-link option was
// removed — corporate Mimecast rewrites/blocks emailed links, and the 7-day
// re-login cap would have made that email round-trip a weekly nuisance.
// New users get a password via an admin/manager invite link (/set-password).
export default function Login() {
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    if (!em) return;
    if (!password) { setStatus('error'); setError('Enter a password.'); return; }
    setStatus('sending');
    setError(null);
    const { error } = await signInWithPassword(em, password);
    if (error) { setStatus('error'); setError(error); }
    else       { setStatus('idle'); /* AuthProvider will pick up the session */ }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-2xl font-medium mb-1">COVE Dashboard</h1>
        <p className="text-sm text-gray-500 mb-4">Sign in with your password.</p>

        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          placeholder="you@example.com"
          className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />

        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="••••••••"
          className="w-full border border-gray-300 rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />

        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full bg-purple-600 text-white rounded py-2 font-medium hover:bg-purple-700 disabled:opacity-50"
        >
          {status === 'sending' ? '…' : 'Sign in'}
        </button>

        {status === 'error' && error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}

        <p className="mt-4 text-xs text-gray-500">
          No password yet, or forgot it? Ask your admin or manager for an invite
          link to set a new one.
        </p>
      </form>
    </div>
  );
}
