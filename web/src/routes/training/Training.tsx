import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Section } from '../../components/Section';
import { useBuildingEquipmentCountsMap, type BuildingEquipmentCounts } from '../../hooks/useBuildingKb';
import {
  useSites, useTrainingBuildings, useTrainingRoster,
  type TrainingBuilding, type TrainingTech,
} from '../../hooks/useTraining';
import {
  useTrainingCuration, useSaveTrainingCuration, toggleId,
} from '../../hooks/useTrainingCuration';
import { CurationPicker } from './CurationPicker';
import { TrainingBuildingPanel } from './TrainingBuildingPanel';
import { TrainingTechPanel } from './TrainingTechPanel';

// COVE · Training view — a curated, editable pane over real building + user data.
//   * Two-pane: a sticky left rail lists the pinned buildings + techs; clicking
//     one opens its full panel on the right. Only the selected panel mounts, so
//     there's at most one live building subscription at a time.
//   * Curated panels MIRROR canonical data and edit through the SAME hooks as the
//     Building / Admin views, so edits land in all places live.
//   * The picker (users.preferences.training) chooses what's pinned.

const SITE_META = [
  { code: 'binney', label: 'Binney St', minor: false },
  { code: 'upark',  label: 'UPark',     minor: true  },
] as const;

function countsLabel(c: BuildingEquipmentCounts | undefined): string {
  if (!c) return '';
  return `${c.total} eq${c.issues ? ` · ${c.issues} open` : ''}`;
}

// ---- left-rail primitives --------------------------------------------------

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="t-small t-muted uppercase tracking-wider"
           style={{ fontSize: '0.6rem', letterSpacing: '0.08em', padding: '2px 8px 4px', position: 'sticky', top: 0, background: 'var(--color-card)' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function RailRow({ selected, onClick, primary, meta }: { selected: boolean; onClick: () => void; primary: string; meta?: string }) {
  return (
    <button
      type="button" onClick={onClick} className="t-row-hover"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '5px 8px', border: 'none', borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
        borderRadius: 4, cursor: 'pointer', font: 'inherit', color: 'var(--color-text)',
        background: selected ? 'rgba(99,102,241,0.12)' : 'transparent',
      }}
    >
      <span className="t-small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selected ? 600 : 400 }}>
        {primary}
      </span>
      {meta && <span className="t-small t-muted" style={{ whiteSpace: 'nowrap', fontSize: '0.7rem' }}>{meta}</span>}
    </button>
  );
}

// ---- read-only mirror lists (secondary, below the two-pane) -----------------

function BuildingList({ ready, loading, rows }: { ready: boolean; loading: boolean; rows: TrainingBuilding[] }) {
  if (!ready) return <p className="t-small t-muted">Pending migration 0072 + roster import.</p>;
  if (loading) return <p className="t-small t-muted">Loading…</p>;
  if (rows.length === 0) return <p className="t-small t-muted">No buildings imported for this site yet.</p>;
  return (
    <div className="space-y-1">
      {rows.map((b) => (
        <div key={b.id} className="flex items-center gap-3 px-2 py-1 t-row-hover" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
          <span className="t-mono t-small" style={{ minWidth: 56, color: 'var(--color-text)' }}>{b.short_code ?? b.code}</span>
          <span className="t-text" style={{ flex: 1, minWidth: 0 }}>{b.name}</span>
          {b.client_company && <span className="t-small t-muted">{b.client_company}</span>}
        </div>
      ))}
    </div>
  );
}

function MinorSummary({
  ready, count, noun, linkTo, linkLabel,
}: { ready: boolean; count: number; noun: string; linkTo: string; linkLabel: string }) {
  if (!ready) return <p className="t-small t-muted">Pending migration 0072 + roster import.</p>;
  return (
    <div className="flex items-center justify-between" style={{ padding: '4px 2px' }}>
      <span className="t-small t-muted">{count} {noun} loaded — for reference.</span>
      <Link to={linkTo} className="t-small t-accent hover:underline">{linkLabel}</Link>
    </div>
  );
}

function TechList({ ready, loading, rows }: { ready: boolean; loading: boolean; rows: TrainingTech[] }) {
  if (!ready) return <p className="t-small t-muted">Pending migration 0072 + roster import.</p>;
  if (loading) return <p className="t-small t-muted">Loading…</p>;
  if (rows.length === 0) return <p className="t-small t-muted">No techs assigned to this site yet.</p>;
  return (
    <div className="space-y-1">
      {rows.map((t) => (
        <div key={t.user_id} className="flex items-center gap-3 px-2 py-1 t-row-hover" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
          <span className="t-text" style={{ flex: 1, minWidth: 0 }}>{t.full_name}</span>
          {t.title && <span className="t-small t-muted">{t.title}</span>}
          {t.discipline && (
            <span className="t-small" style={{ padding: '0 6px', borderRadius: 999, background: 'var(--color-border-soft)', color: 'var(--color-text)' }}>
              {t.discipline}
            </span>
          )}
          <span className="t-small t-muted">L{t.level}</span>
          {t.is_lead && <span className="t-small" style={{ color: '#a16207' }}>★ lead</span>}
        </div>
      ))}
    </div>
  );
}

