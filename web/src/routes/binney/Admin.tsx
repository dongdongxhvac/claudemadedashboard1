// Binney St admin — first pass: a slim single-tab shell hosting the
// duplicated Binney User Profiles view (onboarding Binney techs). Mirrors the
// UPark routes/admin/Admin.tsx gating: full access for admins, view-only
// engineer list for leads.
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { BinneyUserProfilesTab } from './BinneyUserProfilesTab';
import { SiteSwitcher } from './SiteSwitcher';

export default function BinneyAdmin() {
  const { session, signOut } = useAuth();
  const me = useMe();

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
              Binney St · Admin
              {!isAdmin && isLead && (
                <span className="t-small ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.15)', color: '#a16207', fontSize: 11, fontWeight: 500 }}>
                  ★ Lead view
                </span>
              )}
            </h1>
            <p className="t-small t-muted">{today}</p>
          </div>
          <div className="flex items-center gap-4">
            <SiteSwitcher />
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
              <span
                className="px-3 py-2 t-text"
                style={{
                  borderBottom: '2px solid var(--color-accent)',
                  color: 'var(--color-accent)',
                  fontWeight: 500,
                }}
              >
                User Profiles {!isAdmin && <span className="t-small" style={{ opacity: 0.7 }}>(view)</span>}
              </span>
            </div>
            <BinneyUserProfilesTab canManageUsers={isAdmin} />
          </div>
        )}
      </main>
    </div>
  );
}
