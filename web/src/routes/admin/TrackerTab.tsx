// Admin → Tracker (user 2026-10-09): replaces the per-row Training button
// and the Profile links. Two views:
//   • All engineers — the matrix: every item (log counts, 8 professional
//     traits, 28 skills) as a row, every active engineer as a column, scores
//     and statuses edited in the cell ("editable with all items showed").
//   • One engineer — the full panel: dated log with straight / helped-the-
//     team marks, trait notes, skill notes and SOP write-ups.
// Edit rights follow the career helpers (migration 0133): admin, or a
// same-site manager / lead. Everyone else who can open Admin reads only.
import { useMemo, useState } from 'react';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useMe } from '../../hooks/useMe';
import { useUparkUserIds } from '../../hooks/useSiteScope';
import { TrackerPanel } from '../../components/tracker/TrackerPanel';
import { TrackerMatrix } from '../../components/tracker/TrackerMatrix';

type View = 'all' | 'one';

export function TrackerTab() {
  const me = useMe();
  const eng = useEngineers();
  const uparkIds = useUparkUserIds();
  const [view, setView] = useState<View>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [filter, setFilter] = useState('');

  const canEdit = !!me.data && (
    me.data.role === 'admin' || me.data.role === 'manager' || me.data.role === 'director'
    || me.data.is_manager === true || me.data.is_lead === true
  );

  const roster = useMemo(() => {
    const rows = (eng.data ?? [])
      .filter((r) => r.role === 'engineer' && (showInactive || r.active))
      .filter((r) => !uparkIds || uparkIds.has(r.user_id));
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((r) => r.full_name.toLowerCase().includes(f) || (r.email ?? '').toLowerCase().includes(f)) : rows;
  }, [eng.data, showInactive, filter, uparkIds]);

  const person = (eng.data ?? []).find((r) => r.user_id === picked);
  const openOne = (e: EngineerRow) => { setPicked(e.user_id); setView('one'); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Seg active={view === 'all'} onClick={() => setView('all')}>All engineers</Seg>
        <Seg active={view === 'one'} onClick={() => setView('one')}>One engineer{person ? ` · ${person.full_name}` : ''}</Seg>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a name…"
          style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 6px', fontSize: 12, marginLeft: 8 }}
        />
        <label className="t-small t-muted flex items-center gap-1">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> show inactive
        </label>
        {eng.isLoading && <span className="t-small t-muted">Loading…</span>}
        {eng.error && <span className="t-small t-danger">Error: {(eng.error as Error).message}</span>}
      </div>

      {view === 'all' && !eng.isLoading && (
        <TrackerMatrix engineers={roster} canEdit={canEdit} onOpen={openOne} />
      )}

      {view === 'one' && (
        <div className="flex gap-4 items-start flex-wrap md:flex-nowrap">
          <aside className="t-card" style={{ padding: '0.75rem', flex: '0 0 220px', maxWidth: '100%' }}>
            <ul className="space-y-0.5" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {roster.map((r) => (
                <li key={r.user_id}>
                  <button
                    onClick={() => setPicked(r.user_id)}
                    className="w-full text-left t-small px-2 py-1 rounded"
                    style={{
                      background: picked === r.user_id ? 'rgba(94,106,210,0.12)' : 'transparent',
                      color: picked === r.user_id ? 'var(--color-accent)' : 'var(--color-text)',
                      opacity: r.active ? 1 : 0.6,
                    }}
                  >
                    {r.full_name}
                    {r.is_lead && <span className="t-muted"> ★</span>}
                    {!r.active && <span className="t-muted"> (inactive)</span>}
                  </button>
                </li>
              ))}
              {roster.length === 0 && !eng.isLoading && <li className="t-small t-muted italic px-2">No engineers match.</li>}
            </ul>
          </aside>

          <div style={{ flex: '1 1 480px', minWidth: 0 }}>
            {!person ? (
              <div className="t-card" style={{ padding: '1rem' }}>
                <p className="t-text t-muted">Pick an engineer to open their full tracker — the dated log, notes and SOP write-ups.</p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-3 mb-3 flex-wrap">
                  <h2 className="t-section-title" style={{ marginBottom: 0 }}>{person.full_name}</h2>
                  <span className="t-small t-muted">
                    {person.title ?? 'Engineer'}{person.discipline ? ` · ${person.discipline}` : ''}{person.hiring_date ? ` · hired ${person.hiring_date}` : ''}
                  </span>
                  {!canEdit && <span className="t-small t-muted">(view only)</span>}
                </div>
                <TrackerPanel key={person.user_id} userId={person.user_id} canEdit={canEdit} isSelf={me.data?.id === person.user_id} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Seg({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="t-small px-3 py-1 rounded border"
      style={{
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        background: 'var(--color-card)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
