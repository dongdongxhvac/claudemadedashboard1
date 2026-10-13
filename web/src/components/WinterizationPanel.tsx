// §13 — Winterization · cold weather prep (UPark manager page).
//
// The whiteboard list (migrations 0145 / 0146) with a status per task:
// drain-downs are Filled → Drained, 88's cooling-tower float is Summer →
// Winter mode. Every change records the date and the engineer who set it,
// and reaches TV2's Winterization tile within seconds over realtime.
// Admin / manager / lead may edit; everyone else sees it read-only.
import { useMemo, useState } from 'react';
import { Section } from './Section';
import { useMe } from '../hooks/useMe';
import {
  useWinterizationTasks, useWinterizationRealtime,
  useSetWinterizationStatus, useAddWinterizationTask, useDeleteWinterizationTask,
  currentWinterSeason, isWinterized,
  WINTERIZATION_STATUSES, WINTERIZATION_STATUS_LABEL,
  type WinterizationKind, type WinterizationStatus,
} from '../hooks/useWinterization';

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export function WinterizationPanel() {
  const season = useMemo(() => currentWinterSeason(), []);
  const q = useWinterizationTasks(season);
  useWinterizationRealtime();
  const me = useMe().data;
  const canEdit = !!me && me.active &&
    (['admin', 'manager', 'director'].includes(me.role) || me.is_manager === true || me.is_lead === true);
  const setStatus = useSetWinterizationStatus();
  const add = useAddWinterizationTask();
  const del = useDeleteWinterizationTask();
  const [code, setCode] = useState('');
  const [task, setTask] = useState('');
  const [kind, setKind] = useState<WinterizationKind>('drain');
  const [err, setErr] = useState<string | null>(null);
  const busy = setStatus.isPending || add.isPending || del.isPending;

  const rows = q.data ?? [];
  const done = rows.filter((r) => isWinterized(r.status)).length;
  const subtitle = q.isLoading ? 'loading…'
    : rows.length === 0 ? `season ${season} · no tasks yet`
    : `season ${season} · ${done}/${rows.length} winterized`;

  return (
    <Section collapsible title="§13 Winterization · cold weather prep" subtitle={subtitle}>
      {q.isError && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}
      <table className="t-small w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="t-muted">
            <th className="text-left pb-1 pr-3">Bldg</th>
            <th className="text-left pb-1 pr-3">Task</th>
            <th className="text-left pb-1 pr-3">Status</th>
            <th className="text-left pb-1 pr-3">Set</th>
            {canEdit && <th className="pb-1" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const winterized = isWinterized(r.status);
            return (
              <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                <td className="py-1 pr-3 t-mono" style={{ fontWeight: 600 }}>{r.building_code}</td>
                <td className="py-1 pr-3" style={{ opacity: winterized ? 0.7 : 1 }}>{r.task}</td>
                <td className="py-1 pr-3">
                  {/* One segmented control per task, its two states from the task's kind. */}
                  <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }} role="radiogroup">
                    {WINTERIZATION_STATUSES[r.kind].map((s: WinterizationStatus) => {
                      const on = s === r.status;
                      const good = isWinterized(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={!canEdit || busy || on}
                          onClick={() => {
                            setErr(null);
                            setStatus.mutate({ id: r.id, status: s }, { onError: (ex) => setErr((ex as Error).message) });
                          }}
                          className="t-small px-2 py-0.5"
                          style={{
                            background: on ? (good ? 'var(--color-ok)' : 'var(--color-warn)') : 'var(--color-card)',
                            color: on ? 'white' : 'var(--color-text-muted)',
                            fontWeight: on ? 600 : 400,
                            borderLeft: '1px solid var(--color-border)',
                            marginLeft: -1,
                            cursor: !canEdit || on ? 'default' : busy ? 'wait' : 'pointer',
                          }}
                        >
                          {WINTERIZATION_STATUS_LABEL[s]}
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
                      onClick={() => { setErr(null); del.mutate(r.id, { onError: (ex) => setErr((ex as Error).message) }); }}
                      disabled={busy}
                      className="t-small t-muted hover:underline"
                      title="Remove this task"
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && !q.isLoading && (
            <tr><td colSpan={canEdit ? 5 : 4} className="py-3 t-muted italic">No tasks for {season} yet.</td></tr>
          )}
        </tbody>
      </table>
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim() || !task.trim()) return;
            setErr(null);
            const next = rows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
            add.mutate(
              { season, building_code: code.trim(), task: task.trim(), sort_order: next, kind },
              { onSuccess: () => { setCode(''); setTask(''); }, onError: (ex) => setErr((ex as Error).message) },
            );
          }}
        >
          <input
            type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="bldg" size={6}
            className="border rounded px-2 py-1 t-small t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <input
            type="text" value={task} onChange={(e) => setTask(e.target.value)} placeholder="task — e.g. CT 2+3 drain downs"
            className="border rounded px-2 py-1 t-small flex-1"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 240 }}
          />
          <select
            value={kind} onChange={(e) => setKind(e.target.value as WinterizationKind)}
            className="border rounded px-2 py-1 t-small"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            title="Drain-down: Filled → Drained · Mode: Summer → Winter"
          >
            <option value="drain">drain-down (filled / drained)</option>
            <option value="mode">mode (summer / winter)</option>
          </select>
          <button
            type="submit" disabled={busy || !code.trim() || !task.trim()}
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