// ---- page ------------------------------------------------------------------

export default function Training() {
  const { session, signOut } = useAuth();
  const today = new Date().toLocaleDateString('en-CA');

  const sitesQ = useSites();
  const ready = sitesQ.isSuccess && sitesQ.data.length > 0;
  const bldgsQ = useTrainingBuildings(ready);
  const rosterQ = useTrainingRoster(ready);
  const countsQ = useBuildingEquipmentCountsMap();

  const { curation } = useTrainingCuration();
  const saveCuration = useSaveTrainingCuration();
  const showSec = (k: string) => curation.visibleSections.includes(k);
  const showBuildings = showSec('buildings');
  const showRoster = showSec('roster');

  const siteByCode = useMemo(
    () => new Map((sitesQ.data ?? []).map((s) => [s.code, s])),
    [sitesQ.data],
  );

  const curatedBuildings = (bldgsQ.data ?? []).filter((b) => curation.pinnedBuildingIds.includes(b.id));
  const curatedTechs = (rosterQ.data ?? []).filter((t) => curation.pinnedTechIds.includes(t.user_id));

  const onToggleEquipmentPin = (equipmentId: string) => {
    saveCuration.mutate({
      ...curation,
      pinnedEquipmentIds: toggleId(curation.pinnedEquipmentIds, equipmentId),
    });
  };

  // ---- two-pane selection (auto-pick first valid; fix when pins change) ----
  const [selected, setSelected] = useState<{ kind: 'building' | 'tech'; id: string } | null>(null);
  const validKeys = useMemo(() => {
    const s = new Set<string>();
    if (showBuildings) curatedBuildings.forEach((b) => s.add(`b:${b.id}`));
    if (showRoster) curatedTechs.forEach((t) => s.add(`t:${t.user_id}`));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBuildings, showRoster, curation.pinnedBuildingIds, curation.pinnedTechIds, bldgsQ.data, rosterQ.data]);

  useEffect(() => {
    const cur = selected ? `${selected.kind === 'building' ? 'b' : 't'}:${selected.id}` : null;
    if (cur && validKeys.has(cur)) return;
    const firstB = showBuildings ? curatedBuildings[0] : undefined;
    const firstT = showRoster ? curatedTechs[0] : undefined;
    if (firstB) setSelected({ kind: 'building', id: firstB.id });
    else if (firstT) setSelected({ kind: 'tech', id: firstT.user_id });
    else setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validKeys]);

  const selBuilding = selected?.kind === 'building' ? curatedBuildings.find((b) => b.id === selected.id) : undefined;
  const selTech = selected?.kind === 'tech' ? curatedTechs.find((t) => t.user_id === selected.id) : undefined;
  const hasPins = (showBuildings && curatedBuildings.length > 0) || (showRoster && curatedTechs.length > 0);

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="t-section-title">COVE · Training</h1>
            <p className="t-small t-muted">{today} · Technical Training &amp; Support</p>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/manager" className="t-small t-accent hover:underline">← Dashboard</Link>
            <Link to="/buildings" className="t-small t-accent hover:underline">Buildings</Link>
            <span className="t-small t-muted">{session?.user.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="t-card" style={{ background: 'var(--color-card-elevated, rgba(99,102,241,0.04))' }}>
          <p className="t-small" style={{ lineHeight: 1.5 }}>
            <b className="t-text">What this page is.</b>{' '}
            Use <b>Choose what to show</b> to pin the buildings &amp; techs you're training on; pick one in the left rail to work on it.
            Each <b>building</b> shows its real equipment &amp; SOP — editing here also updates the Buildings page.
            Each <b>tech</b> shows skills you can grade, scored on what each problem demands —{' '}
            🧠 <b>memory</b>, 🔧 <b>technical</b>, or 💡 <b>rule-of-thumb</b>.{' '}
            <span className="t-muted">Items marked <b>DRAFT</b> save in your browser while we shape the format; live items save to the database.</span>
          </p>
        </div>

        {!ready && (
          <div className="t-card" style={{ borderColor: 'var(--color-warn, #d4a017)' }}>
            <p className="t-text">
              <b>Two-site data not wired yet.</b> Apply migration <code>0072_training_sites_foundation.sql</code> and run{' '}
              <code>watcher/import_training_roster.py</code> to populate the UPark / Binney St building &amp; roster
              lists. The picker works right now.
            </p>
          </div>
        )}

        <CurationPicker ready={ready} />

        {/* ---- two-pane: pinned rail (left) + detail (right) ---- */}
        <div className="flex gap-4 items-start">
          <aside
            className="shrink-0"
            style={{ width: 250, position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}
          >
            <div className="t-card" style={{ padding: 8 }}>
              {showBuildings && (
                <RailGroup label={`Buildings (${curatedBuildings.length})`}>
                  {curatedBuildings.length === 0
                    ? <p className="t-small t-muted" style={{ padding: '2px 8px' }}>Pin buildings above.</p>
                    : curatedBuildings.map((b) => (
                        <RailRow
                          key={b.id}
                          selected={selected?.kind === 'building' && selected.id === b.id}
                          onClick={() => setSelected({ kind: 'building', id: b.id })}
                          primary={`${b.short_code ?? b.code} · ${b.name}`}
                          meta={countsLabel(countsQ.data?.get(b.id))}
                        />
                      ))}
                </RailGroup>
              )}
              {showRoster && (
                <RailGroup label={`Techs (${curatedTechs.length})`}>
                  {curatedTechs.length === 0
                    ? <p className="t-small t-muted" style={{ padding: '2px 8px' }}>Pin techs above.</p>
                    : curatedTechs.map((t) => (
                        <RailRow
                          key={t.user_id}
                          selected={selected?.kind === 'tech' && selected.id === t.user_id}
                          onClick={() => setSelected({ kind: 'tech', id: t.user_id })}
                          primary={t.full_name}
                          meta={`${t.discipline ? t.discipline + ' · ' : ''}L${t.level}`}
                        />
                      ))}
                </RailGroup>
              )}
              {!showBuildings && !showRoster && (
                <p className="t-small t-muted" style={{ padding: '4px 8px' }}>Enable Buildings / Techs in “Choose what to show”.</p>
              )}
            </div>
          </aside>

          <section className="flex-1 min-w-0">
            {selBuilding ? (
              <div className="t-card">
                <div className="flex items-baseline justify-between mb-3 gap-3">
                  <h2 className="t-section-title">{selBuilding.short_code ?? selBuilding.code} · {selBuilding.name}</h2>
                  <span className="t-small t-muted">{countsLabel(countsQ.data?.get(selBuilding.id))}</span>
                </div>
                <TrainingBuildingPanel
                  key={selBuilding.id}
                  buildingId={selBuilding.id}
                  shortCode={selBuilding.short_code ?? selBuilding.code}
                  name={selBuilding.name}
                  pinnedEquipmentIds={curation.pinnedEquipmentIds}
                  onToggleEquipmentPin={onToggleEquipmentPin}
                />
              </div>
            ) : selTech ? (
              <div className="t-card">
                <div className="flex items-baseline justify-between mb-3 gap-3">
                  <h2 className="t-section-title">{selTech.full_name}</h2>
                  <span className="t-small t-muted">
                    {selTech.discipline ? `${selTech.discipline} · ` : ''}L{selTech.level}{selTech.is_lead ? ' · ★ lead' : ''}
                  </span>
                </div>
                <TrainingTechPanel key={selTech.user_id} tech={selTech} />
              </div>
            ) : (
              <div className="t-card">
                <p className="t-small t-muted">
                  {hasPins
                    ? 'Pick a building or tech on the left.'
                    : 'Nothing pinned yet — use “Choose what to show” above to pin the buildings & techs you’re training on.'}
                </p>
              </div>
            )}
          </section>
        </div>

        {/* ---- site mirrors (read-only reference, secondary) ---- */}
        {showSec('mirrors') && SITE_META.map((m) => {
          const site = siteByCode.get(m.code);
          const list = (bldgsQ.data ?? []).filter((b) => site && b.site_id === site.id);
          return (
            <Section
              key={`b-${m.code}`}
              collapsible
              id={`sec-buildings-${m.code}`}
              title={`Buildings · ${m.label}${m.minor ? ' (reference)' : ''}`}
              subtitle={ready ? `${list.length} buildings` : 'pending 0072'}
            >
              {m.minor
                ? <MinorSummary ready={ready} count={list.length} noun="buildings" linkTo="/buildings" linkLabel="View full list →" />
                : <BuildingList ready={ready} loading={bldgsQ.isLoading} rows={list} />}
            </Section>
          );
        })}

        {showSec('mirrors') && SITE_META.map((m) => {
          const site = siteByCode.get(m.code);
          const list = (rosterQ.data ?? []).filter((t) => site && t.home_site_id === site.id);
          return (
            <Section
              key={`r-${m.code}`}
              collapsible
              id={`sec-roster-${m.code}`}
              title={`Roster · ${m.label}${m.minor ? ' (reference)' : ''}`}
              subtitle={ready ? `${list.length} techs` : 'pending 0072'}
            >
              {m.minor
                ? <MinorSummary ready={ready} count={list.length} noun="techs" linkTo="/manager" linkLabel="View on dashboard →" />
                : <TechList ready={ready} loading={rosterQ.isLoading} rows={list} />}
            </Section>
          );
        })}
      </main>
    </div>
  );
}
