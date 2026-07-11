import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useMySiteAccess } from '../../hooks/useSiteScope';
import { UserProfilesTab } from './UserProfilesTab';
import { OncallTab } from './OncallTab';
import { OncallExperimentTab } from './OncallExperimentTab';
import { BuildingsTab } from './BuildingsTab';
import { RoundsTab } from './RoundsTab';
import { WeeklyUpdateTab } from './WeeklyUpdateTab';
import { WaterBillingTab } from './WaterBillingTab';
import { MroBillingTab } from './MroBillingTab';

type Tab = 'users' | 'oncall' | 'oncall_experiment' | 'buildings' | 'rounds' | 'weekly' | 'water' | 'mro';

export default function Admin() {
  const { session, signOut } = useAuth();
  const me = useMe();
  const siteAccess = useMySiteAccess();
  const [tab, setTab] = useState<Tab>('users');

  const today = new Date().toLocaleDateString('en-CA');

  const isAdmin = me.data?.role === 'admin';
  const isLead  = me.data?.is_lead === true;
  const canAccess = isAdmin || isLead;

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="t-section-title">
              COVE · Admin
              {!isAdmin && isLead && (
                <span className="t-small ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.15)', color: '#a16207', fontSize: 11, fontWeight: 500 }}>
                  ★ Lead view
                </span>
              )}
            </h1>
            <p className="t-small t-muted">{today}</p>
          </div>
          <div className="flex items-center gap-4">
            {siteAccess.canSeeAllSites && (
              <Link to="/binney/admin" className="t-small t-accent hover:underline">
                → Binney St
              </Link>
            )}
            <Link to={isAdmin ? '/manager' : '/engineer/me'} className="t-small t-accent hover:underline">
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
              <TabButton active={tab === 'oncall'} onClick={() => setTab('oncall')}>
                On-call
              </TabButton>
              <TabButton active={tab === 'oncall_experiment'} onClick={() => setTab('oncall_experiment')}>
                Temp Coverage <span className="t-small ml-1 px-1 rounded" style={{ background: 'rgba(168,85,247,0.18)', color: '#7e22ce', fontSize: 9, fontWeight: 600, letterSpacing: '0.5px' }}>EXP</span>
              </TabButton>
              <TabButton active={tab === 'buildings'} onClick={() => setTab('buildings')}>
                Bldg Assign
              </TabButton>
              <TabButton active={tab === 'rounds'} onClick={() => setTab('rounds')}>
                Rounds
              </TabButton>
              <TabButton active={tab === 'weekly'} onClick={() => setTab('weekly')}>
                Weekly Update
              </TabButton>
              <TabButton active={tab === 'water'} onClick={() => setTab('water')}>
                Water Billing
              </TabButton>
              <TabButton active={tab === 'mro'} onClick={() => setTab('mro')}>
                MRO Billing
              </TabButton>
              <TabButton disabled title="Coming in Phase 5">SOPs</TabButton>
            </div>
            {tab === 'users'             && <UserProfilesTab canManageUsers={isAdmin} />}
            {tab === 'oncall'            && <OncallTab />}
            {tab === 'oncall_experiment' && <OncallExperimentTab />}
            {tab === 'buildings'         && <BuildingsTab />}
            {tab === 'rounds'            && <RoundsTab />}
            {tab === 'weekly'            && <WeeklyUpdateTab />}
            {tab === 'water'             && <WaterBillingTab />}
            {tab === 'mro'               && <MroBillingTab />}
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
