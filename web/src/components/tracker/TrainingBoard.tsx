// TrainingBoard — page 1 of the 8-Week Tracker as a live form: the three
// columns, numbered sections and items of the print-station document, each
// item with a status toggle (done / more work / next week), its own control
// (hours per week, week boxes, count boxes, date, labelled boxes, areas) and
// a note. Edits go to a draft (keyed item:week); nothing writes until Save.
import {
  STATUS_META, STATUS_CYCLE, WEEKS, MARKS, MARK_META, SCORES, SCORE_LABELS, ROUNDS, ROUND_META, isScorable, statusForScore, currentOf, hoursOf, roundOf, weekTicked, itemProgress, notesOf, allNotes, itemNum,
  type TrainingBoardDef, type BoardRow, type BoardItem, type BoardStatus, type BoardProgress, type BoardNote,
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
                          <span className="t-mono" style={{ flex: '0 0 28px', fontWeight: 700, fontSize: 14, color: 'var(--color-text-muted)' }}>{itemNum(item)}</span>
                          <span className="flex-1 min-w-0" style={{ fontWeight: 600, lineHeight: 1.25, fontSize: 15 }}>
                            {item.text}
                            {item.hint && <span className="block t-muted" style={{ fontWeight: 500, fontSize: 11 }}>{item.hint}</span>}
                          </span>
                          {isScorable(sec.num) && <span className="inline-flex items-center gap-0.5" title="Score 1–4 · 1–3 keeps the item on next week for review, 4 = done">
                            {SCORES.map((n) => {
                              const on = cur.score === n;
                              return (
                                <button key={n} type="button" disabled={!canEdit} title={`${n} · ${SCORE_LABELS[n]}${n >= 4 ? ' → done' : ' → next week'}`}
                                  onClick={() => setRow(item.key, week, on ? { value: { ...valueBase(item), score: undefined } } : { value: { ...valueBase(item), score: n }, status: statusForScore(n) })}
                                  className="t-mono rounded"
                                  style={{ width: 22, height: 20, fontSize: 11, fontWeight: 700, border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`, background: on ? 'var(--color-accent)' : 'var(--color-card)', color: on ? '#fff' : 'var(--color-text-muted)', cursor: canEdit ? 'pointer' : 'default' }}>{n}</button>
                              );
                            })}
                          </span>}
                          <button type="button" onClick={cycle} disabled={!canEdit}
                            title={canEdit ? `Week ${week}: click to cycle · none → done → next week` : meta?.label ?? ''}
                            className="px-1.5 py-0.5 rounded whitespace-nowrap"
                            style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.03em', border: `1px solid ${meta ? meta.color : 'var(--color-border)'}`, color: meta ? meta.color : 'var(--color-text-muted)', background: 'var(--color-card)', cursor: canEdit ? 'pointer' : 'default' }}>
                            {meta ? `${meta.short} ${meta.label}` : '○ —'}{st && cur.statusWeek ? <span className="t-mono" style={{ opacity: 0.7 }}> W{cur.statusWeek}</span> : null}
                          </button>
                        </div>

                        {/* the item's own control */}
                        <div className="mt-1 ml-7 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {c.kind === 'hours8' && WEEKS.map((w) => (
                            <label key={w} className="inline-flex items-center gap-0.5" title={`${w}`}>
                              <span className="t-mono t-muted" style={{ fontSize: 10 }}>{w}</span>
                              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} disabled={!canEdit} value={hoursOf(rows, item.key, w) ?? ''}
                                onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ''); const { hours: _h, ...v } = rowFor(item, w)?.value ?? {}; void _h; setRow(item.key, w, { value: d === '' ? v : { ...v, hours: Number(d) } }); }}
                                style={{ ...input, width: 40, padding: '1px 4px', fontSize: 11, textAlign: 'center' }} />
                            </label>
                          ))}
                          {/* rounds (items 7 + 9 merged, user 2026-10-26): per round the hours spent and its own notes —
                              each note's mark is the round state (learning / solo / next week), not the hours */}
                          {c.kind === 'rounds8' && (
                            <div className="w-full space-y-1">
                              {WEEKS.map((w) => {
                                const r = rowFor(item, w);
                                const h = hoursOf(rows, item.key, w); const ro = roundOf(rows, item.key, w);
                                const rm = ro ? ROUND_META[ro] : null;
                                const notes: BoardNote[] = notesOf(r, true);
                                const clean = () => { const { mark: _m, round: _r, ...v } = r?.value ?? {}; void _m; void _r; return v; };
                                const writeNotes = (next: BoardNote[]) => setRow(item.key, w, { note: null, value: { ...clean(), notes: next } });
                                return (
                                  <div key={w} style={{ borderLeft: `3px solid ${rm ? rm.color : 'var(--color-border)'}`, paddingLeft: 6, background: rm ? rm.bg : 'transparent', borderRadius: 3, padding: '2px 4px 2px 6px' }}>
                                    <div className="flex items-center gap-2">
                                      <span className="t-mono" style={{ fontSize: 11, fontWeight: 700, minWidth: 12, color: rm ? rm.color : 'var(--color-text-muted)' }}>{w}</span>
                                      <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} disabled={!canEdit} value={h ?? ''} placeholder="h" title={`Round ${w} · hours spent`}
                                        onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ''); const { hours: _h, ...v } = r?.value ?? {}; void _h; setRow(item.key, w, { value: d === '' ? v : { ...v, hours: Number(d) } }); }}
                                        style={{ ...input, width: 40, padding: '1px 4px', fontSize: 11, textAlign: 'center' }} />
                                      {rm && <span style={{ fontSize: 10.5, fontWeight: 700, color: rm.color }}>{rm.short} {rm.label}</span>}
                                      {canEdit && <button type="button" onClick={() => writeNotes([...notes, { text: '', mark: null }])} className="t-accent hover:underline" style={{ fontSize: 10.5, marginLeft: 'auto' }}>+ note</button>}
                                    </div>
                                    {notes.map((n, i) => (
                                      <div key={i} className="flex items-center gap-1 mt-0.5">
                                        {ROUNDS.map((m) => {
                                          const mm = ROUND_META[m]; const on = n.mark === m;
                                          return (
                                            <button key={m} type="button" disabled={!canEdit} title={mm.label}
                                              onClick={() => writeNotes(notes.map((x, j) => (j === i ? { ...x, mark: on ? null : m } : x)))}
                                              className="px-1 rounded whitespace-nowrap"
                                              style={{ fontSize: 10, fontWeight: 700, height: 18, border: `1px solid ${on ? mm.color : 'var(--color-border)'}`, background: on ? mm.bg : 'var(--color-card)', color: on ? mm.color : 'var(--color-text-muted)', cursor: canEdit ? 'pointer' : 'default' }}>{mm.short} {mm.label}</button>
                                          );
                                        })}
                                        <input value={n.text} disabled={!canEdit} placeholder="note"
                                          onChange={(e) => writeNotes(notes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                                          style={{ ...input, flex: 1, minWidth: 60, padding: '1px 5px', fontSize: 11, color: n.mark ? MARK_META[n.mark].color : undefined }} />
                                        {canEdit && <button type="button" onClick={() => writeNotes(notes.filter((_, j) => j !== i))} className="t-muted hover:underline" style={{ fontSize: 11 }} title="Remove this note">×</button>}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          )}
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

                        {/* notes — several per week, each with its own mark (missed / good); earlier weeks' notes shown muted */}
                        <div className="mt-1 ml-7">
                          {c.kind !== 'rounds8' && allNotes(rows, item.key).filter((n) => n.week !== week).map((n, i) => (
                            <div key={`${n.week}-${i}`} className="t-muted" style={{ fontSize: 10.5, paddingLeft: 5 }}>
                              W{n.week}: {n.mark && <span style={{ color: MARK_META[n.mark].color, fontWeight: 700 }}>{MARK_META[n.mark].short} </span>}{n.text}
                            </div>
                          ))}
                          {(() => {
                            const notes: BoardNote[] = notesOf(wr, true);   // keep the blank line being typed
                            // the legacy item-level `mark` is not carried forward — marks live on the notes now
                            const write = (next: BoardNote[]) => { const { mark: _legacy, ...v } = { ...valueBase(item), ...(wr?.value ?? {}) }; void _legacy; setRow(item.key, week, { note: null, value: { ...v, notes: next } }); };
                            const hasAny = cur.status || cur.note || Object.keys(cur.value).length > 0 || wr || rows.some((r) => r.item_key === item.key);
                            const reset = canEdit && hasAny && (
                              <button type="button" onClick={() => { if (window.confirm(`Reset "${itemNum(item)} ${item.text}"? Every saved week of this item is cleared (logged as a reset).`)) onReset(item.key); }}
                                className="t-muted hover:underline" style={{ fontSize: 10.5, marginLeft: 'auto' }} title="Clear this item (all weeks)">↺ reset</button>
                            );
                            if (c.kind === 'rounds8') return reset ? <div className="flex items-center">{reset}</div> : null;
                            return (
                              <>
                                {notes.map((n, i) => (
                                  <div key={i} className="flex items-center gap-1 mb-0.5">
                                    {MARKS.map((m) => {
                                      const mm = MARK_META[m]; const on = n.mark === m;
                                      return (
                                        <button key={m} type="button" disabled={!canEdit} title={mm.label}
                                          onClick={() => write(notes.map((x, j) => (j === i ? { ...x, mark: on ? null : m } : x)))}
                                          className="px-1 rounded"
                                          style={{ fontSize: 10, fontWeight: 700, height: 18, border: `1px solid ${on ? mm.color : 'var(--color-border)'}`, background: on ? mm.bg : 'var(--color-card)', color: on ? mm.color : 'var(--color-text-muted)', cursor: canEdit ? 'pointer' : 'default' }}>{mm.short} {mm.label}</button>
                                      );
                                    })}
                                    <input value={n.text} disabled={!canEdit} placeholder="note"
                                      onChange={(e) => write(notes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                                      style={{ ...input, flex: 1, padding: '1px 5px', fontSize: 11, color: n.mark ? MARK_META[n.mark].color : undefined }} />
                                    {canEdit && <button type="button" onClick={() => write(notes.filter((_, j) => j !== i))} className="t-muted hover:underline" style={{ fontSize: 11 }} title="Remove this note">×</button>}
                                  </div>
                                ))}
                                {canEdit && (
                                  <div className="flex items-center gap-3">
                                    <button type="button" onClick={() => write([...notes, { text: '', mark: null }])} className="t-accent hover:underline" style={{ fontSize: 10.5 }}>+ note · W{week}</button>
                                    {reset}
                                  </div>
                                )}
                              </>
                            );
                          })()}
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
