// /upark/training/new-hire — the engineer's training page = the printed
// 8-week schedule, live.
//
// Per user 2026-09-21: "engineer go by 8 week schedule print out and record
// from admin sign off". So this page IS the schedule handout (week chips,
// why-boiler-first note, standing dailies, one card per week with its plan
// sections and handout links, the CHECK OFF row, the Friday line) with the
// mentor's sign-off record shown against it read-only: each check-off chip
// is ticked when the mentor verified it in the drawer (Admin › User
// Profiles → Training), week initials + COVE audit show on the card.
//
// The engineer's own contribution: opening a handout here (recorded once a
// day) and finishing its quiz — the viewer watches the handout's own quiz
// counters (useQuizWatcher) and saves the run; the best run shows as a
// chip beside the quiz item. The mentor still ticks. Handouts open in a
// full-width viewer that replaces the schedule (they are full-page
// documents; two panes would squeeze both).
//
// Every handout comes from the Print Station file (hooks/useTrainingDocs.ts)
// — one file to overwrite when training changes. Documents open as
// iframe.srcdoc; "New tab" uses a blob: URL.
//
// Every signed-in UPark person can open it (site-fenced in App.tsx, not
// manager-gated — it is course material). Not enrolled → the schedule still
// reads and quizzes still save; there is just no record row to show.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useEngineers } from '../../hooks/useEngineers';
import { useTrainingDocs, type NhDoc } from '../../hooks/useTrainingDocs';
import { useNewHireUser, useCanEditNewHire, useRecordDocActivity, type NhDocActivity, type NhCheckoff } from '../../hooks/useNewHire';
import { useQuizWatcher } from '../../hooks/useQuizWatcher';
import {
  NH_EYEBROW, NH_SCHEDULE_TITLE, NH_SCHEDULE_INTRO, NH_WEEKS, NH_WEEKS_DEF, NH_STANDING_DAILY, NH_SEASONAL_NOTE,
  nhWeekFor, weekKey, coveKey, nhQuizDocForItem, type NhWeek, type NhItem,
} from '../../lib/newHireProgram';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

const STATUS_LABEL: Record<string, string> = { active: 'In program', completed: 'Certified', paused: 'Paused', withdrawn: 'Withdrawn' };
const mono = { fontFamily: 'var(--font-mono)' } as const;

