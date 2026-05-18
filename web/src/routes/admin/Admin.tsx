import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { UserProfilesTab } from './UserProfilesTab';
import { OncallTab } from './OncallTab';
import { BuildingsTab } from './BuildingsTab';
import { RoundsTab } from './RoundsTab';

type Tab = 'users' | 'oncall' | 'buildings' | 'rounds';

export default function Admin() {
  const { session, signOut } = useAuth();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('users');

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
              <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
                User Profiles
              </TabButton>
              <TabButton active={tab === 'oncall'} onClick={() => setTab('oncall')}>
                On-call
              </TabButton>
              <TabButton active={tab === 'buildings'} onClick={() => setTab('buildings')}>
                Buildings
              </TabButton>
              <TabButton active={tab === 'rounds'} onClick={() => setTab('rounds')}>
                Rounds
              </TabButton>
              <TabButton disabled title="Coming in Phase 5">SOPs</TabButton>
            </div>
            {tab === 'users'     && <UserProfilesTab />}
            {tab === 'oncall'    && <OncallTab />}
            {tab === 'buildings' && <BuildingsTab />}
            {tab === 'rounds'    && <RoundsTab />}
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
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={disabled}
      title={title}
      onClick={onClick}
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
