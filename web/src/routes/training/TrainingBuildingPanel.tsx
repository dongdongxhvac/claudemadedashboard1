import { useMemo, useState } from 'react';
import {
  useBuildingSections,
  useBuildingEquipment,
  useBuildingKbRealtime,
  SECTION_LABELS,
  type SectionKey,
} from '../../hooks/useBuildingKb';
import { SectionEditor } from '../../components/buildings/SectionEditor';
import { EquipmentList } from '../../components/buildings/EquipmentList';
import {
  DraftTable, DraftBadge, DraftBody, useLocalDraft, makeRow,
  type DraftColumn, type DraftRow,
} from './draftTable';
import { SOP_SECTION_KEYS, FACET_HINT, draftKey } from './trainingSections';
import { ProblemAxisLegend } from './ProblemAxisLegend';

// Lazy per-building panel for the Training view. Mounted only when its outer
// collapsible <Section> is expanded (Section unmounts children while collapsed),
// so the building-scoped hooks + realtime channel below come and go with expand
// /collapse — capping live subscriptions to currently-open buildings.
//
// REAL (single-source via reuse): the embedded EquipmentList + SectionEditor
// write through the canonical useBuildingKb mutations and share the cache keys
// ['building_equipment', id] / ['building_section_notes', id], so an edit here
// and an edit on /buildings/:code refresh each other automatically.
//
// DRAFT (prototype): the per-equipment faceted SOP + the real-world problem
// library are localStorage-only, keyed by the real equipment id, until we lock
// their schema.

const EQUIPMENT_SOP_COLS: DraftColumn[] = [
  { key: 'facet', label: 'Facet', width: '13%', placeholder: FACET_HINT },
  { key: 'task', label: 'Task', width: '22%', placeholder: 'e.g. tube-clean, oil sample' },
  { key: 'steps', label: 'Steps', width: '37%' },
  { key: 'tools', label: 'Tools', width: '14%' },
  { key: 'frequency', label: 'Freq', width: '14%', placeholder: 'monthly / annual' },
];

// Real-world problem library for one asset. The 3 skill flags = which skills the
// problem demands (the per-tech LEVEL on each lives in the tech panel):
//   Mem = follow SOP from memory · Tech = hands-on skill + troubleshooting ·
//   Rule = finish with no operation interruption / no alarms.
const PROBLEM_COLS: DraftColumn[] = [
  { key: 'problem', label: 'Problem', width: '22%', placeholder: 'Reset VFD after fault' },
  { key: 'symptom', label: 'Symptom / trigger', width: '18%', placeholder: 'fault shown; equipment stopped' },
  { key: 'solution', label: 'Solution / SOP', width: '28%' },
  { key: 'mem', label: 'Mem', width: '7%', placeholder: 'Y' },
  { key: 'tech', label: 'Tech', width: '7%', placeholder: 'Y' },
  { key: 'rule', label: 'Rule', width: '7%', placeholder: 'Y' },
  { key: 'source', label: 'Source', width: '11%', placeholder: 'history / anticipated' },
];

const seedProblems = (): DraftRow[] => [
  makeRow({
    problem: 'e.g. Reset VFD after a fault',
    symptom: 'VFD shows fault; fan / pump stopped',
    solution: 'Follow reset SOP: clear fault, confirm cause cleared, restart per sequence',
    mem: 'Y', tech: '', rule: 'Y', source: 'history',
  }),
  makeRow({
    problem: 'e.g. VFD keeps tripping — find why',
    symptom: 'Repeated overcurrent / overtemp trips',
    solution: 'Diagnose: motor amps vs FLA, load, params, cooling. No-disruption: work on bypass so the space stays served.',
    mem: '', tech: 'Y', rule: 'Y', source: 'history',
  }),
];

type Tab = 'equipment' | 'sop' | 'eqsop' | 'problems';

const TABS: { key: Tab; label: string }[] = [
  { key: 'equipment', label: 'Equipment (live)' },
  { key: 'sop', label: 'Building SOP (live)' },
  { key: 'eqsop', label: 'Equipment SOP (draft)' },
  { key: 'problems', label: 'Problems (draft)' },
];

