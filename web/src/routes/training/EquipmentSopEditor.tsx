import { useEffect, useMemo, useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useEquipmentSops, useEquipmentSopsRealtime, useSaveEquipmentSops,
  toEditable, blankEditable,
  SOP_FACETS, SOP_LOTO,
  type EditableSopRow, type SopFacet, type SopLoto,
} from '../../hooks/useEquipmentSops';
import { draftKey } from './trainingSections';
import type { DraftRow } from './draftTable';

// Live (DB-backed) editor for an equipment's faceted SOP — the Phase-1 graduation
// of the old localStorage SOP draft. Working-copy + Save (like CurationPicker) so
// edits batch into one write. Offers a one-click import of any leftover browser
// draft for this asset, so nothing typed during prototyping is lost.

const cellStyle: React.CSSProperties = {
  width: '100%', background: 'transparent',
  border: '1px solid transparent', borderRadius: 4, padding: '3px 6px',
};
const focusBorder = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = 'var(--color-border)'; };
const blurBorder = (e: React.FocusEvent<HTMLElement>) => { e.currentTarget.style.borderColor = 'transparent'; };

function normalizeFacet(f?: string): SopFacet {
  const v = (f ?? '').trim().toLowerCase();
  if (v.startsWith('reset')) return 'reset';
  if (v.startsWith('support')) return 'support';
  if (v.startsWith('know')) return 'knowledge';
  return 'pm';
}

function mapDraft(rows: DraftRow[]): EditableSopRow[] {
  return rows
    .map((r) => ({
      ...blankEditable(),
      facet: normalizeFacet(r.facet),
      name: (r.task ?? '').trim(),
      body: (r.steps ?? '').trim(),
      tools: (r.tools ?? '').trim(),
      frequency: (r.frequency ?? '').trim(),
    }))
    .filter((r) => r.name);
}

