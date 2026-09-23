// "My record" — the engineer's self-serve work log on their own page.
// Add an entry in ~20 seconds from a phone; it sits as "recorded by you"
// until a lead or manager verifies it on the profile page. Own unverified
// entries can be edited or deleted here; verified ones are read-only.
import { useState } from 'react';
import { Section } from '../Section';
import { useSiteBuildings } from '../../hooks/useSiteBuildings';
import {
  useWorkRecords, useDeleteWorkRecord,
  KIND_LABELS, INDEPENDENCE_LABELS, type WorkRecord,
} from '../../hooks/useWorkRecords';
import { WorkRecordForm } from './WorkRecordForm';

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function MyWorkRecordSection({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const q = useWorkRecords(userId);
  const del = useDeleteWorkRecord();
  const buildings = useSiteBuildings();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WorkRecord | null>(null);
  const [showAll, setShowAll] = useState(false);

  const rows = q.data ?? [];
  const verified = rows.filter((r) => r.status === 'verified').length;
  const shown = showAll ? rows : rows.slice(0, compact ? 5 : 10);

  const subtitle = (
    <span className="t-small t-muted">
      {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {verified} verified
      {!adding && !editing && (
        <button onClick={() => setAdding(true)} className="ml-3 t-accent hover:underline" style={{ fontWeight: 600 }}>
          + Add entry
        </button>
      )}
    </span>
  );

  return (
    <Section collapsible title="My record" subtitle={subtitle} loading={q.isLoading} id="my-record">
      {q.error && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}

      {(adding || editing) && (
        <div className="t-card mb-3" style={{ padding: '0.9rem 1rem' }}>
          <div className="t-small font-semibold mb-2">{editing ? 'Edit entry' : 'New entry'}</div>
          <WorkRecordForm
            userId={userId}
            buildings={buildings}
            initial={editing}
            onDone={() => { setAdding(false); setEditing(null); }}
            onCancel={() => { setAdding(false); setEditing(null); }}
          />
        </div>
      )}

      {rows.length === 0 && !adding ? (
        <p className="t-small t-muted italic">
          Nothing recorded yet. Add what you did today — a pump rebuild, a VFD fault you chased, the building set-up you explained in the office.
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map((r) => (
            <li
              key={r.id}
              className="t-small flex items-baseline gap-2 flex-wrap"
              style={{ padding: '0.3rem 0.5rem', borderLeft: `3px solid ${r.status === 'verified' ? 'var(--color-ok, #10b981)' : 'var(--color-border)'}`, background: 'var(--color-card)', borderRadius: 3 }}
            >
              <span className="t-mono t-muted" style={{ minWidth: 48 }}>{fmtDate(r.occurred_on)}</span>
              {r.building_code && <span className="t-mono" style={{ minWidth: 40 }}>Bld {r.building_code}</span>}
              <span className="t-muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{KIND_LABELS[r.kind]}</span>
              <span className="font-medium">{r.task}</span>
              {r.independence && <span className="t-muted">· {INDEPENDENCE_LABELS[r.independence]}</span>}
              {r.photo_path && <span className="t-muted" title="Photo attached">📎</span>}
              <span
                className="ml-auto"
                style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 3,
                  background: r.status === 'verified' ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                  color: r.status === 'verified' ? '#047857' : '#475569',
                }}
                title={r.status === 'verified' ? `Verified by ${r.verified_by_name ?? 'lead'}` : 'Waiting for a lead to verify'}
              >
                {r.status === 'verified' ? `VERIFIED · ${r.verified_by_name ?? ''}`.trim() : 'RECORDED BY YOU'}
              </span>
              {r.status === 'self' && !editing && !adding && (
                <span className="flex gap-2">
                  <button onClick={() => setEditing(r)} className="t-accent hover:underline">Edit</button>
                  <button
                    onClick={() => { if (confirm('Delete this entry?')) del.mutate(r); }}
                    className="t-muted hover:t-danger"
                  >Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && (
        <button onClick={() => setShowAll(true)} className="t-small t-accent hover:underline mt-2">
          Show all {rows.length}
        </button>
      )}
    </Section>
  );
}
