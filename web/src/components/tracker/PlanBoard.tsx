// PlanBoard — the "Plan" tab of the 8-Week Tracker (user 2026-10-30): a blank
// copy of the board where the mentor picks a week, clicks the items the new
// hire should do that week (reviewed the week after) and adds weeks past 8
// as needed; below it the plan in the weekly-log layout. Saved as one meta
// row (meta.plan) — see planOf in lib/trainingBoard.
import { useState } from 'react';
import {
  STATUS_META, MARK_META, currentOf, itemDone, itemNum, planWeekOf, togglePlanItem, setPlanNote, planNote, PLAN_WEEK_NOTE, allNotes, fmtDay,
  type TrainingBoardDef, type BoardRow, type BoardPlan,
} from '../../lib/trainingBoard';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const input: React.CSSProperties = {
  background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 4, padding: '2px 6px', fontSize: 12, width: '100%',
};

export function PlanBoard({ def, rows, plan, setPlan, canEdit, dates }: {
  def: TrainingBoardDef; rows: BoardRow[]; plan: BoardPlan; setPlan: (p: BoardPlan) => void; canEdit: boolean;
  /** review-session dates (meta.weeks) — shown on the log rows */
  dates: Record<number, string>;
}) {
  const [week, setWeek] = useState<number>(() => {
    // default: the first week that has nothing planned after the last planned one, else 1
    const planned = Object.keys(plan.weeks).map(Number);
    return planned.length ? Math.min(plan.count, Math.max(...planned) + 1) : 1;
  });
  const weeks = Array.from({ length: plan.count }, (_, i) => i + 1);
  const addWeek = () => { setPlan({ ...plan, count: plan.count + 1 }); setWeek(plan.count + 1); };
  const cols: TrainingBoardDef['sections'][] = [[], [], []];
  def.sections.forEach((s, i) => cols[Math.min(2, Math.floor(i / 2))].push(s));
  const open = def.items.filter((it) => !itemDone(it, rows));
  const unplanned = open.filter((it) => planWeekOf(plan, it.key) == null);

  return (
    <div>
      {/* week chips for the plan — independent of the review-session chip above */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="t-small t-muted">Plan week</span>
        <div className="flex items-center gap-1 flex-wrap">
          {weeks.map((x) => {
            const on = x === week; const n = plan.weeks[x]?.length ?? 0;
            return (
              <button key={x} type="button" onClick={() => setWeek(x)} className="t-mono px-1.5 py-0.5 rounded border t-small flex flex-col items-center"
                style={{ borderColor: on ? 'var(--color-accent)' : 'var(--color-border)', background: on ? 'var(--color-accent)' : 'var(--color-card)', color: on ? '#fff' : n ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: on ? 700 : 500, lineHeight: 1.1, minWidth: 34 }}>
                <span>{x}</span>
                <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.85 }}>{n ? `${n} item${n === 1 ? '' : 's'}` : '·'}</span>
              </button>
            );
          })}
          {canEdit && <button type="button" onClick={addWeek} className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)', background: 'var(--color-card)' }} title="Add a week to the plan">+ week</button>}
        </div>
        <span className="t-small t-muted" style={{ marginLeft: 'auto' }}>{open.length} open · {unplanned.length} not planned yet</span>
      </div>
      <p className="t-small t-muted mb-2">Click an item to put it on week {week} (click again to take it off; an item lives on one week), then write its note — this week to do · next week review. Done items are greyed out. Save the plan with the button above.</p>
      <label className="t-small flex items-center gap-2 mb-3">
        <span className="t-muted whitespace-nowrap">W{week} note</span>
        <input value={planNote(plan, week, PLAN_WEEK_NOTE)} disabled={!canEdit} placeholder={`Week ${week} — this week to do · next week review`}
          onChange={(e) => setPlan(setPlanNote(plan, week, PLAN_WEEK_NOTE, e.target.value))} style={input} />
      </label>

      {/* blank board */}
      <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {cols.map((col, ci) => (
          <div key={ci} className="space-y-3">
            {col.map((sec) => {
              const openN = sec.items.filter((it) => !itemDone(it, rows)).length;
              const plannedN = sec.items.filter((it) => planWeekOf(plan, it.key) != null).length;
              return (
                <div key={sec.key}>
                  <div className="flex items-baseline justify-between px-1.5 py-0.5 rounded mb-1 uppercase tracking-wider"
                    style={{ ...mono, fontSize: 12, fontWeight: 700, background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                    <span>{sec.num} · {sec.title}</span>
                    <span className="t-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{plannedN} planned · {openN} open</span>
                  </div>
                  {sec.items.map((item) => {
                    const done = itemDone(item, rows);
                    const cur = currentOf(rows, item.key);
                    const pw = planWeekOf(plan, item.key);
                    const here = pw === week;
                    const st = cur.status ? STATUS_META[cur.status] : null;
                    const otherNote = pw && !here ? planNote(plan, pw, item.key) : '';
                    return (
                      <div key={item.key} style={{ borderBottom: '1px solid var(--color-border)', opacity: done ? 0.45 : 1,
                        background: here ? 'rgba(94,106,210,0.10)' : 'transparent', borderLeft: `3px solid ${here ? 'var(--color-accent)' : pw ? 'var(--color-border)' : 'transparent'}` }}>
                        <button type="button" disabled={!canEdit || done} onClick={() => setPlan(togglePlanItem(plan, week, item.key))}
                          className="w-full text-left t-small flex items-start gap-2" style={{ padding: '5px 6px', cursor: canEdit && !done ? 'pointer' : 'default' }}>
                          <span className="t-mono" style={{ flex: '0 0 28px', fontWeight: 700, fontSize: 13, color: 'var(--color-text-muted)' }}>{itemNum(item)}</span>
                          <span className="flex-1 min-w-0" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>
                            {item.text}
                            {st && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: st.color }}>{st.short} {st.label}{cur.statusWeek ? ` W${cur.statusWeek}` : ''}</span>}
                            {otherNote && <span className="block t-muted" style={{ fontWeight: 500, fontSize: 11 }}>W{pw}: {otherNote}</span>}
                          </span>
                          <span className="t-mono whitespace-nowrap" style={{ fontSize: 10.5, fontWeight: 700, color: here ? 'var(--color-accent)' : pw ? 'var(--color-text-muted)' : 'transparent' }}>{pw ? `W${pw}` : '·'}</span>
                        </button>
                        {here && (
                          <div style={{ padding: '0 6px 6px 40px' }}>
                            <input value={planNote(plan, week, item.key)} disabled={!canEdit} placeholder="this week to do · next week review"
                              onChange={(e) => setPlan(setPlanNote(plan, week, item.key, e.target.value))} style={{ ...input, fontSize: 11.5 }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* the plan in the weekly-log layout */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full t-small" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 640 }}>
          <colgroup><col style={{ width: '12%' }} /><col style={{ width: '44%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /></colgroup>
          <thead>
            <tr>{['Week', 'Planned — for the new hire to do', 'Done since', 'Review next week — still open'].map((c, i) => <th key={i} className="text-left px-2 py-1" style={{ background: 'var(--color-text)', color: 'var(--color-bg)', fontSize: 10.5, fontWeight: 700, textAlign: i === 0 ? 'center' : 'left' }}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((x) => {
              const keys = plan.weeks[x] ?? [];
              const items = keys.map((k) => def.items.find((it) => it.key === k)).filter((it): it is NonNullable<typeof it> => !!it);
              const doneItems = items.filter((it) => itemDone(it, rows));
              const openItems = items.filter((it) => !itemDone(it, rows));
              const isCur = x === week;
              const cell: React.CSSProperties = { border: '1px solid var(--color-border)', whiteSpace: 'pre-wrap', verticalAlign: 'top' };
              return (
                <tr key={x} style={{ background: isCur ? 'rgba(94,106,210,0.06)' : 'transparent', opacity: items.length || isCur ? 1 : 0.55 }}>
                  <td className="px-2 py-1.5 align-top text-center" style={cell}>
                    <button type="button" onClick={() => setWeek(x)} className="t-mono font-bold hover:underline" style={{ fontSize: 14, color: isCur ? 'var(--color-accent)' : 'var(--color-text)' }}>W{x}</button>
                    {dates[x] && <div className="t-mono t-muted" style={{ fontSize: 10 }}>{fmtDay(dates[x])}</div>}
                  </td>
                  <td className="px-2 py-1.5" style={cell}>
                    {planNote(plan, x, PLAN_WEEK_NOTE) && <div style={{ fontStyle: 'italic', marginBottom: 2 }}>{planNote(plan, x, PLAN_WEEK_NOTE)}</div>}
                    {items.length ? items.map((it) => { const n = planNote(plan, x, it.key); return <div key={it.key}>{itemNum(it)} {it.text}{n ? <span className="t-muted"> — {n}</span> : null}</div>; }) : (!planNote(plan, x, PLAN_WEEK_NOTE) && <span className="t-muted">—</span>)}
                  </td>
                  <td className="px-2 py-1.5" style={cell}>{doneItems.map((it) => { const c = currentOf(rows, it.key); return `✓ ${itemNum(it)} ${it.text}${c.statusWeek ? ` · W${c.statusWeek}` : ''}`; }).join('\n') || <span className="t-muted">—</span>}</td>
                  <td className="px-2 py-1.5" style={cell}>
                    {openItems.length ? openItems.map((it) => {
                      const missed = allNotes(rows, it.key).filter((n) => n.mark === 'missed');
                      const n = planNote(plan, x, it.key);
                      return <div key={it.key}>{itemNum(it)} {it.text}{n ? <span className="t-muted"> — {n}</span> : null}{missed.length ? <span style={{ color: MARK_META.missed.color }}> — ✗ {missed.map((m) => m.text).join(' · ')}</span> : null}</div>;
                    }) : <span className="t-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
