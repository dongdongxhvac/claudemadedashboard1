// Career timeline — profile card (RPG styling, matches
// routes/engineer/Profile.tsx). Events come merged and sorted from
// hooks/useCareerTimeline.ts; stored rows (career_events, migration 0133)
// can be added / edited / removed by admins, managers and leads.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KIND_META, EDITABLE_KINDS, type CareerEvent, type CareerEventKind, type CareerEventRow } from '../../lib/careerTimeline';
import { useAddCareerEvent, useUpdateCareerEvent, useDeleteCareerEvent } from '../../hooks/useCareerTimeline';
import { PT, panel, input } from './theme';
const fmt = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

type FormState = { kind: CareerEventKind; occurred_on: string; title: string; detail: string; visibility: 'public' | 'managers' };
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function EventForm({ userId, row, canManagerRows, onDone }: { userId: string; row: CareerEventRow | null; canManagerRows: boolean; onDone: () => void }) {
  const [f, setF] = useState<FormState>(row
    ? { kind: (row.kind in KIND_META ? row.kind : 'custom') as CareerEventKind, occurred_on: row.occurred_on, title: row.title, detail: row.detail ?? '', visibility: row.visibility }
    : { kind: 'custom', occurred_on: todayYmd(), title: '', detail: '', visibility: 'public' });
  const [err, setErr] = useState<string | null>(null);
  const add = useAddCareerEvent();
  const upd = useUpdateCareerEvent();
  const pending = add.isPending || upd.isPending;
  const set = (k: keyof FormState, v: string) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => {
    setErr(null);
    if (!f.title.trim()) { setErr('Title is required.'); return; }
    const opts = { onSuccess: onDone, onError: (e: Error) => setErr(e.message) };
    if (row) upd.mutate({ id: row.id, patch: { kind: f.kind, occurred_on: f.occurred_on, title: f.title.trim(), detail: f.detail, visibility: f.visibility } }, opts);
    else add.mutate({ user_id: userId, kind: f.kind, occurred_on: f.occurred_on, title: f.title.trim(), detail: f.detail, visibility: f.visibility }, opts);
  };
  const kinds = row && !EDITABLE_KINDS.includes(f.kind) ? [f.kind, ...EDITABLE_KINDS] : EDITABLE_KINDS;
  return (
    <div className="rounded-lg p-4 mb-3" style={panel}>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Kind</span>
          <select style={input} value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_META[k].icon} {KIND_META[k].label}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Date</span>
          <input style={input} type="date" value={f.occurred_on} onChange={(e) => set('occurred_on', e.target.value)} /></label>
        <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs opacity-60">Title *</span>
          <input style={input} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Promoted to Lead Engineer" /></label>
        <label className="flex flex-col gap-1 md:col-span-3"><span className="text-xs opacity-60">Detail</span>
          <input style={input} value={f.detail} onChange={(e) => set('detail', e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Who sees it</span>
          <select style={input} value={f.visibility} onChange={(e) => set('visibility', e.target.value)} disabled={!canManagerRows} title={canManagerRows ? '' : 'Only managers can add manager-only rows'}>
            <option value="public">The person + managers</option>
            <option value="managers">Managers only</option>
          </select></label>
      </div>
      {err && <p className="text-xs mt-2" style={{ color: PT.danger }}>{err}</p>}
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={submit} disabled={pending} className="text-sm px-3 py-1 rounded-md" style={{ background: PT.button, color: '#fff' }}>{pending ? 'Saving…' : row ? 'Save' : 'Add event'}</button>
        <button type="button" onClick={onDone} className="text-sm px-3 py-1 rounded-md opacity-70 hover:opacity-100">Cancel</button>
      </div>
    </div>
  );
}

export function CareerTimeline({ userId, events, isLoading, error, canEdit, canManagerRows, showPrivate, glow }: {
  userId: string;
  events: CareerEvent[];
  isLoading: boolean;
  error: Error | null;
  /** may add / edit / delete stored rows (admin / manager / lead — the DB decides) */
  canEdit: boolean;
  /** manager-ish: sees and may write 'managers' rows */
  canManagerRows: boolean;
  /** the person themself or manager-ish: sees 'private' rows (PTO counts) */
  showPrivate: boolean;
  glow: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CareerEventRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const del = useDeleteCareerEvent();

  const visible = events.filter((e) => e.audience === 'all' || (e.audience === 'private' && showPrivate) || (e.audience === 'managers' && canManagerRows));
  const shown = showAll ? visible : visible.filter((e) => e.milestone);
  const minor = visible.length - visible.filter((e) => e.milestone).length;

  // group by year (already newest first)
  const years: { year: string; rows: CareerEvent[] }[] = [];
  for (const e of shown) {
    const y = e.date.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === y) last.rows.push(e); else years.push({ year: y, rows: [e] });
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-xs uppercase tracking-widest opacity-60">
          Career timeline <span className="opacity-60">· {visible.length}</span>
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {minor > 0 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="underline opacity-70 hover:opacity-100">
              {showAll ? 'Milestones only' : `Show all events (+${minor})`}
            </button>
          )}
          {canEdit && !adding && !editing && (
            <button type="button" onClick={() => setAdding(true)} className="underline opacity-80 hover:opacity-100">+ Add event</button>
          )}
        </div>
      </div>

      {canEdit && adding && <EventForm userId={userId} row={null} canManagerRows={canManagerRows} onDone={() => setAdding(false)} />}
      {canEdit && editing && <EventForm key={editing.id} userId={userId} row={editing} canManagerRows={canManagerRows} onDone={() => setEditing(null)} />}
      {err && <p className="text-xs mb-2" style={{ color: PT.danger }}>{err}</p>}

      <div className="rounded-lg" style={panel}>
        {isLoading && <p className="text-sm opacity-60 p-4">Loading…</p>}
        {error && <p className="text-sm p-4" style={{ color: PT.danger }}>Error: {error.message}</p>}
        {!isLoading && !error && shown.length === 0 && (
          <p className="text-sm opacity-50 italic p-4">{visible.length === 0 ? 'Nothing on the timeline yet — it fills in from hiring, training, PMs and on-call.' : 'No milestones yet — show all events to see the small steps.'}</p>
        )}
        {years.map((y) => (
          <div key={y.year} className="px-4 pt-3 pb-1">
            <div className="text-xs font-mono opacity-50 mb-2">{y.year}</div>
            <ol className="relative ml-3" style={{ borderLeft: `1px solid ${PT.panelBorder}` }}>
              {y.rows.map((e) => (
                <li key={e.id} className="relative pl-6 pb-3">
                  <span className="absolute flex items-center justify-center rounded-full"
                    style={{
                      left: e.milestone ? -15 : -11, top: e.milestone ? 0 : 3,
                      width: e.milestone ? 29 : 21, height: e.milestone ? 29 : 21,
                      fontSize: e.milestone ? 16 : 11,
                      background: e.milestone ? PT.headerBg : PT.panel,
                      border: `1px solid ${e.milestone ? PT.chipBorder : PT.panelBorder}`,
                      boxShadow: e.milestone ? `0 0 14px ${glow}` : 'none',
                    }} title={KIND_META[e.kind].label}>{e.icon}</span>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-mono text-xs opacity-60 w-14">{fmt(e.date)}</span>
                    <span className={e.milestone ? 'text-sm font-medium' : 'text-sm opacity-85'}>
                      {e.link ? <Link to={e.link} className="hover:underline">{e.title}</Link> : e.title}
                    </span>
                    {e.detail && <span className="text-xs opacity-55">{e.detail}</span>}
                    {e.audience === 'managers' && <span className="text-xs px-1.5 rounded-full opacity-70" style={{ background: PT.lockedBg, border: `1px solid ${PT.lockedBorder}` }}>managers only</span>}
                    {e.editable && canEdit && (
                      <span className="text-xs flex gap-2 ml-auto">
                        <button type="button" className="underline opacity-60 hover:opacity-100" onClick={() => { setEditing(e.editable); setAdding(false); }}>edit</button>
                        <button type="button" className="underline opacity-60 hover:opacity-100" style={{ color: PT.danger }}
                          onClick={() => { if (window.confirm(`Delete "${e.title}"?`)) del.mutate(e.editable!.id, { onError: (x) => setErr((x as Error).message) }); }}>remove</button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
