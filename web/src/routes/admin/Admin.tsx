import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe, manageScopeFor } from '../../hooks/useMe';
import { useMySiteAccess } from '../../hooks/useSiteScope';
import { UserProfilesTab } from './UserProfilesTab';
import { OncallTab } from './OncallTab';
import { OncallExperimentTab } from './OncallExperimentTab';
import { BuildingsTab } from './BuildingsTab';
import { RoundsTab } from './RoundsTab';
import { WeeklyUpdateTab } from './WeeklyUpdateTab';
import { WaterBillingTab } from './WaterBillingTab';
import { MroBillingTab } from './MroBillingTab';
import { UkgReconcileTab } from './UkgReconcileTab';

type Tab = 'users' | 'ukg' | 'oncall' | 'buildings' | 'rounds' | 'more';
// Low-traffic tools tucked under one right-aligned "More" tab (user
// 2026-09-22) so the day-to-day tabs stay front and centre. The sub-tab
// row only renders while "More" is selected.
type MoreTab = 'weekly' | 'water' | 'mro' | 'oncall_experiment';
const MORE_TABS: { key: MoreTab; label: React.ReactNode }[] = [
  { key: 'weekly',            label: 'Weekly Update' },
  { key: 'water',             label: 'Water Billing' },
  { key: 'mro',               label: 'MRO Billing' },
  { key: 'oncall_experiment', label: <>Temp Coverage <span className="t-small ml-1 px-1 rounded" style={{ background: 'rgba(168,85,247,0.18)', color: '#7e22ce', fontSize: 9, fontWeight: 600, letterSpacing: '0.5px' }}>EXP</span></> },
];

export default function Admin() {
  const { session, signOut } = useAuth();
  const me = useMe();
  const siteAccess = useMySiteAccess();
  const [tab, setTab] = useState<Tab>('users');
  const [moreTab, setMoreTab] = useState<MoreTab>('weekly');

  const today = new Date().toLocaleDateString('en-CA');

  const isAdmin = me.data?.role === 'admin';
  const isLead  = me.data?.is_lead === true;
  // Managers (role or is_manager flag) can add/edit ENGINEER users (migration
  // 0124) plus use the credential panels; other roles/rows stay view-only.
  const isManagerish =
    me.data?.role === 'manager' || me.data?.role === 'director' || me.data?.is_manager === true;
  const canAccess = isAdmin || isLead || isManagerish;
  const manageScope = manageScopeFor(me.data);

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="t-section-title">
                UPark · Admin
                {!isAdmin && isLead && (
                  <span className="t-small ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.15)', color: '#a16207', fontSize: 11, fontWeight: 500 }}>
                    ★ Lead view
                  </span>
                )}
              </h1>
              {siteAccess.canSeeAllSites && (
                <Link to="/binney/admin" className="t-small t-accent hover:underline">
                  → Binney St
                </Link>
              )}
            </div>
            <p className="t-small t-muted">{today}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to={isAdmin ? '/upark/manager' : '/engineer/me'} className="t-small t-accent hover:underline">
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
                User Profiles {manageScope === 'none' && <span className="t-small" style={{ opacity: 0.7 }}>(view)</span>}
              </TabButton>
              <TabButton active={tab === 'ukg'} onClick={() => setTab('ukg')}>
                PTO vs UKG
              </TabButton>
              <TabButton active={tab === 'oncall'} onClick={() => setTab('oncall')}>
                On-call
              </TabButton>
              <TabButton active={tab === 'buildings'} onClick={() => setTab('buildings')}>
                Bldg Assign
              </TabButton>
              <TabButton active={tab === 'rounds'} onClick={() => setTab('rounds')}>
                Rounds
              </TabButton>
              <div className="ml-auto">
                <TabButton
                  active={tab === 'more'}
                  onClick={() => setTab('more')}
                  title="Weekly Update · Water Billing · MRO Billing · Temp Coverage · SOPs"
                >
                  More ▾
                </TabButton>
              </div>
            </div>
            {tab === 'more' && (
              <div
                className="flex items-center gap-1 -mt-2 pb-1 border-b"
                style={{ borderColor: 'var(--color-border-soft, var(--color-border))', justifyContent: 'flex-end' }}
              >
                {MORE_TABS.map((t) => (
                  <TabButton key={t.key} active={moreTab === t.key} onClick={() => setMoreTab(t.key)} small>
                    {t.label}
                  </TabButton>
                ))}
                <TabButton disabled title="Coming in Phase 5" small>SOPs</TabButton>
              </div>
            )}
            {tab === 'users'     && <UserProfilesTab manageScope={manageScope} />}
            {tab === 'ukg'       && <UkgReconcileTab site="upark" />}
            {tab === 'oncall'    && <OncallTab />}
            {tab === 'buildings' && <BuildingsTab />}
            {tab === 'rounds'    && <RoundsTab />}
            {tab === 'more' && moreTab === 'weekly'            && <WeeklyUpdateTab />}
            {tab === 'more' && moreTab === 'water'             && <WaterBillingTab />}
            {tab === 'more' && moreTab === 'mro'               && <MroBillingTab />}
            {tab === 'more' && moreTab === 'oncall_experiment' && <OncallExperimentTab />}
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
  small,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  /** Compact variant for the "More" sub-tab row. */
  small?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`${small ? 'px-2 py-1 t-small' : 'px-3 py-2 t-text'} disabled:opacity-40 disabled:cursor-not-allowed`}
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
