// New-hire 8-week program — the mentor's SIGN-OFF SHEET, live.
//
// Per user 2026-09-21: "admin go by sign off spa format, admin assign
// trainings". The drawer shows the actual "Master Sign-Off Sheet" document
// from the Print Station (components/LiveDoc.tsx) with the record drawn into
// it: click an item's Initials/Date cell to verify it (your initials + the
// date appear), click its NOTES line to add a note, click the rep tally /
// COVE audit boxes to tick them, click a signature line to sign. The sheet
// document is also the program DEFINITION (lib/signoffSheet.ts) — items,
// reps, COVE weeks and signers all come from it.
//
// A person can be on more than one program (lib/programs.ts — each with its
// own print station + sign-off sheet; migration 0132): the drawer has one
// tab per assigned program and an "Assign training" control for the rest.
// Around the sheet: assignment (start date · mentor · status), the
// per-handout Reviewed / Quiz-passed ticks, the engineer's activity trail,
// and removal from that program.
//
// Opened from Admin › User Profiles (row "Training" button). Read-only for
// anyone who can't edit this person (DB decides; useCanEditNewHire mirrors
// it). The engineer sees the same sheet read-only on their training page.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NH_WEEKS, nhWeekFor, docKeyFor, noteKeyFor } from '../lib/newHireProgram';
import { PROGRAMS, programFor, type TrainingProgram } from '../lib/programs';
import { coveKey } from '../lib/signoffSheet';
import {
  useNewHireAll, programsOf, useNewHireUser, useCanEditNewHire, useEnrollNewHire, useUpdateEnrollment, useUnenrollNewHire,
  useSetCheckoff, useAddRepLog, useDeleteRepLog, useDeleteDocActivity,
  type NhStatus, type NhCheckoff, type NhDocActivity, type NhUserState,
} from '../hooks/useNewHire';
import { useTrainingDocs } from '../hooks/useTrainingDocs';
import { useSignoffSheet } from '../hooks/useSignoffSheet';
import { LiveSignoffSheet, type SheetActions } from './LiveDoc';
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
const mono = { fontFamily: 'var(--font-mono)' } as const;

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

export function NewHireProgramDrawer({ person, people, onClose, initialProgramKey }: {
  person: NhPerson;
  /** Everyone on the roster (names for verified_by / mentor picker). */
  people: NhPerson[];
  onClose: () => void;
  /** Program tab to open on (roster pill click); default = the first assigned. */
  initialProgramKey?: string;
}) {
  const me = useMe().data;
  const all = useNewHireAll();
  const assigned = useMemo(() => programsOf(all.data, person.user_id), [all.data, person.user_id]);
  const [chosenKey, setChosenKey] = useState<string | null>(initialProgramKey ?? null);
  const [assigning, setAssigning] = useState(false);
  const program: TrainingProgram = programFor(chosenKey && assigned.some((e) => e.program_key === chosenKey) ? chosenKey : assigned[0]?.program_key ?? chosenKey ?? PROGRAMS[0].key);
  const unassigned = PROGRAMS.filter((p) => p.available && !assigned.some((e) => e.program_key === p.key));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.user_id, p.full_name]));
    return (id: string | null | undefined) => (id ? (id === me?.id ? `${m.get(id) ?? 'you'} (you)` : (m.get(id) ?? '—')) : '—');
  }, [people, me?.id]);
  const canEdit = useCanEditNewHire(assigned.map((e) => e.mentor_user_id));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--color-bg)', maxWidth: 1000 }}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="t-small t-muted uppercase tracking-wider" style={mono}>Training</div>
            <h3 className="t-section-title" style={{ marginBottom: 2 }}>{person.full_name}</h3>
          </div>
          <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
        </div>

        {/* program tabs + assign */}
        <div className="flex items-center gap-1 flex-wrap mb-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {assigned.map((e) => {
            const p = programFor(e.program_key);
            const on = p.key === program.key && !assigning;
            return (
              <button key={p.key} type="button" onClick={() => { setChosenKey(p.key); setAssigning(false); }} className="t-small px-3 py-2" style={{ borderBottom: `2px solid ${on ? 'var(--color-accent)' : 'transparent'}`, color: on ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: 600, marginBottom: -1 }} title={p.title}>
                {p.short}{e.status === 'completed' ? ' ✓' : ''}
              </button>
            );
          })}
          {canEdit && unassigned.length > 0 && (
            <button type="button" onClick={() => setAssigning((a) => !a)} className="t-small px-3 py-2" style={{ borderBottom: `2px solid ${assigning ? 'var(--color-accent)' : 'transparent'}`, color: assigning ? 'var(--color-accent)' : 'var(--color-text-muted)', marginBottom: -1 }}>
              + Assign training
            </button>
          )}
          {all.isLoading && <span className="t-small t-muted px-2">Loading…</span>}
          {all.isError && <span className="t-small px-2" style={{ color: 'var(--color-danger)' }}>Error: {(all.error as Error).message}</span>}
        </div>

        {!all.isLoading && (assigning || assigned.length === 0) && (
          <AssignCard person={person} people={people} canEdit={canEdit} programs={unassigned} onDone={(key) => { setChosenKey(key); setAssigning(false); }} />
        )}

        {!assigning && assigned.length > 0 && (
          <ProgramPanel key={program.key} person={person} people={people} program={program} canEdit={canEdit} nameOf={nameOf} />
        )}
      </div>
    </div>
  );
}

