// TrainingBoard — page 1 of the 8-Week Tracker as a live form: the three
// columns, numbered sections and items of the print-station document, each
// item with a status toggle (done / more work / next week), its own control
// (hours per week, week boxes, count boxes, date, labelled boxes, areas) and
// a note. Edits go to a draft (keyed item:week); nothing writes until Save.
import {
  STATUS_META, STATUS_CYCLE, WEEKS, MARKS, MARK_META, SCORES, SCORE_LABELS, currentOf, hoursOf, weekTicked, itemProgress,
  type TrainingBoardDef, type BoardRow, type BoardItem, type BoardStatus, type BoardProgress,
} from '../../lib/trainingBoard';

export type RowPatch = { status?: BoardStatus | null; note?: string | null; value?: Record<string, unknown> };
export type SetRow = (itemKey: string, week: number, patch: RowPatch) => void;

const input: React.CSSProperties = {
  background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 4, padding: '2px 5px', fontSize: 12,
};
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function Box({ on, half, onClick, title, disabled }: { on: boolean; half?: boolean; onClick?: () => void; title?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || !onClick} title={title}
      className="inline-flex items-center justify-center"
      style={{
        width: 16, height: 16, borderRadius: 3, border: '1.7px solid var(--color-text)', verticalAlign: 'middle',
        background: on ? 'var(--color-text)' : half ? 'repeating-linear-gradient(45deg, var(--color-text) 0 2px, transparent 2px 5px)' : 'transparent',
        color: 'var(--color-bg)', fontSize: 11, lineHeight: 1, cursor: onClick && !disabled ? 'pointer' : 'default', padding: 0,
      }}>{on ? '✓' : ''}</button>
  );
}

