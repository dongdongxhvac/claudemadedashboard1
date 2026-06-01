// /buildings — marketplace-style index of all active buildings.
//
// Each card links to /buildings/:short_code. Sorted by short_code numerically
// (same order plantlog uses, so engineers see what they expect). Responsive
// grid: 1 col mobile, 2 col tablet, 3 col desktop.
//
// Why a "marketplace" feel: this is the discovery surface. Engineers in the
// field will most often arrive via a quick "open /buildings, tap 26" rather
// than via deep-link, so the index needs to be tap-friendly and scan-friendly.
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe, useCanAccessAdmin } from '../../hooks/useMe';
import { useBuildings, useBuildingsRealtime } from '../../hooks/useBuildings';
import { KbSearchBar } from '../../components/buildings/KbSearchBar';

function compareByShortCode(
  a: { short_code: string | null; code: string },
  b: { short_code: string | null; code: string },
): number {
  const aKey = a.short_code ?? a.code;
  const bKey = b.short_code ?? b.code;
  const aNum = parseInt((aKey.match(/^(\d+)/) ?? ['', ''])[1], 10);
  const bNum = parseInt((bKey.match(/^(\d+)/) ?? ['', ''])[1], 10);
  const na = Number.isFinite(aNum) ? aNum : Number.POSITIVE_INFINITY;
  const nb = Number.isFinite(bNum) ? bNum : Number.POSITIVE_INFINITY;
  if (na !== nb) return na - nb;
  return aKey.localeCompare(bKey);
}

export default function BuildingsIndex() {
  const { signOut } = useAuth();
  const me = useMe();
  const canEdit = useCanAccessAdmin();
  const buildingsQ = useBuildings();
  useBuildingsRealtime();

  const buildings = (buildingsQ.data ?? []).slice().sort(compareByShortCode);

  return (
    <div className="min-h-screen t-bg">
      <header
        className="border-b"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="t-section-title">Buildings</h1>
            <p className="t-small t-muted">
              Per-building knowledge: equipment, parts, troubleshooting.
              {canEdit && <span className="ml-1">You can edit.</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/manager" className="t-small t-accent hover:underline">Dashboard</Link>
            <span className="t-small t-muted">{me.data?.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <KbSearchBar />
        {buildingsQ.isLoading ? (
          <p className="t-text t-muted">Loading buildings…</p>
        ) : buildingsQ.error ? (
          <p className="t-text t-danger">Error: {(buildingsQ.error as Error).message}</p>
        ) : buildings.length === 0 ? (
          <p className="t-text t-muted">No active buildings found.</p>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            }}
          >
            {buildings.map((b) => {
              const slug = b.short_code ?? b.code;
              return (
                <Link
                  key={b.id}
                  to={`/buildings/${encodeURIComponent(slug)}`}
                  className="t-card"
                  style={{
                    padding: 14,
                    display: 'block',
                    textDecoration: 'none',
                    color: 'inherit',
                    border: '1px solid var(--color-border)',
                    transition: 'border-color 120ms, transform 80ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                  }}
                >
                  <div
                    className="t-section-title"
                    style={{ fontSize: '1rem', marginBottom: 4 }}
                  >
                    {b.short_code ? (
                      <>
                        <span className="t-mono t-muted mr-2">{b.short_code}</span>
                        {b.name}
                      </>
                    ) : (
                      b.name
                    )}
                  </div>
                  {b.address && (
                    <div className="t-small t-muted">{b.address}</div>
                  )}
                  {b.client_company && (
                    <div className="t-small t-muted">{b.client_company}</div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
