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
import {
  DraftTable, DraftBadge, DraftBody, useLocalDraft, makeRow,
  type DraftColumn, type DraftRow,
} from './draftTable';

// COVE · Training view — a curated, editable pane over real building + user data.
//   * Curated buildings/techs MIRROR canonical data and edit through the SAME
//     hooks as the Building / Admin views, so edits land in all places live.
//   * The picker (users.preferences.training) chooses the partial subset shown.
//   * SOP + skill RECORDS are prototyped as entity-anchored drafts (localStorage)
//     until their schema is locked. Layout mirrors the Admin/Manager chrome.

// Order matters: Binney St first because it's the brand-new site we're
// building out. UPark already has its 14 buildings + ~5 of 12 techs seeded,
// so it's rendered as a compact summary by default ("minor" presence) and
// can be expanded only when reference is needed.
const SITE_META = [
  { code: 'binney', label: 'Binney St', buildings: 28, techs: 19, minor: false },
  { code: 'upark',  label: 'UPark',     buildings: 14, techs: 12, minor: true  },
] as const;

// ---- draft column definitions (global template prototypes) -----------------

const ONBOARDING_COLS: DraftColumn[] = [
  { key: 'phase',   label: 'Phase',       width: '22%', placeholder: 'Week 1 · Safety' },
  { key: 'item',    label: 'Item',        width: '40%' },
  { key: 'type',    label: 'Type',        width: '16%', placeholder: 'classroom / lab / shadow / competency / cert' },
  { key: 'due',     label: 'Due (days)',  width: '10%' },
  { key: 'signoff', label: 'Sign-off by', width: '12%', placeholder: 'Lead / Primary / Supervisor' },
];

const SOP_COLS: DraftColumn[] = [
  { key: 'facet',   label: 'Facet',   width: '14%', placeholder: 'PM / Reset / Support / Knowledge' },
  { key: 'heading', label: 'Heading', width: '22%' },
  { key: 'detail',  label: 'Detail',  width: '40%' },
  { key: 'tools',   label: 'Tools',   width: '12%' },
  { key: 'cadence', label: 'Cadence', width: '12%' },
];

const CATALOG_COLS: DraftColumn[] = [
  { key: 'code',        label: 'Code',       width: '14%' },
  { key: 'name',        label: 'Competency', width: '26%' },
  { key: 'discipline',  label: 'Discipline', width: '10%', placeholder: 'M / E / P / BMS / FLS' },
  { key: 'facets',      label: 'Facets',     width: '22%', placeholder: 'PM,Reset,Support,Knowledge' },
  { key: 'description', label: 'Notes',      width: '28%' },
];

const CURRICULUM_COLS: DraftColumn[] = [
  { key: 'curriculum', label: 'Curriculum', width: '24%' },
  { key: 'scope',      label: 'For',        width: '18%', placeholder: 'role / discipline' },
  { key: 'itemType',   label: 'Item type',  width: '16%', placeholder: 'course / competency / cert' },
  { key: 'item',       label: 'Item',       width: '24%' },
  { key: 'target',     label: 'Target',     width: '18%', placeholder: 'level 3 / hold' },
];

const REQUIREMENTS_COLS: DraftColumn[] = [
  { key: 'scope',       label: 'Scope',        width: '28%', placeholder: 'role / discipline / building rule / on-call' },
  { key: 'requirement', label: 'Requirement',  width: '34%' },
  { key: 'minLevel',    label: 'Min level',    width: '18%', placeholder: '2 assisted / 3 independent' },
  { key: 'cert',        label: 'Required cert', width: '20%' },
];

// ---- seed rows (realistic examples; editable, delete-able) -----------------

