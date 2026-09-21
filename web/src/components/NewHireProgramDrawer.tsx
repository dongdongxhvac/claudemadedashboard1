// New-hire 8-week program — the mentor's SIGN-OFF SHEET, live.
//
// Per user 2026-09-21: "admin go by sign off spa format, admin assign
// trainings". So this drawer mirrors the printed sign-off sheet (handout
// 'plan', second tab) block for block: the header strip (new hire · mentor
// · manager · start date), the Week × Verified items table with Initials
// and Date, the PM rep tally (two boxes per rep, LOTO evals included), the
// COVE hours audit grid, and the Level-1 certification block. Below it, as
// secondary cards: the per-handout Reviewed / Quiz-passed ticks, the
// engineer's activity trail, and removal.
//
// Assigning: a person with no enrollment gets the "Assign training" card
// (program · start date · mentor). Today the only program is the 8-week
// Plan B; later programs (Licensed HVAC development, the 5 category tracks)
// are listed as coming — enrollments carry program_key, so they slot in.
//
// Opened from Admin › User Profiles (row "Training" button). Read-only for
// anyone who can't edit this person (DB decides; useCanEditNewHire mirrors
// it so buttons aren't offered that would 0-row). The engineer sees the
// same record read-only on their schedule page (/upark/training/new-hire).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  NH_PROGRAM_KEY, NH_PROGRAM_TITLE, NH_SIGNOFF_TITLE, NH_SIGNOFF_INTRO, NH_WEEKS, NH_WEEKS_DEF, NH_REPS, NH_EVALS, NH_CERT_SIGNERS, NH_CERT_TEXT,
  NH_CAT_META, NH_TOTAL_ITEMS,
  nhWeekFor, weekKey, coveKey, docKeyFor, nhQuizDocForItem,
  type NhWeek, type NhItem, type NhRep, type NhDocKey,
} from '../lib/newHireProgram';
import {
  useNewHireUser, useCanEditNewHire, useEnrollNewHire, useUpdateEnrollment, useUnenrollNewHire,
  useSetCheckoff, useSetCheckoffNote, useAddRepLog, useDeleteRepLog, useDeleteDocActivity,
  type NhStatus, type NhCheckoff, type NhRepLog, type NhDocActivity, type NhUserState,
} from '../hooks/useNewHire';
import { useTrainingManifest, type NhDoc } from '../hooks/useTrainingManifest';
import { useMe } from '../hooks/useMe';

export type NhPerson = { user_id: string; full_name: string; role: string; active: boolean; is_lead: boolean; hiring_date?: string | null };

/** Programs an admin can assign. Only Plan B exists today; the rest are
 *  placeholders so the picker already shows where they will go. */
const PROGRAMS: { key: string; label: string; available: boolean }[] = [
  { key: NH_PROGRAM_KEY, label: NH_PROGRAM_TITLE, available: true },
  { key: 'upark_hvac_license_dev', label: 'Licensed HVAC development — coming', available: false },
  { key: 'upark_categories_5', label: '5 category training (refrigeration · electrical · building knowledge · …) — coming', available: false },
];

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
const initialsOf = (name: string) => name.replace(/\s*\(you\)$/, '').split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '—';