export function TrainingBuildingPanel({
  buildingId,
  shortCode,
  name,
  pinnedEquipmentIds,
  onToggleEquipmentPin,
}: {
  buildingId: string;
  shortCode: string;
  name: string;
  pinnedEquipmentIds: string[];
  onToggleEquipmentPin: (equipmentId: string) => void;
}) {
  useBuildingKbRealtime(buildingId);
  const sectionsQ = useBuildingSections(buildingId);
  const eqQ = useBuildingEquipment(buildingId);

  const [tab, setTab] = useState<Tab>('equipment');
  const [sopSection, setSopSection] = useState<SectionKey>('overview');
  const [showFocus, setShowFocus] = useState(false);
  const [draftEqId, setDraftEqId] = useState<string>('');

  const equipment = eqQ.data ?? [];
  const sectionByKey = useMemo(
    () => new Map((sectionsQ.data ?? []).map((n) => [n.section_key, n])),
    [sectionsQ.data],
  );

  // Pinned-equipment ids that actually belong to THIS building.
  const focusIds = useMemo(
    () => equipment.filter((e) => pinnedEquipmentIds.includes(e.id)).map((e) => e.id),
    [equipment, pinnedEquipmentIds],
  );

  const eqLabel = (e: { short_name: string | null; full_name: string }) =>
    e.short_name ? `${e.short_name} · ${e.full_name}` : e.full_name;

  const needsAsset = tab === 'eqsop' || tab === 'problems';

  return (
    <div>
      {/* sub-tab strip */}
      <div className="flex gap-1 flex-wrap" style={{ marginBottom: 12, borderBottom: '1px solid var(--color-border-soft)', paddingBottom: 4 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="t-small"
              style={{
                padding: '4px 10px', borderRadius: 3, border: '1px solid',
                borderColor: active ? 'var(--color-accent)' : 'transparent',
                background: active ? 'rgba(99,102,241,0.06)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                cursor: 'pointer', font: 'inherit', fontWeight: active ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'equipment' && (
        <div>
          {/* Focus-assets picker — toggles which equipment this curated panel
              shows. Pins persist in users.preferences (parent handles save). */}
          <button
            type="button"
            onClick={() => setShowFocus((s) => !s)}
            className="t-small t-accent"
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8 }}
          >
            {showFocus ? '▾' : '▸'} Focus specific assets
            {focusIds.length > 0 && (
              <span className="t-muted"> · showing {focusIds.length} of {equipment.length}</span>
            )}
          </button>
          {showFocus && (
            <div
              style={{
                maxHeight: 180, overflowY: 'auto', marginBottom: 12,
                border: '1px solid var(--color-border-soft)', borderRadius: 4, padding: 6,
              }}
            >
              {equipment.length === 0 && <p className="t-small t-muted">No equipment yet.</p>}
              {equipment.map((e) => (
                <label key={e.id} className="flex items-center gap-2 t-row-hover" style={{ padding: '2px 4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pinnedEquipmentIds.includes(e.id)}
                    onChange={() => onToggleEquipmentPin(e.id)}
                  />
                  <span className="t-small">{eqLabel(e)}</span>
                </label>
              ))}
              {focusIds.length > 0 && (
                <p className="t-small t-muted" style={{ marginTop: 4 }}>
                  Unchecking all shows every asset again.
                </p>
              )}
            </div>
          )}

          <EquipmentList
            buildingId={buildingId}
            buildingShortCode={shortCode}
            buildingName={name}
            onlyEquipmentIds={focusIds.length > 0 ? focusIds : undefined}
          />
        </div>
      )}

      {tab === 'sop' && (
        <div>
          <div className="flex gap-1 flex-wrap" style={{ marginBottom: 12, borderBottom: '1px solid var(--color-border-soft)', paddingBottom: 4 }}>
            {SOP_SECTION_KEYS.map((k) => {
              const active = sopSection === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSopSection(k)}
                  className="t-small"
                  style={{
                    padding: '3px 9px', borderRadius: 3, border: '1px solid',
                    borderColor: active ? 'var(--color-accent)' : 'transparent',
                    background: active ? 'rgba(99,102,241,0.06)' : 'transparent',
                    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                    cursor: 'pointer', font: 'inherit', fontWeight: active ? 600 : 400,
                  }}
                >
                  {SECTION_LABELS[k]}
                </button>
              );
            })}
          </div>
          <SectionEditor
            buildingId={buildingId}
            sectionKey={sopSection}
            note={sectionByKey.get(sopSection)}
          />
        </div>
      )}

      {/* Shared asset selector for the two per-equipment draft tabs. */}
      {needsAsset && (
        <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
          <span className="t-small t-muted">Asset:</span>
          <select
            value={draftEqId}
            onChange={(e) => setDraftEqId(e.target.value)}
            className="t-text"
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— pick equipment —</option>
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>{eqLabel(e)}</option>
            ))}
          </select>
          <DraftBadge />
        </div>
      )}

      {tab === 'eqsop' && (
        <DraftBody intro="Prototype an equipment SOP, sectioned by the four facets. Draft only (saved in this browser, keyed to the asset) until we lock the SOP schema.">
          {draftEqId
            ? <EquipmentSopDraft key={draftEqId} equipmentId={draftEqId} />
            : <p className="t-small t-muted">Pick an asset above to draft its SOP.</p>}
        </DraftBody>
      )}

      {tab === 'problems' && (
        <DraftBody intro="Real-world problems for this asset — building- & equipment-specific. Tag each with the skills it demands (Mem / Tech / Rule); the per-tech level on each lives in the tech panel. Draft now; will merge with logged issue history when locked.">
          <ProblemAxisLegend />
          {draftEqId
            ? <EquipmentProblems key={draftEqId} equipmentId={draftEqId} />
            : <p className="t-small t-muted">Pick an asset above to list its real-world problems.</p>}
        </DraftBody>
      )}
    </div>
  );
}

// Separate components so each per-equipment localStorage draft hook has a stable
// key (remounts via `key={draftEqId}` when the asset changes).

function EquipmentSopDraft({ equipmentId }: { equipmentId: string }) {
  const [rows, setRows] = useLocalDraft(draftKey.equipmentSop(equipmentId), () => []);
  return (
    <DraftTable columns={EQUIPMENT_SOP_COLS} rows={rows} onChange={setRows} addLabel="Add SOP line" />
  );
}

function EquipmentProblems({ equipmentId }: { equipmentId: string }) {
  const [rows, setRows] = useLocalDraft(draftKey.equipmentProblems(equipmentId), seedProblems);
  return (
    <DraftTable columns={PROBLEM_COLS} rows={rows} onChange={setRows} addLabel="Add problem" />
  );
}
