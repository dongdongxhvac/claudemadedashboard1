// /upark/training/new-hire — the engineer's training page: the two printouts, live.
//
// Per user 2026-09-21: "engineer go by 8 week schedule print out and record
// from admin sign off". So this page shows the actual documents from the
// Print Station (hooks/useTrainingDocs.ts):
//   • Schedule tab — the "8-Week Schedule" document as printed; its file
//     chips open the matching handout in the viewer, and its "Check off"
//     ticks mirror the mentor's sign-offs (matched to sign-off-sheet items).
//   • My record tab — the "Master Sign-Off Sheet" document, read-only, with
//     the mentor's initials, dates, notes, rep boxes, COVE audit and
//     signatures filled in.
// Handouts open in a full-width viewer (iframe srcdoc, Print / New tab);
// finishing a quiz inside one is detected by useQuizWatcher and saved as
// the engineer's own run. UPark only (site-fenced in App.tsx), not
// manager-gated — it is course material.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useEngineers } from '../../hooks/useEngineers';
import { useTrainingDocs } from '../../hooks/useTrainingDocs';
import { useSignoffSheet } from '../../hooks/useSignoffSheet';
import { useNewHireUser, useCanEditNewHire, useRecordDocActivity } from '../../hooks/useNewHire';
import { useQuizWatcher } from '../../hooks/useQuizWatcher';
import { LiveSchedule, LiveSignoffSheet } from '../../components/LiveDoc';
import { NH_PROGRAM_TITLE, NH_WEEKS, nhWeekFor } from '../../lib/newHireProgram';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const STATUS_LABEL: Record<string, string> = { active: 'In program', completed: 'Certified', paused: 'Paused', withdrawn: 'Withdrawn' };

type Tab = 'schedule' | 'record' | 'handouts';

