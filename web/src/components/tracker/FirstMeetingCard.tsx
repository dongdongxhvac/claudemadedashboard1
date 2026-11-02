// FirstMeetingCard — section 0 of the board (user 2026-11-02): the first-meeting
// checklist and the three report dates from page 4 of the 8-Week Tracker. Lives
// at the bottom of the Board tab so the introduction is on the board without
// being in the way every week; the "0 · First meeting" header links down to it.
import { META_FIRST, FIRST_MEETING_ID, firstMeetingOf, type TrainingBoardDef, type BoardRow } from '../../lib/trainingBoard';
import type { SetRow } from './TrainingBoard';

const input: React.CSSProperties = {
  background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 4, padding: '1px 4px', fontSize: 11,
};
export function FirstMeetingCard({ def, rows, canEdit, setRow }: { def: TrainingBoardDef; rows: BoardRow[]; canEdit: boolean; setRow: SetRow }) {
  const { first, covered, dates } = firstMeetingOf(rows);
  const setFirst = (patch: Record<string, unknown>) => setRow(META_FIRST, 0, { value: { ...first, ...patch } });
  return (
    <div id={FIRST_MEETING_ID} className="mt-4" style={{ scrollMarginTop: 80 }}>
      <div className="flex items-baseline justify-between px-1.5 py-0.5 rounded mb-1 uppercase tracking-wider"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, background: 'var(--color-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        <span>0 · First meeting — introduction</span>
        <span className="t-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{covered.length} / {def.firstMeeting.length}</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="t-card" style={{ padding: '0.75rem 0.9rem', borderLeft: '4px solid var(--color-text-muted)' }}>
          <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>Tick as covered</div>
          <ul className="space-y-1">
            {def.firstMeeting.map((f) => (
              <li key={f} className="t-small flex items-start gap-2">
                <input type="checkbox" checked={covered.includes(f)} disabled={!canEdit}
                  onChange={(e) => setFirst({ covered: e.target.checked ? [...covered, f] : covered.filter((x) => x !== f) })} />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="t-card" style={{ padding: '0.75rem 0.9rem' }}>
          <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>Dates</div>
          <div className="space-y-1">
            {def.signers.map((s) => (
              <label key={s} className="t-small flex items-center gap-2 flex-wrap">
                <span className="t-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, minWidth: 190 }}>{s}</span>
                <input type="date" value={dates[s] ?? ''} disabled={!canEdit} onChange={(e) => setFirst({ dates: { ...dates, [s]: e.target.value } })} style={input} />
              </label>
            ))}
          </div>
          {def.reportLines.length > 0 && (
            <pre className="t-small t-muted mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{def.reportLines.join('\n')}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