export function EquipmentSopEditor({ equipmentId }: { equipmentId: string }) {
  const canEdit = useCanAccessAdmin();
  const rowsQ = useEquipmentSops(equipmentId);
  const save = useSaveEquipmentSops();
  useEquipmentSopsRealtime(equipmentId);

  const draftStorageKey = `cove.training.draft:${draftKey.equipmentSop(equipmentId)}`;
  const draftRows = useMemo<DraftRow[]>(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      return raw ? (JSON.parse(raw) as DraftRow[]) : [];
    } catch { return []; }
    // re-read when the asset changes
  }, [draftStorageKey]);
  const draftCount = mapDraft(draftRows).length;

  const loaded = rowsQ.data ?? [];
  const snap = JSON.stringify(loaded);
  const [working, setWorking] = useState<EditableSopRow[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [importedDraft, setImportedDraft] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) return;
    setWorking((JSON.parse(snap) as typeof loaded).map(toEditable));
  }, [snap, dirty]);

  const setCell = (i: number, patch: Partial<EditableSopRow>) => {
    setWorking((w) => w.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
    setLocalError(null);
  };
  const addRow = () => { setWorking((w) => [...w, blankEditable()]); setDirty(true); };
  const delRow = (i: number) => {
    setWorking((w) => {
      const r = w[i];
      if (r.taskId) setDeleted((d) => [...d, r.taskId as string]);
      return w.filter((_, idx) => idx !== i);
    });
    setDirty(true);
  };
  const onImport = () => {
    setWorking((w) => [...w, ...mapDraft(draftRows)]);
    setImportedDraft(true);
    setDirty(true);
  };

  async function onSave() {
    // Pre-flight: catch duplicate facet+name here (the unique constraint) so we
    // never start a save that would fail, and give a specific message.
    const seen = new Set<string>();
    for (const r of working) {
      const n = r.name.trim();
      if (!n) continue;
      const k = `${r.facet}|${n.toLowerCase()}`;
      if (seen.has(k)) {
        setLocalError(`Two tasks share the same facet + name ("${n}") — rename one.`);
        return;
      }
      seen.add(k);
    }
    setLocalError(null);
    try {
      await save.mutateAsync({ equipmentId, rows: working, deletedTaskIds: deleted });
      setDirty(false);
      setDeleted([]);
      // Clear the consumed browser draft, but KEEP importedDraft=true for this
      // mount so the "Import" button doesn't reappear with stale (now-deleted)
      // rows and re-import duplicates.
      if (importedDraft) {
        try { window.localStorage.removeItem(draftStorageKey); } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('SOP save failed', e);
    }
  }

  if (rowsQ.isLoading) return <p className="t-small t-muted">Loading…</p>;

  if (!canEdit) {
    return working.length === 0
      ? <p className="t-small t-muted">No SOP recorded for this asset yet.</p>
      : (
        <div className="space-y-1">
          {working.map((r, i) => (
            <div key={i} className="t-small" style={{ padding: '3px 0', borderBottom: '1px solid var(--color-border-soft)' }}>
              <b>{SOP_FACETS.find((f) => f.value === r.facet)?.label}</b> · {r.name}
              {r.body && <span className="t-muted"> — {r.body}</span>}
            </div>
          ))}
        </div>
      );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <span className="t-small" style={{ padding: '1px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.14)', color: '#047857', fontSize: 10, fontWeight: 600, letterSpacing: '0.5px' }}>
          LIVE · saves to database
        </span>
        <div className="flex items-center gap-3">
          {draftCount > 0 && !importedDraft && (
            <button type="button" onClick={onImport} className="t-small t-accent" style={{ background: 'none', border: '1px dashed var(--color-accent)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>
              Import {draftCount} browser-draft row{draftCount === 1 ? '' : 's'}
            </button>
          )}
          {localError
            ? <span className="t-small" style={{ color: 'var(--color-danger)' }}>{localError}</span>
            : dirty && <span className="t-small" style={{ color: 'var(--color-warn, #d97706)' }}>unsaved</span>}
          {!localError && save.isError && <span className="t-small" style={{ color: 'var(--color-danger)' }}>save failed — try again</span>}
          <button
            type="button" onClick={onSave} disabled={!dirty || save.isPending}
            className="t-small t-accent"
            style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid var(--color-accent)', background: 'var(--color-card)', cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.5 }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Facet', 'Task', 'Steps', 'Tools', 'Freq', 'LOTO'].map((h, idx) => (
                <th key={h} className="t-small t-muted uppercase tracking-wider"
                    style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)', width: ['13%', '22%', '33%', '12%', '12%', '8%'][idx] }}>
                  {h}
                </th>
              ))}
              <th style={{ width: 28, borderBottom: '1px solid var(--color-border)' }} />
            </tr>
          </thead>
          <tbody>
            {working.map((r, i) => (
              <tr key={r.taskId ?? `new-${i}`} className="t-row-hover">
                <td style={td}>
                  <select value={r.facet} onChange={(e) => setCell(i, { facet: e.target.value as SopFacet })} className="t-text" style={cellStyle} onFocus={focusBorder} onBlur={blurBorder}>
                    {SOP_FACETS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </td>
                <td style={td}><input value={r.name} placeholder="e.g. tube-clean, oil sample" onChange={(e) => setCell(i, { name: e.target.value })} className="t-text" style={cellStyle} onFocus={focusBorder} onBlur={blurBorder} /></td>
                <td style={td}><input value={r.body} onChange={(e) => setCell(i, { body: e.target.value })} className="t-text" style={cellStyle} onFocus={focusBorder} onBlur={blurBorder} /></td>
                <td style={td}><input value={r.tools} onChange={(e) => setCell(i, { tools: e.target.value })} className="t-text" style={cellStyle} onFocus={focusBorder} onBlur={blurBorder} /></td>
                <td style={td}><input value={r.frequency} placeholder="monthly / annual" onChange={(e) => setCell(i, { frequency: e.target.value })} className="t-text" style={cellStyle} onFocus={focusBorder} onBlur={blurBorder} /></td>
                <td style={td}>
                  <select value={r.safetyLoto ?? ''} onChange={(e) => setCell(i, { safetyLoto: (e.target.value || null) as SopLoto | null })} className="t-text" style={cellStyle} onFocus={focusBorder} onBlur={blurBorder}>
                    <option value="">—</option>
                    {SOP_LOTO.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
                  <button type="button" onClick={() => delRow(i)} title="Remove task" className="t-muted" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                </td>
              </tr>
            ))}
            {working.length === 0 && (
              <tr><td colSpan={7} className="t-small t-muted" style={{ padding: '10px 8px' }}>No SOP tasks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={addRow} className="t-small t-accent" style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}>
        + Add SOP task
      </button>
    </div>
  );
}

const td: React.CSSProperties = { padding: '3px 4px', borderBottom: '1px solid var(--color-border-soft)' };