/** One assigned program: assignment card, the live sign-off sheet, handouts, activity, removal. */
function ProgramPanel({ person, people, program, canEdit, nameOf }: {
  person: NhPerson; people: NhPerson[]; program: TrainingProgram; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
}) {
  const docs = useTrainingDocs(program);
  const { sheet, error: sheetError, isLoading: sheetLoading } = useSignoffSheet(program);
  const { state } = useNewHireUser(person.user_id, program, sheet);
  const enr = state.enrollment;

  const setCheckoff = useSetCheckoff();
  const addRep = useAddRepLog();
  const delRep = useDeleteRepLog();
  const upd = useUpdateEnrollment();
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); } catch (ex) { setErr((ex as Error).message); } };
  const uid = person.user_id, pk = program.key;
  const actions: SheetActions = {
    toggleItem: (key, on) => run(() => setCheckoff.mutateAsync({ user_id: uid, program_key: pk, item_key: key, on })),
    // A note is its own row (note.<key>) so it can exist without the initials; empty → removed.
    setNote: (key, note) => run(() => setCheckoff.mutateAsync({ user_id: uid, program_key: pk, item_key: noteKeyFor(key), on: !!note, note })),
    toggleCove: (n, on) => run(() => setCheckoff.mutateAsync({ user_id: uid, program_key: pk, item_key: coveKey(n), on })),
    toggleRep: (repKey, _i, on, level) => run(async () => {
      if (on) await addRep.mutateAsync({ user_id: uid, program_key: pk, rep_key: repKey, occurred_on: todayIso(), note: level });
      else { const latest = state.repLogs.find((l) => l.rep_key === repKey); if (latest) await delRep.mutateAsync(latest.id); }
    }),
    toggleSigner: (key, on) => run(async () => {
      await setCheckoff.mutateAsync({ user_id: uid, program_key: pk, item_key: key, on });
      const signers = sheet?.signers ?? [];
      const nowSigned = signers.length > 0 && signers.every((s) => (s.key === key ? on : state.checked.has(s.key)));
      if (nowSigned && enr?.status !== 'completed') await upd.mutateAsync({ user_id: uid, program_key: pk, patch: { status: 'completed' } });
      if (!nowSigned && enr?.status === 'completed') await upd.mutateAsync({ user_id: uid, program_key: pk, patch: { status: 'active' } });
    }),
  };

  const sheetFields = {
    'New hire': person.full_name,
    'Mentor': enr?.mentor_user_id ? nameOf(enr.mentor_user_id).replace(/\s*\(you\)$/, '') : '',
    'Manager': (() => { const r = state.checkoffs.get('cert.manager'); return r ? nameOf(r.verified_by).replace(/\s*\(you\)$/, '') : ''; })(),
    'Start date': enr?.start_date ?? '',
  };

  if (!enr) return null;
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="t-text font-medium">{program.title}</div>
        <div className="flex items-center gap-2 whitespace-nowrap flex-wrap justify-end">
          {docs.printStationUrl && <a href={docs.printStationUrl} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="The Print Station — preview and print any of the handouts">Print station ↗</a>}
          {docs.hrefFor('signoff_sheet') && <a href={docs.hrefFor('signoff_sheet')!} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="Blank printable sheet">Blank sheet ↗</a>}
        </div>
      </div>

      <AssignmentCard person={person} people={people} program={program} canEdit={canEdit} nameOf={nameOf} enrollment={enr} state={state} />
      {err && <p className="t-small mb-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
      {sheetLoading && <p className="t-small t-muted mb-2">Loading the print station…</p>}
      {sheetError && (
        <div className="t-card mb-3" style={{ borderLeft: '4px solid var(--color-warn)' }}>
          <div className="t-text font-medium">No sign-off sheet yet</div>
          <p className="t-small t-muted mt-1">{sheetError.message}</p>
          <p className="t-small t-muted mt-1">Build this program's Print Station in the same format as the 8-week one (a "Master Sign-Off Sheet" document inside it), drop it at that path, push — the sheet appears here.</p>
        </div>
      )}
      {sheet && (
        <div className="mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <p className="t-small t-muted px-3 py-1.5" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>
            {canEdit ? 'Initials = complete: click an Initials or Date cell to verify an item (your initials + today). NOTES can be added to any item at any time. Click the rep tally, COVE audit boxes and signature lines to tick or sign.' : 'Read-only — only the mentor, a lead, a manager or an admin can sign here.'}
          </p>
          <LiveSignoffSheet sheet={sheet} checkoffs={state.checkoffs} repLogs={state.repLogs} bestQuizByDoc={state.bestQuizByDoc} fields={sheetFields} canEdit={canEdit} nameOf={nameOf} actions={actions} />
        </div>
      )}
      <Secondary title="All handouts — reviewed & quiz sign-off (per handout)" hint="every document in the print station; not on the paper sheet">
        <HandoutsCard userId={uid} program={program} state={state} canEdit={canEdit} nameOf={nameOf} />
      </Secondary>
      <ActivityCard program={program} state={state} canEdit={canEdit} />
      {canEdit && <DangerCard userId={uid} program={program} name={person.full_name} />}
    </>
  );
}

