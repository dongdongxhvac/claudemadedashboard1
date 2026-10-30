// TrainingSection — the 8-Week Tracker in the admin Tracker drawer: the
// board (page 1) as a live form with a draft + Save, the generated weekly
// log (pages 2–3) and invite (page 4), the engineer's schedule (shift), the
// week chips (review sessions 1–8: pick one, Save stamps its date) and Print
// (the real print-station document, filled in). Admin side only:
// TrackerPanel mounts it when canEdit.
import { useMemo, useState } from 'react';
import { Section } from '../Section';
import { useTrainingBoard, useSaveTrainingBoard, type BoardRowInput } from '../../hooks/useTrainingBoard';
import { useEngineers } from '../../hooks/useEngineers';
import { useShifts } from '../../hooks/useShifts';
import { rowKey, WEEKS, STATUS_META, META_WEEKS, weekDates, fmtDay, type BoardRow } from '../../lib/trainingBoard';
import { buildTrackerPrintHtml } from '../../lib/trainingBoardPrint';
import { TrainingBoard, type RowPatch } from './TrainingBoard';
import { WeeklyLog } from './WeeklyLog';
import { InviteCard } from './InviteCard';
import { ResetLog } from './ResetLog';

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
type Tab = 'board' | 'log' | 'invite' | 'resets';

