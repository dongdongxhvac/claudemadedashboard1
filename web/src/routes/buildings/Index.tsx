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
import {
  useBuildingEquipmentCountsMap,
  useBuildingEquipmentDownRealtime,
} from '../../hooks/useBuildingKb';
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
  const countsQ    = useBuildingEquipmentCountsMap();
  useBuildingsRealtime();
  // Counts refresh on any equipment status change so the issue tally on
  // the cards always reflects current state.
  useBuildingEquipmentDownRealtime();

  const buildings = (buildingsQ.data ?? []).slice().sort(compareByShortCode);
  const countsMap = countsQ.data;

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
              const slug   = b.short_code ?? b.code;
              const counts = countsMap?.get(b.id);
              const hasIssues = (counts?.issues ?? 0) > 0;
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
                    /* Subtle left border tints to red when this building has
                       any equipment in off-PM / down-CM / degraded / bypass.
                       Same color logic as the §10.1 status pills. */
                    border: '1px solid var(--color-border)',
                    borderLeft: hasIssues
                      ? '3px solid var(--color-danger)'
                      : '1px solid var(--color-border)',
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
                  {/* Per-card equipment + issue rollup. Renders even when
                      counts are zero so the user knows the building has
                      been catalogued; "0 equipment" is meaningful as
                      "nothing in the KB yet — go fill it in". */}
                  <div className="t-small t-muted mt-2" style={{ fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                      {counts?.total ?? 0}
                    </span>{' '}
                    equipment
                    {hasIssues && (
                      <>
                        <span className="mx-1" style={{ color: 'var(--color-text-muted)' }}>·</span>
                        <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>
                          {counts!.issues}
                        </span>{' '}
                        issue{counts!.issues === 1 ? '' : 's'}
                        <span className="t-muted ml-1" style={{ fontSize: '0.7rem' }}>
                          (
                          {[
                            counts!.down_cm  > 0 && `${counts!.down_cm} CM`,
                            counts!.off_pm   > 0 && `${counts!.off_pm} PM`,
                            counts!.degraded > 0 && `${counts!.degraded} deg`,
                            counts!.bypass   > 0 && `${counts!.bypass} byp`,
                          ].filter(Boolean).join(' · ')}
                          )
                        </span>
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
