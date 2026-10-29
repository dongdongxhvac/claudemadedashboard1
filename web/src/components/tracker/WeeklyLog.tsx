// WeeklyLog — pages 2–3 of the 8-Week Tracker, generated from the board's
// rows: per week the category tallies, Review (notes + quiz passes), Done
// (items ticked that week) and Focus (items marked next week).
import { weekLog, fmtDay, WEEKS, MARK_META, type TrainingBoardDef, type BoardRow, type BoardLogRow, type QuizPass, type BoardMark } from '../../lib/trainingBoard';

const MARK_BY_WORD = new Map((Object.keys(MARK_META) as BoardMark[]).map((k) => [MARK_META[k].label.toLowerCase(), MARK_META[k]]));
/** "Oct 28 · 16a Boiler — note: missed · open questions" → the mark word coloured, the note text underlined (user 2026-10-29). */
function ReviewLine({ line }: { line: string }) {
  // item texts can contain " — " themselves, so key on the "note: " label (logged notes) or a leading mark word (pre-log notes)
  const i = line.indexOf(' — note: ');
  const j = line.lastIndexOf(' — ');
  if (i < 0 && j < 0) return <div>{line}</div>;
  const label = i >= 0 ? 'note: ' : '';
  const head = i >= 0 ? line.slice(0, i) : line.slice(0, j);
  const rest = i >= 0 ? line.slice(i + ' — note: '.length) : line.slice(j + 3);
  if (i < 0 && !/^(missed|good|checked|learning|solo|next week) · /.test(rest)) return <div>{line}</div>;
  const wm = /^(missed|good|checked|learning|solo|next week) · (.*)$/s.exec(rest);
  const word = wm?.[1]; const text = wm ? wm[2] : rest;
  const meta = word ? MARK_BY_WORD.get(word) : null;
  return (
    <div style={{ background: meta ? meta.bg : 'rgba(245,158,11,0.10)', borderRadius: 3, padding: '0 3px', margin: '1px 0' }}>
      {head} — {label}
      {meta && <b style={{ color: meta.color }}>{word} · </b>}
      <span style={{ textDecoration: 'underline', textUnderlineOffset: 2, fontWeight: 600 }}>{text}</span>
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
        <colgroup><col style={{ width: '14%' }} /><col style={{ width: '40%' }} /><col style={{ width: '20%' }} /><col style={{ width: '26%' }} /></colgroup>
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
                    {log.tallies.map((t) => <div key={t.label}>{t.label} <b className="t-mono" style={{ color: 'var(--color-text)' }}>{t.value || '—'}</b></div>)}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)' }}>{log.review.map((l, i) => <ReviewLine key={i} line={l} />)}</td>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)', whiteSpace: 'pre-wrap' }}>{log.done.join('\n')}</td>
                <td className="px-2 py-1.5 align-top" style={{ border: '1px solid var(--color-border)', whiteSpace: 'pre-wrap' }}>{log.focus.join('\n')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