const inputStyle = { borderColor: 'var(--color-border)', background: 'var(--color-card)' } as const;
const btnGhost = { color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' } as const;
const mono = { fontFamily: 'var(--font-mono)' } as const;
const SHEET_INK = '#1a1f2b';

function DocLinks({ keys, compact = false }: { keys?: NhDocKey[]; compact?: boolean }) {
  const { byKey, href } = useTrainingManifest();
  if (!keys?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {keys.map((k) => {
        const d = byKey.get(k);
        if (!d) return null; // not in the manifest (yet) — link silently absent
        return (
          <a
            key={k}
            href={href(d)}
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

function QuizScoreChip({ row, compact = false }: { row?: NhDocActivity; compact?: boolean }) {
  if (!row || row.score == null || row.total == null) return null;
  const pct = row.total ? row.score / row.total : 0;
  const ok = pct >= 0.8;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded t-mono"
      style={{ fontSize: compact ? 10 : 11, background: ok ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)', color: ok ? '#047857' : '#b45309', whiteSpace: 'nowrap' }}
      title={`Engineer's best quiz run${row.quiz_title ? ` — ${row.quiz_title}` : ''} · ${fmtDate(row.at)}`}
    >
      quiz {row.score}/{row.total} · {fmtDate(row.at)}
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

  const manifest = useTrainingManifest();
  const enr = state.enrollment;
  const curWeek = nhWeekFor(enr?.start_date);
  const hasQuiz = (k: string) => manifest.byKey.get(k)?.quiz === true;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--color-bg)', maxWidth: 960 }}>
        {/* sheet header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <span className="inline-block px-2 py-0.5 rounded" style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', background: SHEET_INK, color: '#fff' }}>UPark · Training · Level 1 · Plan B · Mentor record</span>
            <h3 className="t-section-title mt-1" style={{ marginBottom: 2 }}>{NH_SIGNOFF_TITLE}</h3>
            <div className="t-small t-muted">{NH_SIGNOFF_INTRO}</div>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {manifest.hrefFor('plan') && (
              <a href={manifest.hrefFor('plan')!} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="Printable schedule + sign-off sheet">Print sheet ↗</a>
            )}
            <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
          </div>
        </div>

        {isLoading && <p className="t-text t-muted">Loading…</p>}
        {isError && <p className="t-text t-danger">Error: {(error as Error).message}</p>}

        {!isLoading && !enr && <AssignCard person={person} people={people} canEdit={canEdit} />}

        {enr && (
          <>
            <SheetHeader person={person} people={people} canEdit={canEdit} nameOf={nameOf} enrollment={enr} state={state} curWeek={curWeek} docs={manifest.docs} />
            <SheetWeeks userId={person.user_id} state={state} canEdit={canEdit} nameOf={nameOf} curWeek={curWeek} hasQuiz={hasQuiz} />
            <TallyCard userId={person.user_id} repCounts={state.repCounts} logs={state.repLogs} canEdit={canEdit} nameOf={nameOf} />
            <CoveAuditCard userId={person.user_id} checkoffs={state.checkoffs} canEdit={canEdit} nameOf={nameOf} />
            <CertCard userId={person.user_id} enrollmentStatus={enr.status} checked={state.checked} checkoffs={state.checkoffs} canEdit={canEdit} nameOf={nameOf} progress={state.progress} />

            <Secondary title="Handouts — reviewed & quiz sign-off (per handout)" hint="not on the paper sheet; the engineer sees these on their schedule page">
              <HandoutsCard userId={person.user_id} state={state} canEdit={canEdit} nameOf={nameOf} />
            </Secondary>
            <ActivityCard state={state} canEdit={canEdit} />
            {canEdit && <DangerCard userId={person.user_id} name={person.full_name} />}
          </>
        )}
      </div>
    </div>
  );
}

function Secondary({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="t-small hover:underline" style={{ color: 'var(--color-accent)' }}>{open ? '▾' : '▸'} {title}{hint && <span className="t-muted"> · {hint}</span>}</button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

// ── assign ────────────────────────────────────────────────────────────────

function mentorCandidates(people: NhPerson[], selfId: string) {
  return people
    .filter((p) => p.active && p.user_id !== selfId && (p.role === 'engineer' || p.role === 'manager'))
    .sort((a, b) => (Number(b.is_lead) - Number(a.is_lead)) || a.full_name.localeCompare(b.full_name));
}

function AssignCard({ person, people, canEdit }: { person: NhPerson; people: NhPerson[]; canEdit: boolean }) {
  const enroll = useEnrollNewHire();
  const [program, setProgram] = useState<string>(NH_PROGRAM_KEY);
  const [start, setStart] = useState<string>(person.hiring_date ?? todayIso());
  const [mentor, setMentor] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const cands = useMemo(() => mentorCandidates(people, person.user_id), [people, person.user_id]);
  const chosen = PROGRAMS.find((p) => p.key === program);

  return (
    <div className="t-card mb-3">
      <div className="t-small t-muted uppercase tracking-wider mb-1" style={mono}>Assign training</div>
      <p className="t-text t-muted mb-3">{person.full_name} has no training assigned. Assigning opens this sign-off sheet for them and puts the live schedule on their training page.</p>
      {canEdit ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            if (!chosen?.available) { setErr('That program is not built yet — only the 8-week Plan B can be assigned today.'); return; }
            try { await enroll.mutateAsync({ user_id: person.user_id, start_date: start || null, mentor_user_id: mentor || null }); }
            catch (ex) { setErr((ex as Error).message); }
          }}
        >
          <label className="block" style={{ minWidth: 280 }}>
            <span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Program</span>
            <select value={program} onChange={(e) => setProgram(e.target.value)} className="border rounded px-2 py-1 t-text w-full" style={inputStyle}>
              {PROGRAMS.map((p) => <option key={p.key} value={p.key} disabled={!p.available}>{p.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Start date (Monday of week 1)</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border rounded px-2 py-1 t-text t-mono" style={inputStyle} />
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Mentor</span>
            <select value={mentor} onChange={(e) => setMentor(e.target.value)} className="border rounded px-2 py-1 t-text" style={inputStyle}>
              <option value="">— pick later —</option>
              {cands.map((p) => <option key={p.user_id} value={p.user_id}>{p.is_lead ? '★ ' : ''}{p.full_name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={enroll.isPending} className="t-small px-3 py-1.5 rounded font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}>
            {enroll.isPending ? 'Assigning…' : 'Assign training'}
          </button>
          {err && <span className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</span>}
        </form>
      ) : (
        <p className="t-small t-muted italic">Only admins, managers and leads can assign training.</p>
      )}
    </div>
  );
}

// ── sheet header strip: new hire · mentor · manager · start date ─────────

function SheetHeader({ person, people, canEdit, nameOf, enrollment, state, curWeek, docs }: {
  person: NhPerson; people: NhPerson[]; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
  enrollment: NonNullable<NhUserState['enrollment']>; state: NhUserState; curWeek: number; docs: NhDoc[];
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
  const p = state.progress;
  const managerRow = state.checkoffs.get('cert.manager');
  const weekLabel = curWeek === 0 ? 'starts ' + fmtDate(enrollment.start_date) : curWeek > NH_WEEKS ? 'past week 8' : `Week ${curWeek} of ${NH_WEEKS}`;
  const signable = docs.filter((d) => d.signoff !== false);
  const quizzable = signable.filter((d) => d.quiz);
  const docsReviewed = signable.filter((d) => state.docTicks.get(d.key)?.reviewed).length;
  const quizzesSigned = quizzable.filter((d) => state.docTicks.get(d.key)?.quiz).length;


  return (
    <div className="t-card mb-3">
      <div className="flex flex-wrap gap-4 items-end">
        <Field label="New hire" value={<b>{person.full_name}</b>} />
        <Field label="Mentor" value={enrollment.mentor_user_id ? nameOf(enrollment.mentor_user_id) : <span className="t-muted">— not set —</span>} />
        <Field label="Manager" value={managerRow ? nameOf(managerRow.verified_by) : <span className="t-muted">signs at certification</span>} />
        <Field label="Start date" value={enrollment.start_date ? <span className="t-mono">{enrollment.start_date}</span> : <span className="t-muted">— not set —</span>} />
        <div className="flex items-center gap-2 pb-1">
          <span className="t-small px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.color, fontWeight: 600, fontSize: 11 }}>{sm.label}</span>
          {canEdit && !editing && <button type="button" onClick={() => setEditing(true)} className="t-small px-2 py-0.5 rounded border" style={btnGhost}>Edit assignment</button>}
        </div>
      </div>

      {editing && (
        <form className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}
          onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            try { await upd.mutateAsync({ user_id: person.user_id, patch: { start_date: start || null, mentor_user_id: mentor || null, status, notes: notes.trim() || null } }); setEditing(false); }
            catch (ex) { setErr((ex as Error).message); }
          }}>
          <label className="block"><span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Start date</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border rounded px-2 py-1 t-text t-mono" style={inputStyle} /></label>
          <label className="block"><span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Mentor</span>
            <select value={mentor} onChange={(e) => setMentor(e.target.value)} className="border rounded px-2 py-1 t-text" style={inputStyle}><option value="">— none —</option>{cands.map((c) => <option key={c.user_id} value={c.user_id}>{c.is_lead ? '★ ' : ''}{c.full_name}</option>)}</select></label>
          <label className="block"><span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as NhStatus)} className="border rounded px-2 py-1 t-text" style={inputStyle}>{(Object.keys(STATUS_META) as NhStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
          <label className="block flex-1" style={{ minWidth: 220 }}><span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Notes</span><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="seasonal swap, schedule exceptions…" className="w-full border rounded px-2 py-1 t-text" style={inputStyle} /></label>
          <div className="flex gap-2">
            <button type="submit" disabled={upd.isPending} className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}>Save</button>
            <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
          </div>
          {err && <span className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</span>}
        </form>
      )}
      {!editing && enrollment.notes && <p className="t-small t-muted mt-2">{enrollment.notes}</p>}

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 8, background: 'var(--color-border)' }}>
          <div style={{ width: `${p.pct}%`, height: '100%', background: p.pct >= 100 ? 'var(--color-ok)' : 'var(--color-accent)', transition: 'width .3s' }} />
        </div>
        <span className="t-small t-mono" style={{ minWidth: 36, textAlign: 'right' }}>{p.pct}%</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 t-small t-muted">
        <span>{weekLabel}</span>
        <span>Items <b className="t-mono">{p.itemsDone}/{NH_TOTAL_ITEMS}</b></span>
        <span>Weeks initialed <b className="t-mono">{p.weeksSigned}/{NH_WEEKS}</b></span>
        <span>COVE audits <b className="t-mono">{p.coveSigned}/{NH_WEEKS}</b></span>
        <span>Reps at target <b className="t-mono">{p.repsDone}/{p.repsTotal}</b></span>
        <span>Handouts reviewed <b className="t-mono">{docsReviewed}/{signable.length}</b> · quizzes signed <b className="t-mono">{quizzesSigned}/{quizzable.length}</b></span>
        <span>Certification <b className="t-mono">{p.certSigned}/3</b></span>
      </div>
    </div>
  );
}

/** One labelled underline field of the sheet's header strip. */
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 150, flex: '1 1 150px' }}>
      <span className="t-small t-muted uppercase tracking-wider" style={{ ...mono, fontSize: 10 }}>{label}</span>
      <span className="t-text" style={{ borderBottom: '1px solid var(--color-text)', paddingBottom: 2, minHeight: 22 }}>{value}</span>
    </div>
  );
}

// ── Week × Verified items · Initials · Date ──────────────────────────────

function SheetWeeks({ userId, state, canEdit, nameOf, curWeek, hasQuiz }: {
  userId: string; state: NhUserState; canEdit: boolean; nameOf: (id: string | null | undefined) => string; curWeek: number; hasQuiz: (k: string) => boolean;
}) {
  const set = useSetCheckoff();
  const [err, setErr] = useState<string | null>(null);
  const toggle = async (item_key: string, on: boolean) => {
    setErr(null);
    try { await set.mutateAsync({ user_id: userId, item_key, on }); }
    catch (ex) { setErr((ex as Error).message); }
  };
  return (
    <div className="mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
      <div className="grid t-small font-semibold" style={{ gridTemplateColumns: '64px 1fr 120px 92px', background: SHEET_INK, color: '#fff', padding: '8px 12px', ...mono, fontSize: 11, letterSpacing: '0.04em' }}>
        <span>Week</span><span>Verified items</span><span>Initials</span><span>Date</span>
      </div>
      {NH_WEEKS_DEF.map((w) => (
        <SheetWeekRow key={w.n} week={w} userId={userId} state={state} canEdit={canEdit} nameOf={nameOf} isCur={w.n === curWeek} hasQuiz={hasQuiz} onToggle={toggle} />
      ))}
      {err && <p className="t-small px-3 py-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}

function SheetWeekRow({ week, userId, state, canEdit, nameOf, isCur, hasQuiz, onToggle }: {
  week: NhWeek; userId: string; state: NhUserState; canEdit: boolean; nameOf: (id: string | null | undefined) => string; isCur: boolean; hasQuiz: (k: string) => boolean;
  onToggle: (key: string, on: boolean) => void;
}) {
  const wkRow = state.checkoffs.get(weekKey(week.n));
  const done = week.items.filter((i) => state.checked.has(i.key)).length;
  const allDone = done === week.items.length;
  return (
    <div id={`nh-week-${week.n}`} className="grid" style={{ gridTemplateColumns: '64px 1fr 120px 92px', borderTop: '1px solid var(--color-border-soft)', background: isCur ? 'rgba(94,106,210,0.05)' : undefined, scrollMarginTop: 12 }}>
      <div className="px-3 py-2.5" style={{ borderRight: '1px solid var(--color-border-soft)' }}>
        <span className="font-bold" style={{ ...mono, fontSize: 12, color: week.accent }}>WK {week.n}</span>
        <div className="t-muted" style={{ fontSize: 10, ...mono }}>{done}/{week.items.length}</div>
        {isCur && <div style={{ fontSize: 9, ...mono, color: week.accent }}>now</div>}
      </div>
      <div className="px-3 py-2">
        <div className="t-small t-muted mb-1" style={{ fontSize: 11 }}>{week.title}</div>
        <ul className="space-y-1">
          {week.items.map((it) => (
            <ItemRow key={it.key} item={it} userId={userId} row={state.checkoffs.get(it.key)} canEdit={canEdit} nameOf={nameOf}
              onToggle={(on) => onToggle(it.key, on)}
              quizRow={(() => { const q = nhQuizDocForItem(it, hasQuiz); return q ? state.bestQuizByDoc.get(q) : undefined; })()} />
          ))}
        </ul>
      </div>
      <div className="px-2 py-2 flex items-start" style={{ borderLeft: '1px solid var(--color-border-soft)' }}>
        <button type="button" disabled={!canEdit} onClick={() => onToggle(weekKey(week.n), !wkRow)}
          className="w-full rounded border disabled:cursor-default"
          style={{ height: 40, ...mono, fontSize: wkRow ? 16 : 11, fontWeight: 700, letterSpacing: '0.06em', background: wkRow ? week.accent : 'var(--color-card)', color: wkRow ? '#fff' : allDone ? week.accent : 'var(--color-text-muted)', borderColor: wkRow ? week.accent : allDone ? week.accent : 'var(--color-border)', borderStyle: wkRow ? 'solid' : 'dashed' }}
          title={wkRow ? `${nameOf(wkRow.verified_by)} · ${fmtDate(wkRow.done_at)}` : canEdit ? (allDone ? 'All items verified — click to initial the week' : 'Initial the week only when every listed item is verified') : ''}>
          {wkRow ? initialsOf(nameOf(wkRow.verified_by)) : allDone ? 'initial' : '—'}
        </button>
      </div>
      <div className="px-2 py-2 flex items-start">
        <span className="w-full flex items-center justify-center rounded" style={{ height: 40, ...mono, fontSize: 11, color: wkRow ? 'var(--color-text)' : 'var(--color-text-muted)', background: 'var(--color-bg)' }}>{wkRow ? fmtDate(wkRow.done_at) : '—'}</span>
      </div>
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
  item, userId, row, canEdit, nameOf, onToggle, quizRow,
}: {
  item: NhItem; userId: string; row?: NhCheckoff; canEdit: boolean; nameOf: (id: string | null | undefined) => string; onToggle: (on: boolean) => void;
  /** The engineer's best self-recorded run of the quiz behind this item (mentor still ticks). */
  quizRow?: NhDocActivity;
}) {
  const setNote = useSetCheckoffNote();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote_] = useState('');
  const openNote = () => { setNote_(row?.note ?? ''); setNoteOpen(true); };
  const on = !!row;

  return (
    <li className="flex items-start gap-2" style={{ lineHeight: 1.35 }}>
      <input
        type="checkbox"
        checked={on}
        disabled={!canEdit}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--color-ok)', flex: '0 0 auto', marginTop: 2 }}
        title={canEdit ? (on ? 'Un-verify' : 'Mark verified') : undefined}
      />
      <div className="flex-1 min-w-0 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap t-small" style={{ fontSize: 13 }}>
        <span className="inline-flex items-center gap-1.5" style={{ color: on ? '#047857' : 'var(--color-text)', fontWeight: item.gate ? 600 : 400 }}>
          <CatDot cat={item.cat} />
          {item.label}
          {item.gate && <span className="px-1 rounded" style={{ background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>GATE</span>}
        </span>
        <DocLinks keys={item.docs} compact />
        <QuizScoreChip row={quizRow} compact />
        {on && !noteOpen && (
          <span className="t-muted" style={{ fontSize: 11, ...mono }}>
            {initialsOf(nameOf(row!.verified_by))} · {fmtDate(row!.done_at)}
            {row!.note ? <span style={{ fontFamily: 'var(--font-body)' }}> — {row!.note}</span> : null}
            {canEdit && <button type="button" className="ml-1 hover:underline" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-body)' }} onClick={openNote}>{row!.note ? 'edit' : '+ note'}</button>}
          </span>
        )}
        {on && noteOpen && (
          <form className="flex items-center gap-1 flex-1" style={{ minWidth: 220 }} onSubmit={async (e) => { e.preventDefault(); await setNote.mutateAsync({ user_id: userId, item_key: item.key, note: note.trim() || null }); setNoteOpen(false); }}>
            <input autoFocus type="text" value={note} onChange={(e) => setNote_(e.target.value)} placeholder="building, proof, what was weak…" className="border rounded px-2 py-0.5 t-small flex-1" style={inputStyle} />
            <button type="submit" className="t-small px-2 py-0.5 rounded text-white" style={{ background: 'var(--color-accent)' }}>Save</button>
            <button type="button" onClick={() => setNoteOpen(false)} className="t-small px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)' }}>✕</button>
          </form>
        )}
      </div>
    </li>
  );
}

// ── PM rep tally — two boxes per rep (the sheet's layout) ────────────────

function TallyCard({ userId, repCounts, logs, canEdit, nameOf }: {
  userId: string; repCounts: Map<string, number>; logs: NhRepLog[]; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
}) {
  const add = useAddRepLog();
  const del = useDeleteRepLog();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const reps: NhRep[] = [...NH_REPS, ...NH_EVALS];
  const atTarget = reps.filter((r) => (repCounts.get(r.key) ?? 0) >= r.target).length;
  const open = openKey ? reps.find((r) => r.key === openKey) : null;
  const openLogs = open ? logs.filter((l) => l.rep_key === open.key) : [];

  return (
    <div className="t-card mb-3">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <span className="t-text font-medium">PM rep tally — tick each completed rep (target 2×)</span>
        <span className="t-small t-muted">{atTarget}/{reps.length} at target · LOTO evals: #1 Wk 1 · #2 Wk 3 (MEP gate)</span>
      </div>
      <div className="grid gap-x-6 gap-y-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {reps.map((r) => {
          const n = repCounts.get(r.key) ?? 0;
          return (
            <div key={r.key} className="flex items-center gap-2 py-1.5 border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
              <button type="button" onClick={() => { setOpenKey(openKey === r.key ? null : r.key); setDate(todayIso()); setNote(''); setErr(null); }} className="t-text text-left flex-1 hover:underline" style={{ opacity: n >= r.target ? 0.75 : 1 }}>
                {r.label}{r.mep && <span className="ml-1.5 px-1 py-0.5 rounded t-small" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309', fontSize: 9, fontWeight: 700 }}>MEP</span>}
                <span className="t-small t-muted ml-2">{r.weekHint}</span>
              </button>
              <span className="inline-flex gap-1">
                {Array.from({ length: Math.max(r.target, n) }).map((_, i) => (
                  <span key={i} className="inline-flex items-center justify-center rounded" style={{ width: 22, height: 22, ...mono, fontSize: 12, border: `1.5px solid ${i < n ? 'var(--color-ok)' : 'var(--color-border)'}`, background: i < n ? 'var(--color-ok)' : 'var(--color-card)', color: '#fff' }}>{i < n ? '✓' : ''}</span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      {open && (
        <div className="mt-2 p-2 rounded" style={{ background: 'var(--color-bg)' }}>
          <div className="t-small font-medium mb-1">{open.label} — {openLogs.length}/{open.target}</div>
          {openLogs.map((l) => (
            <div key={l.id} className="t-small t-muted flex items-center gap-2 py-0.5">
              <span className="t-mono">{fmtDate(l.occurred_on)}</span>{l.note && <span>— {l.note}</span>}<span>· {nameOf(l.logged_by)}</span>
              {canEdit && <button type="button" onClick={() => del.mutate(l.id)} className="hover:underline" style={{ color: 'var(--color-danger)' }}>remove</button>}
            </div>
          ))}
          {canEdit && (
            <form className="flex flex-wrap items-center gap-2 mt-1" onSubmit={async (e) => {
              e.preventDefault(); setErr(null);
              try { await add.mutateAsync({ user_id: userId, rep_key: open.key, occurred_on: date, note: note.trim() || null }); setNote(''); }
              catch (ex) { setErr((ex as Error).message); }
            }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-2 py-0.5 t-small t-mono" style={inputStyle} />
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="building · with whom · job / WO" className="border rounded px-2 py-0.5 t-small flex-1" style={{ ...inputStyle, minWidth: 200 }} />
              <button type="submit" disabled={add.isPending} className="t-small px-2 py-0.5 rounded text-white disabled:opacity-50" style={{ background: 'var(--color-accent)' }}>Tick a rep</button>
              <button type="button" onClick={() => setOpenKey(null)} className="t-small px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)' }}>✕</button>
              {err && <span className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</span>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── COVE hours audit — WK 1..8 boxes ─────────────────────────────────────

function CoveAuditCard({ userId, checkoffs, canEdit, nameOf }: { userId: string; checkoffs: Map<string, NhCheckoff>; canEdit: boolean; nameOf: (id: string | null | undefined) => string }) {
  const set = useSetCheckoff();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="t-card mb-3">
      <div className="t-text font-medium mb-2">COVE hours audit — 7 h documented every day, ≥35 h each week (initial when verified)</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        {NH_WEEKS_DEF.map((w) => {
          const row = checkoffs.get(coveKey(w.n));
          return (
            <button key={w.n} type="button" disabled={!canEdit}
              onClick={async () => { setErr(null); try { await set.mutateAsync({ user_id: userId, item_key: coveKey(w.n), on: !row }); } catch (ex) { setErr((ex as Error).message); } }}
              className="flex items-center justify-between px-2 py-1.5 rounded border disabled:cursor-default"
              style={{ borderColor: row ? 'var(--color-ok)' : 'var(--color-border)', background: row ? 'rgba(16,185,129,0.10)' : 'var(--color-card)' }}
              title={row ? `${nameOf(row.verified_by)} · ${fmtDate(row.done_at)}` : canEdit ? 'Click to initial' : ''}>
              <span style={{ ...mono, fontSize: 11, fontWeight: 700 }}>WK {w.n}</span>
              <span style={{ ...mono, fontSize: 11, color: row ? '#047857' : 'var(--color-text-muted)' }}>{row ? `${initialsOf(nameOf(row.verified_by))} · ${fmtDate(row.done_at)}` : '☐'}</span>
            </button>
          );
        })}
      </div>
      {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}

// ── certification ─────────────────────────────────────────────────────────

function CertCard({ userId, enrollmentStatus, checked, checkoffs, canEdit, nameOf, progress }: {
  userId: string; enrollmentStatus: NhStatus; checked: Set<string>; checkoffs: Map<string, NhCheckoff>;
  canEdit: boolean; nameOf: (id: string | null | undefined) => string; progress: NhUserState['progress'];
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
      const nowSigned = NH_CERT_SIGNERS.every((s) => (s.key === key ? on : checked.has(s.key)));
      if (nowSigned && enrollmentStatus !== 'completed') await upd.mutateAsync({ user_id: userId, patch: { status: 'completed' } });
      if (!nowSigned && enrollmentStatus === 'completed') await upd.mutateAsync({ user_id: userId, patch: { status: 'active' } });
    } catch (ex) { setErr((ex as Error).message); }
  };
  return (
    <div className="mb-3 p-4 rounded-lg" style={{ border: `2px solid ${allSigned ? 'var(--color-ok)' : SHEET_INK}`, background: 'var(--color-card)' }}>
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <span className="t-text font-semibold" style={{ fontSize: 16 }}>Level-1 Certification</span>
        <span className="t-small" style={{ color: allSigned ? 'var(--color-ok)' : ready ? '#b45309' : 'var(--color-text-muted)' }}>
          {allSigned ? '✓ Certified' : ready ? 'Ready to sign' : `Not yet — ${NH_TOTAL_ITEMS - progress.itemsDone} items, ${progress.repsTotal - progress.repsDone} reps, ${NH_WEEKS - progress.weeksSigned} weeks outstanding`}
        </span>
      </div>
      <p className="t-small t-muted mb-3">{NH_CERT_TEXT}</p>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {NH_CERT_SIGNERS.map((s) => {
          const row = checkoffs.get(s.key);
          return (
            <div key={s.key} className="flex flex-col gap-1">
              <SignToggle label={`${s.label} signature`} on={!!row} row={row} nameOf={nameOf} canEdit={canEdit} onToggle={(on) => sign(s.key, on)} strong title="Recorded from the signed paper sheet" />
              <span className="t-small t-muted uppercase tracking-wider" style={{ ...mono, fontSize: 9, borderTop: '1px solid var(--color-text)', paddingTop: 2 }}>{s.label} — signature / date{row ? ` · ${nameOf(row.verified_by)}` : ''}</span>
            </div>
          );
        })}
      </div>
      {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
      <p className="t-small t-muted mt-3">File with this record: tag sheets (boiler · tower · AHU · chiller · portfolio 117), building check (all three parts), site map, and the phase-tracker print handout.</p>
    </div>
  );
}

// ── secondary cards ───────────────────────────────────────────────────────


function HandoutsCard({
  userId, state, canEdit, nameOf,
}: {
  userId: string; state: NhUserState; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
}) {
  const { docs, groups, href, isLoading, isError, error } = useTrainingManifest();
  const set = useSetCheckoff();
  const [err, setErr] = useState<string | null>(null);
  const toggle = async (item_key: string, on: boolean) => {
    setErr(null);
    try { await set.mutateAsync({ user_id: userId, item_key, on }); }
    catch (ex) { setErr((ex as Error).message); }
  };
  return (
    <div className="t-card mb-2">
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <span className="t-text font-medium">Handouts — reviewed &amp; quiz sign-off</span>
        <span className="t-small t-muted">Mentor ticks per handout · score = the engineer's own best run from the training page</span>
      </div>
      {isLoading && <p className="t-small t-muted">Loading manifest…</p>}
      {isError && <p className="t-small" style={{ color: 'var(--color-danger)' }}>Handout manifest missing or invalid: {(error as Error).message}</p>}
      {groups.map((g) => {
        const list = docs.filter((d) => d.group === g.key);
        if (!list.length) return null;
        return (
          <div key={g.key} className="mb-2">
            <div className="t-small t-muted uppercase tracking-wider mb-0.5">{g.label}</div>
            <ul>
              {list.map((d) => {
                const keys = docKeyFor(d.key);
                const rev = state.checkoffs.get(keys.reviewed), qz = state.checkoffs.get(keys.quiz);
                const opened = state.openedByDoc.get(d.key);
                return (
                  <li key={d.key} className="flex items-center gap-2 flex-wrap py-1 border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
                    <a href={href(d)} target="_blank" rel="noreferrer" className="t-small hover:underline" style={{ color: 'var(--color-accent)', flex: '1 1 220px', minWidth: 0 }}>
                      ↗ {d.label}
                      {d.week && <span className="t-mono t-muted ml-1.5" style={{ fontSize: 10 }}>WK {d.week}</span>}
                    </a>
                    <span className="t-small t-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      {opened ? `opened ×${opened.days} · last ${fmtDate(opened.last.at)}` : 'not opened yet'}
                    </span>
                    <QuizScoreChip row={state.bestQuizByDoc.get(d.key)} compact />
                    {d.signoff !== false && (
                      <span className="inline-flex gap-1.5">
                        <SignToggle label="Reviewed" on={!!rev} row={rev} nameOf={nameOf} canEdit={canEdit} onToggle={(on) => toggle(keys.reviewed, on)} title="Mentor: overview reviewed with the new hire" />
                        {d.quiz && (
                          <SignToggle label="Quiz passed" on={!!qz} row={qz} nameOf={nameOf} canEdit={canEdit} onToggle={(on) => toggle(keys.quiz, on)} title="Mentor: quiz passed (checked against the answer key)" accent="#7c3aed" />
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {err && <p className="t-small mt-1" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}

function ActivityCard({ state, canEdit }: { state: NhUserState; canEdit: boolean }) {
  const { byKey } = useTrainingManifest();
  const del = useDeleteDocActivity();
  const [open, setOpen] = useState(false);
  const [showOpened, setShowOpened] = useState(false);
  const quizzes = state.activity.filter((a) => a.kind === 'quiz');
  const rows = showOpened ? state.activity : quizzes;
  return (
    <div className="t-card mb-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <button type="button" onClick={() => setOpen((o) => !o)} className="t-text font-medium hover:underline">
          {open ? '▾' : '▸'} Engineer activity <span className="t-small t-muted font-normal">· {quizzes.length} quiz run{quizzes.length === 1 ? '' : 's'} · {state.openedByDoc.size} handout{state.openedByDoc.size === 1 ? '' : 's'} opened</span>
        </button>
        {open && (
          <label className="t-small t-muted flex items-center gap-1">
            <input type="checkbox" checked={showOpened} onChange={(e) => setShowOpened(e.target.checked)} /> include opened events
          </label>
        )}
      </div>
      {open && (rows.length === 0
        ? <p className="t-small t-muted mt-1.5 italic">Nothing recorded yet — the engineer records these from the training page.</p>
        : (
          <table className="w-full t-small mt-1.5 border-collapse">
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
                  <td className="py-1 pr-2 t-mono t-muted whitespace-nowrap">{fmtDate(a.at)}</td>
                  <td className="py-1 pr-2">{byKey.get(a.doc_key)?.label ?? a.doc_key}{a.kind === 'quiz' && a.quiz_title && <span className="t-muted"> — {a.quiz_title}</span>}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{a.kind === 'quiz' ? <QuizScoreChip row={a} compact /> : <span className="t-muted">opened</span>}</td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {canEdit && <button type="button" onClick={() => del.mutate(a.id)} className="hover:underline" style={{ color: 'var(--color-danger)' }} title="Remove this entry">remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
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
