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
  DraftTable, DraftBadge, DraftBody, useLocalDraft,
  type DraftColumn,
} from './draftTable';
import { SOP_SECTION_KEYS, FACET_HINT, draftKey } from './trainingSections';

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
// DRAFT (prototype): the per-equipment faceted SOP is localStorage-only, keyed
// by the real equipment id, until we lock the SOP schema.

const EQUIPMENT_SOP_COLS: DraftColumn[] = [
  { key: 'facet', label: 'Facet', width: '13%', placeholder: FACET_HINT },
  { key: 'task', label: 'Task', width: '22%', placeholder: 'e.g. tube-clean, oil sample' },
  { key: 'steps', label: 'Steps', width: '37%' },
  { key: 'tools', label: 'Tools', width: '14%' },
  { key: 'frequency', label: 'Freq', width: '14%', placeholder: 'monthly / annual' },
];

type Tab = 'equipment' | 'sop' | 'eqsop';

const TABS: { key: Tab; label: string }[] = [
  { key: 'equipment', label: 'Equipment (live)' },
  { key: 'sop', label: 'Building SOP (live)' },
  { key: 'eqsop', label: 'Equipment SOP (draft)' },
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

      {tab === 'eqsop' && (
        <DraftBody intro="Prototype an equipment SOP, sectioned by the four facets. Draft only (saved in this browser, keyed to the asset) until we lock the SOP schema.">
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
          {draftEqId
            ? <EquipmentSopDraft key={draftEqId} equipmentId={draftEqId} />
            : <p className="t-small t-muted">Pick an asset to draft its SOP.</p>}
        </DraftBody>
      )}
    </div>
  );
}

// Separate component so the per-equipment localStorage draft hook has a stable
// key (remounts via `key={draftEqId}` when the asset changes).
function EquipmentSopDraft({ equipmentId }: { equipmentId: string }) {
  const [rows, setRows] = useLocalDraft(draftKey.equipmentSop(equipmentId), () => []);
  return (
    <DraftTable
      columns={EQUIPMENT_SOP_COLS}
      rows={rows}
      onChange={setRows}
      addLabel="Add SOP line"
    />
  );
}