function Secondary({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="t-small hover:underline" style={{ color: 'var(--color-accent)' }}>{open ? '▾' : '▸'} {title}{hint && <span className="t-muted"> · {hint}</span>}</button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

// ── assign / assignment ───────────────────────────────────────────────────

function mentorCandidates(people: NhPerson[], selfId: string) {
  return people
    .filter((p) => p.active && p.user_id !== selfId && (p.role === 'engineer' || p.role === 'manager'))
    .sort((a, b) => (Number(b.is_lead) - Number(a.is_lead)) || a.full_name.localeCompare(b.full_name));
}

function AssignCard({ person, people, canEdit, programs, onDone }: { person: NhPerson; people: NhPerson[]; canEdit: boolean; programs: TrainingProgram[]; onDone: (programKey: string) => void }) {
  const enroll = useEnrollNewHire();
  const [program, setProgram] = useState<string>(programs[0]?.key ?? '');
  const [start, setStart] = useState<string>(person.hiring_date ?? todayIso());
  const [mentor, setMentor] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const cands = useMemo(() => mentorCandidates(people, person.user_id), [people, person.user_id]);
  const chosen = programs.find((p) => p.key === program);

  return (
    <div className="t-card mb-3">
      <div className="t-small t-muted uppercase tracking-wider mb-1" style={mono}>Assign training</div>
      <p className="t-text t-muted mb-3">{programs.length === 0 ? `${person.full_name} is assigned to every available program.` : `Assigning a program opens its sign-off sheet for ${person.full_name} and puts its handouts on their training page.`}</p>
      {canEdit ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            if (!chosen) { setErr('Pick a program.'); return; }
            try { await enroll.mutateAsync({ user_id: person.user_id, program_key: chosen.key, start_date: start || null, mentor_user_id: mentor || null }); onDone(chosen.key); }
            catch (ex) { setErr((ex as Error).message); }
          }}
        >
          <label className="block" style={{ minWidth: 280 }}>
            <span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Program</span>
            <select value={program} onChange={(e) => setProgram(e.target.value)} className="border rounded px-2 py-1 t-text w-full" style={inputStyle}>
              {programs.map((p) => <option key={p.key} value={p.key}>{p.title}</option>)}
              {PROGRAMS.filter((p) => !p.available).map((p) => <option key={p.key} value={p.key} disabled>{p.title}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1" style={mono}>Start date</span>
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

function AssignmentCard({ person, people, program, canEdit, nameOf, enrollment, state }: {
  person: NhPerson; people: NhPerson[]; program: TrainingProgram; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
  enrollment: NonNullable<NhUserState['enrollment']>; state: NhUserState;
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
  const curWeek = nhWeekFor(enrollment.start_date);
  // "of 8" is the new-hire program's length; other programs just count weeks since the start.
  const weekly = program.key === PROGRAMS[0].key;
  const weekLabel = curWeek === 0 ? 'starts ' + fmtDate(enrollment.start_date) : !weekly ? `week ${curWeek}` : curWeek > NH_WEEKS ? 'past week 8' : `Week ${curWeek} of ${NH_WEEKS}`;
  return (
    <div className="t-card mb-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="t-small px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.color, fontWeight: 600, fontSize: 11 }}>{sm.label}</span>
        <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1" style={mono}>Start</span><b>{enrollment.start_date ? fmtDate(enrollment.start_date) : '—'}</b> <span className="t-small t-muted">· {weekLabel}</span></span>
        <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1" style={mono}>Mentor</span><b>{enrollment.mentor_user_id ? nameOf(enrollment.mentor_user_id) : '— not set —'}</b></span>
        {canEdit && !editing && <button type="button" onClick={() => setEditing(true)} className="t-small px-2 py-0.5 rounded border ml-auto" style={btnGhost}>Edit assignment</button>}
      </div>
      {editing && (
        <form className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}
          onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            try { await upd.mutateAsync({ user_id: person.user_id, program_key: program.key, patch: { start_date: start || null, mentor_user_id: mentor || null, status, notes: notes.trim() || null } }); setEditing(false); }
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
        <span>Week items <b className="t-mono">{p.weekItemsDone}/{p.weekItemsTotal}</b></span>
        <span>All items <b className="t-mono">{p.itemsDone}/{p.itemsTotal}</b></span>
        <span>Reps at target <b className="t-mono">{p.repsDone}/{p.repsTotal}</b></span>
        <span>COVE audits <b className="t-mono">{p.coveSigned}/{p.coveTotal}</b></span>
        <span>Certification <b className="t-mono">{p.certSigned}/{p.certTotal}</b></span>
      </div>
    </div>
  );
}

// ── secondary cards ───────────────────────────────────────────────────────

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

function HandoutsCard({
  userId, program, state, canEdit, nameOf,
}: {
  userId: string; program: TrainingProgram; state: NhUserState; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
}) {
  const { docs, groups, href, isLoading, isError, error } = useTrainingDocs(program);
  const set = useSetCheckoff();
  const [err, setErr] = useState<string | null>(null);
  const toggle = async (item_key: string, on: boolean) => {
    setErr(null);
    try { await set.mutateAsync({ user_id: userId, program_key: program.key, item_key, on }); }
    catch (ex) { setErr((ex as Error).message); }
  };
  return (
    <div className="t-card mb-2">
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <span className="t-text font-medium">Handouts — reviewed &amp; quiz sign-off</span>
        <span className="t-small t-muted">Mentor ticks per handout · score = the engineer's own best run from the training page</span>
      </div>
      {isLoading && <p className="t-small t-muted">Loading the print station…</p>}
      {isError && <p className="t-small" style={{ color: 'var(--color-danger)' }}>Print station missing or unreadable: {(error as Error).message}</p>}
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

function ActivityCard({ program, state, canEdit }: { program: TrainingProgram; state: NhUserState; canEdit: boolean }) {
  const { byKey } = useTrainingDocs(program);
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
                  <td className="py-1 pr-2">{byKey.get(a.doc_key)?.label ?? a.doc_key}{a.kind === 'quiz' && a.quiz_title && a.quiz_title !== byKey.get(a.doc_key)?.label && <span className="t-muted"> — {a.quiz_title}</span>}</td>
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

function DangerCard({ userId, program, name }: { userId: string; program: TrainingProgram; name: string }) {
  const un = useUnenrollNewHire();
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="t-card mb-2">
      {!armed ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="t-small t-muted uppercase tracking-wider block">Remove from {program.short}</span>
            <p className="t-small t-muted mt-0.5">Deletes {name}'s assignment to {program.title} and every check-off, note and rep log recorded on it. Other programs are untouched. To pause instead, set Status → Paused.</p>
          </div>
          <button type="button" onClick={() => setArmed(true)} className="t-small px-3 py-1 rounded border font-medium" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', background: 'transparent' }}>Remove…</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="t-small" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>This cannot be undone. Remove {name} from {program.short} and delete its record?</span>
          <div className="flex gap-2">
            <button type="button" disabled={un.isPending} onClick={async () => { setErr(null); try { await un.mutateAsync({ user_id: userId, program_key: program.key }); } catch (ex) { setErr((ex as Error).message); } }} className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-40" style={{ background: 'var(--color-danger)' }}>Remove</button>
            <button type="button" onClick={() => setArmed(false)} className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="t-small mt-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
    </div>
  );
}
