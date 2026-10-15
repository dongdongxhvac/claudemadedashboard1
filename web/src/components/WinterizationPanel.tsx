// §13 — Winterization · cold weather prep (UPark manager page).
//
// The whiteboard list (migrations 0145–0148). Each task carries the ACTION
// it needs — Drain / Fill, or Winter mode / Summer mode for 88's
// cooling-tower float — and a Done tick that records the date and the
// engineer. Picking a new action (Fill, in spring) opens a fresh to-do.
// Changes reach TV2's Winterization tile within seconds over realtime.
// Admin / manager / lead may edit; everyone else sees it read-only.
import { useMemo, useState } from 'react';
import { Section } from './Section';
import { useMe } from '../hooks/useMe';
import {
  useWinterizationTasks, useWinterizationRealtime,
  useSetWinterizationAction, useMarkWinterizationDone,
  useAddWinterizationTask, useDeleteWinterizationTask,
  currentWinterSeason, isWinterAction,
  WINTERIZATION_ACTIONS, WINTERIZATION_ACTION_LABEL,
  type WinterizationKind, type WinterizationAction,
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
  const setAction = useSetWinterizationAction();
  const markDone = useMarkWinterizationDone();
  const add = useAddWinterizationTask();
  const del = useDeleteWinterizationTask();
  const [code, setCode] = useState('');
  const [task, setTask] = useState('');
  const [kind, setKind] = useState<WinterizationKind>('drain');
  const [err, setErr] = useState<string | null>(null);
  const busy = setAction.isPending || markDone.isPending || add.isPending || del.isPending;
  const onError = (ex: unknown) => setErr((ex as Error).message);

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
            <th className="text-left pb-1 pr-2" style={{ width: 28 }}>Done</th>
            <th className="text-left pb-1 pr-3">Bldg</th>
            <th className="text-left pb-1 pr-3">Task</th>
            <th className="text-left pb-1 pr-3">To do</th>
            <th className="text-left pb-1 pr-3">Done by</th>
            {canEdit && <th className="pb-1" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isDone = !!r.done_at;
            const winterized = isDone && isWinterAction(r.action);
            return (
              <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                <td className="py-1 pr-2">
                  <input
                    type="checkbox"
                    checked={isDone}
                    disabled={!canEdit || busy}
                    onChange={(e) => { setErr(null); markDone.mutate({ id: r.id, done: e.target.checked }, { onError }); }}
                    title={isDone ? 'Un-mark' : `Mark "${WINTERIZATION_ACTION_LABEL[r.action].todo}" done`}
                    style={{ accentColor: winterized ? 'var(--color-ok)' : 'var(--color-accent)' }}
                  />
                </td>
                <td className="py-1 pr-3 t-mono" style={{ fontWeight: 600 }}>{r.building_code}</td>
                <td className="py-1 pr-3" style={{ opacity: isDone ? 0.7 : 1 }}>{r.task}</td>
                <td className="py-1 pr-3">
                  {/* What the task needs next (its kind's two actions). Picking
                      a different one opens a fresh to-do. */}
                  <div className="inline-flex rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }} role="radiogroup">
                    {WINTERIZATION_ACTIONS[r.kind].map((a: WinterizationAction) => {
                      const on = a === r.action;
                      const onBg = isDone
                        ? (isWinterAction(a) ? 'var(--color-ok)' : 'var(--color-accent)')
                        : 'var(--color-warn)';
                      return (
                        <button
                          key={a}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={!canEdit || busy || on}
                          onClick={() => { setErr(null); setAction.mutate({ id: r.id, action: a }, { onError }); }}
                          className="t-small px-2 py-0.5"
                          title={on ? (isDone ? 'current action, done' : 'current to-do') : `set the to-do to "${WINTERIZATION_ACTION_LABEL[a].todo}" (clears done)`}
                          style={{
                            background: on ? onBg : 'var(--color-card)',
                            color: on ? 'white' : 'var(--color-text-muted)',
                            fontWeight: on ? 600 : 400,
                            borderLeft: '1px solid var(--color-border)',
                            marginLeft: -1,
                            cursor: !canEdit || on ? 'default' : busy ? 'wait' : 'pointer',
                          }}
                        >
                          {on && isDone ? WINTERIZATION_ACTION_LABEL[a].done : WINTERIZATION_ACTION_LABEL[a].todo}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="py-1 pr-3 t-muted">
                  {r.done_at ? `${fmtWhen(r.done_at)}${r.done_by_name ? ` · ${r.done_by_name}` : ''}` : <span className="italic">to do</span>}
                </td>
                {canEdit && (
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={() => { setErr(null); del.mutate(r.id, { onError }); }}
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
            <tr><td colSpan={canEdit ? 6 : 5} className="py-3 t-muted italic">No tasks for {season} yet.</td></tr>
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
              { onSuccess: () => { setCode(''); setTask(''); }, onError },
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
            title="Drain-down: to do Drain, then Fill in spring · Mode: Winter mode, then Summer mode"
          >
            <option value="drain">drain-down (drain / fill)</option>
            <option value="mode">mode (winter / summer)</option>
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
