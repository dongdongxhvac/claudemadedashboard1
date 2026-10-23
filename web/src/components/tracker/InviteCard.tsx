// InviteCard — page 4 of the 8-Week Tracker: the first-meeting checklist,
// the weekly calendar-invite body (generated from the selected week's rows;
// Title / When editable and saved with the board) and the report dates.
import { useState } from 'react';
import { inviteText, META_INVITE, META_FIRST, type TrainingBoardDef, type BoardRow } from '../../lib/trainingBoard';
import type { SetRow } from './TrainingBoard';

const input: React.CSSProperties = {
  background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 4, padding: '2px 5px', fontSize: 12,
};

export function InviteCard({ def, rows, week, personName, canEdit, setRow }: {
  def: TrainingBoardDef; rows: BoardRow[]; week: number; personName: string; canEdit: boolean; setRow: SetRow;
}) {
  const meta = rows.find((r) => r.item_key === META_INVITE && r.week === week)?.value ?? {};
  const first = rows.find((r) => r.item_key === META_FIRST && r.week === 0)?.value ?? {};
  const covered = (first.covered as string[] | undefined) ?? [];
  const dates = (first.dates as Record<string, string> | undefined) ?? {};
  const text = inviteText(def, rows, week, personName);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const setFirst = (patch: Record<string, unknown>) => setRow(META_FIRST, 0, { value: { ...first, ...patch } });

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      <div className="t-card" style={{ padding: '0.75rem 0.9rem', borderLeft: '4px solid var(--color-text-muted)' }}>
        <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>First meeting — tick as covered</div>
        <ul className="space-y-1">
          {def.firstMeeting.map((f) => (
            <li key={f} className="t-small flex items-start gap-2">
              <input type="checkbox" checked={covered.includes(f)} disabled={!canEdit}
                onChange={(e) => setFirst({ covered: e.target.checked ? [...covered, f] : covered.filter((x) => x !== f) })} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1">
          {def.signers.map((s) => (
            <label key={s} className="t-small flex items-center gap-2 flex-wrap">
              <span className="t-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, minWidth: 170 }}>{s}</span>
              <input type="date" value={dates[s] ?? ''} disabled={!canEdit} onChange={(e) => setFirst({ dates: { ...dates, [s]: e.target.value } })} style={{ ...input, padding: '1px 4px', fontSize: 11 }} />
            </label>
          ))}
        </div>
      </div>

      <div className="t-card" style={{ padding: '0.75rem 0.9rem' }}>
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="t-small t-muted uppercase tracking-wider" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>Weekly calendar invite · W{week} — copy this body</div>
          <button type="button" onClick={copy} className="t-small px-2 py-0.5 rounded border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
        <div className="grid gap-1 mb-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="t-small flex flex-col"><span className="t-muted" style={{ fontSize: 10.5 }}>Title</span>
            <input value={typeof meta.title === 'string' ? meta.title : ''} placeholder={`8-Week Review · W${week} · ${personName}`} disabled={!canEdit}
              onChange={(e) => setRow(META_INVITE, week, { value: { ...meta, title: e.target.value || undefined } })} style={input} /></label>
          <label className="t-small flex flex-col"><span className="t-muted" style={{ fontSize: 10.5 }}>When</span>
            <input value={typeof meta.when === 'string' ? meta.when : ''} placeholder="Fri 2:00–3:00 pm · shop" disabled={!canEdit}
              onChange={(e) => setRow(META_INVITE, week, { value: { ...meta, when: e.target.value || undefined } })} style={input} /></label>
        </div>
        <pre className="t-small" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', background: 'var(--color-bg)', border: '1px dashed var(--color-border)', borderRadius: 4, padding: '8px 10px', margin: 0 }}>{text}</pre>
        {def.reportLines.length > 0 && (
          <pre className="t-small t-muted mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{def.reportLines.join('\n')}</pre>
        )}
      </div>
    </div>
  );
}
