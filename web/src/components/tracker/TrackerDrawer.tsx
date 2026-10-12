// TrackerDrawer — one engineer's tracker in a slide-over, opened from the
// "Tracker" button next to Edit on the User Profiles rosters (UPark and
// Binney, user 2026-10-09). Same panel as the admin Tracker tab; edit rights
// follow the career helpers (admin, or same-site manager / lead) — the DB
// enforces them, this only decides which controls to show.
import { useMe } from '../../hooks/useMe';
import { TrackerPanel } from './TrackerPanel';

export function TrackerDrawer({ person, onClose }: {
  person: { user_id: string; full_name: string; title?: string | null; hiring_date?: string | null };
  onClose: () => void;
}) {
  const me = useMe();
  const canEdit = !!me.data && (
    me.data.role === 'admin' || me.data.role === 'manager' || me.data.role === 'director'
    || me.data.is_manager === true || me.data.is_lead === true
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-full overflow-y-auto p-6"
        style={{ background: 'var(--color-bg)' }}
      >
        <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="t-section-title" style={{ marginBottom: 0 }}>{person.full_name} · Tracker</h3>
            <p className="t-small t-muted">
              {person.title ?? 'Engineer'}{person.hiring_date ? ` · hired ${person.hiring_date}` : ''}{!canEdit ? ' · view only' : ''}
            </p>
          </div>
          <button onClick={onClose} className="t-small t-accent hover:underline">Close</button>
        </div>
        <TrackerPanel key={person.user_id} userId={person.user_id} canEdit={canEdit} isSelf={me.data?.id === person.user_id} />
      </div>
    </div>
  );
}
