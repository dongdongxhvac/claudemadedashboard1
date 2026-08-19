// New-hire 8-week program tracker — the mentor's sign-off sheet, live.
//
// Opened from Admin › User Profiles (row "Training" button). One drawer per
// person: enroll (start date + mentor), then per-week verified items with
// who/when, the mentor's weekly initials + COVE ≥35 h audit, the PM rep
// tally (2× each) and LOTO evals, the Level-1 certification block, and a
// shelf of every handout (served from /training/new-hire/). Definition
// lives in lib/newHireProgram.ts; progress via hooks/useNewHire.ts (0128).
//
// Read-only for anyone who can't edit this person (DB decides; we mirror
// with useCanEditNewHire so buttons aren't offered that would 0-row).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  NH_PROGRAM_TITLE, NH_WEEKS, NH_WEEKS_DEF, NH_REPS, NH_EVALS, NH_CERT_SIGNERS, NH_CERT_TEXT,
  NH_DOCS, NH_CAT_META, NH_STANDING_DAILY, NH_SEASONAL_NOTE, NH_TOTAL_ITEMS,
  nhDocHref, nhWeekFor, weekKey, coveKey,
  type NhWeek, type NhItem, type NhRep, type NhDocKey,
} from '../lib/newHireProgram';
import {
  useNewHireUser, useCanEditNewHire, useEnrollNewHire, useUpdateEnrollment, useUnenrollNewHire,
  useSetCheckoff, useSetCheckoffNote, useAddRepLog, useDeleteRepLog,
  type NhStatus, type NhCheckoff, type NhRepLog,
} from '../hooks/useNewHire';
import { useMe } from '../hooks/useMe';

export type NhPerson = { user_id: string; full_name: string; role: string; active: boolean; is_lead: boolean; hiring_date?: string | null };

