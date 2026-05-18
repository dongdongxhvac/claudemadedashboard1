import { useState } from 'react';
import { useAuth } from '../lib/auth';

type Mode = 'password' | 'magic';

export default function Login() {
  const { signInWithMagicLink, signInWithPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setStatus('idle'); setError(null); };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    if (!em) return;
    setStatus('sending');
    setError(null);
    if (mode === 'magic') {
      const { error } = await signInWithMagicLink(em);
      if (error) { setStatus('error'); setError(error); }
      else       { setStatus('sent'); }
    } else {
      if (!password) { setStatus('error'); setError('Enter a password.'); return; }
      const { error } = await signInWithPassword(em, password);
      if (error) { setStatus('error'); setError(error); }
      else       { setStatus('idle'); /* AuthProvider will pick up the session */ }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-2xl font-medium mb-1">COVE Dashboard</h1>
        <p className="text-sm text-gray-500 mb-4">
          {mode === 'password' ? 'Sign in with your password.' : 'Sign in with a magic link.'}
        </p>

        <div className="flex border border-gray-200 rounded mb-4 overflow-hidden" role="tablist">
          <TabButton active={mode === 'password'} onClick={() => { setMode('password'); reset(); }}>
            Password
          </TabButton>
          <TabButton active={mode === 'magic'} onClick={() => { setMode('magic'); reset(); }}>
            Magic link
          </TabButton>
        </div>

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

        {mode === 'password' && (
          <>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </>
        )}

        <button
          type="submit"
          disabled={status === 'sending' || status === 'sent'}
          className="w-full bg-purple-600 text-white rounded py-2 font-medium hover:bg-purple-700 disabled:opacity-50"
        >
          {status === 'sending' ? '…' :
           status === 'sent' && mode === 'magic' ? 'Check your inbox' :
           mode === 'password' ? 'Sign in' : 'Send magic link'}
        </button>

        {status === 'sent' && mode === 'magic' && (
          <p className="mt-4 text-sm text-green-600">
            Magic link sent to {email}. Click the link to sign in.
          </p>
        )}
        {status === 'error' && error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}

        {mode === 'password' && (
          <p className="mt-4 text-xs text-gray-500">
            No password yet? Ask an admin to set one for you, or use Magic link.
          </p>
        )}
      </form>
    </div>
  );
}

function TabButton({
  children, active, onClick,
}: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className="flex-1 py-2 text-sm font-medium"
      style={{
        background: active ? 'rgba(147, 51, 234, 0.08)' : 'white',
        color: active ? '#7e22ce' : '#475569',
        borderRight: '1px solid #e5e7eb',
      }}
    >
      {children}
    </button>
  );
}
