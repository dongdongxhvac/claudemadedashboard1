// Admin → On-call tab. UPark-style table:
//   rows    = active engineers
//   columns = engineer's rotation #1, #2, #3, … (their Nth shift)
//   cells   = "MM/DD - MM/DD" (Friday → Friday)
// The active rotation (Fri→Fri window containing today) highlights green
// with an "On Call" badge. Admin clicks Web Edit to type/clear cells; Save
// upserts or deletes the corresponding oncall_rotations rows.
import { useState, useMemo } from 'react';
import {
  useEngineerRotationGrid, useSetRotation, useDeleteRotation, useOncallRealtime,
  fmtMd, plus7Days, parseRotationCell,
  type OncallRotation,
} from '../../hooks/useOncall';

const COLS_MIN = 5; // always show at least 5 rotation columns

export function OncallTab() {
  useOncallRealtime();
  const q = useEngineerRotationGrid();
  const setRot = useSetRotation();
  const delRot = useDeleteRotation();

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // key: `${user_id}|${colIdx}` → "MM/DD - MM/DD"
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Build display rows from the grid data.
  const todayIso = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    if (!q.data) return [];
    return q.data.engineers.map((e) => {
      const arr = q.data!.rotationsByUser.get(e.user_id) ?? [];
      return { ...e, rotations: arr };
    });
  }, [q.data]);

  const maxCols = Math.max(COLS_MIN, q.data?.maxCols ?? 0);

  const cellValue = (userId: string, colIdx: number): { display: string; active: boolean; rotation?: OncallRotation } => {
    const draftKey = `${userId}|${colIdx}`;
    if (editing && drafts[draftKey] !== undefined) {
      return { display: drafts[draftKey], active: false };
    }
    const arr = q.data?.rotationsByUser.get(userId) ?? [];
    const r = arr[colIdx];
    if (!r) return { display: '', active: false };
    const range = `${fmtMd(r.week_start)} - ${fmtMd(plus7Days(r.week_start))}`;
    const active = r.week_start <= todayIso && plus7Days(r.week_start) > todayIso;
    return { display: range, active, rotation: r };
  };

  const setDraft = (userId: string, colIdx: number, value: string) => {
    setDrafts((prev) => ({ ...prev, [`${userId}|${colIdx}`]: value }));
  };

  const startEdit = () => {
    setDrafts({});
    setErrors([]);
    setEditing(true);
  };
  const cancelEdit = () => {
    setDrafts({});
    setErrors([]);
    setEditing(false);
  };

  const saveAll = async () => {
    setSaving(true);
    setErrors([]);
    const errs: string[] = [];

    for (const e of rows) {
      const existing = e.rotations;
      for (let col = 0; col < maxCols; col++) {
        const draftKey = `${e.user_id}|${col}`;
        const draftRaw = drafts[draftKey];
        if (draftRaw === undefined) continue; // unchanged

        const trimmed = draftRaw.trim();
        const oldRow = existing[col];

        if (trimmed === '') {
          // Clear: delete the existing row at this slot (if any).
          if (oldRow) {
            try {
              await delRot.mutateAsync(oldRow.id);
            } catch (err) {
              errs.push(`${e.full_name} · rotation ${col + 1}: delete failed (${(err as Error).message})`);
            }
          }
        } else {
          const iso = parseRotationCell(trimmed);
          if (!iso) {
            errs.push(`${e.full_name} · rotation ${col + 1}: invalid date "${trimmed}". Use MM/DD or MM/DD - MM/DD.`);
            continue;
          }
          // If editing an existing slot to a new date, delete the old row first to avoid
          // leaving the engineer assigned to BOTH weeks.
          if (oldRow && oldRow.week_start !== iso) {
            try { await delRot.mutateAsync(oldRow.id); } catch { /* swallow */ }
          }
          try {
            await setRot.mutateAsync({ week_start: iso, primary_user_id: e.user_id });
          } catch (err) {
            errs.push(`${e.full_name} · rotation ${col + 1}: ${(err as Error).message}`);
          }
        }
      }
    }

    setErrors(errs);
    setSaving(false);
    if (errs.length === 0) {
      setDrafts({});
      setEditing(false);
    }
  };

  if (q.isLoading) return <p className="t-text t-muted">Loading on-call data…</p>;
  if (q.isError) return <p className="t-text t-danger">Error: {(q.error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <div className="t-card">
        <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
          <div>
            <h2 className="t-section-title">On-call schedule</h2>
            <p className="t-small t-muted">
              Each rotation runs Friday → Friday. Active rotation highlights green.
              Use MM/DD format (current year assumed; pass /YY or /YYYY to override).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <button
                onClick={startEdit}
                className="t-small px-3 py-1 rounded border font-medium text-white"
                style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
              >
                Web Edit
              </button>
            ) : (
              <>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="t-small px-3 py-1 rounded border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveAll}
                  disabled={saving}
                  className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--color-ok)' }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mb-3 p-2 rounded border" style={{ borderColor: 'var(--color-danger)', background: '#fef2f2', color: '#7f1d1d' }}>
            <p className="t-small font-medium mb-1">Some changes couldn't save:</p>
            <ul className="list-disc list-inside t-small">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full t-text border-collapse">
            <thead>
              <tr className="text-left t-small t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-2 pr-3">Engineer</th>
                {Array.from({ length: maxCols }).map((_, i) => (
                  <th key={i} className="py-2 px-2 text-center whitespace-nowrap">
                    Rotation {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const anyActive = e.rotations.some((r) => r.week_start <= todayIso && plus7Days(r.week_start) > todayIso);
                return (
                  <tr key={e.user_id} className="border-b t-row-hover" style={{
                    borderColor: 'var(--color-border-soft)',
                    background: anyActive ? 'rgba(34, 197, 94, 0.08)' : undefined,
                  }}>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">
                      {e.full_name}
                      {anyActive && (
                        <span className="ml-2 t-small px-1.5 py-0.5 rounded text-white" style={{ background: 'var(--color-ok)', fontSize: '9px' }}>
                          ON CALL
                        </span>
                      )}
                    </td>
                    {Array.from({ length: maxCols }).map((_, i) => {
                      const c = cellValue(e.user_id, i);
                      if (editing) {
                        return (
                          <td key={i} className="py-1 px-1">
                            <input
                              type="text"
                              value={drafts[`${e.user_id}|${i}`] ?? c.display}
                              onChange={(ev) => setDraft(e.user_id, i, ev.target.value)}
                              placeholder="MM/DD - MM/DD"
                              className="w-full border rounded px-2 py-1 t-small t-mono text-center"
                              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={i} className="py-2 px-2 text-center t-mono t-small whitespace-nowrap"
                          style={{
                            background: c.active ? 'rgba(34, 197, 94, 0.18)' : undefined,
                            fontWeight: c.active ? 600 : undefined,
                          }}>
                          {c.display || <span className="t-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
