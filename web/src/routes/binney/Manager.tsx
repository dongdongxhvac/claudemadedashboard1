// Binney St manager view — first pass, PTO only. A slim page shell around
// the duplicated BinneyPtoPanel. Everything else on the UPark manager page
// (PMs/WOs, plantlog, BMS alarms, overtime, meters) is deferred until Binney
// has those data sources.
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useIsAdmin } from '../../hooks/useMe';
import { BinneyPtoPanel } from './BinneyPtoPanel';
import { SiteSwitcher } from './SiteSwitcher';
import { useBinneySiteId } from './hooks/useBinneySiteId';
import { useBinneyUserIds } from './hooks/useBinneyPto';

export default function BinneyManager() {
  const { session, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const siteQ = useBinneySiteId();
  const idsQ = useBinneyUserIds();

  const today = new Date().toLocaleDateString('en-CA');
  const siteMissing = !siteQ.isLoading && !siteQ.isError && siteQ.data === null;
  const rosterEmpty = idsQ.data !== undefined && idsQ.data.length === 0;

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="t-section-title">Binney St · Dashboard</h1>
              <SiteSwitcher />
            </div>
            <p className="t-small t-muted">{today} · first pass — PTO only</p>
          </div>
          <div className="flex items-center gap-4">
            {isAdmin && (
              <Link to="/binney/admin" className="t-small t-accent hover:underline">
                Admin
              </Link>
            )}
            <span className="t-small t-muted">{session?.user.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        {siteMissing ? (
          <p className="t-text t-danger">
            Binney St site row not found (sites.code = 'binney'). Apply migration 0072 /
            re-seed the sites table before using this page.
          </p>
        ) : (
          <>
            {rosterEmpty && (
              <p className="t-small t-muted">
                No engineers are homed at Binney St yet — the PTO panel below will stay
                empty until the roster is loaded.
                {isAdmin && (
                  <>
                    {' '}Add techs in <Link to="/binney/admin" className="t-accent hover:underline">Binney Admin</Link>.
                  </>
                )}
              </p>
            )}
            <BinneyPtoPanel />
          </>
        )}
      </main>
    </div>
  );
}
