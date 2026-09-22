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
// Around the sheet: assignment (program · start date · mentor · status),
// the per-handout Reviewed / Quiz-passed ticks, the engineer's activity
// trail, and removal. Only Plan B can be assigned today; later programs
// (Licensed HVAC development, the 5 category tracks) are listed as coming.
//
// Opened from Admin › User Profiles (row "Training" button). Read-only for
// anyone who can't edit this person (DB decides; useCanEditNewHire mirrors
// it). The engineer sees the same sheet read-only on their training page.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NH_PROGRAM_KEY, NH_PROGRAM_TITLE, NH_WEEKS, nhWeekFor, docKeyFor, noteKeyFor } from '../lib/newHireProgram';
import { coveKey } from '../lib/signoffSheet';
import {
  useNewHireUser, useCanEditNewHire, useEnrollNewHire, useUpdateEnrollment, useUnenrollNewHire,
  useSetCheckoff, useAddRepLog, useDeleteRepLog, useDeleteDocActivity,
  type NhStatus, type NhCheckoff, type NhDocActivity, type NhUserState,
} from '../hooks/useNewHire';
import { useTrainingDocs, NH_PRINT_STATION_URL } from '../hooks/useTrainingDocs';
import { useSignoffSheet } from '../hooks/useSignoffSheet';
import { LiveSignoffSheet, type SheetActions } from './LiveDoc';
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

