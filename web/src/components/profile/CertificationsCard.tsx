// Milestones & certifications — profile card (RPG styling, matches
// routes/engineer/Profile.tsx). Auto milestones are computed
// (lib/careerTimeline.ts autoMilestones); certifications are rows in the
// certifications table (migration 0133) with an optional scanned file.
import { useState } from 'react';
import { certExpiryState, daysUntil, type AutoMilestone, type CertificationRow } from '../../lib/careerTimeline';
import { useCertifications, useUpsertCertification, useDeleteCertification, useCertificationFileUrl } from '../../hooks/useCertifications';
import { PT, panel, input } from './theme';
const fmt = (ymd: string | null | undefined) => (ymd ? new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export function ExpiryBadge({ expiresOn, today = new Date() }: { expiresOn: string | null; today?: Date }) {
  const st = certExpiryState(expiresOn, today);
  if (st === 'none') return <span className="text-xs opacity-50">no expiry</span>;
  const d = daysUntil(expiresOn!, today);
  const style = st === 'expired' ? { background: PT.bad.bg, color: PT.bad.text }
    : st === 'soon' ? { background: PT.warn.bg, color: PT.warn.text }
    : { background: PT.ok.bg, color: PT.ok.text };
  const text = st === 'expired' ? `EXPIRED ${fmt(expiresOn)}` : st === 'soon' ? `EXPIRES IN ${d} D` : `valid to ${fmt(expiresOn)}`;
  return <span className="text-xs px-2 py-0.5 rounded-full font-mono" style={style}>{text}</span>;
}

function FileLink({ path }: { path: string | null }) {
  const url = useCertificationFileUrl(path);
  if (!path) return null;
  if (!url.data) return <span className="text-xs opacity-50">{url.isError ? 'file unavailable' : 'file…'}</span>;
  return <a href={url.data} target="_blank" rel="noreferrer" className="text-xs underline opacity-80 hover:opacity-100">📎 open file</a>;
}

type FormState = { name: string; issuer: string; number: string; issued_on: string; expires_on: string; note: string; file: File | null; removeFile: boolean };
const blank: FormState = { name: '', issuer: '', number: '', issued_on: '', expires_on: '', note: '', file: null, removeFile: false };
const fromRow = (r: CertificationRow): FormState => ({ name: r.name, issuer: r.issuer ?? '', number: r.number ?? '', issued_on: r.issued_on ?? '', expires_on: r.expires_on ?? '', note: r.note ?? '', file: null, removeFile: false });

function CertForm({ userId, row, onDone }: { userId: string; row: CertificationRow | null; onDone: () => void }) {
  const [f, setF] = useState<FormState>(row ? fromRow(row) : blank);
  const [err, setErr] = useState<string | null>(null);
  const upsert = useUpsertCertification();
  const set = (k: keyof FormState, v: string | File | null | boolean) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => {
    setErr(null);
    upsert.mutate(
      { id: row?.id, row: { user_id: userId, name: f.name, issuer: f.issuer, number: f.number, issued_on: f.issued_on, expires_on: f.expires_on, note: f.note }, file: f.file, removeFile: f.removeFile },
      { onSuccess: onDone, onError: (e) => setErr((e as Error).message) },
    );
  };
  return (
    <div className="rounded-lg p-4 mt-3" style={panel}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs opacity-60">Name *</span>
          <input style={input} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="EPA 608 Universal" /></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Issuer</span>
          <input style={input} value={f.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="EPA / OSHA / state board" /></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">License / cert number</span>
          <input style={input} value={f.number} onChange={(e) => set('number', e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Issued</span>
          <input style={input} type="date" value={f.issued_on} onChange={(e) => set('issued_on', e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Expires (blank = never)</span>
          <input style={input} type="date" value={f.expires_on} onChange={(e) => set('expires_on', e.target.value)} /></label>
        <label className="flex flex-col gap-1 md:col-span-2"><span className="text-xs opacity-60">Note</span>
          <input style={input} value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="text-xs opacity-60">Scan / photo (PDF, JPG, PNG · 15 MB)</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => set('file', e.target.files?.[0] ?? null)} />
          {row?.file_path && !f.file && (
            <label className="text-xs opacity-70 flex items-center gap-1"><input type="checkbox" checked={f.removeFile} onChange={(e) => set('removeFile', e.target.checked)} /> remove the current file</label>
          )}
        </label>
      </div>
      {err && <p className="text-xs mt-2" style={{ color: PT.danger }}>{err}</p>}
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={submit} disabled={upsert.isPending} className="text-sm px-3 py-1 rounded-md" style={{ background: PT.button, color: '#fff' }}>
          {upsert.isPending ? 'Saving…' : row ? 'Save' : 'Add certification'}
        </button>
        <button type="button" onClick={onDone} className="text-sm px-3 py-1 rounded-md opacity-70 hover:opacity-100">Cancel</button>
      </div>
    </div>
  );
}

export function CertificationsCard({ userId, milestones, canEdit, glow }: {
  userId: string;
  milestones: AutoMilestone[];
  canEdit: boolean;
  glow: string;
}) {
  const q = useCertifications(userId);
  const del = useDeleteCertification();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CertificationRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rows = q.data ?? [];
  const today = new Date();

  return (
    <section className="mb-8">
      <h2 className="text-xs uppercase tracking-widest opacity-60 mb-3">Milestones &amp; certifications</h2>

      {/* auto milestones — earned chips glow, locked chips are dim */}
      <div className="flex flex-wrap gap-2 mb-4">
        {milestones.map((m) => {
          const on = !!m.earnedOn;
          return (
            <span key={m.key} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
              title={on ? `Earned ${fmt(m.earnedOn)}` : `Locked — ${m.hint}`}
              style={on
                ? { background: PT.chipBg, color: PT.chipText, border: `1px solid ${PT.chipBorder}`, boxShadow: `0 0 14px ${glow}` }
                : { background: PT.lockedBg, color: PT.lockedText, border: `1px solid ${PT.lockedBorder}` }}>
              <span style={{ filter: on ? 'none' : 'grayscale(1)' }}>{m.icon}</span>
              {m.label}
              {on && <span className="font-mono opacity-70">· {fmt(m.earnedOn)}</span>}
            </span>
          );
        })}
      </div>

      <div className="rounded-lg overflow-hidden" style={panel}>
        {q.isLoading && <p className="text-sm opacity-60 p-4">Loading…</p>}
        {q.isError && <p className="text-sm p-4" style={{ color: PT.danger }}>Error: {(q.error as Error).message}</p>}
        {!q.isLoading && rows.length === 0 && (
          <p className="text-sm opacity-50 italic p-4">No licenses or certifications on file{canEdit ? ' — add one below.' : '.'}</p>
        )}
        {rows.map((r, i) => (
          <div key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ borderTop: i === 0 ? 'none' : `1px solid ${PT.panelBorder}` }}>
            <span className="text-xl">📜</span>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <div className="text-sm font-medium">{r.name}{r.issuer && <span className="opacity-60"> · {r.issuer}</span>}</div>
              <div className="text-xs opacity-60 font-mono">
                {r.number && <>#{r.number} · </>}issued {fmt(r.issued_on)}{r.note && <span className="font-sans"> · {r.note}</span>}
              </div>
            </div>
            <ExpiryBadge expiresOn={r.expires_on} today={today} />
            <FileLink path={r.file_path} />
            {canEdit && (
              <span className="text-xs flex gap-2">
                <button type="button" className="underline opacity-70 hover:opacity-100" onClick={() => { setEditing(r); setAdding(false); }}>edit</button>
                <button type="button" className="underline opacity-70 hover:opacity-100" style={{ color: PT.danger }}
                  onClick={() => { if (window.confirm(`Delete "${r.name}"?`)) del.mutate({ id: r.id, file_path: r.file_path }, { onError: (e) => setErr((e as Error).message) }); }}>remove</button>
              </span>
            )}
          </div>
        ))}
      </div>
      {err && <p className="text-xs mt-2" style={{ color: PT.danger }}>{err}</p>}

      {canEdit && !adding && !editing && (
        <button type="button" onClick={() => setAdding(true)} className="text-sm mt-3 underline opacity-80 hover:opacity-100">+ Add certification</button>
      )}
      {canEdit && adding && <CertForm userId={userId} row={null} onDone={() => setAdding(false)} />}
      {canEdit && editing && <CertForm key={editing.id} userId={userId} row={editing} onDone={() => setEditing(null)} />}
    </section>
  );
}
