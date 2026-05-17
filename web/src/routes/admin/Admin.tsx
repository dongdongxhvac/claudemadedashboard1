import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { EngineerProfilesTab } from './EngineerProfilesTab';

export default function Admin() {
  const { session, signOut } = useAuth();
  const me = useMe();

  const today = new Date().toLocaleDateString('en-CA');

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="t-section-title">COVE · Admin</h1>
            <p className="t-small t-muted">{today}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/manager" className="t-small t-accent hover:underline">← Dashboard</Link>
            <span className="t-small t-muted">{session?.user.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {me.isLoading ? (
          <p className="t-text t-muted">Loading...</p>
        ) : me.data?.role !== 'admin' ? (
          <p className="t-text t-danger">
            Admin access required. You're signed in as <b>{me.data?.role ?? 'unknown'}</b>.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <TabButton active>Engineer Profiles</TabButton>
              <TabButton disabled title="Coming in Phase 4">Buildings</TabButton>
              <TabButton disabled title="Coming in Phase 4">Rounds</TabButton>
              <TabButton disabled title="Coming in Phase 4">On-call</TabButton>
              <TabButton disabled title="Coming in Phase 5">SOPs</TabButton>
            </div>
            <EngineerProfilesTab />
          </div>
        )}
      </main>
    </div>
  );
}

function TabButton({
  children,
  active,
  disabled,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      disabled={disabled}
      title={title}
      className="px-3 py-2 t-text disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  );
}