export default function NewHireTraining() {
  const { signOut } = useAuth();
  const me = useMe();
  const isMobile = useIsMobile();
  const docs = useTrainingDocs();
  const { sheet, scheduleHtml, error: sheetError, isLoading: sheetLoading } = useSignoffSheet();
  const myId = me.data?.id ?? '';
  const { state, isLoading: nhLoading } = useNewHireUser(myId, sheet);
  const canSeeMentorDocs = useCanEditNewHire(state.enrollment?.mentor_user_id);
  const engineers = useEngineers();
  const record = useRecordDocActivity();

  const [tab, setTab] = useState<Tab>('schedule');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openDoc = openKey ? docs.byKey.get(openKey) ?? null : null;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const openByKey = useCallback((key: string) => {
    const d = docs.byKey.get(key);
    if (!d) return;
    setOpenKey(d.key);
    window.scrollTo({ top: 0 });
    if (myId) record.mutate({ kind: 'opened', doc_key: d.key }, { onError: () => { /* best-effort */ } });
  }, [docs.byKey, myId, record]);
  const close = () => setOpenKey(null);

  const quizDocsSeen = useQuizWatcher(iframeRef, !!openDoc, (r) => {
    if (!openDoc || !myId || !openDoc.quiz) return;
    record.mutate(
      { kind: 'quiz', doc_key: openDoc.key, quiz_title: r.title, score: r.score, total: r.total },
      {
        onSuccess: () => showToast(`Saved: ${openDoc.label} quiz ${r.score}/${r.total}`),
        onError: (e) => showToast(`Could not save quiz result: ${(e as Error).message}`, 'warn'),
      },
    );
  });

  const enr = state.enrollment;
  const curWeek = nhWeekFor(enr?.start_date);
  const nameOf = useMemo(() => {
    const m = new Map((engineers.data ?? []).map((e) => [e.user_id, e.full_name]));
    return (id: string | null | undefined) => (id ? m.get(id) ?? '—' : '—');
  }, [engineers.data]);
  const mentorName = enr?.mentor_user_id ? nameOf(enr.mentor_user_id) : null;
  const docKeys = useMemo(() => new Set(docs.docs.map((d) => d.key)), [docs.docs]);
  const sheetFields = {
    'New hire': me.data?.full_name ?? '',
    'Mentor': mentorName ?? '',
    'Manager': (() => { const r = state.checkoffs.get('cert.manager'); return r ? nameOf(r.verified_by) : ''; })(),
    'Start date': enr?.start_date ?? '',
  };

  // ── viewer (replaces the page) ────────────────────────────────────────
  if (openDoc) {
    return (
      <div className="t-bg" style={{ fontFamily: 'var(--font-body)', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-wrap" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={close} className="t-small t-accent hover:underline whitespace-nowrap">← Back</button>
          <span className="t-text font-medium truncate" style={{ flex: '1 1 auto', minWidth: 0 }}>{openDoc.label}</span>
          {quizDocsSeen > 0 && !isMobile && <span className="t-small t-muted" style={{ fontSize: 11 }}>quiz on this page · saves itself when every question is answered</span>}
          <button type="button" onClick={() => { try { iframeRef.current?.contentWindow?.print(); } catch { /* blocked */ } }} className="t-small px-2 py-0.5 rounded border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>Print</button>
          <a href={docs.href(openDoc)} target="_blank" rel="noreferrer" className="t-small px-2 py-0.5 rounded border no-underline" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>New tab ↗</a>
        </div>
        <iframe key={openDoc.key} ref={iframeRef} srcDoc={openDoc.html} title={openDoc.label} style={{ flex: '1 1 auto', width: '100%', border: 0, background: '#fff', minHeight: 0 }} />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  const weekLabel = !enr ? null : curWeek === 0 ? `starts ${fmtDate(enr.start_date)}` : curWeek > NH_WEEKS ? 'past week 8' : `Week ${curWeek} of ${NH_WEEKS}`;
  const p = state.progress;

  return (
    <div className="min-h-screen t-bg" style={{ fontFamily: 'var(--font-body)' }}>
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="t-section-title" style={{ fontSize: isMobile ? '1.05rem' : undefined }}>New-hire training</h1>
            {!nhLoading && (enr
              ? <p className="t-small t-muted">
                  <span className="px-1.5 py-0.5 rounded-full mr-1.5" style={{ background: 'rgba(59,130,246,0.12)', color: '#1e40af', fontWeight: 600, fontSize: 11 }}>{STATUS_LABEL[enr.status] ?? enr.status}</span>
                  {NH_PROGRAM_TITLE} · {weekLabel}{mentorName ? ` · mentor ${mentorName}` : ''}
                  {sheet && <> · <b className="t-mono">{p.weekItemsDone}/{p.weekItemsTotal}</b> week items verified · <b className="t-mono">{p.repsDone}/{p.repsTotal}</b> reps at target</>}
                </p>
              : <p className="t-small t-muted">Not assigned to the 8-week program yet — the handouts and quizzes are open to everyone; the record fills in once your mentor signs.</p>)}
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap t-small">
            <Link to="/upark/engineer" className="t-accent hover:underline">← My day</Link>
            {!isMobile && <button onClick={signOut} className="t-accent hover:underline">Sign out</button>}
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-1">
          {([['schedule', '8-Week Schedule'], ['record', 'My sign-off record'], ['handouts', 'All handouts']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="t-small px-3 py-2" style={{ borderBottom: `2px solid ${tab === k ? 'var(--color-accent)' : 'transparent'}`, color: tab === k ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: 600 }}>{label}</button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto" style={{ padding: isMobile ? 0 : '12px 16px' }}>
        {(sheetLoading || docs.isLoading) && <p className="t-small t-muted p-4">Loading the print station…</p>}
        {sheetError && <p className="t-small p-4" style={{ color: 'var(--color-danger)' }}>{sheetError.message}</p>}

        {tab === 'schedule' && scheduleHtml && (
          <div className="rounded overflow-hidden" style={{ border: isMobile ? 0 : '1px solid var(--color-border)' }}>
            <p className="t-small t-muted px-3 py-1.5" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>Ticks in each week's <b>Check off</b> row are your mentor's sign-offs. Click a file name to open that handout.</p>
            <LiveSchedule html={scheduleHtml} sheet={sheet} checkoffs={state.checkoffs} docKeys={docKeys} onOpen={openByKey} />
          </div>
        )}
        {tab === 'schedule' && !scheduleHtml && !sheetLoading && <p className="t-small t-muted p-4">The print station has no "8-Week Schedule" document.</p>}

        {tab === 'record' && sheet && (
          <div className="rounded overflow-hidden" style={{ border: isMobile ? 0 : '1px solid var(--color-border)' }}>
            <p className="t-small t-muted px-3 py-1.5" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>Read-only — your mentor fills this in. Initials and dates are theirs; quiz chips are your own best runs.</p>
            <LiveSignoffSheet sheet={sheet} checkoffs={state.checkoffs} repLogs={state.repLogs} bestQuizByDoc={state.bestQuizByDoc} fields={sheetFields} canEdit={false} nameOf={nameOf} title="My sign-off record" />
          </div>
        )}

        {tab === 'handouts' && (
          <div className="t-card m-4 md:m-0">
            {docs.groups.filter((g) => g.key !== 'mentor_only' || canSeeMentorDocs).map((g) => (
              <div key={g.key} className="mb-3">
                <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-mono)' }}>{g.label}</div>
                <ul className="flex flex-wrap gap-1.5">
                  {docs.docs.filter((d) => d.group === g.key).map((d) => {
                    const best = state.bestQuizByDoc.get(d.key);
                    return (
                      <li key={d.key}>
                        <button type="button" onClick={() => openByKey(d.key)} className="t-small px-2 py-1 rounded border hover:underline" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                          {d.label}{d.quiz ? ' · quiz' : ''}{best && best.score != null ? <span className="t-mono ml-1" style={{ fontSize: 10, color: best.total && best.score / best.total >= 0.8 ? '#047857' : '#b45309' }}>{best.score}/{best.total}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </main>
      {toast && <Toast toast={toast} />}
    </div>
  );
}

function Toast({ toast }: { toast: { text: string; tone: 'ok' | 'warn' } }) {
  return (
    <div role="status" className="fixed left-1/2 t-small px-3 py-2 rounded shadow" style={{ bottom: 20, transform: 'translateX(-50%)', zIndex: 60, background: toast.tone === 'ok' ? '#065f46' : '#92400e', color: '#fff', maxWidth: '90vw' }}>
      {toast.text}
    </div>
  );
}