export function TrainingBoard({ def, rows, week, canEdit, setRow, onReset, progress }: {
  def: TrainingBoardDef;
  /** base rows merged with the draft */
  rows: BoardRow[];
  /** the week chip — status / note / count / date edits land on (item, week) */
  week: number;
  canEdit: boolean;
  setRow: SetRow;
  /** clear every saved row of an item (logged as "reset" on Save) */
  onReset: (itemKey: string) => void;
  progress: BoardProgress;
}) {
  const rowFor = (item: BoardItem, w = week) => rows.find((r) => r.item_key === item.key && r.week === w) ?? null;
  // a value edit starts from the latest value (cumulative controls carry forward)
  const valueBase = (item: BoardItem) => ({ ...(currentOf(rows, item.key).value ?? {}) });

  const cols: BoardSection3[] = [[], [], []];
  // same column split as the printout: 2 sections per column
  def.sections.forEach((s, i) => cols[Math.min(2, Math.floor(i / 2))].push(s));

  return (
    <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      {cols.map((col, ci) => (
        <div key={ci} className="space-y-3">
          {col.map((sec) => {
            const sp = progress.sections.get(sec.key);
            return (
              <div key={sec.key}>
                <div className="flex items-baseline justify-between px-1.5 py-0.5 rounded mb-1 uppercase tracking-wider"
                  style={{ ...mono, fontSize: 12, fontWeight: 700, background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                  <span>{sec.num} · {sec.title}</span>
                  <span className="t-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{sp?.done ?? 0} / {sp?.total ?? sec.items.length}</span>
                </div>
                <div>
                  {sec.items.map((item) => {
                    const cur = currentOf(rows, item.key);
                    const wr = rowFor(item);
                    const pct = itemProgress(item, rows);
                    const st = cur.status;
                    const meta = st ? STATUS_META[st] : null;
                    const cycle = () => {
                      if (!canEdit) return;
                      const now = wr?.status ?? null;
                      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(now) + 1) % STATUS_CYCLE.length];
                      setRow(item.key, week, { status: next });
                    };
                    const c = item.control;
                    return (
                      <div key={item.key} className="t-small" style={{ borderBottom: '1px solid var(--color-border)', padding: '5px 2px 6px', background: meta ? meta.bg : 'transparent', borderLeft: `3px solid ${meta ? meta.color : 'transparent'}`, paddingLeft: 6 }}>
                        <div className="flex items-start gap-2">
                          <span className="t-mono" style={{ flex: '0 0 24px', fontWeight: 700, fontSize: 14, color: 'var(--color-text-muted)' }}>{item.num}</span>
                          <span className="flex-1 min-w-0" style={{ fontWeight: 600, lineHeight: 1.25, fontSize: 15 }}>
                            {item.text}
                            {item.hint && <span className="block t-muted" style={{ fontWeight: 500, fontSize: 11 }}>{item.hint}</span>}
                          </span>
                          <button type="button" onClick={cycle} disabled={!canEdit}
                            title={canEdit ? `Week ${week}: click to cycle · none → done → more work → next week` : meta?.label ?? ''}
                            className="px-1.5 py-0.5 rounded whitespace-nowrap"
                            style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', border: `1px solid ${meta ? meta.color : 'var(--color-border)'}`, color: meta ? meta.color : 'var(--color-text-muted)', background: 'var(--color-card)', cursor: canEdit ? 'pointer' : 'default' }}>
                            {meta ? `${meta.short} ${meta.label}` : '○ —'}{st && cur.statusWeek ? <span className="t-mono" style={{ opacity: 0.7 }}> W{cur.statusWeek}</span> : null}
                          </button>
                        </div>

                        {/* score 1–4 · mark · reset (user 2026-10-26) */}
                        <div className="mt-1 ml-7 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-0.5" title="Score 1–4 (saved with this week)">
                            {SCORES.map((n) => {
                              const on = cur.score === n;
                              return (
                                <button key={n} type="button" disabled={!canEdit} title={`${n} · ${SCORE_LABELS[n]}`}
                                  onClick={() => setRow(item.key, week, { value: { ...valueBase(item), score: on ? undefined : n } })}
                                  className="t-mono rounded"
                                  style={{ width: 22, height: 20, fontSize: 11, fontWeight: 700, border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`, background: on ? 'var(--color-accent)' : 'var(--color-card)', color: on ? '#fff' : 'var(--color-text-muted)', cursor: canEdit ? 'pointer' : 'default' }}>{n}</button>
                              );
                            })}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            {MARKS.map((m) => {
                              const mm = MARK_META[m]; const on = cur.mark === m;
                              return (
                                <button key={m} type="button" disabled={!canEdit} title={mm.label}
                                  onClick={() => setRow(item.key, week, { value: { ...valueBase(item), mark: on ? undefined : m } })}
                                  className="px-1.5 rounded"
                                  style={{ fontSize: 10, fontWeight: 700, height: 20, border: `1px solid ${on ? mm.color : 'var(--color-border)'}`, background: on ? mm.bg : 'var(--color-card)', color: on ? mm.color : 'var(--color-text-muted)', cursor: canEdit ? 'pointer' : 'default' }}>{mm.short} {mm.label}</button>
                              );
                            })}
                          </span>
                          {canEdit && (cur.status || cur.note || Object.keys(cur.value).length > 0 || wr) && (
                            <button type="button" onClick={() => { if (window.confirm(`Reset "${item.num} ${item.text}"? Every saved week of this item is cleared (logged as a reset).`)) onReset(item.key); }}
                              className="t-muted hover:underline" style={{ fontSize: 10.5, marginLeft: 'auto' }} title="Clear this item (all weeks)">↺ reset</button>
                          )}
                        </div>

                        {/* the item's own control */}
                        <div className="mt-1 ml-7 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {c.kind === 'hours8' && WEEKS.map((w) => (
                            <label key={w} className="inline-flex items-center gap-0.5" title={`Week ${w} hours`}>
                              <span className="t-mono t-muted" style={{ fontSize: 10 }}>{w}</span>
                              <input type="number" min={0} max={99} step={0.5} disabled={!canEdit} value={hoursOf(rows, item.key, w) ?? ''}
                                onChange={(e) => setRow(item.key, w, { value: e.target.value === '' ? {} : { hours: Number(e.target.value) } })}
                                style={{ ...input, width: 46, padding: '1px 3px', fontSize: 11 }} />
                            </label>
                          ))}
                          {c.kind === 'weeks8' && WEEKS.map((w) => (
                            <span key={w} className="inline-flex flex-col items-center" title={`Week ${w}`}>
                              <Box on={weekTicked(rows, item.key, w)} disabled={!canEdit} onClick={() => setRow(item.key, w, { status: weekTicked(rows, item.key, w) ? null : 'done' })} />
                              <span className="t-mono t-muted" style={{ fontSize: 9 }}>{w}</span>
                            </span>
                          ))}
                          {c.kind === 'count' && (() => {
                            const n = Number(cur.value.n) || 0;
                            return (
                              <>
                                {Array.from({ length: c.n }, (_, i) => (
                                  <Box key={i} on={i < n} disabled={!canEdit} title={`${i + 1} of ${c.n}`}
                                    onClick={() => setRow(item.key, week, { value: { ...valueBase(item), n: i + 1 === n ? i : i + 1 } })} />
                                ))}
                              </>
                            );
                          })()}
                          {c.kind === 'labels' && (() => {
                            const ticks = (cur.value.ticks as string[] | undefined) ?? [];
                            return c.labels.map((l) => (
                              <label key={l} className="inline-flex items-center gap-1" style={{ marginRight: 6 }}>
                                <Box on={ticks.includes(l)} disabled={!canEdit}
                                  onClick={() => setRow(item.key, week, { value: { ...valueBase(item), ticks: ticks.includes(l) ? ticks.filter((x) => x !== l) : [...ticks, l] } })} />
                                <span className="t-mono" style={{ fontSize: 10 }}>{l}</span>
                              </label>
                            ));
                          })()}
                          {c.kind === 'areas' && (() => {
                            const areas = (cur.value.areas as string[] | undefined) ?? [];
                            return (
                              <div className="grid gap-1 w-full" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                {Array.from({ length: c.n }, (_, i) => (
                                  <span key={i} className="inline-flex items-center gap-1">
                                    <Box on={!!areas[i]} disabled />
                                    <input value={areas[i] ?? ''} disabled={!canEdit} placeholder="area"
                                      onChange={(e) => { const next = [...areas]; while (next.length < c.n) next.push(''); next[i] = e.target.value; setRow(item.key, week, { value: { ...valueBase(item), areas: next } }); }}
                                      style={{ ...input, width: '100%', padding: '1px 4px', fontSize: 11 }} />
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                          {/* note / check / date items: the status pill is the tick; the save date is recorded on Save (user 2026-10-24) */}
                        </div>

                        {/* note — this week's note; the latest earlier note shows muted */}
                        <div className="mt-1 ml-7">
                          <input value={wr?.note ?? ''} disabled={!canEdit} placeholder={canEdit ? `note · W${week}` : ''}
                            onChange={(e) => setRow(item.key, week, { note: e.target.value })}
                            style={{ ...input, width: '100%', padding: '1px 5px', fontSize: 11, background: 'transparent', borderColor: wr?.note ? 'var(--color-border)' : 'transparent' }}
                            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                            onBlur={(e) => { if (!e.currentTarget.value) e.currentTarget.style.borderColor = 'transparent'; }} />
                          {cur.note && cur.note !== (wr?.note ?? '') && <div className="t-muted" style={{ fontSize: 10.5, paddingLeft: 5 }}>W{cur.week}: {cur.note}</div>}
                        </div>

                        {/* progress sliver */}
                        <div className="ml-7 mt-1 rounded-full overflow-hidden" style={{ height: 3, background: 'var(--color-border)' }}>
                          <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: meta ? meta.color : 'var(--color-accent)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
type BoardSection3 = TrainingBoardDef['sections'];