export function NewHireProgramDrawer({ person, people, onClose }: {
  person: NhPerson;
  /** Everyone on the roster (names for verified_by / mentor picker). */
  people: NhPerson[];
  onClose: () => void;
}) {
  const me = useMe().data;
  const { sheet, error: sheetError, isLoading: sheetLoading } = useSignoffSheet();
  const { state, isLoading, isError, error } = useNewHireUser(person.user_id, sheet);
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

  const docs = useTrainingDocs();
  const enr = state.enrollment;

  // ── actions the live sheet calls ─────────────────────────────────────
  const setCheckoff = useSetCheckoff();
  const addRep = useAddRepLog();
  const delRep = useDeleteRepLog();
  const upd = useUpdateEnrollment();
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); } catch (ex) { setErr((ex as Error).message); } };
  const actions: SheetActions = {
    toggleItem: (key, on) => run(() => setCheckoff.mutateAsync({ user_id: person.user_id, item_key: key, on })),
    // A note is its own row (note.<key>) so it can exist without the initials; empty → removed.
    setNote: (key, note) => run(() => setCheckoff.mutateAsync({ user_id: person.user_id, item_key: noteKeyFor(key), on: !!note, note })),
    toggleCove: (n, on) => run(() => setCheckoff.mutateAsync({ user_id: person.user_id, item_key: coveKey(n), on })),
    toggleRep: (repKey, _i, on, level) => run(async () => {
      if (on) await addRep.mutateAsync({ user_id: person.user_id, rep_key: repKey, occurred_on: todayIso(), note: level });
      else { const latest = state.repLogs.find((l) => l.rep_key === repKey); if (latest) await delRep.mutateAsync(latest.id); }
    }),
    toggleSigner: (key, on) => run(async () => {
      await setCheckoff.mutateAsync({ user_id: person.user_id, item_key: key, on });
      const signers = sheet?.signers ?? [];
      const nowSigned = signers.length > 0 && signers.every((s) => (s.key === key ? on : state.checked.has(s.key)));
      if (nowSigned && enr?.status !== 'completed') await upd.mutateAsync({ user_id: person.user_id, patch: { status: 'completed' } });
      if (!nowSigned && enr?.status === 'completed') await upd.mutateAsync({ user_id: person.user_id, patch: { status: 'active' } });
    }),
  };

  const sheetFields = {
    'New hire': person.full_name,
    'Mentor': enr?.mentor_user_id ? nameOf(enr.mentor_user_id).replace(/\s*\(you\)$/, '') : '',
    'Manager': (() => { const r = state.checkoffs.get('cert.manager'); return r ? nameOf(r.verified_by).replace(/\s*\(you\)$/, '') : ''; })(),
    'Start date': enr?.start_date ?? '',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--color-bg)', maxWidth: 1000 }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="t-small t-muted uppercase tracking-wider" style={mono}>Training · sign-off sheet</div>
            <h3 className="t-section-title" style={{ marginBottom: 2 }}>{person.full_name}</h3>
            <div className="t-small t-muted">{NH_PROGRAM_TITLE}</div>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap flex-wrap justify-end">
            {docs.hrefFor('plan') && <a href={docs.hrefFor('plan')!} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="The 8-Week Schedule document">8-Week Schedule ↗</a>}
            <a href={encodeURI(NH_PRINT_STATION_URL)} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="The Print Station — preview and print any of the handouts">Print station ↗</a>
            {docs.hrefFor('signoff_sheet') && <a href={docs.hrefFor('signoff_sheet')!} target="_blank" rel="noreferrer" className="t-small px-2 py-1 rounded border no-underline" style={btnGhost} title="Blank printable sheet">Blank sheet ↗</a>}
            <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
          </div>
        </div>

        {(isLoading || sheetLoading) && <p className="t-text t-muted">Loading…</p>}
        {isError && <p className="t-text t-danger">Error: {(error as Error).message}</p>}
        {sheetError && <p className="t-text t-danger">{sheetError.message}</p>}

        {!isLoading && !enr && <AssignCard person={person} people={people} canEdit={canEdit} />}

        {enr && (
          <>
            <AssignmentCard person={person} people={people} canEdit={canEdit} nameOf={nameOf} enrollment={enr} state={state} />
            {err && <p className="t-small mb-2" style={{ color: 'var(--color-danger)' }}>{err}</p>}
            {sheet && (
              <div className="mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <p className="t-small t-muted px-3 py-1.5" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>
                  {canEdit ? 'Initials = complete: click an Initials or Date cell to verify an item (your initials + today). NOTES can be added to any item at any time. Click the rep tally, COVE audit boxes and signature lines to tick or sign.' : 'Read-only — only the mentor, a lead, a manager or an admin can sign here.'}
                </p>
                <LiveSignoffSheet sheet={sheet} checkoffs={state.checkoffs} repLogs={state.repLogs} bestQuizByDoc={state.bestQuizByDoc} fields={sheetFields} canEdit={canEdit} nameOf={nameOf} actions={actions} />
              </div>
            )}
            <Secondary title="Handouts — reviewed & quiz sign-off (per handout)" hint="not on the paper sheet; the engineer sees these on their training page">
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

function AssignmentCard({ person, people, canEdit, nameOf, enrollment, state }: {
  person: NhPerson; people: NhPerson[]; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
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
  const weekLabel = curWeek === 0 ? 'starts ' + fmtDate(enrollment.start_date) : curWeek > NH_WEEKS ? 'past week 8' : `Week ${curWeek} of ${NH_WEEKS}`;
  return (
    <div className="t-card mb-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="t-small px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.color, fontWeight: 600, fontSize: 11 }}>{sm.label}</span>
        <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1" style={mono}>Program</span>{PROGRAMS.find((x) => x.key === enrollment.program_key)?.label ?? enrollment.program_key}</span>
        <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1" style={mono}>Start</span><b>{enrollment.start_date ? fmtDate(enrollment.start_date) : '—'}</b> <span className="t-small t-muted">· {weekLabel}</span></span>
        <span className="t-text"><span className="t-muted t-small uppercase tracking-wider mr-1" style={mono}>Mentor</span><b>{enrollment.mentor_user_id ? nameOf(enrollment.mentor_user_id) : '— not set —'}</b></span>
        {canEdit && !editing && <button type="button" onClick={() => setEditing(true)} className="t-small px-2 py-0.5 rounded border ml-auto" style={btnGhost}>Edit assignment</button>}
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
  userId, state, canEdit, nameOf,
}: {
  userId: string; state: NhUserState; canEdit: boolean; nameOf: (id: string | null | undefined) => string;
}) {
  const { docs, groups, href, isLoading, isError, error } = useTrainingDocs();
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

function ActivityCard({ state, canEdit }: { state: NhUserState; canEdit: boolean }) {
  const { byKey } = useTrainingDocs();
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