const seedOnboarding = (): DraftRow[] => [
  makeRow({ phase: 'Week 1 · Safety', item: 'Site LOTO orientation: red lock / green lock / tag / no lock', type: 'classroom', due: '3', signoff: 'Lead' }),
  makeRow({ phase: 'Week 1 · Safety', item: 'NFPA 70E arc-flash awareness', type: 'cert', due: '5', signoff: 'Lead' }),
  makeRow({ phase: 'Week 2 · Systems', item: 'Chiller plant startup — shadow primary', type: 'shadow', due: '10', signoff: 'Primary' }),
  makeRow({ phase: 'Week 3 · Systems', item: 'BAS alarm triage basics', type: 'lab', due: '15', signoff: 'Lead' }),
  makeRow({ phase: 'Week 4 · Sign-off', item: 'Independent AHU filter-swap PM', type: 'competency', due: '20', signoff: 'Supervisor' }),
];

const seedSop = (): DraftRow[] => [
  makeRow({ facet: 'PM', heading: 'Pre-checks', detail: 'Verify run status; log baseline readings (temps / pressures / amps)', tools: 'gauges, DMM', cadence: 'per PM' }),
  makeRow({ facet: 'PM', heading: 'Procedure steps', detail: 'Numbered steps with isolation per LOTO taxonomy', tools: '—', cadence: 'per PM' }),
  makeRow({ facet: 'Reset', heading: 'Trip recovery', detail: 'Conditions to confirm before reset; reset sequence', tools: 'HMI', cadence: 'as needed' }),
  makeRow({ facet: 'Support', heading: 'Common issues / solutions', detail: 'Top failure modes + fixes (links to Equipment KB)', tools: '—', cadence: 'reference' }),
  makeRow({ facet: 'Knowledge', heading: 'Theory / refs', detail: 'How the system works; P&ID; manufacturer refs', tools: '—', cadence: 'reference' }),
];

const seedCatalog = (): DraftRow[] => [
  makeRow({ code: 'CHW-START', name: 'Chiller plant startup / shutdown', discipline: 'M', facets: 'PM,Reset,Support,Knowledge', description: 'Sequence, interlocks, safeties' }),
  makeRow({ code: 'BAS-ALARM', name: 'BAS alarm triage', discipline: 'BMS', facets: 'Support,Knowledge', description: 'Identify, acknowledge, dispatch' }),
  makeRow({ code: 'VFD-TS', name: 'VFD troubleshooting', discipline: 'E', facets: 'Support,Reset,Knowledge', description: 'Faults, parameters, bypass' }),
  makeRow({ code: 'BLR-BD', name: 'Boiler blowdown', discipline: 'M', facets: 'PM,Knowledge', description: 'Surface / bottom blowdown procedure' }),
];

const seedCurricula = (): DraftRow[] => [
  makeRow({ curriculum: 'New Building Engineer', scope: 'engineer (M)', itemType: 'competency', item: 'CHW-START', target: 'level 3 independent' }),
  makeRow({ curriculum: 'New Building Engineer', scope: 'engineer (M)', itemType: 'cert', item: 'EPA 608', target: 'hold' }),
  makeRow({ curriculum: 'BMS Specialist', scope: 'engineer (BMS)', itemType: 'competency', item: 'BAS-ALARM', target: 'level 4 trainer' }),
  makeRow({ curriculum: 'Lead path', scope: 'lead', itemType: 'competency', item: 'CHW-START', target: 'level 4 trainer' }),
];

const seedRequirements = (): DraftRow[] => [
  makeRow({ scope: 'Every building (critical equip)', requirement: '>=1 tech PM-competent on each critical asset', minLevel: '3 independent', cert: '—' }),
  makeRow({ scope: 'Engineer (M) baseline', requirement: 'CHW-START', minLevel: '2 assisted', cert: 'EPA 608' }),
  makeRow({ scope: 'BMS coverage', requirement: 'BAS-ALARM', minLevel: '3 independent', cert: '—' }),
  makeRow({ scope: 'Off-hours on-call', requirement: 'Reset on all plant equipment', minLevel: '3 independent', cert: '—' }),
];

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

/** Compact one-line render for "minor" sites — data already lives elsewhere
 *  in the app, so we don't duplicate the list here; just show the count and
 *  link out to where the full view lives. */
