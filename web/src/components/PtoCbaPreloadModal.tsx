// Preview for "Preload by CBA" on the manager Balances grid (both sites).
// Shows what each not-yet-set engineer would get, lets the manager untick
// or adjust anyone, and only writes when they press Preload.
import { useState } from 'react';

export type CbaPreloadRow = {
  user_id: string;
  name: string;
  hire_date: string | null;
  /** From cbaAllotment().basis; null when there's no hire date. */
  basis: string | null;
  vacation: number;
  sick: number;
  holiday: number;
};

export type CbaPreloadWrite = {
  user_id: string; year: number;
  vacation_alloted: number; sick_alloted: number; holiday_alloted: number;
};

function fmtHire(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export function PtoCbaPreloadModal({
  year, rows, pending, onApply, onClose,
}: {
  year: number;
  rows: CbaPreloadRow[];
  pending: boolean;
  onApply: (writes: CbaPreloadWrite[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const ready   = rows.filter((r) => r.basis);
  const skipped = rows.filter((r) => !r.basis);
  const [picked, setPicked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(ready.map((r) => [r.user_id, true])),
  );
  const [vals, setVals] = useState<Record<string, { vacation: string; sick: string; holiday: string }>>(
    () => Object.fromEntries(ready.map((r) => [r.user_id, {
      vacation: String(r.vacation), sick: String(r.sick), holiday: String(r.holiday),
    }])),
  );
  const [err, setErr] = useState<string | null>(null);

  const chosen = ready.filter((r) => picked[r.user_id]);
  const allOn = chosen.length === ready.length;

  const apply = async () => {
    setErr(null);
    try {
      await onApply(chosen.map((r) => ({
        user_id: r.user_id,
        year,
        vacation_alloted: Number(vals[r.user_id].vacation) || 0,
        sick_alloted:     Number(vals[r.user_id].sick) || 0,
        holiday_alloted:  Number(vals[r.user_id].holiday) || 0,
      })));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const setVal = (uid: string, k: 'vacation' | 'sick' | 'holiday', v: string) =>
    setVals((m) => ({ ...m, [uid]: { ...m[uid], [k]: v } }));

  const input = (uid: string, k: 'vacation' | 'sick' | 'holiday', r: CbaPreloadRow) => {
    const changed = Number(vals[uid][k]) !== r[k];
    return (
      <input
        type="number" min={0} step={1}
        value={vals[uid][k]}
        disabled={!picked[uid]}
        onChange={(e) => setVal(uid, k, e.target.value)}
        className="border rounded px-1 py-0.5 t-small t-mono text-right disabled:opacity-40"
        style={{
          width: 64, background: 'var(--color-card)',
          borderColor: changed ? 'var(--color-accent)' : 'var(--color-border)',
        }}
        title={changed ? `CBA rule: ${r[k]}h — you changed it` : 'CBA rule value'}
      />
    );
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 50,
      }}
    >
      <div
        className="t-card"
        style={{
          width: 'min(820px, 98vw)', height: '100%', overflow: 'auto', padding: '1.25rem',
          borderLeft: '1px solid var(--color-border)', boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="t-section-title">Preview · {year} allotments by CBA rule</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>
        <p className="t-small t-muted mb-3">
          Service is counted on 1/1/{year}. Vacation by years of service, sick by the sick-day schedule × daily hours,
          floater keeps last year’s. Untick anyone to skip, or adjust a number before preloading. Nothing is saved until you press Preload.
        </p>

        <table className="t-text t-small border-collapse" style={{ width: '100%' }}>
          <thead>
            <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <th className="py-1 pr-2" style={{ width: 24 }}>
                <input
                  type="checkbox" checked={allOn}
                  onChange={() => setPicked(Object.fromEntries(ready.map((r) => [r.user_id, !allOn])))}
                  title={allOn ? 'Untick all' : 'Tick all'}
                />
              </th>
              <th className="py-1 pr-2">Engineer</th>
              <th className="py-1 pr-2">Hired</th>
              <th className="py-1 pr-2">Basis</th>
              <th className="py-1 px-1 text-right">Vacation</th>
              <th className="py-1 px-1 text-right">Sick</th>
              <th className="py-1 px-1 text-right">Floater</th>
            </tr>
          </thead>
          <tbody>
            {ready.map((r) => (
              <tr key={r.user_id} style={{ borderBottom: '1px solid var(--color-border-soft)', opacity: picked[r.user_id] ? 1 : 0.5 }}>
                <td className="py-1 pr-2 align-top">
                  <input
                    type="checkbox" checked={!!picked[r.user_id]}
                    onChange={(e) => setPicked((m) => ({ ...m, [r.user_id]: e.target.checked }))}
                  />
                </td>
                <td className="py-1 pr-2 align-top font-medium">{r.name}</td>
                <td className="py-1 pr-2 align-top t-mono">{fmtHire(r.hire_date)}</td>
                <td className="py-1 pr-2 align-top t-muted" style={{ fontSize: '0.7rem' }}>{r.basis}</td>
                <td className="py-1 px-1 text-right align-top">{input(r.user_id, 'vacation', r)}</td>
                <td className="py-1 px-1 text-right align-top">{input(r.user_id, 'sick', r)}</td>
                <td className="py-1 px-1 text-right align-top">{input(r.user_id, 'holiday', r)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {skipped.length > 0 && (
          <p className="t-small t-muted mt-3">
            Skipped — no hire date on file: {skipped.map((r) => r.name).join(', ')}. Set these by hand with “set”.
          </p>
        )}

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={pending || chosen.length === 0}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {pending ? 'Preloading…' : `Preload ${chosen.length} engineer${chosen.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
