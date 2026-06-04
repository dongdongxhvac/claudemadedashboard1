// /buildings/:short_code — one building's knowledge-base detail page.
//
// Layout per user direction 2026-06-04:
//   * Sticky header at the top with building name + short_code + address.
//     ALWAYS visible while the user scrolls — prevents accidentally
//     editing equipment under the wrong building (a real risk when
//     swapping between buildings in adjacent tabs).
//   * Four primary tabs: Equipment, Vendor Log, Inventory, SOP.
//   * SOP tab rolls up the seven free-form note sections (Overview,
//     Mechanical, Control, Electrical, Plumbing, Access, Troubleshooting)
//     under one tab with sub-tabs inside, keeping the top strip narrow.
//
// Projects panel removed from this page (data preserved; surfaced on
// the manager dashboard + TV view).
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
import { ProjectsPanel } from '../../components/buildings/ProjectsPanel';

type Tab = 'equipment' | 'vendors' | 'inventory' | 'sop' | 'projects';

const TABS: { key: Tab; label: string }[] = [
  { key: 'equipment', label: 'Equipment' },
  { key: 'vendors',   label: 'Vendor Log' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'sop',       label: 'SOP' },
  { key: 'projects',  label: 'Projects' },
];

// Sub-tab order inside the SOP tab. Overview comes first (general building
// notes), then the system-specific operational notes, then access +
// troubleshooting at the end.
const SOP_SECTION_KEYS: SectionKey[] = [
  'overview',
  'mechanical',
  'control',
  'electrical',
  'plumbing',
  'access',
  'troubleshooting',
];

export default function BuildingDetail() {
  const { short_code } = useParams<{ short_code: string }>();
  const { signOut } = useAuth();
  const me = useMe();
  const buildingsQ = useBuildings();
  const [tab, setTab] = useState<Tab>('equipment');
  const [sopSection, setSopSection] = useState<SectionKey>('overview');

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
  if (!building) {
    return <Navigate to="/buildings" replace />;
  }

  const sectionByKey = new Map(
    (sectionsQ.data ?? []).map((n) => [n.section_key, n]),
  );
  const eqCount = equipmentQ.data?.length ?? 0;

  return (
    <div className="min-h-screen t-bg">
      {/* Sticky header + tab strip as one block so building identity stays
          locked in view even when the user scrolls deep into a long
          equipment list. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'var(--color-card)',
          borderBottom: '1px solid var(--color-border)',
          boxShadow: '0 1px 0 var(--color-border-soft, rgba(0,0,0,0.04))',
        }}
      >
        {/* Building identity row */}
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-baseline justify-between gap-3 flex-wrap">
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
              <Link to="/buildings" className="t-accent hover:underline">
                ← All buildings
              </Link>
            </div>
            <div
              className="flex items-baseline gap-2 flex-wrap"
              style={{ marginTop: 2 }}
            >
              {building.short_code && (
                <span
                  className="t-mono"
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'var(--color-accent)',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    letterSpacing: '0.04em',
                  }}
                >
                  {building.short_code}
                </span>
              )}
              <h1
                className="t-section-title"
                style={{ fontSize: '1.05rem', margin: 0 }}
              >
                {building.name}
              </h1>
              {building.address && (
                <span
                  className="t-small t-muted"
                  style={{ fontSize: '0.75rem' }}
                >
                  · {building.address}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3" style={{ flex: '0 0 auto' }}>
            <Link
              to="/manager"
              className="t-small t-accent hover:underline"
              style={{ fontSize: '0.75rem' }}
            >
              Dashboard
            </Link>
            <span className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
              {me.data?.email}
            </span>
            <button
              onClick={signOut}
              className="t-small t-accent hover:underline"
              style={{ fontSize: '0.75rem' }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Primary tab strip — 4 tabs only */}
        <div className="max-w-5xl mx-auto px-4" style={{ overflowX: 'auto' }}>
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
                    padding: '8px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: isActive
                      ? '2px solid var(--color-accent)'
                      : '2px solid transparent',
                    color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: '0.85rem',
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

      <main className="max-w-5xl mx-auto px-4 py-4">
        {tab === 'equipment' && <EquipmentList buildingId={building.id} />}
        {tab === 'inventory' && <PartsPanel buildingId={building.id} />}
        {tab === 'vendors' && <VendorVisitsPanel buildingId={building.id} />}
        {tab === 'projects' && <ProjectsPanel buildingId={building.id} />}
        {tab === 'sop' && (
          <div>
            {/* SOP sub-tab strip — chooses which free-form note to edit. */}
            <div
              className="flex gap-1 flex-wrap"
              style={{
                marginBottom: 14,
                borderBottom: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))',
                paddingBottom: 4,
              }}
            >
              {SOP_SECTION_KEYS.map((k) => {
                const isActive = sopSection === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSopSection(k)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 3,
                      border: '1px solid',
                      borderColor: isActive ? 'var(--color-accent)' : 'transparent',
                      background: isActive ? 'rgba(99, 102, 241, 0.06)' : 'transparent',
                      color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 600 : 400,
                      font: 'inherit',
                    }}
                  >
                    {SECTION_LABELS[k]}
                  </button>
                );
              })}
            </div>
            <SectionEditor
              buildingId={building.id}
              sectionKey={sopSection}
              note={sectionByKey.get(sopSection)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
