// TrainingSection — the 8-Week Tracker in the admin Tracker drawer: the
// board (page 1) as a live form with a draft + Save, the generated weekly
// log (pages 2–3) and invite (page 4), a start-date field (week chips follow
// it) and Print (the real print-station document, filled in). Admin side
// only: TrackerPanel mounts it when canEdit.
import { useMemo, useState } from 'react';
import { Section } from '../Section';
import { useTrainingBoard, useSaveTrainingBoard, useSetTrainingStart, type BoardRowInput } from '../../hooks/useTrainingBoard';
import { rowKey, WEEKS, STATUS_META, META_WEEKS, weekDates, fmtDay, type BoardRow } from '../../lib/trainingBoard';
import { buildTrackerPrintHtml } from '../../lib/trainingBoardPrint';
import { TrainingBoard, type RowPatch } from './TrainingBoard';
import { WeeklyLog } from './WeeklyLog';
import { InviteCard } from './InviteCard';
import { ResetLog } from './ResetLog';

const input: React.CSSProperties = {
  background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 4, padding: '2px 5px', fontSize: 12,
};
type Tab = 'board' | 'log' | 'invite' | 'resets';

export function TrainingSection({ userId, canEdit, personName }: { userId: string; canEdit: boolean; personName: string }) {
  const b = useTrainingBoard(userId);
  const save = useSaveTrainingBoard();
  const setStart = useSetTrainingStart();
  const [week, setWeek] = useState<number>(0);
  const [tab, setTab] = useState<Tab>('board');
  const [draft, setDraft] = useState<Map<string, BoardRowInput>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  // week chips are review sessions (user 2026-10-26): the one picked, else the last one that has a date, else 1
  const dates = useMemo(() => weekDates(b.rows), [b.rows]);
  const lastDated = WEEKS.filter((x) => dates[x]).pop() ?? 1;
  const w = week || lastDated;

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
  /** Clicking a chip selects it and, the first time, stamps today as that session's date (saved right away). */
  const pickWeek = (x: number) => {
    setWeek(x);
    if (dates[x]) return;
    const today = new Date().toLocaleDateString('en-CA');
    save.mutate({ user_id: userId, rows: [{ item_key: META_WEEKS, week: 0, status: null, note: null, value: { dates: { ...dates, [x]: today } } }], base: b.rows }, {
      onError: (e) => setErr((e as Error).message),
    });
  };
  const doSave = () => {
    setErr(null);
    save.mutate({ user_id: userId, rows: [...draft.values()], base: b.rows }, {
      onSuccess: () => setDraft(new Map()),
      onError: (e) => setErr((e as Error).message),
    });
  };
  const print = () => {
    if (!b.def || !b.doc) return;
    const html = buildTrackerPrintHtml(b.doc.html, b.def, rows, { name: personName, startDate: b.startDate, quizzes: b.quizzes, log: b.log });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
  };

  const p = b.progress;
  const subtitle = (
    <span className="t-small t-muted">
      {p ? <>{p.done}/{p.total} done · W{w}{dates[w] ? ` ${fmtDay(dates[w])}` : ''}{p.moreWork ? ` · ${p.moreWork} more work` : ''}{p.nextWeek ? ` · ${p.nextWeek} next week` : ''}</> : 'from the print station'}
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
            <label className="t-small flex items-center gap-1">
              <span className="t-muted">Start</span>
              <input type="date" value={b.startDate ?? ''} disabled={!canEdit || setStart.isPending}
                onChange={(e) => setStart.mutate({ user_id: userId, start_date: e.target.value || null, mentor_user_id: b.enrollment?.mentor_user_id ?? null }, { onError: (x) => setErr((x as Error).message) })}
                style={{ ...input, padding: '1px 4px', fontSize: 11 }} title="Program start date (new_hire_enrollments) — shown on the printout and the roster; the week chips are independent review sessions" />
            </label>
            <div className="flex items-start gap-1" title="Review session 1–8 · click one to work on it; the first click stamps today's date">
              <span className="t-small t-muted" style={{ paddingTop: 2 }}>Week</span>
              {WEEKS.map((x) => (
                <button key={x} type="button" onClick={() => pickWeek(x)} className="t-mono px-1.5 py-0.5 rounded border t-small flex flex-col items-center"
                  style={{ borderColor: x === w ? 'var(--color-accent)' : 'var(--color-border)', color: x === w ? 'var(--color-accent)' : dates[x] ? 'var(--color-text)' : 'var(--color-text-muted)', background: 'var(--color-card)', fontWeight: x === w ? 700 : 500, lineHeight: 1.1 }}>
                  <span>{x}</span>
                  <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>{dates[x] ? fmtDay(dates[x]) : '·'}</span>
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-[160px]">
              <div className="rounded-full overflow-hidden" style={{ height: 8, background: 'var(--color-border)' }}>
                <div style={{ width: `${p.pct}%`, height: '100%', background: STATUS_META.done.color, transition: 'width .2s' }} />
              </div>
              <div className="t-small t-muted t-mono" style={{ fontSize: 10.5 }}>{p.pct}% · {p.done} of {p.total}</div>
            </div>
            {canEdit && (
              <button type="button" onClick={doSave} disabled={!dirty || save.isPending} className="t-small px-3 py-1 rounded font-semibold"
                style={{ background: dirty ? 'var(--color-accent)' : 'var(--color-border)', color: dirty ? '#fff' : 'var(--color-text-muted)' }}>
                {save.isPending ? 'Saving…' : dirty ? `Save (${dirty})` : 'Saved'}
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
              <p className="t-small t-muted mb-2">
                Click the status pill to cycle <b style={{ color: STATUS_META.done.color }}>done</b> → <b style={{ color: STATUS_META.next_week.color }}>next week</b>; score 1–4 (1–3 keeps the item on next week for review, 4 = done; no score on COVE / PlantLog / Setup); add as many notes as needed, each marked ✗ missed or ★ good; ↺ resets an item. Edits land on week {w} until you press Save; every change is logged with its date in the weekly log.
              </p>
              <TrainingBoard def={b.def} rows={rows} week={w} canEdit={canEdit} setRow={setRow} onReset={resetItem} progress={p} />
            </>
          )}
          {tab === 'log' && <WeeklyLog def={b.def} rows={rows} quizzes={b.quizzes} log={b.log} dates={dates} currentWeek={w} onPickWeek={(x) => { setWeek(x); setTab('board'); }} />}
          {tab === 'resets' && <ResetLog def={b.def} log={b.log} />}
          {tab === 'invite' && <InviteCard def={b.def} rows={rows} log={b.log} week={w} personName={personName} canEdit={canEdit} setRow={setRow} />}
        </>
      )}
    </Section>
  );
}
