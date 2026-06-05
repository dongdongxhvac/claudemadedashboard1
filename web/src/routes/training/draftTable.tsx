import { useEffect, useState, type ReactNode } from 'react';

// Local-only scaffolding primitives for the Training view's not-yet-modeled
// sections (onboarding, SOP template, competency catalog, curriculums,
// requirements matrix). NOTHING here hits the database — the point is to let
// the supervisor shape columns/rows and discover the right structure before we
// commit a schema. Draft rows persist to localStorage so they survive section
// collapse and page refreshes during that exploration.

export type DraftColumn = {
  key: string;
  label: string;
  placeholder?: string;
  width?: string;
};

export type DraftRow = Record<string, string> & { _id: string };

export function makeRow(seed: Record<string, string> = {}): DraftRow {
  return { _id: crypto.randomUUID(), ...seed };
}

/** Draft state backed by localStorage. Lives in the page component (not inside
 *  a collapsible Section, which unmounts its children), so edits are never lost
 *  when a section is collapsed. */
export function useLocalDraft(key: string, seed: () => DraftRow[]) {
  const storageKey = `cove.training.draft:${key}`;
  const [rows, setRows] = useState<DraftRow[]>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as DraftRow[];
    } catch { /* ignore */ }
    return seed();
  });
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(rows)); } catch { /* ignore */ }
  }, [storageKey, rows]);
  return [rows, setRows] as const;
}

export function DraftBadge() {
  return (
    <span
      className="t-small"
      style={{
        padding: '1px 6px', borderRadius: 999,
        background: 'rgba(168,85,247,0.15)', color: '#7e22ce',
        fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
      }}
    >
      DRAFT · not saved to DB
    </span>
  );
}

export function DraftTable({
  columns,
  rows,
  onChange,
  addLabel = 'Add row',
}: {
  columns: DraftColumn[];
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  addLabel?: string;
}) {
  const setCell = (id: string, key: string, val: string) =>
    onChange(rows.map((r) => (r._id === id ? { ...r, [key]: val } : r)));
  const addRow = () => onChange([...rows, makeRow()]);
  const delRow = (id: string) => onChange(rows.filter((r) => r._id !== id));

  return (
    <div>
      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="t-small t-muted uppercase tracking-wider"
                  style={{
                    textAlign: 'left', padding: '6px 8px',
                    borderBottom: '1px solid var(--color-border)', width: c.width,
                  }}
                >
                  {c.label}
                </th>
              ))}
              <th style={{ width: 28, borderBottom: '1px solid var(--color-border)' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="t-row-hover">
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: '3px 4px', borderBottom: '1px solid var(--color-border-soft)' }}>
                    <input
                      value={r[c.key] ?? ''}
                      placeholder={c.placeholder}
                      onChange={(e) => setCell(r._id, c.key, e.target.value)}
                      className="t-text"
                      style={{
                        width: '100%', background: 'transparent',
                        border: '1px solid transparent', borderRadius: 4, padding: '3px 6px',
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                    />
                  </td>
                ))}
                <td style={{ textAlign: 'center', borderBottom: '1px solid var(--color-border-soft)' }}>
                  <button
                    type="button"
                    onClick={() => delRow(r._id)}
                    title="Remove row"
                    className="t-muted"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                  >×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="t-small t-muted" style={{ padding: '10px 8px' }}>
                  No rows yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="t-small t-accent"
        style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        + {addLabel}
      </button>
    </div>
  );
}

/** Section body wrapper: one-line intent line above the editable table. */
export function DraftBody({ intro, children }: { intro: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="t-small t-muted">{intro}</p>
      {children}
    </div>
  );
}
