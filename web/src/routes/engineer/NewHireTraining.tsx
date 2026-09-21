// /upark/training/new-hire — the engineer's own training page.
//
// Every signed-in UPark person can open it (site-fenced in App.tsx, NOT
// manager-gated — it is course material). It shows:
//   • my program status (only when enrolled — week N of 8, verified items,
//     mentor; read-only, the mentor's drawer is the record)
//   • the handout library from the manifest (web/public/training/manifest.json),
//     with my best quiz score + the mentor's Reviewed / Quiz-passed ticks
//   • a viewer: the handout in an <iframe> (same origin) with Print / New tab
//   • my quiz history
//
// Opening a handout records an 'opened' row (once per doc per day); finishing
// a quiz inside the frame is detected by useQuizWatcher (the handouts' own
// qDone/qTot/qRight counters) and recorded as a 'quiz' row — no edits to the
// handouts themselves. Mentor sign-off stays with the mentor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useEngineers } from '../../hooks/useEngineers';
import { useTrainingManifest, type NhDoc } from '../../hooks/useTrainingManifest';
import { useNewHireUser, useCanEditNewHire, useRecordDocActivity, type NhDocActivity } from '../../hooks/useNewHire';
import { useQuizWatcher } from '../../hooks/useQuizWatcher';
import { NH_PROGRAM_TITLE, NH_WEEKS, NH_TOTAL_ITEMS, nhWeekFor } from '../../lib/newHireProgram';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

const STATUS_LABEL: Record<string, string> = { active: 'In program', completed: 'Certified', paused: 'Paused', withdrawn: 'Withdrawn' };

