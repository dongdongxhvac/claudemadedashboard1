// TrackerPanel — one engineer's tracker: the dated log (shop / reading / WO /
// problem / PM / event, each marked straight vs helped-the-team), the
// professional scorecard (0-4 per trait) and the hands-on skills checklist.
// Shared by the admin Tracker tab (canEdit = lead/manager/admin) and the
// engineer's own page (canEdit = false: they can add/edit their own
// unverified log entries and type their SOP write-ups, nothing else).
import { useMemo, useState } from 'react';
import { Section } from '../Section';
import {
  TRACK_KINDS, TRACK_KIND_LABELS, TRACK_KIND_HINTS,
  SPIRITS, SPIRIT_LABELS, SPIRIT_HINTS,
  TRAITS, SCORE_LABELS,
  SKILLS, SKILL_GROUPS, SKILL_STATUSES, SKILL_STATUS_LABELS,
  type TrackKind, type Spirit, type SkillStatus, type SkillDef,
} from '../../lib/tracker';
import {
  useTrackerEntries, useUpsertTrackerEntry, useSetEntrySpirit, useVerifyTrackerEntry, useDeleteTrackerEntry,
  useTrackerTraits, useUpsertTrackerTrait,
  useTrackerSkills, useUpsertTrackerSkill,
  type TrackerEntry, type TrackerSkill,
} from '../../hooks/useTracker';

const today = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 6px', fontSize: 12,
};

export function TrackerPanel({ userId, canEdit, isSelf, personName }: {
  userId: string;
  /** Lead / manager / admin: verify, mark spirit, score traits, set skill status. */
  canEdit: boolean;
  /** The page belongs to the person being tracked. */
  isSelf: boolean;
  personName?: string;
}) {
  return (
    <div className="space-y-4">
      <LogSection userId={userId} canEdit={canEdit} isSelf={isSelf} personName={personName} />
      <TraitsSection userId={userId} canEdit={canEdit} />
      <SkillsSection userId={userId} canEdit={canEdit} isSelf={isSelf} />
    </div>
  );
}

// ── 1 · Log ───────────────────────────────────────────────────────────────