const STATUS_META: Record<NhStatus, { label: string; bg: string; color: string }> = {
  active:    { label: 'In program', bg: 'rgba(59,130,246,0.12)',  color: '#1e40af' },
  completed: { label: 'Certified',  bg: 'rgba(16,185,129,0.15)',  color: '#047857' },
  paused:    { label: 'Paused',     bg: 'rgba(245,158,11,0.15)',  color: '#b45309' },
  withdrawn: { label: 'Withdrawn',  bg: 'rgba(100,116,139,0.15)', color: '#475569' },
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const inputStyle = { borderColor: 'var(--color-border)', background: 'var(--color-card)' } as const;
const btnGhost = { color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' } as const;

function DocLinks({ keys, compact = false }: { keys?: NhDocKey[]; compact?: boolean }) {
  if (!keys?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {keys.map((k) => {
        const d = NH_DOCS.find((x) => x.key === k)!;
        return (
          <a
            key={k}
            href={nhDocHref(k)}
            target="_blank"
            rel="noreferrer"
            className="t-small px-1.5 py-0.5 rounded no-underline hover:underline"
            style={{ background: 'rgba(94,106,210,0.08)', color: 'var(--color-accent)', fontSize: compact ? 10 : 11, border: '1px solid rgba(94,106,210,0.25)' }}
            title={`Open ${d.label} in a new tab`}
          >
            ↗ {compact ? d.label.split(' — ')[0].split(' (')[0] : d.label}
          </a>
        );
      })}
    </span>
  );
}

function CatDot({ cat }: { cat: NhItem['cat'] }) {
  const m = NH_CAT_META[cat];
  return <span title={m.label} className="inline-block rounded-full" style={{ width: 8, height: 8, background: m.color, flex: '0 0 auto' }} />;
}

function Dots({ n, target }: { n: number; target: number }) {
  return (
    <span className="inline-flex gap-1 items-center">
      {Array.from({ length: Math.max(target, n) }).map((_, i) => (
        <span key={i} className="inline-block rounded-full" style={{
          width: 10, height: 10,
          background: i < n ? (i < target ? 'var(--color-ok)' : 'var(--color-accent)') : 'transparent',
          border: `1.5px solid ${i < n ? 'transparent' : 'var(--color-border)'}`,
        }} />
      ))}
    </span>
  );
}

export function NewHireProgramDrawer({
  person,
  people,
  onClose,
}: {
  person: NhPerson;
  /** Everyone on the roster (names for verified_by / mentor picker). */
  people: NhPerson[];
  onClose: () => void;
}) {
  const me = useMe().data;
  const { state, isLoading, isError, error } = useNewHireUser(person.user_id);
  const canEdit = useCanEditNewHire(state.enrollment?.mentor_user_id);
  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.user_id, p.full_name]));
    return (id: string | null | undefined) => (id ? (id === me?.id ? `${m.get(id) ?? 'you'} (you)` : (m.get(id) ?? '—')) : '—');
  }, [people, me?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const enr = state.enrollment;
  const curWeek = nhWeekFor(enr?.start_date);
  // Which week cards are expanded. Starts at the week in progress (or wk 1
  // before start / wk 8 after); chips expand + scroll.
  const [openWeeks, setOpenWeeks] = useState<Set<number> | null>(null);
  const defaultWeek = curWeek === 0 ? 1 : curWeek > NH_WEEKS ? NH_WEEKS : curWeek;
  const isOpen = (n: number) => (openWeeks ?? new Set([defaultWeek])).has(n);
  const toggleWeek = (n: number, force?: boolean) => setOpenWeeks((prev) => {
    const next = new Set(prev ?? [defaultWeek]);
    const want = force ?? !next.has(n);
    if (want) next.add(n); else next.delete(n);
    return next;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full h-full overflow-y-auto p-5"
        style={{ background: 'var(--color-bg)', maxWidth: 860 }}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="t-small t-muted uppercase tracking-wider">New-hire program</div>
            <h3 className="t-section-title" style={{ marginBottom: 2 }}>{person.full_name}</h3>
            <div className="t-small t-muted">{NH_PROGRAM_TITLE}</div>
          </div>
          <div className="flex items-center gap-2">
            <a href={nhDocHref('plan')} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="Printable schedule + sign-off sheet">
              Schedule / sign-off sheet ↗
            </a>
            <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
          </div>
        </div>

        {isLoading && <p className="t-text t-muted">Loading…</p>}
        {isError && <p className="t-text t-danger">Error: {(error as Error).message}</p>}

        {!isLoading && !enr && (
          <EnrollCard person={person} people={people} canEdit={canEdit} />
        )}

        {enr && (
          <>
            <SummaryCard
              person={person} people={people} canEdit={canEdit} nameOf={nameOf}
              enrollment={enr} progress={state.progress} curWeek={curWeek}
            />

            {/* week chips */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {NH_WEEKS_DEF.map((w) => {
                const done = w.items.filter((i) => state.checked.has(i.key)).length;
                const signed = state.checked.has(weekKey(w.n));
                const isCur = w.n === curWeek;
                return (
                  <button
                    key={w.n}
                    type="button"
                    onClick={() => {
                      toggleWeek(w.n, true);
                      requestAnimationFrame(() => document.getElementById(`nh-week-${w.n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }}
                    className="t-small px-2 py-0.5 rounded-full border"
                    style={{
                      background: signed ? w.accent : 'var(--color-card)',
                      color: signed ? '#fff' : w.accent,
                      borderColor: w.accent,
                      fontWeight: isCur ? 700 : 500,
                      boxShadow: isCur ? `0 0 0 2px ${w.accent}55` : undefined,
                      fontSize: 11,
                    }}
                    title={`${w.title} — ${done}/${w.items.length} items${signed ? ' · initialed' : ''}${isCur ? ' · this week' : ''}`}
                  >
                    WK {w.n} · {w.short} {signed ? '✓' : `${done}/${w.items.length}`}
                  </button>
                );
              })}
            </div>

            {NH_WEEKS_DEF.map((w) => (
              <WeekCard
                key={w.n}
                week={w}
                userId={person.user_id}
                checked={state.checked}
                checkoffs={state.checkoffs}
                canEdit={canEdit}
                nameOf={nameOf}
                open={isOpen(w.n)}
                onToggleOpen={() => toggleWeek(w.n)}
              />
            ))}

            <RepsCard userId={person.user_id} title="PM rep tally — target 2× each" reps={NH_REPS} repCounts={state.repCounts} logs={state.repLogs} canEdit={canEdit} nameOf={nameOf} />
            <RepsCard userId={person.user_id} title="LOTO / PPE / Meter lab evals" reps={NH_EVALS} repCounts={state.repCounts} logs={state.repLogs} canEdit={canEdit} nameOf={nameOf} />

            <CertCard userId={person.user_id} enrollmentStatus={enr.status} checked={state.checked} checkoffs={state.checkoffs} canEdit={canEdit} nameOf={nameOf} progress={state.progress} />

            <StandingCard />
            <DocsShelf />

            {canEdit && <DangerCard userId={person.user_id} name={person.full_name} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── enroll ────────────────────────────────────────────────────────────────

function mentorCandidates(people: NhPerson[], selfId: string) {
  return people
    .filter((p) => p.active && p.user_id !== selfId && (p.role === 'engineer' || p.role === 'manager'))
    .sort((a, b) => (Number(b.is_lead) - Number(a.is_lead)) || a.full_name.localeCompare(b.full_name));
}

function EnrollCard({ person, people, canEdit }: { person: NhPerson; people: NhPerson[]; canEdit: boolean }) {
  const enroll = useEnrollNewHire();
  const [start, setStart] = useState<string>(person.hiring_date ?? todayIso());
  const [mentor, setMentor] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const cands = useMemo(() => mentorCandidates(people, person.user_id), [people, person.user_id]);

  return (
    <div className="t-card mb-3">
      <div className="t-small t-muted uppercase tracking-wider mb-1">Not enrolled</div>
      <p className="t-text t-muted mb-3">
        {person.full_name} isn't in the 8-week program yet. Enrolling opens the live sign-off sheet: 8 weeks × verified items, PM rep tally, LOTO evals, COVE audits and the Level-1 certification block.
      </p>
      {canEdit ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await enroll.mutateAsync({ user_id: person.user_id, start_date: start || null, mentor_user_id: mentor || null });
            } catch (ex) { setErr((ex as Error).message); }
          }}
        >
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Start date (Monday of week 1)</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border rounded px-2 py-1 t-text t-mono" style={inputStyle} />
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Mentor</span>
            <select value={mentor} onChange={(e) => setMentor(e.target.value)} className="border rounded px-2 py-1 t-text" style={inputStyle}>
              <option value="">— pick later —</option>
              {cands.map((p) => <option key={p.user_id} value={p.user_id}>{p.is_lead ? '★ ' : ''}{p.full_name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={enroll.isPending} className="t-small px-3 py-1.5 rounded font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}>
            {enroll.isPending ? 'Enrolling…' : 'Enroll in 8-week program'}
          </button>
          {err && <span className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</span>}
        </form>
      ) : (
        <p className="t-small t-muted italic">Only admins, managers and leads can enroll.</p>
      )}
    </div>
  );
}

// ── summary ───────────────────────────────────────────────────────────────

function SummaryCard({
  person, people, canEdit, nameOf, enrollment, progress, curWeek,
}: {
  person: NhPerson; people: NhPerson[]; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
  enrollment: NonNullable<ReturnType<typeof useNewHireUser>['state']['enrollment']>;
  progress: ReturnType<typeof useNewHireUser>['state']['progress'];
  curWeek: number;
}) {
  const upd = useUpdateEnrollment();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(enrollment.start_date ?? '');
  const [mentor, setMentor] = useState(enrollment.mentor_user_id ?? '');
  const [status, setStatus] = useState<NhStatus>(enrollment.status);
  const [notes, setNotes] = useState(enrollment.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const cands = useMemo(() => mentorCandidates(people, person.user_id), [people, person.user_id]);
  const sm = STATUS_META[enrollment.status];

  const weekLabel = curWeek === 0 ? 'starts ' + fmtDate(enrollment.start_date)
    : curWeek > NH_WEEKS ? 'past week 8'
    : `Week ${curWeek} of ${NH_WEEKS}`;

  return (
    <div className="t-card mb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 items-baseline">
          <span className="t-small px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.color, fontWeight: 600, fontSize: 11 }}>{sm.label}</span>
          <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1">Start</span><b>{enrollment.start_date ? fmtDate(enrollment.start_date) : '— not set —'}</b> <span className="t-small t-muted">· {weekLabel}</span></span>
          <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1">Mentor</span><b>{enrollment.mentor_user_id ? nameOf(enrollment.mentor_user_id) : '— not set —'}</b></span>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="t-small px-2 py-0.5 rounded border" style={btnGhost}>Edit enrollment</button>
        )}
      </div>

      {editing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3"
          style={{ borderColor: 'var(--color-border)' }}
          onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            try {
              await upd.mutateAsync({ user_id: person.user_id, patch: { start_date: start || null, mentor_user_id: mentor || null, status, notes: notes.trim() || null } });
              setEditing(false);
            } catch (ex) { setErr((ex as Error).message); }
          }}
        >
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Start date</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border rounded px-2 py-1 t-text t-mono" style={inputStyle} />
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Mentor</span>
            <select value={mentor} onChange={(e) => setMentor(e.target.value)} className="border rounded px-2 py-1 t-text" style={inputStyle}>
              <option value="">— none —</option>
              {cands.map((p) => <option key={p.user_id} value={p.user_id}>{p.is_lead ? '★ ' : ''}{p.full_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as NhStatus)} className="border rounded px-2 py-1 t-text" style={inputStyle}>
              {(Object.keys(STATUS_META) as NhStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </label>
          <label className="block flex-1" style={{ minWidth: 220 }}>
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Notes</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="seasonal swap, schedule exceptions…" className="w-full border rounded px-2 py-1 t-text" style={inputStyle} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={upd.isPending} className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}>Save</button>
            <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
          </div>
          {err && <span className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</span>}
        </form>
      )}
      {!editing && enrollment.notes && <p className="t-small t-muted mt-2">{enrollment.notes}</p>}

      {/* progress */}
      <div className="mt-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-full overflow-hidden" style={{ height: 8, background: 'var(--color-border)' }}>
            <div style={{ width: `${progress.pct}%`, height: '100%', background: progress.pct >= 100 ? 'var(--color-ok)' : 'var(--color-accent)', transition: 'width .3s' }} />
          </div>
          <span className="t-small t-mono" style={{ minWidth: 36, textAlign: 'right' }}>{progress.pct}%</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 t-small t-muted">
          <span>Items <b className="t-mono">{progress.itemsDone}/{NH_TOTAL_ITEMS}</b></span>
          <span>Reps at target <b className="t-mono">{progress.repsDone}/{progress.repsTotal}</b></span>
          <span>Weeks initialed <b className="t-mono">{progress.weeksSigned}/{NH_WEEKS}</b></span>
          <span>COVE audits <b className="t-mono">{progress.coveSigned}/{NH_WEEKS}</b></span>
          <span>Certification <b className="t-mono">{progress.certSigned}/3</b></span>
        </div>
      </div>
    </div>
  );
}

// ── week ──────────────────────────────────────────────────────────────────

function WeekCard({
  week, userId, checked, checkoffs, canEdit, nameOf, open, onToggleOpen,
}: {
  week: NhWeek; userId: string; checked: Set<string>; checkoffs: Map<string, NhCheckoff>;
  canEdit: boolean; nameOf: (id: string | null | undefined) => string; open: boolean; onToggleOpen: () => void;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const set = useSetCheckoff();
  const [err, setErr] = useState<string | null>(null);
  const done = week.items.filter((i) => checked.has(i.key)).length;
  const allDone = done === week.items.length;
  const wk = weekKey(week.n), ck = coveKey(week.n);
  const wkRow = checkoffs.get(wk), ckRow = checkoffs.get(ck);

  const toggle = async (item_key: string, on: boolean) => {
    setErr(null);
    try { await set.mutateAsync({ user_id: userId, item_key, on }); }
    catch (ex) { setErr((ex as Error).message); }
  };

  return (
    <div id={`nh-week-${week.n}`} className="t-card mb-2" style={{ borderLeft: `4px solid ${week.accent}`, scrollMarginTop: 12 }}>
      <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={onToggleOpen}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="t-mono t-small font-bold" style={{ color: week.accent }}>WK {week.n}</span>
          <span className="t-text font-medium">{week.title}</span>
          <span className="t-small t-muted">{done}/{week.items.length} verified{allDone ? ' ✓' : ''}</span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <SignToggle
            label="COVE ≥35 h"
            on={!!ckRow}
            row={ckRow}
            nameOf={nameOf}
            canEdit={canEdit}
            onToggle={(on) => toggle(ck, on)}
            title="Mentor's Friday audit: 7 h documented every day, ≥35 h this week"
          />
          <SignToggle
            label="Initials"
            on={!!wkRow}
            row={wkRow}
            nameOf={nameOf}
            canEdit={canEdit}
            onToggle={(on) => toggle(wk, on)}
            title="Mentor initials the week only when every listed item is verified"
            strong
            accent={week.accent}
          />
          <span className="t-small t-muted" style={{ width: 14, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
        </div>
      </div>

      {open && (
        <div className="mt-2">
          <ul className="space-y-1.5">
            {week.items.map((it) => (
              <ItemRow key={it.key} item={it} userId={userId} row={checkoffs.get(it.key)} canEdit={canEdit} nameOf={nameOf} onToggle={(on) => toggle(it.key, on)} />
            ))}
          </ul>
          {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}

          <button type="button" onClick={() => setPlanOpen((p) => !p)} className="t-small mt-3 hover:underline" style={{ color: 'var(--color-accent)' }}>
            {planOpen ? '▾' : '▸'} This week's plan &amp; handouts
          </button>
          {planOpen && (
            <div className="mt-1.5 space-y-1.5">
              {week.plan.map((b) => (
                <div key={b.title} className="t-small" style={{ paddingLeft: 8, borderLeft: '2px solid var(--color-border)' }}>
                  <span className="font-semibold">{b.title}.</span> <span className="t-muted">{b.text}</span>{' '}
                  <DocLinks keys={b.docs} compact />
                </div>
              ))}
              <div className="t-small t-muted italic" style={{ paddingLeft: 8 }}>Friday: {week.friday}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignToggle({
  label, on, row, nameOf, canEdit, onToggle, title, strong = false, accent,
}: {
  label: string; on: boolean; row?: NhCheckoff; nameOf: (id: string | null | undefined) => string;
  canEdit: boolean; onToggle: (on: boolean) => void; title?: string; strong?: boolean; accent?: string;
}) {
  const color = accent ?? 'var(--color-ok)';
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => onToggle(!on)}
      className="t-small px-2 py-0.5 rounded border whitespace-nowrap disabled:cursor-default"
      style={{
        background: on ? color : 'var(--color-card)',
        color: on ? '#fff' : 'var(--color-text-muted)',
        borderColor: on ? color : 'var(--color-border)',
        fontWeight: strong ? 600 : 500,
        fontSize: 11,
      }}
      title={(title ? title + '\n' : '') + (row ? `${nameOf(row.verified_by)} · ${fmtDate(row.done_at)}` : canEdit ? 'Click to sign' : '')}
    >
      {on ? '✓ ' : ''}{label}{row ? <span style={{ opacity: 0.85 }}> · {fmtDate(row.done_at)}</span> : null}
    </button>
  );
}

function ItemRow({
  item, userId, row, canEdit, nameOf, onToggle,
}: {
  item: NhItem; userId: string; row?: NhCheckoff; canEdit: boolean; nameOf: (id: string | null | undefined) => string; onToggle: (on: boolean) => void;
}) {
  const setNote = useSetCheckoffNote();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote_] = useState('');
  const openNote = () => { setNote_(row?.note ?? ''); setNoteOpen(true); };
  const on = !!row;

  return (
    <li className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={on}
        disabled={!canEdit}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1"
        style={{ width: 15, height: 15, accentColor: 'var(--color-ok)', flex: '0 0 auto' }}
        title={canEdit ? (on ? 'Un-verify' : 'Mark verified') : undefined}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5 flex-wrap">
          <span className="mt-1.5"><CatDot cat={item.cat} /></span>
          <span className="t-text" style={{ textDecoration: on ? 'line-through' : 'none', opacity: on ? 0.7 : 1 }}>
            {item.label}
            {item.gate && <span className="ml-1.5 px-1.5 py-0.5 rounded t-small" style={{ background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>GATE</span>}
          </span>
          <DocLinks keys={item.docs} compact />
        </div>
        {(on || noteOpen) && (
          <div className="t-small t-muted mt-0.5 flex items-center gap-2 flex-wrap">
            {on && <span>✓ {nameOf(row!.verified_by)} · {fmtDate(row!.done_at)}</span>}
            {on && !noteOpen && (row!.note
              ? <span>— {row!.note} {canEdit && <button type="button" className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={openNote}>edit</button>}</span>
              : canEdit && <button type="button" className="hover:underline" style={{ color: 'var(--color-accent)' }} onClick={openNote}>+ note</button>)}
            {on && noteOpen && (
              <form className="flex items-center gap-1 flex-1" onSubmit={async (e) => { e.preventDefault(); await setNote.mutateAsync({ user_id: userId, item_key: item.key, note: note.trim() || null }); setNoteOpen(false); }}>
                <input autoFocus type="text" value={note} onChange={(e) => setNote_(e.target.value)} placeholder="building, proof, what was weak…" className="border rounded px-2 py-0.5 t-small flex-1" style={inputStyle} />
                <button type="submit" className="t-small px-2 py-0.5 rounded text-white" style={{ background: 'var(--color-accent)' }}>Save</button>
                <button type="button" onClick={() => setNoteOpen(false)} className="t-small px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)' }}>✕</button>
              </form>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ── reps ──────────────────────────────────────────────────────────────────

function RepsCard({
  userId, title, reps, repCounts, logs, canEdit, nameOf,
}: {
  userId: string; title: string; reps: NhRep[]; repCounts: Map<string, number>; logs: NhRepLog[];
  canEdit: boolean; nameOf: (id: string | null | undefined) => string;
}) {
  const add = useAddRepLog();
  const del = useDeleteRepLog();
  const [openKey, setOpenKey] = useState<string | null>(null);   // rep whose log list is expanded
  const [adding, setAdding] = useState<string | null>(null);     // rep with the add form open
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const atTarget = reps.filter((r) => (repCounts.get(r.key) ?? 0) >= r.target).length;

  return (
    <div className="t-card mb-2">
      <div className="flex items-baseline justify-between mb-2">
        <span className="t-text font-medium">{title}</span>
        <span className="t-small t-muted">{atTarget}/{reps.length} at target</span>
      </div>
      <table className="w-full t-text border-collapse">
        <tbody>
          {reps.map((r) => {
            const n = repCounts.get(r.key) ?? 0;
            const mine = logs.filter((l) => l.rep_key === r.key);
            const isOpen = openKey === r.key;
            return (
              <FragmentRows key={r.key}>
                <tr className="border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
                  <td className="py-1.5 pr-2">
                    <span style={{ opacity: n >= r.target ? 0.75 : 1 }}>{r.label}</span>
                    {r.mep && <span className="ml-1.5 px-1 py-0.5 rounded t-small" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309', fontSize: 9, fontWeight: 700 }}>MEP</span>}
                    <span className="t-small t-muted ml-2">{r.weekHint}</span>
                  </td>
                  <td className="py-1.5 px-2 whitespace-nowrap"><Dots n={n} target={r.target} /> <span className="t-small t-mono t-muted ml-1">{n}/{r.target}</span></td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {mine.length > 0 && (
                      <button type="button" onClick={() => setOpenKey(isOpen ? null : r.key)} className="t-small mr-2 hover:underline" style={{ color: 'var(--color-accent)' }}>
                        {isOpen ? 'hide' : `${mine.length} logged`}
                      </button>
                    )}
                    {canEdit && (
                      <button type="button" onClick={() => { setAdding(adding === r.key ? null : r.key); setDate(todayIso()); setNote(''); setErr(null); }} className="t-small px-2 py-0.5 rounded border" style={btnGhost}>
                        + log rep
                      </button>
                    )}
                  </td>
                </tr>
                {adding === r.key && (
                  <tr><td colSpan={3} className="py-1.5">
                    <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
                      e.preventDefault(); setErr(null);
                      try { await add.mutateAsync({ user_id: userId, rep_key: r.key, occurred_on: date, note: note.trim() || null }); setAdding(null); setOpenKey(r.key); }
                      catch (ex) { setErr((ex as Error).message); }
                    }}>
                      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-2 py-0.5 t-small t-mono" style={inputStyle} />
                      <input autoFocus type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="building · with whom · job / WO" className="border rounded px-2 py-0.5 t-small flex-1" style={{ ...inputStyle, minWidth: 200 }} />
                      <button type="submit" disabled={add.isPending} className="t-small px-2 py-0.5 rounded text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}>Log</button>
                      <button type="button" onClick={() => setAdding(null)} className="t-small px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)' }}>✕</button>
                      {err && <span className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</span>}
                    </form>
                  </td></tr>
                )}
                {isOpen && mine.map((l) => (
                  <tr key={l.id}><td colSpan={3} className="py-0.5 pl-4 t-small t-muted">
                    <span className="t-mono">{fmtDate(l.occurred_on)}</span>
                    {l.note && <span> — {l.note}</span>}
                    <span> · {nameOf(l.logged_by)}</span>
                    {canEdit && <button type="button" onClick={() => del.mutate(l.id)} className="ml-2 hover:underline" style={{ color: 'var(--color-danger)' }} title="Remove this rep">remove</button>}
                  </td></tr>
                ))}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
// React fragments can't carry keys inside <tbody> via the short syntax; tiny helper.
function FragmentRows({ children }: { children: ReactNode }) { return <>{children}</>; }

// ── certification ─────────────────────────────────────────────────────────

function CertCard({
  userId, enrollmentStatus, checked, checkoffs, canEdit, nameOf, progress,
}: {
  userId: string; enrollmentStatus: NhStatus; checked: Set<string>; checkoffs: Map<string, NhCheckoff>;
  canEdit: boolean; nameOf: (id: string | null | undefined) => string;
  progress: ReturnType<typeof useNewHireUser>['state']['progress'];
}) {
  const set = useSetCheckoff();
  const upd = useUpdateEnrollment();
  const [err, setErr] = useState<string | null>(null);
  const allSigned = NH_CERT_SIGNERS.every((s) => checked.has(s.key));
  const ready = progress.itemsDone === NH_TOTAL_ITEMS && progress.repsDone === progress.repsTotal && progress.weeksSigned === NH_WEEKS;

  const sign = async (key: string, on: boolean) => {
    setErr(null);
    try {
      await set.mutateAsync({ user_id: userId, item_key: key, on });
      // All three signed → mark the enrollment completed (and back to active if a signature is pulled).
      const nowSigned = NH_CERT_SIGNERS.every((s) => (s.key === key ? on : checked.has(s.key)));
      if (nowSigned && enrollmentStatus !== 'completed') await upd.mutateAsync({ user_id: userId, patch: { status: 'completed' } });
      if (!nowSigned && enrollmentStatus === 'completed') await upd.mutateAsync({ user_id: userId, patch: { status: 'active' } });
    } catch (ex) { setErr((ex as Error).message); }
  };

  return (
    <div className="t-card mb-2" style={{ borderLeft: `4px solid ${allSigned ? 'var(--color-ok)' : 'var(--color-border)'}` }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="t-text font-medium">Level-1 Certification</span>
        <span className="t-small" style={{ color: allSigned ? 'var(--color-ok)' : ready ? '#b45309' : 'var(--color-text-muted)' }}>
          {allSigned ? '✓ Certified' : ready ? 'Ready to sign' : `Not yet — ${NH_TOTAL_ITEMS - progress.itemsDone} items, ${progress.repsTotal - progress.repsDone} reps, ${NH_WEEKS - progress.weeksSigned} weeks outstanding`}
        </span>
      </div>
      <p className="t-small t-muted mb-2">{NH_CERT_TEXT}</p>
      <div className="flex flex-wrap gap-2">
        {NH_CERT_SIGNERS.map((s) => {
          const row = checkoffs.get(s.key);
          return (
            <SignToggle key={s.key} label={`${s.label} signature`} on={!!row} row={row} nameOf={nameOf} canEdit={canEdit} onToggle={(on) => sign(s.key, on)} strong title="Recorded from the signed paper sheet" />
          );
        })}
      </div>
      {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
      <p className="t-small t-muted mt-2">File with this record: tag sheets (chiller · tower · AHU · boiler · portfolio 117), building check (all three parts), site map, and the phase-tracker print handout.</p>
    </div>
  );
}

// ── standing dailies / docs / danger ──────────────────────────────────────

function StandingCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="t-card mb-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="t-text font-medium hover:underline">{open ? '▾' : '▸'} Standing daily — every week</button>
      {open && (
        <>
          <ul className="mt-1.5 space-y-1 t-small t-muted" style={{ paddingLeft: 16, listStyle: 'disc' }}>
            {NH_STANDING_DAILY.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          <p className="t-small t-muted mt-2 italic">{NH_SEASONAL_NOTE}</p>
        </>
      )}
    </div>
  );
}

function DocsShelf() {
  const groups: { g: (typeof NH_DOCS)[number]['group']; label: string }[] = [
    { g: 'program', label: 'Program' }, { g: 'overview', label: 'Discipline overviews' }, { g: 'equipment', label: 'Equipment deep-dives' },
    { g: 'field', label: 'Field exercises' }, { g: 'reference', label: 'Reference' }, { g: 'mentor', label: 'Mentor only' },
  ];
  return (
    <div className="t-card mb-2">
      <div className="t-text font-medium mb-1.5">Handouts</div>
      <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {groups.map(({ g, label }) => (
          <div key={g}>
            <div className="t-small t-muted uppercase tracking-wider mb-0.5">{label}</div>
            <ul className="space-y-0.5">
              {NH_DOCS.filter((d) => d.group === g).map((d) => (
                <li key={d.key}><a href={nhDocHref(d.key)} target="_blank" rel="noreferrer" className="t-small hover:underline" style={{ color: 'var(--color-accent)' }}>↗ {d.label}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function DangerCard({ userId, name }: { userId: string; name: string }) {
  const un = useUnenrollNewHire();
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="t-card mb-2">
      {!armed ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="t-small t-muted uppercase tracking-wider block">Remove from program</span>
            <p className="t-small t-muted mt-0.5">Deletes the enrollment and every check-off and rep log for {name}. To pause instead, set Status → Paused.</p>
          </div>
          <button type="button" onClick={() => setArmed(true)} className="t-small px-3 py-1 rounded border font-medium" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', background: 'transparent' }}>Remove…</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="t-small" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>This cannot be undone. Remove {name}'s enrollment and all progress?</span>
          <div className="flex gap-2">
            <button type="button" disabled={un.isPending} onClick={async () => { setErr(null); try { await un.mutateAsync(userId); } catch (ex) { setErr((ex as Error).message); } }} className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-danger)' }}>Remove</button>
            <button type="button" onClick={() => setArmed(false)} className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}
