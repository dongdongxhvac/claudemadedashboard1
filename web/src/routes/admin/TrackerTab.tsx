// Admin → Tracker (user 2026-10-09): replaces the per-row Training button
// and the Profile links. Pick an engineer on the left, work their tracker on
// the right — log (shop / reading / WO / problem / PM / event, straight vs
// helped the team), professional scorecard, skills checklist.
// Edit rights follow the career helpers (migration 0133): admin, or a
// same-site manager / lead. Everyone else who can open Admin reads only.
import { useMemo, useState } from 'react';
import { useEngineers } from '../../hooks/useEngineers';
import { useMe } from '../../hooks/useMe';
import { TrackerPanel } from '../../components/tracker/TrackerPanel';

export function TrackerTab() {
  const me = useMe();
  const eng = useEngineers();
  const [picked, setPicked] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [filter, setFilter] = useState('');

  const canEdit = !!me.data && (
    me.data.role === 'admin' || me.data.role === 'manager' || me.data.role === 'director'
    || me.data.is_manager === true || me.data.is_lead === true
  );

  const roster = useMemo(() => {
    const rows = (eng.data ?? []).filter((r) => r.role === 'engineer' && (showInactive || r.active));
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((r) => r.full_name.toLowerCase().includes(f) || (r.email ?? '').toLowerCase().includes(f)) : rows;
  }, [eng.data, showInactive, filter]);

  const person = roster.find((r) => r.user_id === picked) ?? (eng.data ?? []).find((r) => r.user_id === picked);

  return (
    <div className="flex gap-4 items-start flex-wrap md:flex-nowrap">
      <aside className="t-card" style={{ padding: '0.75rem', flex: '0 0 240px', maxWidth: '100%' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find a name…"
          className="w-full mb-2"
          style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 6px', fontSize: 12 }}
        />
        {eng.isLoading && <p className="t-small t-muted">Loading…</p>}
        {eng.error && <p className="t-small t-danger">Error: {(eng.error as Error).message}</p>}
        <ul className="space-y-0.5" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {roster.map((r) => (
            <li key={r.user_id}>
              <button
                onClick={() => setPicked(r.user_id)}
                className="w-full text-left t-small px-2 py-1 rounded"
                style={{
                  background: picked === r.user_id ? 'rgba(var(--color-accent-rgb, 59,130,246),0.12)' : 'transparent',
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
        <label className="t-small t-muted flex items-center gap-1 mt-2">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> show inactive
        </label>
      </aside>

      <div style={{ flex: '1 1 480px', minWidth: 0 }}>
        {!person ? (
          <div className="t-card" style={{ padding: '1rem' }}>
            <p className="t-text t-muted">Pick an engineer to open their tracker.</p>
            <p className="t-small t-muted mt-2">
              The tracker has three parts: the <b>log</b> of what they did (shop · reading · WO · problem · PM · event, each marked
              straight or helped-the-team), the <b>professional</b> scorecard (learning, following direction, reliable, communication,
              responsibility, skills, experience, knowledge) and the hands-on <b>skills</b> checklist with SOP write-ups.
              {!canEdit && ' You can read trackers but not change them.'}
            </p>
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
  );
}
