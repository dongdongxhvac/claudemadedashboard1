// WeeklyLog — pages 2–3 of the 8-Week Tracker, generated from the board's
// rows: per week the category tallies, Review (notes + quiz passes), Done
// (items ticked that week) and Focus (items marked next week).
import { weekLog, fmtDay, WEEKS, MARK_META, splitReviewLine, splitLogLine, type TrainingBoardDef, type BoardRow, type BoardLogRow, type QuizPass } from '../../lib/trainingBoard';

/** "Oct 28 · 16a Boiler — note: missed · open questions": date + item number small, item name larger (user 2026-11-02),
 *  a note's mark word coloured and its text underlined (user 2026-10-29). */
function LogLine({ def, line }: { def: TrainingBoardDef; line: string }) {
  const q = splitLogLine(def, line);
  const p = splitReviewLine(line);
  const meta = p?.word ? MARK_META[p.word] : null;
  const head = q ? <><span className="t-mono t-muted" style={{ fontSize: 10 }}>{q.date} · {q.num}</span> <b style={{ fontSize: 13 }}>{q.name}</b></> : null;
  if (!p) return <div style={{ margin: '1px 0' }}>{head ? <>{head}<span>{q!.rest}</span></> : line}</div>;
  return (
    <div style={{ background: meta ? meta.bg : 'rgba(245,158,11,0.10)', borderRadius: 3, padding: '0 3px', margin: '1px 0' }}>
      {head ?? p.head}{head ? '' : ''} — {p.label}
      {meta && <b style={{ color: meta.color }}>{meta.label.toLowerCase()} · </b>}
      <span style={{ textDecoration: 'underline', textUnderlineOffset: 2, fontWeight: 600 }}>{p.text}</span>
    </div>
  );
}

export function WeeklyLog({ def, rows, quizzes, log: log0 = [], dates = {}, currentWeek, onPickWeek }: {
  def: TrainingBoardDef; rows: BoardRow[]; quizzes: QuizPass[]; log?: BoardLogRow[]; dates?: Record<number, string>; currentWeek: number; onPickWeek?: (w: number) => void;
}) {
  const cols = def.logColumns.length === 4 ? def.logColumns : ['Week · by category', 'Review — past week activities · quiz or field exercise', 'Done — ticked on the board (#)', 'Focus — next week'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full t-small" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 640 }}>
        <colgroup><col style={{ width: '14%' }} /><col style={{ width: '40%' }} /><col style={{ width: '28%' }} /><col style={{ width: '18%' }} /></colgroup>
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="text-left px-2 py-1" style={{ background: 'var(--color-text)', color: 'var(--color-bg)', fontSize: 10.5, fontWeight: 700, textAlign: i === 0 ? 'center' : 'left' }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {WEEKS.map((w) => {
            const log = weekLog(def, rows, w, quizzes, log0);
            const empty = !log.review.length && !log.done.length && !log.focus.length && log.tallies.every((t) => !t.value);
            const isCur = w === currentWeek;
            return (
              <tr key={w} style={{ background: isCur ? 'rgba(94,106,210,0.06)' : 'transparent', opacity: empty && !isCur ? 0.55 : 1 }}>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)' }}>
                  <button type="button" onClick={() => onPickWeek?.(w)} className="t-mono font-bold hover:underline" style={{ fontSize: 14, color: isCur ? 'var(--color-accent)' : 'var(--color-text)' }} title="Edit this week on the board">W{w}</button>
                  {dates[w] && <div className="t-mono t-muted" style={{ fontSize: 10 }}>{fmtDay(dates[w])}</div>}
                  <div className="t-muted" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
                    {log.tallies.map((t) => (
                      <div key={t.label}>{t.label} {t.total != null
                        ? <><b className="t-mono" style={{ color: 'var(--color-text)', fontSize: 14 }}>{t.value || '0'}</b><span className="t-mono">/{t.total}</span></>
                        : <b className="t-mono" style={{ color: 'var(--color-text)' }}>{t.value || '—'}</b>}</div>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)' }}>{log.review.map((l, i) => <LogLine key={i} def={def} line={l} />)}</td>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)' }}>{log.done.map((l, i) => <LogLine key={i} def={def} line={l} />)}</td>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)' }}>{log.focus.map((l, i) => <LogLine key={i} def={def} line={l} />)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
