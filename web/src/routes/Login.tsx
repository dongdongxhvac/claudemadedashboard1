import { useState } from 'react';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { signInWithMagicLink } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setError(null);
    const { error } = await signInWithMagicLink(email.trim());
    if (error) {
      setStatus('error');
      setError(error);
    } else {
      setStatus('sent');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-2xl font-medium mb-1">COVE Dashboard</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in with a magic link.</p>

        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          placeholder="you@example.com"
          className="w-full border border-gray-300 rounded px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />

        <button
          type="submit"
          disabled={status === 'sending' || status === 'sent'}
          className="w-full bg-purple-600 text-white rounded py-2 font-medium hover:bg-purple-700 disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending...' : status === 'sent' ? 'Check your inbox' : 'Send magic link'}
        </button>

        {status === 'sent' && (
          <p className="mt-4 text-sm text-green-600">
            Magic link sent to {email}. Click the link to sign in.
          </p>
        )}
        {status === 'error' && error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </form>
    </div>
  );
}
