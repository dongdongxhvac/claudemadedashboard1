import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Section } from '../../components/Section';
import { useBuildingEquipmentCountsMap } from '../../hooks/useBuildingKb';
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
//   * Curated buildings/techs MIRROR canonical data and edit through the SAME
//     hooks as the Building / Admin views, so edits land in all places live.
//   * The picker (users.preferences.training) chooses the partial subset shown.
//   * SOP + skill RECORDS are prototyped as entity-anchored drafts (localStorage,
//     keyed to a real building/equipment/tech id) until their schema is locked.
//
// Phase 0 of the redesign cut the 5 old global "template" draft tables
// (Onboarding / SOP Template / Competency Catalog / Curriculums / Requirements
// Matrix) — they predated the problem-based model and duplicated it. Their old
// localStorage keys (cove.training.draft:onboarding etc.) are now orphaned and
// simply never read.

// Binney St first (the brand-new site we're building out); UPark second and
// rendered as a compact reference, since its data already lives in the main app.
const SITE_META = [
  { code: 'binney', label: 'Binney St', minor: false },
  { code: 'upark',  label: 'UPark',     minor: true  },
] as const;

// ---- read-only mirror lists ------------------------------------------------

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

/** Compact one-line render for "minor" sites — data already lives elsewhere in
 *  the app, so we don't duplicate the list; just show the real count + link out. */
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

  const siteByCode = useMemo(
    () => new Map((sitesQ.data ?? []).map((s) => [s.code, s])),
    [sitesQ.data],
  );

  // Curated subsets (real rows filtered to the saved pins).
  const curatedBuildings = (bldgsQ.data ?? []).filter((b) => curation.pinnedBuildingIds.includes(b.id));
  const curatedTechs = (rosterQ.data ?? []).filter((t) => curation.pinnedTechIds.includes(t.user_id));

  // Inline equipment pin toggle — spreads the latest curation so it never
  // clobbers the picker's building/tech/section fields.
  const onToggleEquipmentPin = (equipmentId: string) => {
    saveCuration.mutate({
      ...curation,
      pinnedEquipmentIds: toggleId(curation.pinnedEquipmentIds, equipmentId),
    });
  };

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
            Use <b>Choose what to show</b> to pick the buildings &amp; techs you're training on.
            Each <b>building</b> shows its real equipment &amp; SOP — editing here also updates the Buildings page.
            Each <b>tech</b> shows skills you can grade. The goal: training built around real-world{' '}
            <b>problems</b> (per building, per equipment), with each tech scored on what the problem demands —{' '}
            🧠 <b>memory</b>, 🔧 <b>technical</b>, or 💡 <b>rule-of-thumb</b>.{' '}
            <span className="t-muted">Items marked <b>DRAFT</b> save in your browser while we shape the format; live items save to the database.</span>
          </p>
        </div>

        {!ready && (
          <div className="t-card" style={{ borderColor: 'var(--color-warn, #d4a017)' }}>
            <p className="t-text">
              <b>Two-site data not wired yet.</b> Apply migration <code>0072_training_sites_foundation.sql</code> and run{' '}
              <code>watcher/import_training_roster.py</code> to populate the UPark / Binney St building &amp; roster
              sections. The picker works right now.
            </p>
          </div>
        )}

        <CurationPicker ready={ready} />

        {/* Curated buildings — live + editable, single-source with the Building view. */}
        {showSec('buildings') && (
          curatedBuildings.length === 0 ? (
            <div className="t-card"><p className="t-small t-muted">No buildings picked yet — choose some in “Choose what to show” to mirror their equipment + SOP here.</p></div>
          ) : (
            curatedBuildings.map((b) => {
              const counts = countsQ.data?.get(b.id);
              return (
                <Section
                  key={`tb-${b.id}`}
                  collapsible
                  id={`sec-train-bldg-${b.id}`}
                  title={`${b.short_code ?? b.code} · ${b.name}`}
                  subtitle={counts ? `${counts.total} equipment${counts.issues ? ` · ${counts.issues} open` : ''}` : undefined}
                >
                  <TrainingBuildingPanel
                    buildingId={b.id}
                    shortCode={b.short_code ?? b.code}
                    name={b.name}
                    pinnedEquipmentIds={curation.pinnedEquipmentIds}
                    onToggleEquipmentPin={onToggleEquipmentPin}
                  />
                </Section>
              );
            })
          )
        )}

        {/* Curated techs — profile edits sync to Admin; skill records are drafts. */}
        {showSec('roster') && (
          curatedTechs.length === 0 ? (
            <div className="t-card"><p className="t-small t-muted">No techs picked yet — choose some in “Choose what to show” to track their skills + history here.</p></div>
          ) : (
            curatedTechs.map((t) => (
              <Section
                key={`tt-${t.user_id}`}
                collapsible
                id={`sec-train-tech-${t.user_id}`}
                title={t.full_name}
                subtitle={t.discipline ? `${t.discipline} · L${t.level}` : `L${t.level}`}
              >
                <TrainingTechPanel tech={t} />
              </Section>
            ))
          )
        )}

        {/* Site mirrors (read-only overview). Counts are the real row counts. */}
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
              {m.minor ? (
                <MinorSummary
                  ready={ready}
                  count={list.length}
                  noun="buildings"
                  linkTo="/buildings"
                  linkLabel="View full list →"
                />
              ) : (
                <BuildingList ready={ready} loading={bldgsQ.isLoading} rows={list} />
              )}
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
              {m.minor ? (
                <MinorSummary
                  ready={ready}
                  count={list.length}
                  noun="techs"
                  linkTo="/manager"
                  linkLabel="View on dashboard →"
                />
              ) : (
                <TechList ready={ready} loading={rosterQ.isLoading} rows={list} />
              )}
            </Section>
          );
        })}
      </main>
    </div>
  );
}