function MinorSummary({
  ready, count, total, noun, linkTo, linkLabel,
}: { ready: boolean; count: number; total: number; noun: string; linkTo: string; linkLabel: string }) {
  if (!ready) return <p className="t-small t-muted">Pending migration 0072 + roster import.</p>;
  return (
    <div className="flex items-center justify-between" style={{ padding: '4px 2px' }}>
      <span className="t-small t-muted">
        {count} of {total} {noun} already loaded — for reference.
      </span>
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

  const [onboarding, setOnboarding] = useLocalDraft('onboarding', seedOnboarding);
  const [sopTemplate, setSopTemplate] = useLocalDraft('sop_template', seedSop);
  const [catalog, setCatalog] = useLocalDraft('competency_catalog', seedCatalog);
  const [curricula, setCurricula] = useLocalDraft('curriculums', seedCurricula);
  const [requirements, setRequirements] = useLocalDraft('requirements_matrix', seedRequirements);

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
        {!ready && (
          <div className="t-card" style={{ borderColor: 'var(--color-warn, #d4a017)' }}>
            <p className="t-text">
              <b>Two-site data not wired yet.</b> Apply migration <code>0072_training_sites_foundation.sql</code> and run{' '}
              <code>watcher/import_training_roster.py</code> to populate the UPark / Binney St building &amp; roster
              sections. The picker &amp; template sections work right now.
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

        {/* Site mirrors (read-only overview). */}
        {showSec('mirrors') && SITE_META.map((m) => {
          const site = siteByCode.get(m.code);
          const list = (bldgsQ.data ?? []).filter((b) => site && b.site_id === site.id);
          return (
            <Section
              key={`b-${m.code}`}
              collapsible
              id={`sec-buildings-${m.code}`}
              title={`Buildings · ${m.label}${m.minor ? ' (reference)' : ''}`}
              subtitle={ready ? `${list.length} of ${m.buildings}` : 'pending 0072'}
            >
              {m.minor ? (
                <MinorSummary
                  ready={ready}
                  count={list.length}
                  total={m.buildings}
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
              subtitle={ready ? `${list.length} of ${m.techs} techs` : 'pending 0072'}
            >
              {m.minor ? (
                <MinorSummary
                  ready={ready}
                  count={list.length}
                  total={m.techs}
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

        {/* Global template prototypes. */}
        {showSec('drafts') && (
          <>
            <Section collapsible id="sec-onboarding" title="Onboarding Training" subtitle={<DraftBadge />}>
              <DraftBody intro="New-hire curriculum: ordered items by phase, each with a type and a sign-off owner.">
                <DraftTable columns={ONBOARDING_COLS} rows={onboarding} onChange={setOnboarding} addLabel="Add onboarding item" />
              </DraftBody>
            </Section>

            <Section collapsible id="sec-sop-template" title="SOP Template" subtitle={<DraftBadge />}>
              <DraftBody intro="The shape of an equipment SOP, organized by the four facets — PM / Reset / Support / Knowledge.">
                <DraftTable columns={SOP_COLS} rows={sopTemplate} onChange={setSopTemplate} addLabel="Add template field" />
              </DraftBody>
            </Section>

            <Section collapsible id="sec-competency-catalog" title="Competency Catalog" subtitle={<DraftBadge />}>
              <DraftBody intro="The catalog of trainable competencies. Facets list which of PM / Reset / Support / Knowledge apply.">
                <DraftTable columns={CATALOG_COLS} rows={catalog} onChange={setCatalog} addLabel="Add competency" />
              </DraftBody>
            </Section>

            <Section collapsible id="sec-curriculums" title="Curriculums" subtitle={<DraftBadge />}>
              <DraftBody intro="Named bundles of courses, competencies, and certs targeted at a role or discipline.">
                <DraftTable columns={CURRICULUM_COLS} rows={curricula} onChange={setCurricula} addLabel="Add curriculum item" />
              </DraftBody>
            </Section>

            <Section collapsible id="sec-requirements-matrix" title="Requirements Matrix" subtitle={<DraftBadge />}>
              <DraftBody intro="What competency level / cert is required, by scope (role, discipline, building rule, on-call).">
                <DraftTable columns={REQUIREMENTS_COLS} rows={requirements} onChange={setRequirements} addLabel="Add requirement" />
              </DraftBody>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