export function TrainingSection({ userId, canEdit, personName }: { userId: string; canEdit: boolean; personName: string }) {
  const b = useTrainingBoard(userId);
  const save = useSaveTrainingBoard();
  const engineers = useEngineers();
  const shifts = useShifts();
  const engineer = engineers.data?.find((e) => e.user_id === userId) ?? null;
  const shift = useMemo(() => {
    const sid = engineer?.shift_id;
    return sid ? shifts.data?.find((s) => s.id === sid) ?? null : null;
  }, [engineer?.shift_id, shifts.data]);
  const scheduleText = shift ? `${shift.name}${shift.start_time ? ` · ${hhmm(shift.start_time)}–${hhmm(shift.end_time)}` : ''}` : '';
  /** the selected review session (0 = none); one at a time, click again to unselect, required to Save */
  const [week, setWeek] = useState<number>(0);
  const [tab, setTab] = useState<Tab>('board');
  const [draft, setDraft] = useState<Map<string, BoardRowInput>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  // week chips are review sessions (user 2026-10-26): exactly one selected at a time, none by default;
  // the log / invite views fall back to the last dated session
  const dates = useMemo(() => weekDates(b.rows), [b.rows]);
  const lastDated = WEEKS.filter((x) => dates[x]).pop() ?? 1;
  const w = week;
  const wView = week || lastDated;

  // base rows + draft → what the board, log and invite see
  const rows = useMemo<BoardRow[]>(() => {
    const m = new Map(b.rows.map((r) => [rowKey(r.item_key, r.week), r]));
    for (const [k, d] of draft) {
      const base = m.get(k);
      m.set(k, { user_id: userId, program_key: 'upark_l1_plan_b', entered_on: base?.entered_on ?? new Date().toLocaleDateString('en-CA'), updated_by: null, updated_at: '', ...(base ?? {}), ...d });
    }
    return [...m.values()].sort((a, c) => a.week - c.week);
  }, [b.rows, draft, userId]);

  const setRow = (itemKey: string, wk: number, patch: RowPatch) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const k = rowKey(itemKey, wk);
      const base = prev.get(k) ?? (() => {
        const r = b.rows.find((x) => x.item_key === itemKey && x.week === wk);
        return { item_key: itemKey, week: wk, status: r?.status ?? null, note: r?.note ?? null, value: r?.value ?? {} };
      })();
      next.set(k, { ...base, ...patch, value: patch.value !== undefined ? patch.value : base.value });
      return next;
    });
  };
  /** Reset: clear every saved row of the item (all weeks) — dropped on Save and logged as "reset". */
  const resetItem = (itemKey: string) => {
    const weeks = new Set(b.rows.filter((r) => r.item_key === itemKey).map((r) => r.week));
    for (const [k] of draft) if (k.startsWith(itemKey + ':')) weeks.add(Number(k.slice(itemKey.length + 1)));
    setDraft((prev) => {
      const next = new Map(prev);
      for (const wk of weeks) next.set(rowKey(itemKey, wk), { item_key: itemKey, week: wk, status: null, note: null, value: {} });
      return next;
    });
  };
  const dirty = draft.size;
  /** A chip selects that session; clicking the selected one unselects it. Nothing is written until Save. */
  const pickWeek = (x: number) => setWeek((cur) => (cur === x ? 0 : x));
  const canSave = canEdit && dirty > 0 && w > 0 && !save.isPending;
  /** Save writes the draft and, the first time a session is saved, stamps today as its date. */
  const doSave = () => {
    if (!w) { setErr('Select a week (1–8) before saving.'); return; }
    setErr(null);
    const today = new Date().toLocaleDateString('en-CA');
    const stamp: BoardRowInput[] = dates[w] ? [] : [{ item_key: META_WEEKS, week: 0, status: null, note: null, value: { dates: { ...dates, [w]: today } } }];
    save.mutate({ user_id: userId, rows: [...draft.values(), ...stamp], base: b.rows }, {
      onSuccess: () => setDraft(new Map()),
      onError: (e) => setErr((e as Error).message),
    });
  };
  /** Undo a session saved by mistake: clear its date stamp and, on request, every row saved on that week (logged as resets). */
  const resetWeek = () => {
    if (!w || !dates[w]) return;
    const wkRows = b.rows.filter((r) => r.week === w);
    const items = wkRows.filter((r) => !r.item_key.startsWith('meta.')).length;
    if (!window.confirm(`Reset W${w}? Its date (${fmtDay(dates[w])}) is cleared so the next Save stamps it again.`)) return;
    const rest: Record<number, string> = { ...dates }; delete rest[w];
    const out: BoardRowInput[] = [{ item_key: META_WEEKS, week: 0, status: null, note: null, value: { dates: rest } }];
    if (wkRows.length && window.confirm(`Also clear everything saved on W${w} (${items} item${items === 1 ? '' : 's'})? This is logged as a reset per item.`)) {
      out.push(...wkRows.map((r) => ({ item_key: r.item_key, week: r.week, status: null, note: null, value: {} })));
    }
    setErr(null);
    save.mutate({ user_id: userId, rows: out, base: b.rows }, {
      onSuccess: () => { setWeek(0); setDraft((prev) => new Map([...prev].filter(([k]) => !k.endsWith(`:${w}`)))); },
      onError: (e) => setErr((e as Error).message),
    });
  };
  const print = () => {
    if (!b.def || !b.doc) return;
    // header: start date = enrollment start, else the hiring date; the schedule goes in the site field
    const html = buildTrackerPrintHtml(b.doc.html, b.def, rows, { name: personName, startDate: b.startDate ?? engineer?.hiring_date ?? null, schedule: scheduleText, quizzes: b.quizzes, log: b.log });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
  };

  const p = b.progress;
  const subtitle = (
    <span className="t-small t-muted">
      {p ? <>{p.done}/{p.total} done{w ? ` · W${w}${dates[w] ? ` ${fmtDay(dates[w])}` : ''}` : ''}{p.moreWork ? ` · ${p.moreWork} more work` : ''}{p.nextWeek ? ` · ${p.nextWeek} next week` : ''}</> : 'from the print station'}
      {dirty > 0 && <> · <span className="px-1.5 rounded" style={{ background: 'rgba(245,158,11,0.18)', color: '#92400e', fontWeight: 600 }}>{dirty} unsaved</span></>}
    </span>
  );

  return (
    <Section title="Training — 8-week board" subtitle={subtitle} loading={b.isLoading} id="tracker-training">
      {b.error && <p className="t-small t-danger">{b.error.message}</p>}
      {err && <p className="t-small t-danger">Error: {err}</p>}
      {b.def && p && (
        <>
          {/* toolbar */}
          <div className="flex items-center gap-3 flex-wrap mb-3">
            {/* the engineer's schedule (shift from the profile) replaces the start-date field (user 2026-10-26) */}
            <span className="t-small flex items-center gap-1" title="Schedule — the shift set on the engineer's profile">
              <span className="t-muted">Schedule</span>
              {shift ? (
                <span className="px-1.5 py-0.5 rounded border t-mono" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', fontSize: 11 }}>{scheduleText}</span>
              ) : <span className="t-muted">{engineers.isLoading || shifts.isLoading ? '…' : 'no shift on the profile'}</span>}
            </span>
            <div className="flex items-start gap-1" title="Review session 1–8 · select one to edit and save; click it again to unselect. Save stamps the session's date the first time.">
              <span className="t-small t-muted" style={{ paddingTop: 2 }}>Week</span>
              {WEEKS.map((x) => {
                const on = x === w;
                return (
                  <button key={x} type="button" onClick={() => pickWeek(x)} aria-pressed={on} className="t-mono px-1.5 py-0.5 rounded border t-small flex flex-col items-center"
                    style={{ borderColor: on ? 'var(--color-accent)' : 'var(--color-border)', color: on ? '#fff' : dates[x] ? 'var(--color-text)' : 'var(--color-text-muted)', background: on ? 'var(--color-accent)' : 'var(--color-card)', fontWeight: on ? 700 : 500, lineHeight: 1.1 }}>
                    <span>{x}</span>
                    <span style={{ fontSize: 9, fontWeight: 500, opacity: on ? 0.9 : 0.8 }}>{dates[x] ? fmtDay(dates[x]) : '·'}</span>
                  </button>
                );
              })}
              {canEdit && w > 0 && dates[w] && (
                <button type="button" onClick={resetWeek} disabled={save.isPending} className="t-small t-muted hover:underline whitespace-nowrap" style={{ paddingTop: 4, fontSize: 10.5 }}
                  title={`Clear the date on W${w} (and, if you choose, everything saved on it)`}>↺ reset W{w}</button>
              )}
            </div>
            <div className="flex-1 min-w-[160px]">
              <div className="rounded-full overflow-hidden" style={{ height: 8, background: 'var(--color-border)' }}>
                <div style={{ width: `${p.pct}%`, height: '100%', background: STATUS_META.done.color, transition: 'width .2s' }} />
              </div>
              <div className="t-small t-muted t-mono" style={{ fontSize: 10.5 }}>{p.pct}% · {p.done} of {p.total}</div>
            </div>
            {canEdit && (
              <button type="button" onClick={doSave} disabled={!canSave} className="t-small px-3 py-1 rounded font-semibold"
                title={dirty && !w ? 'Select a week (1–8) first' : ''}
                style={{ background: canSave ? 'var(--color-accent)' : 'var(--color-border)', color: canSave ? '#fff' : 'var(--color-text-muted)' }}>
                {save.isPending ? 'Saving…' : dirty ? (w ? `Save W${w} (${dirty})` : `Save (${dirty}) · pick a week`) : 'Saved'}
              </button>
            )}
            {canEdit && dirty > 0 && <button type="button" onClick={() => setDraft(new Map())} className="t-small t-muted hover:underline">discard</button>}
            <button type="button" onClick={print} className="t-small px-2 py-0.5 rounded border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }} title="Open the print-station tracker filled in, in a new tab">Print</button>
            {b.printStationUrl && <a href={b.printStationUrl} target="_blank" rel="noreferrer" className="t-small t-accent hover:underline">Print station ↗</a>}
          </div>

          {/* tabs */}
          <div className="flex gap-1 mb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            {([['board', 'Board'], ['log', 'Weekly log'], ['invite', 'Invite · first meeting'], ['resets', 'Reset log']] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="t-small px-3 py-1.5"
                style={{ borderBottom: `2px solid ${tab === k ? 'var(--color-accent)' : 'transparent'}`, color: tab === k ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: 600, marginBottom: -1 }}>{label}</button>
            ))}
          </div>

          {tab === 'board' && (
            <>
              {!w && <p className="t-small mb-2 px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.14)', color: '#92400e' }}>Select a week (1–8) above to edit this session. Only one can be selected; click it again to unselect.</p>}
              <p className="t-small t-muted mb-2">
                Click the status pill to cycle <b style={{ color: STATUS_META.done.color }}>done</b> → <b style={{ color: STATUS_META.next_week.color }}>next week</b>; score 1–4 (1–3 keeps the item on next week for review, 4 = done; no score on COVE / PlantLog / Setup); add as many notes as needed, each marked ✗ missed or ★ good; ↺ resets an item. {w ? `Edits land on week ${w} until you press Save` : 'Select a week to edit'}; every change is logged with its date in the weekly log.
              </p>
              <TrainingBoard def={b.def} rows={rows} week={w} canEdit={canEdit && w > 0} setRow={setRow} onReset={resetItem} progress={p} />
            </>
          )}
          {tab === 'log' && <WeeklyLog def={b.def} rows={rows} quizzes={b.quizzes} log={b.log} dates={dates} currentWeek={wView} onPickWeek={(x) => { setWeek(x); setTab('board'); }} />}
          {tab === 'resets' && <ResetLog def={b.def} log={b.log} />}
          {tab === 'invite' && <InviteCard def={b.def} rows={rows} log={b.log} week={wView} personName={personName} canEdit={canEdit && w > 0} setRow={setRow} />}
        </>
      )}
    </Section>
  );
}
