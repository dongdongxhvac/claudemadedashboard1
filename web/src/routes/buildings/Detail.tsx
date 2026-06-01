// /buildings/:short_code — one building's knowledge-base detail page.
//
// Tab navigation across categories. Each tab shows either a SectionEditor
// (free-form text) or the EquipmentList (structured). Sticky tab strip
// stays visible while the section content scrolls so a field engineer
// can swipe between Mechanical and Troubleshooting fast.
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useBuildings } from '../../hooks/useBuildings';
import {
  useBuildingSections,
  useBuildingEquipment,
  useBuildingKbRealtime,
  SECTION_LABELS,
  type SectionKey,
} from '../../hooks/useBuildingKb';
import { SectionEditor } from '../../components/buildings/SectionEditor';
import { EquipmentList } from '../../components/buildings/EquipmentList';
import { PartsPanel } from '../../components/buildings/PartsPanel';
import { VendorVisitsPanel } from '../../components/buildings/VendorVisitsPanel';

// Tab order: Overview → Vendor Log → Equipment → Inventory (parts) → 4
// system categories → Access → Troubleshooting. Vendor Log sits right after
// Overview because logging a vendor visit is the most-frequent in-field
// write (engineers escorting vendors); Equipment + Inventory follow as the
// next-highest-frequency lookups.
type Tab =
  | 'overview'
  | 'vendors'
  | 'equipment'
  | 'inventory'
  | 'mechanical'
  | 'control'
  | 'electrical'
  | 'plumbing'
  | 'access'
  | 'troubleshooting';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview',        label: SECTION_LABELS.overview },
  { key: 'vendors',         label: 'Vendor Log' },
  { key: 'equipment',       label: 'Equipment' },
  { key: 'inventory',       label: 'Inventory' },
  { key: 'mechanical',      label: SECTION_LABELS.mechanical },
  { key: 'control',         label: SECTION_LABELS.control },
  { key: 'electrical',      label: SECTION_LABELS.electrical },
  { key: 'plumbing',        label: SECTION_LABELS.plumbing },
  { key: 'access',          label: SECTION_LABELS.access },
  { key: 'troubleshooting', label: SECTION_LABELS.troubleshooting },
];

const SECTION_TAB_KEYS: SectionKey[] = [
  'overview', 'mechanical', 'control', 'electrical', 'plumbing',
  'access', 'troubleshooting',
];

export default function BuildingDetail() {
  const { short_code } = useParams<{ short_code: string }>();
  const { signOut } = useAuth();
  const me = useMe();
  const buildingsQ = useBuildings();
  const [tab, setTab] = useState<Tab>('overview');

  const building = useMemo(() => {
    if (!buildingsQ.data) return undefined;
    const key = short_code ?? '';
    return buildingsQ.data.find(
      (b) =>
        b.short_code === key ||
        b.code === key ||
        (b.short_code ?? '').toLowerCase() === key.toLowerCase() ||
        b.code.toLowerCase() === key.toLowerCase(),
    );
  }, [buildingsQ.data, short_code]);

  useBuildingKbRealtime(building?.id);
  const sectionsQ = useBuildingSections(building?.id);
  const equipmentQ = useBuildingEquipment(building?.id);

  if (buildingsQ.isLoading || me.isLoading) {
    return <p className="t-text t-muted p-6">Loading…</p>;
  }

  // No building matched the URL slug — bounce to the index.
  if (!building) {
    return <Navigate to="/buildings" replace />;
  }

  const sectionByKey = new Map(
    (sectionsQ.data ?? []).map((n) => [n.section_key, n]),
  );

  // Equipment-count badge on the Equipment tab so people see at a glance
  // whether this building has any structured records yet.
  const eqCount = equipmentQ.data?.length ?? 0;

  return (
    <div className="min-h-screen t-bg">
      {/* slim header */}
      <header
        className="border-b"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="t-small t-muted">
              <Link to="/buildings" className="t-accent hover:underline">← All buildings</Link>
            </div>
            <h1 className="t-section-title mt-1">{building.name}</h1>
            {building.address && (
              <p className="t-small t-muted">{building.address}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link to="/manager" className="t-small t-accent hover:underline">Dashboard</Link>
            <span className="t-small t-muted">{me.data?.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      {/* sticky tab strip */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'var(--color-card)',
          borderBottom: '1px solid var(--color-border)',
          overflowX: 'auto',
        }}
      >
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex gap-1" style={{ minWidth: 'max-content' }}>
            {TABS.map((t) => {
              const isActive = tab === t.key;
              const isEquipment = t.key === 'equipment';
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className="t-small"
                  style={{
                    padding: '10px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: isActive
                      ? '2px solid var(--color-accent)'
                      : '2px solid transparent',
                    color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {t.label}
                  {isEquipment && eqCount > 0 && (
                    <span
                      className="ml-1 t-muted"
                      style={{ fontSize: '0.65rem' }}
                    >
                      ({eqCount})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === 'equipment' ? (
          <EquipmentList buildingId={building.id} />
        ) : tab === 'inventory' ? (
          <PartsPanel buildingId={building.id} />
        ) : tab === 'vendors' ? (
          <VendorVisitsPanel buildingId={building.id} />
        ) : SECTION_TAB_KEYS.includes(tab as SectionKey) ? (
          <SectionEditor
            buildingId={building.id}
            sectionKey={tab as SectionKey}
            note={sectionByKey.get(tab as SectionKey)}
          />
        ) : null}
      </main>
    </div>
  );
}
