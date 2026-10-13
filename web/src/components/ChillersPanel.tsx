// §14 — Chillers (UPark manager page).
//
// The chiller status board (migration 0149): every chiller with one of the
// shop's four states — Open, Punching, Rat race, Closed — and the date +
// engineer of the last change. Changes reach TV2's Chillers tile within
// seconds over realtime. Admin / manager / lead may edit; everyone else
// sees it read-only.
import { useState } from 'react';
import { Section } from './Section';
import { useMe } from '../hooks/useMe';
import {
  useChillers, useChillersRealtime, useSetChillerStatus, useAddChiller, useDeleteChiller,
  CHILLER_STATUSES, CHILLER_STATUS_LABEL, type ChillerStatus,
} from '../hooks/useChillers';

/** Button colour per state — open = running (green), closed = off (grey),
 *  punching / rat race = in work (amber / red). */
const STATUS_BG: Record<ChillerStatus, string> = {
  open: 'var(--color-ok)', punching: 'var(--color-warn)', rat_race: 'var(--color-danger)', closed: '#64748b',
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export function ChillersPanel() {
  const q = useChillers();
  useChillersRealtime();
  const me = useMe().data;
  const canEdit = !!me && me.active &&
    (['admin', 'manager', 'director'].includes(me.role) || me.is_manager === true || me.is_lead === true);
  const setStatus = useSetChillerStatus();
  const add = useAddChiller();
  const del = useDeleteChiller();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const busy = setStatus.isPending || add.isPending || del.isPending;
  const onError = (ex: unknown) => setErr((ex as Error).message);

  const rows = q.data ?? [];
  const counts = CHILLER_STATUSES.map((s) => `${rows.filter((r) => r.status === s).length} ${CHILLER_STATUS_LABEL[s].toLowerCase()}`).join(' · ');
  const subtitle = q.isLoading ? 'loading…' : rows.length === 0 ? 'no chillers listed' : `${rows.length} chillers · ${counts}`;

  return (
    <Section collapsible title="§14 Chillers" subtitle={subtitle}>
      {q.isError && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}
      <table className="t-small w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="t-muted">
            <th className="text-left pb-1 pr-3">Bldg</th>
            <th className="text-left pb-1 pr-3">Chiller</th>
            <th className="text-left pb-1 pr-3">Status</th>
            <th className="text-left pb-1 pr-3">Set</th>
            {canEdit && <th className="pb-1" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-3 t-mono" style={{ fontWeight: 600 }}>{r.building_code}</td>
              <td className="py-1 pr-3">{r.name ?? <span className="t-muted italic">unnamed</span>}</td>
              <td className="py-1 pr-3">
                <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }} role="radiogroup">
                  {CHILLER_STATUSES.map((s) => {
                    const on = s === r.status;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!canEdit || busy || on}
                        onClick={() => { setErr(null); setStatus.mutate({ id: r.id, status: s }, { onError }); }}
                        className="t-small px-2 py-0.5"
                        style={{
                          background: on ? STATUS_BG[s] : 'var(--color-card)',
                          color: on ? 'white' : 'var(--color-text-muted)',
                          fontWeight: on ? 600 : 400,
                          borderLeft: '1px solid var(--color-border)',
                          marginLeft: -1,
                          cursor: !canEdit || on ? 'default' : busy ? 'wait' : 'pointer',
                        }}
                      >
                        {CHILLER_STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
              </td>
              <td className="py-1 pr-3 t-muted">
                {r.status_at ? `${fmtWhen(r.status_at)}${r.status_by_name ? ` · ${r.status_by_name}` : ''}` : '—'}
              </td>
              {canEdit && (
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => { setErr(null); del.mutate(r.id, { onError }); }}
                    disabled={busy}
                    className="t-small t-muted hover:underline"
                    title="Remove this chiller"
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && !q.isLoading && (
            <tr><td colSpan={canEdit ? 5 : 4} className="py-3 t-muted italic">No chillers listed.</td></tr>
          )}
        </tbody>
      </table>
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim()) return;
            setErr(null);
            const next = rows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
            add.mutate(
              { building_code: code.trim(), name: name.trim() || null, sort_order: next },
              { onSuccess: () => { setCode(''); setName(''); }, onError },
            );
          }}
        >
          <input
            type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="bldg" size={6}
            className="border rounded px-2 py-1 t-small t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="chiller — e.g. Trane chiller3"
            className="border rounded px-2 py-1 t-small flex-1"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 220 }}
          />
          <button
            type="submit" disabled={busy || !code.trim()}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            + Add
          </button>
        </form>
      )}
      {err && <p className="t-small t-danger mt-2">{err}</p>}
    </Section>
  );
}