export default function NewHireTraining() {
  const { signOut } = useAuth();
  const me = useMe();
  const isMobile = useIsMobile();
  const manifest = useTrainingDocs();
  const myId = me.data?.id ?? '';
  const { state, isLoading: nhLoading } = useNewHireUser(myId);
  const canSeeMentorDocs = useCanEditNewHire(state.enrollment?.mentor_user_id);
  const engineers = useEngineers();
  const record = useRecordDocActivity();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const openDoc = openKey ? manifest.byKey.get(openKey) ?? null : null;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const openByKey = (key: string) => {
    const d = manifest.byKey.get(key);
    if (!d) return;
    setOpenKey(d.key);
    window.scrollTo({ top: 0 });
    if (myId) record.mutate({ kind: 'opened', doc_key: d.key }, { onError: () => { /* best-effort */ } });
  };
  const close = () => setOpenKey(null);

  const quizDocsSeen = useQuizWatcher(iframeRef, !!openDoc, (r) => {
    if (!openDoc || !myId || !openDoc.quiz) return;
    record.mutate(
      { kind: 'quiz', doc_key: openDoc.key, quiz_title: r.title, score: r.score, total: r.total },
      {
        onSuccess: () => showToast(`Saved: ${openDoc.label.split(' — ')[0]} quiz ${r.score}/${r.total}`),
        onError: (e) => showToast(`Could not save quiz result: ${(e as Error).message}`, 'warn'),
      },
    );
  });

  const enr = state.enrollment;
  const curWeek = nhWeekFor(enr?.start_date);
  const mentorName = useMemo(() => {
    const id = enr?.mentor_user_id;
    if (!id) return null;
    return engineers.data?.find((e) => e.user_id === id)?.full_name ?? '—';
  }, [enr?.mentor_user_id, engineers.data]);
  const hasQuiz = (k: string) => manifest.byKey.get(k)?.quiz === true;

  // ── viewer (replaces the schedule) ────────────────────────────────────
  if (openDoc) {
    return (
      <div className="t-bg" style={{ fontFamily: 'var(--font-body)', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-wrap" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={close} className="t-small t-accent hover:underline whitespace-nowrap">← Back to schedule</button>
          <span className="t-text font-medium truncate" style={{ flex: '1 1 auto', minWidth: 0 }}>{openDoc.label}</span>
          {quizDocsSeen > 0 && !isMobile && <span className="t-small t-muted" style={{ fontSize: 11 }}>quiz on this page · saves itself when every question is answered</span>}
          <button type="button" onClick={() => { try { iframeRef.current?.contentWindow?.print(); } catch { /* blocked */ } }} className="t-small px-2 py-0.5 rounded border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>Print</button>
          <a href={manifest.href(openDoc)} target="_blank" rel="noreferrer" className="t-small px-2 py-0.5 rounded border no-underline" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>New tab ↗</a>
        </div>
        <iframe key={openDoc.key} ref={iframeRef} srcDoc={openDoc.html} title={openDoc.label} style={{ flex: '1 1 auto', width: '100%', border: 0, background: '#fff', minHeight: 0 }} />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  // ── the schedule ──────────────────────────────────────────────────────
  const weekLabel = !enr ? null : curWeek === 0 ? `starts ${fmtDate(enr.start_date)}` : curWeek > NH_WEEKS ? 'past week 8' : `Week ${curWeek} of ${NH_WEEKS}`;

  return (
    <div className="min-h-screen t-bg" style={{ fontFamily: 'var(--font-body)' }}>
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className="inline-block px-2 py-0.5 rounded" style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', background: '#1a1f2b', color: '#fff' }}>{NH_EYEBROW}</span>
            <h1 className="t-section-title mt-1" style={{ fontSize: isMobile ? '1.05rem' : undefined }}>{NH_SCHEDULE_TITLE}</h1>
            {!nhLoading && (enr
              ? <p className="t-small t-muted">
                  <span className="px-1.5 py-0.5 rounded-full mr-1.5" style={{ background: 'rgba(59,130,246,0.12)', color: '#1e40af', fontWeight: 600, fontSize: 11 }}>{STATUS_LABEL[enr.status] ?? enr.status}</span>
                  {weekLabel}{mentorName ? ` · mentor ${mentorName}` : ''}{enr.start_date ? ` · started ${fmtDate(enr.start_date)}` : ''} · ticks are your mentor's sign-offs
                </p>
              : <p className="t-small t-muted">Not assigned to the 8-week program yet — the handouts and quizzes are open to everyone; sign-offs appear here once your mentor records them.</p>)}
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap t-small">
            <Link to="/upark/engineer" className="t-accent hover:underline">← My day</Link>
            {!isMobile && <button onClick={signOut} className="t-accent hover:underline">Sign out</button>}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-3">
        <p className="t-small t-muted">{NH_SCHEDULE_INTRO}</p>

        {/* week chips */}
        <div className="flex gap-1.5 flex-wrap">
          {NH_WEEKS_DEF.map((w) => {
            const signed = state.checked.has(weekKey(w.n));
            const isCur = w.n === curWeek;
            return (
              <a key={w.n} href={`#week-${w.n}`} className="no-underline px-2 py-1 rounded" style={{ background: w.accent, color: '#fff', fontSize: 11, lineHeight: 1.2, boxShadow: isCur ? '0 0 0 2px #fff, 0 0 0 4px ' + w.accent : undefined, opacity: signed ? 0.75 : 1, minWidth: isMobile ? 0 : 96 }}>
                <span style={{ ...mono, fontSize: 9, opacity: 0.85 }}>WK {w.n}{signed ? ' ✓' : ''}</span><br />{w.short}
              </a>
            );
          })}
        </div>

        <NoteCard title="Why boiler first" text={NH_SEASONAL_NOTE} accent="#d97706" />
        <Collapsible title="Standing daily — every week" defaultOpen={false}>
          <ul className="t-small space-y-1" style={{ paddingLeft: 16, listStyle: 'disc' }}>
            {NH_STANDING_DAILY.map((s, i) => <li key={i}>{s}</li>)}
            <li>One glossary/terminology section per day: <DocLink k="glossary" byKey={manifest.byKey} onOpen={openByKey} /> · <DocLink k="terminology" byKey={manifest.byKey} onOpen={openByKey} />. Escalation: senior engineer → lead → manager, never the vendor.</li>
          </ul>
        </Collapsible>

        {NH_WEEKS_DEF.map((w) => (
          <WeekCard key={w.n} week={w} isCur={w.n === curWeek} checkoffs={state.checkoffs} bestQuizByDoc={state.bestQuizByDoc} hasQuiz={hasQuiz} byKey={manifest.byKey} onOpen={openByKey} />
        ))}

        <div className="t-card">
          <div className="t-small t-muted uppercase tracking-wider mb-1" style={mono}>Also in the print station</div>
          <div className="flex flex-wrap gap-1.5">
            {manifest.docs.filter((d) => !DOCS_IN_SCHEDULE.has(d.key) && (d.group !== 'mentor_only' || canSeeMentorDocs)).map((d) => (
              <button key={d.key} type="button" onClick={() => openByKey(d.key)} className="t-small px-2 py-0.5 rounded border hover:underline" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>{d.label}</button>
            ))}
          </div>
          {manifest.isLoading && <p className="t-small t-muted mt-1">Loading the print station…</p>}
          {manifest.isError && <p className="t-small mt-1" style={{ color: 'var(--color-danger)' }}>Print station missing or unreadable: {(manifest.error as Error).message}</p>}
        </div>
      </main>
      {toast && <Toast toast={toast} />}
    </div>
  );
}

/** Handout keys the schedule cards already link, so the footer shows only the rest. */
const DOCS_IN_SCHEDULE = new Set<string>([
  ...NH_WEEKS_DEF.flatMap((w) => [...w.plan.flatMap((b) => b.docs ?? []), ...w.items.flatMap((i) => i.docs ?? [])]),
  'glossary', 'terminology',
]);

function Toast({ toast }: { toast: { text: string; tone: 'ok' | 'warn' } }) {
  return (
    <div role="status" className="fixed left-1/2 t-small px-3 py-2 rounded shadow" style={{ bottom: 20, transform: 'translateX(-50%)', zIndex: 60, background: toast.tone === 'ok' ? '#065f46' : '#92400e', color: '#fff', maxWidth: '90vw' }}>
      {toast.text}
    </div>
  );
}

function NoteCard({ title, text, accent }: { title: string; text: string; accent: string }) {
  return (
    <div className="t-small px-3 py-2 rounded" style={{ background: 'var(--color-card)', borderLeft: `4px solid ${accent}`, border: '1px solid var(--color-border)', borderLeftWidth: 4, borderLeftColor: accent }}>
      <b>{title}.</b> {text.replace(/^Why boiler first\.\s*/, '')}
    </div>
  );
}

function Collapsible({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="t-card" style={{ padding: '10px 14px' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="t-small font-semibold uppercase tracking-wider" style={{ ...mono, color: 'var(--color-text-muted)' }}>{open ? '▾' : '▸'} {title}</button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** A handout name rendered like the printout's inline file chips, opening the viewer. */
function DocLink({ k, byKey, onOpen }: { k: string; byKey: Map<string, NhDoc>; onOpen: (k: string) => void }) {
  const d = byKey.get(k);
  if (!d) return <span className="px-1.5 py-0.5 rounded t-muted" style={{ ...mono, fontSize: 11, border: '1px dashed var(--color-border)' }} title="Not in the print station yet">{k.replace(/_/g, ' ')} · not in print station</span>;
  return (
    <button type="button" onClick={() => onOpen(k)} className="px-1.5 py-0.5 rounded hover:underline" style={{ ...mono, fontSize: 11, background: 'rgba(94,106,210,0.08)', color: 'var(--color-accent)', border: '1px solid rgba(94,106,210,0.25)', verticalAlign: 'baseline' }} title={`Open ${d.label}`}>
      {d.label}{d.quiz ? ' · quiz' : ''}
    </button>
  );
}

function WeekCard({ week, isCur, checkoffs, bestQuizByDoc, hasQuiz, byKey, onOpen }: {
  week: NhWeek; isCur: boolean; checkoffs: Map<string, NhCheckoff>; bestQuizByDoc: Map<string, NhDocActivity>;
  hasQuiz: (k: string) => boolean; byKey: Map<string, NhDoc>; onOpen: (k: string) => void;
}) {
  const wk = checkoffs.get(weekKey(week.n)), cove = checkoffs.get(coveKey(week.n));
  const done = week.items.filter((i) => checkoffs.has(i.key)).length;
  return (
    <section id={`week-${week.n}`} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', boxShadow: isCur ? `0 0 0 2px ${week.accent}55` : undefined, scrollMarginTop: 12 }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap" style={{ background: week.accent, color: '#fff' }}>
        <div className="flex items-baseline gap-2"><span style={{ ...mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>WEEK {week.n}</span><span className="font-semibold" style={{ fontSize: 15 }}>{week.title}</span>{isCur && <span style={{ ...mono, fontSize: 10, opacity: 0.9 }}>· this week</span>}</div>
        <div className="flex items-center gap-2" style={{ fontSize: 11, ...mono }}>
          <span style={{ opacity: 0.9 }}>{done}/{week.items.length} verified</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: cove ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)' }}>{cove ? '✓' : '☐'} COVE ≥35 h</span>
          <span className="px-1.5 py-0.5 rounded" style={{ background: wk ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)' }}>{wk ? `✓ initialed ${fmtDate(wk.done_at)}` : '☐ initials'}</span>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2">
        {week.plan.map((b) => (
          <div key={b.title} className="t-small" style={{ lineHeight: 1.5 }}>
            <div className="uppercase tracking-wider" style={{ ...mono, fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 1 }}>{b.title}</div>
            <span>{b.text}</span>
            {b.docs?.length ? <span className="inline-flex flex-wrap gap-1 ml-1 align-baseline">{b.docs.map((k) => <DocLink key={k} k={k} byKey={byKey} onOpen={onOpen} />)}</span> : null}
          </div>
        ))}
        <div>
          <div className="uppercase tracking-wider" style={{ ...mono, fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>Check off <span className="normal-case tracking-normal" style={{ fontFamily: 'var(--font-body)' }}>— ticked by your mentor</span></div>
          <div className="flex flex-wrap gap-1.5">
            {week.items.map((it) => <CheckChip key={it.key} item={it} row={checkoffs.get(it.key)} quiz={(() => { const q = nhQuizDocForItem(it, hasQuiz); return q ? bestQuizByDoc.get(q) : undefined; })()} />)}
          </div>
        </div>
        <div className="t-small t-muted italic"><b className="not-italic">Friday:</b> {week.friday}</div>
      </div>
    </section>
  );
}

function CheckChip({ item, row, quiz }: { item: NhItem; row?: NhCheckoff; quiz?: NhDocActivity }) {
  const on = !!row;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded" title={item.label + (row ? ` · verified ${fmtDate(row.done_at)}` : '')}
      style={{ fontSize: 12, border: `1px solid ${on ? 'var(--color-ok)' : 'var(--color-border)'}`, background: on ? 'rgba(16,185,129,0.10)' : 'var(--color-card)', color: on ? '#047857' : 'var(--color-text)' }}>
      <span style={{ ...mono, fontSize: 12 }}>{on ? '☑' : '☐'}</span>
      <span>{item.short}</span>
      {item.gate && <span className="px-1 rounded" style={{ fontSize: 9, fontWeight: 700, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', letterSpacing: '0.04em' }}>GATE</span>}
      {on && <span className="t-muted" style={{ ...mono, fontSize: 10 }}>{fmtDate(row!.done_at)}</span>}
      {quiz && quiz.score != null && quiz.total != null && (
        <span className="px-1 rounded" style={{ ...mono, fontSize: 10, background: (quiz.score / quiz.total) >= 0.8 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.16)', color: (quiz.score / quiz.total) >= 0.8 ? '#047857' : '#b45309' }} title={`Your best quiz run · ${fmtDate(quiz.at)}`}>my {quiz.score}/{quiz.total}</span>
      )}
    </span>
  );
}