export default function NewHireTraining() {
  const { signOut } = useAuth();
  const me = useMe();
  const isMobile = useIsMobile();
  const manifest = useTrainingManifest();
  const myId = me.data?.id ?? '';
  const { state, isLoading: nhLoading } = useNewHireUser(myId);
  const canSeeMentorDocs = useCanEditNewHire(state.enrollment?.mentor_user_id);
  const engineers = useEngineers();
  const record = useRecordDocActivity();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const openDoc = openKey ? manifest.byKey.get(openKey) ?? null : null;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // toast — local state + timer (same pattern as OvertimePanel)
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const open = (d: NhDoc) => {
    setOpenKey(d.key);
    if (myId) record.mutate({ kind: 'opened', doc_key: d.key }, { onError: () => { /* activity is best-effort */ } });
  };
  const close = () => setOpenKey(null);

  const quizDocsSeen = useQuizWatcher(iframeRef, !!openDoc, (r) => {
    if (!openDoc || !myId) return;
    if (!openDoc.quiz) return; // page not marked quiz in the manifest → view only
    record.mutate(
      { kind: 'quiz', doc_key: openDoc.key, quiz_title: r.title, score: r.score, total: r.total },
      {
        onSuccess: () => showToast(`Saved: ${openDoc.label.split(' — ')[0]} quiz ${r.score}/${r.total}`),
        onError: (e) => showToast(`Could not save quiz result: ${(e as Error).message}`, 'warn'),
      },
    );
  });

  const mentorName = useMemo(() => {
    const id = state.enrollment?.mentor_user_id;
    if (!id) return null;
    return engineers.data?.find((e) => e.user_id === id)?.full_name ?? '—';
  }, [state.enrollment?.mentor_user_id, engineers.data]);

  const groups = manifest.groups.filter((g) => g.key !== 'mentor' || canSeeMentorDocs);
  const myQuizzes = state.activity.filter((a) => a.kind === 'quiz');

  const headerH = 52;
  const viewerHeight = `calc(100dvh - ${headerH}px)`;

  const library = (
    <div className={isMobile ? 'p-4 space-y-4' : 'space-y-4'}>
      <ProgramCard state={state} loading={nhLoading} mentorName={mentorName} manifestDocs={manifest.docs} />

      <div className="t-card">
        <div className="t-text font-medium mb-1">Handouts</div>
        <p className="t-small t-muted mb-2">Open a handout to read it here; quizzes are saved automatically when every question is answered. Your mentor signs off each one in your training record.</p>
        {manifest.isLoading && <p className="t-small t-muted">Loading…</p>}
        {manifest.isError && <p className="t-small" style={{ color: 'var(--color-danger)' }}>Handout list missing or invalid: {(manifest.error as Error).message}</p>}
        {groups.map((g) => {
          const list = manifest.docs.filter((d) => d.group === g.key);
          if (!list.length) return null;
          return (
            <div key={g.key} className="mb-3">
              <div className="t-small t-muted uppercase tracking-wider mb-1">{g.label}</div>
              <ul>
                {list.map((d) => (
                  <DocRow key={d.key} doc={d} active={openKey === d.key} best={state.bestQuizByDoc.get(d.key)} ticks={state.docTicks.get(d.key)} href={manifest.href(d)} onOpen={() => open(d)} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="t-card">
        <div className="t-text font-medium mb-1">My quiz history <span className="t-small t-muted font-normal">· {myQuizzes.length}</span></div>
        {myQuizzes.length === 0
          ? <p className="t-small t-muted italic">No quiz finished yet.</p>
          : (
            <table className="w-full t-small border-collapse">
              <tbody>
                {myQuizzes.slice(0, 40).map((a) => (
                  <tr key={a.id} className="border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
                    <td className="py-1 pr-2 t-mono t-muted whitespace-nowrap">{fmtDate(a.at)}</td>
                    <td className="py-1 pr-2">{manifest.byKey.get(a.doc_key)?.label.split(' — ')[0] ?? a.doc_key}{a.quiz_title && <span className="t-muted"> — {a.quiz_title}</span>}</td>
                    <td className="py-1 whitespace-nowrap text-right"><ScoreChip row={a} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );

  const viewer = openDoc && (
    <div className="flex flex-col" style={{ height: viewerHeight, minHeight: 0 }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-wrap" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        {isMobile && <button type="button" onClick={close} className="t-small t-accent hover:underline">← Handouts</button>}
        <span className="t-text font-medium truncate" style={{ flex: '1 1 auto', minWidth: 0 }}>{openDoc.label}</span>
        {quizDocsSeen > 0 && <span className="t-small t-muted" style={{ fontSize: 11 }}>quiz on this page · saves when every question is answered</span>}
        <button type="button" onClick={() => { try { iframeRef.current?.contentWindow?.print(); } catch { /* blocked */ } }} className="t-small px-2 py-0.5 rounded border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>Print</button>
        <a href={manifest.href(openDoc)} target="_blank" rel="noreferrer" className="t-small px-2 py-0.5 rounded border no-underline" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>New tab ↗</a>
        {!isMobile && <button type="button" onClick={close} className="t-small t-muted hover:underline">Close</button>}
      </div>
      <iframe
        key={openDoc.key}
        ref={iframeRef}
        src={manifest.href(openDoc)}
        title={openDoc.label}
        style={{ flex: '1 1 auto', width: '100%', border: 0, background: '#fff', minHeight: 0 }}
      />
    </div>
  );

  return (
    <div className="min-h-screen t-bg" style={{ fontFamily: 'var(--font-body)' }}>
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', height: headerH }}>
        <div className="max-w-screen-2xl mx-auto px-4 h-full flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="t-section-title truncate" style={{ fontSize: isMobile ? '1rem' : undefined }}>New-hire training</h1>
            {!isMobile && <p className="t-small t-muted truncate">{NH_PROGRAM_TITLE}</p>}
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap">
            <Link to="/upark/engineer" className="t-small t-accent hover:underline">← My day</Link>
            {!isMobile && <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>}
          </div>
        </div>
      </header>

      {isMobile ? (
        openDoc ? viewer : library
      ) : (
        <div className="flex" style={{ height: viewerHeight }}>
          <aside className="overflow-y-auto p-4" style={{ width: openDoc ? 380 : '100%', maxWidth: openDoc ? 380 : 960, margin: openDoc ? 0 : '0 auto', flex: '0 0 auto', borderRight: openDoc ? '1px solid var(--color-border)' : undefined }}>
            {library}
          </aside>
          {openDoc && <section style={{ flex: '1 1 auto', minWidth: 0 }}>{viewer}</section>}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed left-1/2 t-small px-3 py-2 rounded shadow"
          style={{ bottom: 20, transform: 'translateX(-50%)', zIndex: 60, background: toast.tone === 'ok' ? '#065f46' : '#92400e', color: '#fff', maxWidth: '90vw' }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ScoreChip({ row }: { row: NhDocActivity }) {
  if (row.score == null || row.total == null) return null;
  const ok = row.total ? row.score / row.total >= 0.8 : false;
  return (
    <span className="t-mono px-1.5 py-0.5 rounded" style={{ fontSize: 11, background: ok ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)', color: ok ? '#047857' : '#b45309', whiteSpace: 'nowrap' }}>
      {row.score}/{row.total}
    </span>
  );
}

function DocRow({ doc, active, best, ticks, href, onOpen }: {
  doc: NhDoc; active: boolean; best?: NhDocActivity; ticks?: { reviewed: boolean; quiz: boolean }; href: string; onOpen: () => void;
}) {
  return (
    <li className="py-1.5 border-b" style={{ borderColor: 'var(--color-border-soft)', background: active ? 'var(--color-accent-soft)' : undefined, margin: '0 -6px', padding: '6px' , borderRadius: 4 }}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="text-left t-text hover:underline" style={{ flex: '1 1 auto', minWidth: 0, color: active ? 'var(--color-accent)' : undefined, fontWeight: active ? 600 : 400 }}>
          {doc.label}
        </button>
        <a href={href} target="_blank" rel="noreferrer" className="t-small t-muted no-underline hover:underline" title="Open in a new tab">↗</a>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
        {doc.week && <span className="t-mono t-muted" style={{ fontSize: 10 }}>WK {doc.week}</span>}
        {doc.quiz && <span className="px-1 rounded" style={{ fontSize: 10, background: 'rgba(124,58,237,0.1)', color: '#6d28d9', fontWeight: 600 }}>QUIZ</span>}
        {best && <span title={`Your best run · ${fmtDate(best.at)}`}><ScoreChip row={best} /></span>}
        {ticks?.reviewed && <span style={{ fontSize: 10, color: '#047857' }}>✓ Reviewed</span>}
        {ticks?.quiz && <span style={{ fontSize: 10, color: '#6d28d9' }}>✓ Quiz signed</span>}
        {doc.note && <span className="t-muted" style={{ fontSize: 10 }}>{doc.note}</span>}
      </div>
    </li>
  );
}

function ProgramCard({ state, loading, mentorName, manifestDocs }: {
  state: ReturnType<typeof useNewHireUser>['state']; loading: boolean; mentorName: string | null; manifestDocs: NhDoc[];
}) {
  const enr = state.enrollment;
  if (loading) return null;
  if (!enr) {
    return (
      <p className="t-small t-muted px-1">You're not enrolled in the 8-week program — the handouts and quizzes below are open to everyone.</p>
    );
  }
  const curWeek = nhWeekFor(enr.start_date);
  const weekLabel = curWeek === 0 ? `starts ${fmtDate(enr.start_date)}` : curWeek > NH_WEEKS ? 'past week 8' : `Week ${curWeek} of ${NH_WEEKS}`;
  const signable = manifestDocs.filter((d) => d.signoff !== false);
  const quizzable = signable.filter((d) => d.quiz);
  const reviewed = signable.filter((d) => state.docTicks.get(d.key)?.reviewed).length;
  const quizSigned = quizzable.filter((d) => state.docTicks.get(d.key)?.quiz).length;
  const p = state.progress;
  return (
    <div className="t-card">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="t-text font-medium">My 8-week program</span>
        <span className="t-small px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.12)', color: '#1e40af', fontWeight: 600, fontSize: 11 }}>{STATUS_LABEL[enr.status] ?? enr.status}</span>
      </div>
      <div className="t-small t-muted mt-1">{weekLabel}{mentorName ? ` · mentor ${mentorName}` : ''}</div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 8, background: 'var(--color-border)' }}>
          <div style={{ width: `${p.pct}%`, height: '100%', background: p.pct >= 100 ? 'var(--color-ok)' : 'var(--color-accent)' }} />
        </div>
        <span className="t-small t-mono">{p.pct}%</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 t-small t-muted">
        <span>Items verified <b className="t-mono">{p.itemsDone}/{NH_TOTAL_ITEMS}</b></span>
        <span>Weeks initialed <b className="t-mono">{p.weeksSigned}/{NH_WEEKS}</b></span>
        <span>Handouts reviewed <b className="t-mono">{reviewed}/{signable.length}</b></span>
        <span>Quizzes signed <b className="t-mono">{quizSigned}/{quizzable.length}</b></span>
      </div>
      <p className="t-small t-muted mt-1.5 italic">Your mentor records verifications; this is a read-only view.</p>
    </div>
  );
}