function LogSection({ userId, canEdit, isSelf, personName }: { userId: string; canEdit: boolean; isSelf: boolean; personName?: string }) {
  const q = useTrackerEntries(userId);
  const upsert = useUpsertTrackerEntry();
  const setSpirit = useSetEntrySpirit();
  const verify = useVerifyTrackerEntry();
  const del = useDeleteTrackerEntry();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TrackerEntry | null>(null);
  const [kindFilter, setKindFilter] = useState<TrackKind | 'all'>('all');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(() => {
    const byKind: Record<string, number> = {};
    let straight = 0, help = 0;
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      if (r.spirit === 'straight') straight++;
      if (r.spirit === 'help_team') help++;
    }
    return { byKind, straight, help };
  }, [rows]);
  const filtered = kindFilter === 'all' ? rows : rows.filter((r) => r.kind === kindFilter);
  const shown = showAll ? filtered : filtered.slice(0, 15);
  const canAdd = canEdit || isSelf;

  const subtitle = (
    <span className="t-small t-muted">
      {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {counts.help} helped the team · {counts.straight} straight
      {canAdd && !adding && !editing && (
        <button onClick={() => setAdding(true)} className="ml-3 t-accent hover:underline" style={{ fontWeight: 600 }}>+ Add entry</button>
      )}
    </span>
  );

  return (
    <Section title={personName ? `${personName} · Log` : 'Log'} subtitle={subtitle} loading={q.isLoading} id="tracker-log">
      {q.error && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}

      {/* count strip */}
      <div className="flex flex-wrap gap-1 mb-3">
        <Chip active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>All {rows.length}</Chip>
        {TRACK_KINDS.map((k) => (
          <Chip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)} title={TRACK_KIND_HINTS[k]}>
            {TRACK_KIND_LABELS[k]} {counts.byKind[k] ?? 0}
          </Chip>
        ))}
      </div>

      {(adding || editing) && (
        <div className="t-card mb-3" style={{ padding: '0.9rem 1rem' }}>
          <div className="t-small font-semibold mb-2">{editing ? 'Edit entry' : 'New entry'}</div>
          <EntryForm
            userId={userId}
            canEdit={canEdit}
            initial={editing}
            busy={upsert.isPending}
            error={upsert.error ? (upsert.error as Error).message : null}
            onSave={async (v) => {
              await upsert.mutateAsync({ ...v, id: editing?.id, user_id: userId, verifyNow: canEdit && !editing });
              setAdding(false); setEditing(null);
            }}
            onCancel={() => { setAdding(false); setEditing(null); }}
          />
        </div>
      )}

      {filtered.length === 0 && !adding ? (
        <p className="t-small t-muted italic">
          Nothing tracked yet{kindFilter !== 'all' ? ` under ${TRACK_KIND_LABELS[kindFilter]}` : ''}. Add what was done — a reading taken, a WO closed, a problem chased, a PM, an event covered.
        </p>
      ) : (
        <ul className="space-y-1">
          {shown.map((r) => {
            const mine = r.status === 'self';
            const editable = canEdit || (isSelf && mine);
            return (
              <li
                key={r.id}
                className="t-small flex items-baseline gap-2 flex-wrap"
                style={{ padding: '0.3rem 0.5rem', borderLeft: `3px solid ${r.spirit === 'help_team' ? 'var(--color-ok, #10b981)' : r.spirit === 'straight' ? 'var(--color-border)' : 'transparent'}`, background: 'var(--color-card)', borderRadius: 3 }}
              >
                <span className="t-mono t-muted" style={{ minWidth: 48 }}>{fmtDate(r.occurred_on)}</span>
                <span className="t-muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 52 }}>{TRACK_KIND_LABELS[r.kind]}</span>
                <span className="font-medium">{r.title}</span>
                {r.note && <span className="t-muted" title={r.note}>· {r.note.length > 80 ? r.note.slice(0, 80) + '…' : r.note}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {canEdit ? (
                    <select
                      value={r.spirit ?? ''}
                      onChange={(e) => setSpirit.mutate({ id: r.id, user_id: userId, spirit: (e.target.value || null) as Spirit | null })}
                      style={{ ...inputStyle, padding: '1px 4px', fontSize: 11 }}
                      title="How was it done?"
                    >
                      <option value="">— spirit —</option>
                      {SPIRITS.map((s) => <option key={s} value={s}>{SPIRIT_LABELS[s]}</option>)}
                    </select>
                  ) : r.spirit ? (
                    <SpiritBadge spirit={r.spirit} />
                  ) : null}
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 3,
                      background: r.status === 'verified' ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                      color: r.status === 'verified' ? '#047857' : '#475569',
                    }}
                    title={r.status === 'verified' ? `Verified by ${r.verified_by_name ?? 'lead'}` : 'Recorded by the engineer, not yet verified'}
                  >
                    {r.status === 'verified' ? `VERIFIED · ${r.verified_by_name ?? ''}`.trim() : 'SELF'}
                  </span>
                  {canEdit && (
                    <button onClick={() => verify.mutate({ id: r.id, user_id: userId, verified: r.status !== 'verified' })} className="t-accent hover:underline">
                      {r.status === 'verified' ? 'Unverify' : 'Verify'}
                    </button>
                  )}
                  {editable && !editing && !adding && (
                    <>
                      <button onClick={() => setEditing(r)} className="t-accent hover:underline">Edit</button>
                      <button onClick={() => { if (confirm('Delete this entry?')) del.mutate({ id: r.id, user_id: userId }); }} className="t-muted hover:t-danger">Delete</button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > shown.length && (
        <button onClick={() => setShowAll(true)} className="t-small t-accent hover:underline mt-2">Show all {filtered.length}</button>
      )}
    </Section>
  );
}

function SpiritBadge({ spirit }: { spirit: Spirit }) {
  const help = spirit === 'help_team';
  return (
    <span
      title={SPIRIT_HINTS[spirit]}
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 3,
        background: help ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.12)',
        color: help ? '#047857' : '#475569',
      }}
    >
      {SPIRIT_LABELS[spirit].toUpperCase()}
    </span>
  );
}

function Chip({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="t-small px-2 py-0.5 rounded border"
      style={{
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        background: 'var(--color-card)',
      }}
    >
      {children}
    </button>
  );
}

type EntryFormValue = { occurred_on: string; kind: TrackKind; title: string; spirit: Spirit | null; note: string | null };

function EntryForm({ canEdit, initial, busy, error, onSave, onCancel }: {
  userId: string;
  canEdit: boolean;
  initial: TrackerEntry | null;
  busy: boolean;
  error: string | null;
  onSave: (v: EntryFormValue) => Promise<void>;
  onCancel: () => void;
}) {
  const [occurredOn, setOccurredOn] = useState(initial?.occurred_on ?? today());
  const [kind, setKind] = useState<TrackKind>(initial?.kind ?? 'wo');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [spirit, setSpirit] = useState<Spirit | ''>(initial?.spirit ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const ok = title.trim().length > 0;

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => { e.preventDefault(); if (ok) void onSave({ occurred_on: occurredOn, kind, title, spirit: spirit || null, note: note || null }); }}
    >
      <div className="flex flex-wrap gap-2 items-end">
        <label className="t-small t-muted flex flex-col">Date
          <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} style={inputStyle} required />
        </label>
        <label className="t-small t-muted flex flex-col">Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as TrackKind)} style={inputStyle}>
            {TRACK_KINDS.map((k) => <option key={k} value={k}>{TRACK_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="t-small t-muted flex flex-col" style={{ flex: '1 1 220px' }}>What
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={TRACK_KIND_HINTS[kind]} style={inputStyle} required />
        </label>
        {canEdit && (
          <label className="t-small t-muted flex flex-col">How
            <select value={spirit} onChange={(e) => setSpirit(e.target.value as Spirit | '')} style={inputStyle}>
              <option value="">— not marked —</option>
              {SPIRITS.map((s) => <option key={s} value={s}>{SPIRIT_LABELS[s]} — {SPIRIT_HINTS[s]}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="t-small t-muted flex flex-col">Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} style={inputStyle} />
      </label>
      {error && <p className="t-small t-danger">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={!ok || busy} className="t-small px-3 py-1 rounded" style={{ background: 'var(--color-accent)', color: '#fff', opacity: !ok || busy ? 0.5 : 1 }}>
          {busy ? 'Saving…' : initial ? 'Save' : canEdit ? 'Add (verified)' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="t-small t-muted hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ── 2 · Professional scorecard ────────────────────────────────────────────

function TraitsSection({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const q = useTrackerTraits(userId);
  const upsert = useUpsertTrackerTrait();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const scored = TRAITS.filter((t) => (q.data?.get(t.key)?.score ?? null) !== null);
  const avg = scored.length ? (scored.reduce((a, t) => a + (q.data!.get(t.key)!.score ?? 0), 0) / scored.length) : null;

  return (
    <Section
      title="Professional"
      subtitle={<span className="t-small t-muted">a licensed tech is a professional · {scored.length}/{TRAITS.length} scored{avg !== null ? ` · avg ${avg.toFixed(1)}` : ''}</span>}
      loading={q.isLoading}
      id="tracker-professional"
    >
      {q.error && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full t-text border-collapse" style={{ fontSize: 12 }}>
          <thead>
            <tr className="t-small t-muted" style={{ textAlign: 'left' }}>
              <th className="py-1 pr-3">Trait</th>
              <th className="py-1 pr-3">Score</th>
              <th className="py-1 pr-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {TRAITS.map((t) => {
              const row = q.data?.get(t.key);
              const score = row?.score ?? null;
              const editingNote = noteFor === t.key;
              return (
                <tr key={t.key} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <div className="font-medium">{t.label}</div>
                    <div className="t-small t-muted">{t.hint}</div>
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4].map((n) => (
                        <button
                          key={n}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => upsert.mutate({ user_id: userId, trait: t.key, score: score === n ? null : n, note: row?.note ?? null })}
                          title={SCORE_LABELS[n]}
                          className="rounded"
                          style={{
                            width: 26, height: 22, fontSize: 11, fontWeight: 600,
                            border: '1px solid var(--color-border)',
                            background: score !== null && n <= score ? 'var(--color-accent)' : 'var(--color-card)',
                            color: score !== null && n <= score ? '#fff' : 'var(--color-text-muted)',
                            cursor: canEdit ? 'pointer' : 'default',
                          }}
                        >{n}</button>
                      ))}
                      <span className="t-small t-muted ml-2">{score !== null ? SCORE_LABELS[score] : 'not scored'}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-3" style={{ minWidth: 220 }}>
                    {editingNote ? (
                      <form className="flex gap-2 items-start" onSubmit={(e) => { e.preventDefault(); upsert.mutate({ user_id: userId, trait: t.key, score, note: noteDraft }); setNoteFor(null); }}>
                        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={2} maxLength={1000} style={{ ...inputStyle, flex: 1 }} autoFocus />
                        <button type="submit" className="t-small t-accent hover:underline">Save</button>
                        <button type="button" onClick={() => setNoteFor(null)} className="t-small t-muted hover:underline">Cancel</button>
                      </form>
                    ) : (
                      <span className="t-small">
                        {row?.note ? <span>{row.note}</span> : <span className="t-muted italic">—</span>}
                        {canEdit && (
                          <button onClick={() => { setNoteFor(t.key); setNoteDraft(row?.note ?? ''); }} className="ml-2 t-accent hover:underline">{row?.note ? 'Edit' : 'Add note'}</button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 3 · Skills checklist ──────────────────────────────────────────────────

function SkillsSection({ userId, canEdit, isSelf }: { userId: string; canEdit: boolean; isSelf: boolean }) {
  const q = useTrackerSkills(userId);
  const upsert = useUpsertTrackerSkill();
  const [open, setOpen] = useState<string | null>(null);

  const rows = q.data ?? new Map<string, TrackerSkill>();
  const done = SKILLS.filter((s) => ['done', 'verified'].includes(rows.get(s.key)?.status ?? 'not_started')).length;
  const verified = SKILLS.filter((s) => rows.get(s.key)?.status === 'verified').length;

  const save = (s: SkillDef, patch: Partial<Pick<TrackerSkill, 'status' | 'done_on' | 'sop_text' | 'note'>>) => {
    const cur = rows.get(s.key);
    const status = (patch.status ?? cur?.status ?? 'not_started') as SkillStatus;
    const doneOn = patch.done_on !== undefined ? patch.done_on
      : status === 'done' || status === 'verified' ? (cur?.done_on ?? today()) : (cur?.done_on ?? null);
    upsert.mutate({
      user_id: userId, skill: s.key, status, done_on: doneOn,
      sop_text: patch.sop_text !== undefined ? patch.sop_text : (cur?.sop_text ?? null),
      note: patch.note !== undefined ? patch.note : (cur?.note ?? null),
    });
  };

  return (
    <Section
      title="Skills"
      subtitle={<span className="t-small t-muted">{done}/{SKILLS.length} done · {verified} verified</span>}
      loading={q.isLoading}
      id="tracker-skills"
    >
      {q.error && <p className="t-small t-danger">Error: {(q.error as Error).message}</p>}
      {upsert.error && <p className="t-small t-danger">Error: {(upsert.error as Error).message}</p>}
      <div className="space-y-3">
        {SKILL_GROUPS.map((g) => (
          <div key={g}>
            <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontSize: 10.5 }}>{g}</div>
            <ul className="space-y-1">
              {SKILLS.filter((s) => s.group === g).map((s) => {
                const row = rows.get(s.key);
                const status = row?.status ?? 'not_started';
                const isOpen = open === s.key;
                const canType = canEdit || (isSelf && status !== 'verified');
                // the person may move their own row up to "done"; only leads verify
                const statusOptions = canEdit ? SKILL_STATUSES : SKILL_STATUSES.filter((x) => x !== 'verified');
                return (
                  <li key={s.key} className="t-small" style={{ background: 'var(--color-card)', borderRadius: 3, borderLeft: `3px solid ${status === 'verified' ? 'var(--color-ok, #10b981)' : status === 'done' ? 'var(--color-accent)' : status === 'learning' ? '#d4a017' : 'var(--color-border)'}` }}>
                    <div className="flex items-center gap-2 flex-wrap" style={{ padding: '0.3rem 0.5rem' }}>
                      <span className="font-medium">{s.label}</span>
                      {s.hint && <span className="t-muted">· {s.hint}</span>}
                      {s.sop && (
                        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.15)', color: '#7e22ce' }} title="This item asks for a written SOP">
                          SOP {row?.sop_text ? '✓' : ''}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        {row?.done_on && (status === 'done' || status === 'verified') && <span className="t-mono t-muted">{fmtDate(row.done_on)}</span>}
                        {canType ? (
                          <select value={status} onChange={(e) => save(s, { status: e.target.value as SkillStatus })} style={{ ...inputStyle, padding: '1px 4px', fontSize: 11 }}>
                            {statusOptions.map((x) => <option key={x} value={x}>{SKILL_STATUS_LABELS[x]}</option>)}
                          </select>
                        ) : (
                          <span className="t-muted">{SKILL_STATUS_LABELS[status]}</span>
                        )}
                        <button onClick={() => setOpen(isOpen ? null : s.key)} className="t-accent hover:underline">{isOpen ? 'Close' : s.sop ? 'SOP / note' : 'Note'}</button>
                      </span>
                    </div>
                    {isOpen && (
                      <SkillDetail skill={s} row={row} canType={canType} canEdit={canEdit} onSave={(patch) => save(s, patch)} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SkillDetail({ skill, row, canType, canEdit, onSave }: {
  skill: SkillDef;
  row: TrackerSkill | undefined;
  canType: boolean;
  canEdit: boolean;
  onSave: (patch: Partial<Pick<TrackerSkill, 'status' | 'done_on' | 'sop_text' | 'note'>>) => void;
}) {
  const [sop, setSop] = useState(row?.sop_text ?? '');
  const [note, setNote] = useState(row?.note ?? '');
  const [doneOn, setDoneOn] = useState(row?.done_on ?? '');
  const dirty = sop !== (row?.sop_text ?? '') || note !== (row?.note ?? '') || doneOn !== (row?.done_on ?? '');
  return (
    <div className="space-y-2" style={{ padding: '0 0.5rem 0.6rem 0.5rem' }}>
      {skill.sop && (
        <label className="t-small t-muted flex flex-col">
          {skill.hint ?? 'Write down the SOP'} — step by step, in the engineer's own words
          <textarea value={sop} onChange={(e) => setSop(e.target.value)} rows={6} maxLength={8000} disabled={!canType} style={inputStyle} placeholder="1. Lock out …&#10;2. …" />
        </label>
      )}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="t-small t-muted flex flex-col" style={{ flex: '1 1 260px' }}>Note
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={!canType} style={inputStyle} placeholder="where, with whom, what to coach next" />
        </label>
        <label className="t-small t-muted flex flex-col">Done on
          <input type="date" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} disabled={!canEdit && !canType} style={inputStyle} />
        </label>
        {canType && (
          <button
            type="button"
            disabled={!dirty}
            onClick={() => onSave({ sop_text: sop || null, note: note || null, done_on: doneOn || null })}
            className="t-small px-3 py-1 rounded"
            style={{ background: 'var(--color-accent)', color: '#fff', opacity: dirty ? 1 : 0.5 }}
          >Save</button>
        )}
      </div>
      {row?.updated_at && <div className="t-small t-muted">Last updated {new Date(row.updated_at).toLocaleDateString()}</div>}
    </div>
  );
}
