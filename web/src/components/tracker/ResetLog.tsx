// ResetLog — fourth tab of the 8-week board (user 2026-10-26): every reset
// in the change trail (training_board_log, field = 'reset'), newest first,
// with what the item held before it was cleared. "All changes" shows the
// whole trail.
import { useState } from 'react';
import { describeChange, fmtDay, itemNum, type TrainingBoardDef, type BoardLogRow } from '../../lib/trainingBoard';

export function ResetLog({ def, log }: { def: TrainingBoardDef; log: BoardLogRow[] }) {
  const [all, setAll] = useState(false);
  const byKey = new Map(def.items.map((it) => [it.key, it]));
  const rows = log.filter((l) => all || l.field === 'reset').slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const name = (key: string) => { const it = byKey.get(key); return it ? `${itemNum(it)} ${it.text}` : key; };
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 t-small">
        <span className="t-muted">{all ? `${rows.length} changes` : `${rows.length} reset${rows.length === 1 ? '' : 's'}`}</span>
        <button type="button" onClick={() => setAll((x) => !x)} className="t-accent hover:underline">{all ? 'Resets only' : 'All changes'}</button>
      </div>
      {rows.length === 0 ? (
        <p className="t-small t-muted italic">{all ? 'Nothing logged yet.' : 'No resets yet — ↺ reset on an item clears every saved week of it and lands here.'}</p>
      ) : (
        <table className="w-full t-small" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="t-muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">Week</th><th className="text-left px-2 py-1">Item</th><th className="text-left px-2 py-1">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--color-border)', background: l.field === 'reset' ? 'rgba(239,68,68,0.06)' : 'transparent' }}>
                <td className="px-2 py-1 t-mono whitespace-nowrap">{fmtDay(l.changed_on)}</td>
                <td className="px-2 py-1 t-mono">{l.week ? `W${l.week}` : '—'}</td>
                <td className="px-2 py-1">{name(l.item_key)}</td>
                <td className="px-2 py-1" style={{ color: l.field === 'reset' ? '#b91c1c' : undefined, fontWeight: l.field === 'reset' ? 600 : 400 }}>{describeChange(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
