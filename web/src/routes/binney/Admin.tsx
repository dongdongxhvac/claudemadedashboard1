// Binney St admin — tabbed shell (User Profiles + PTO vs UKG), mirroring the
// UPark routes/admin/Admin.tsx pattern and gating: full access for admins,
// view-only engineer list for leads.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { BinneyUserProfilesTab } from './BinneyUserProfilesTab';
import { UkgReconcileTab } from '../admin/UkgReconcileTab';
import { SiteSwitcher } from './SiteSwitcher';

type Tab = 'users' | 'ukg';

export default function BinneyAdmin() {
  const { session, signOut } = useAuth();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('users');

  const today = new Date().toLocaleDateString('en-CA');

  const isAdmin = me.data?.role === 'admin';
  const isLead  = me.data?.is_lead === true;
  // Managers (role or is_manager flag) get view-only access so they can use
  // the credential panels (set password / invite link) in User Profiles.
  const isManagerish =
    me.data?.role === 'manager' || me.data?.role === 'director' || me.data?.is_manager === true;
  const canAccess = isAdmin || isLead || isManagerish;

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="t-section-title">
                Binney St · Admin
                {!isAdmin && isLead && (
                  <span className="t-small ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.15)', color: '#a16207', fontSize: 11, fontWeight: 500 }}>
                    ★ Lead view
                  </span>
                )}
              </h1>
              <SiteSwitcher />
            </div>
            <p className="t-small t-muted">{today}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to={isAdmin ? '/binney/manager' : '/engineer/me'} className="t-small t-accent hover:underline">
              ← {isAdmin ? 'Dashboard' : 'My view'}
            </Link>
            <span className="t-small t-muted">{session?.user.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {me.isLoading ? (
          <p className="t-text t-muted">Loading...</p>
        ) : !canAccess ? (
          <p className="t-text t-danger">
            Admin access required. You're signed in as <b>{me.data?.role ?? 'unknown'}</b>.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <TabButton active={tab === 'users'} onClick={() => setTab('users')}>
                User Profiles {!isAdmin && <span className="t-small" style={{ opacity: 0.7 }}>(view)</span>}
              </TabButton>
              <TabButton active={tab === 'ukg'} onClick={() => setTab('ukg')}>
                PTO vs UKG
              </TabButton>
            </div>
            {tab === 'users' && <BinneyUserProfilesTab canManageUsers={isAdmin} />}
            {tab === 'ukg'   && <UkgReconcileTab site="binney" />}
          </div>
        )}
      </main>
    </div>
  );
}

function TabButton({
  children, active, onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 t-text"
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
