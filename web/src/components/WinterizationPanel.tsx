// §13 — Winterization · cold weather prep (UPark manager page).
//
// The whiteboard list (migration 0145) with a tick per task. Ticks and
// edits reach TV2's Winterization tile within seconds over realtime.
// Admin / manager / lead may edit; everyone else sees it read-only.
import { useMemo, useState } from 'react';
import { Section } from './Section';
import { useMe } from '../hooks/useMe';
import {
  useWinterizationTasks, useWinterizationRealtime,
  useSetWinterizationDone, useAddWinterizationTask, useDeleteWinterizationTask,
  currentWinterSeason,
} from '../hooks/useWinterization';

function fmtDone(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export function WinterizationPanel() {
  const season = useMemo(() => currentWinterSeason(), []);
  const q = useWinterizationTasks(season);
  useWinterizationRealtime();
  const me = useMe().data;
  const canEdit = !!me && me.active &&
    (['admin', 'manager', 'director'].includes(me.role) || me.is_manager === true || me.is_lead === true);
  const setDone = useSetWinterizationDone();
  const add = useAddWinterizationTask();
  const del = useDeleteWinterizationTask();
  const [code, setCode] = useState('');
  const [task, setTask] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const rows = q.data ?? [];
  const done = rows.filter((r) => r.done_at).length;
  const subtitle = q.isLoading ? 'loading…'
    : rows.length === 0 ? `season ${season} · no tasks yet`
    : `season ${season} · ${done}/${rows.length} done`;

  return (
    <Section collapsible title="§13 Winterization · cold weather prep" subtitle={subtitle}>
      {q.isError && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}
      <table className="t-small w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="t-muted">
            <th className="text-left pb-1 pr-2" style={{ width: 28 }} />
            <th className="text-left pb-1 pr-3">Bldg</th>
            <th className="text-left pb-1 pr-3">Task</th>
            <th className="text-left pb-1 pr-3">Done</th>
            {canEdit && <th className="pb-1" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-soft)', opacity: r.done_at ? 0.7 : 1 }}>
              <td className="py-1 pr-2">
                <input
                  type="checkbox"
                  checked={!!r.done_at}
                  disabled={!canEdit || setDone.isPending}
                  onChange={(e) => {
                    setErr(null);
                    setDone.mutate({ id: r.id, done: e.target.checked }, { onError: (ex) => setErr((ex as Error).message) });
                  }}
                  style={{ accentColor: 'var(--color-ok)' }}
                />
              </td>
              <td className="py-1 pr-3 t-mono" style={{ fontWeight: 600 }}>{r.building_code}</td>
              <td className="py-1 pr-3" style={{ textDecoration: r.done_at ? 'line-through' : 'none' }}>{r.task}</td>
              <td className="py-1 pr-3 t-muted">
                {r.done_at ? `${fmtDone(r.done_at)}${r.done_by_name ? ` · ${r.done_by_name}` : ''}` : '—'}
              </td>
              {canEdit && (
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => { setErr(null); del.mutate(r.id, { onError: (ex) => setErr((ex as Error).message) }); }}
                    disabled={del.isPending}
                    className="t-small t-muted hover:underline"
                    title="Remove this task"
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          ))}
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
              { season, building_code: code.trim(), task: task.trim(), sort_order: next },
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
          <button
            type="submit" disabled={add.isPending || !code.trim() || !task.trim()}
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
