// §05 PM Audit — the review card (docs/pm-audit.md §4.2): one queued task's
// evidence on the left (photos, checklist, Cove timeline), notes and the
// manager's verdict on the right. Save & next walks the queue in the same
// filter the queue page showed.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useAuditAccess, useAuditCard, useAuditQueue, useSaveReview,
  type TaskAttachment, type TaskDetails, type TaskStep,
} from '../../hooks/usePmAudit';
import {
  REASON_TAGS, SITE_LABEL, THICK_NOTE_CHARS, VERDICT_LABEL, asFlagKeys, buildTimeline, coveTaskUrl, filterQueue, fmtClosed, fmtDay, fmtHours, fmtStamp,
  isPhotoName, isWeekStart, nextOpen, noteSourceLabel, rowChips, shortName, auditWeekLabel,
  type QueueRow, type Review, type Verdict,
} from '../../lib/pmAudit';
import { AuditShell, ChipTag, Notice, Panel, Soft, VerdictTag } from './AuditUi';
import { A, VERDICT_TONE, buttonStyle, cardStyle, font, labelStyle, primaryButtonStyle } from './auditTheme';
import { useAuditParams } from './useAuditParams';

const VERDICTS: Verdict[] = ['pass', 'coach', 'fail'];

// ---------- photos + lightbox ----------

/** The task's photos, oldest upload first — the grid and the viewer share this order. */
function photosOf(details: TaskDetails | null): TaskAttachment[] {
  return (details?.attachments ?? [])
    .filter((a) => isPhotoName(a.name))
    .sort((a, b) => (a.uploadedAt ?? '').localeCompare(b.uploadedAt ?? ''));
}

function PhotoThumb({ a, onOpen }: { a: TaskAttachment; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <button type="button" onClick={onOpen} aria-label={`Open photo ${a.name}`}
        style={{ padding: 0, border: `1px solid ${A.control}`, borderRadius: 8, overflow: 'hidden', background: '#DDE1E7', cursor: 'zoom-in', aspectRatio: '4 / 3', display: 'block', width: '100%' }}>
        {broken
          ? <span style={{ display: 'block', padding: 10, fontSize: 12, color: A.muted, wordBreak: 'break-all' }}>{a.name}<br />preview not available</span>
          : <img src={a.url} alt={a.name} loading="lazy" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </button>
      <figcaption style={{ fontSize: 12, color: A.muted, lineHeight: 1.3 }}>
        {fmtStamp(a.uploadedAt)}{a.uploadedBy ? ` · ${shortName(a.uploadedBy)}` : ''}
      </figcaption>
    </figure>
  );
}

/** Overlay with prev / next and a filmstrip, like Cove's own photo viewer.
 *  ← → move, Esc closes. */
function Lightbox({ photos, index, onIndex, onClose }: { photos: TaskAttachment[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const n = photos.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onIndex((index + n - 1) % n);
      if (e.key === 'ArrowRight') onIndex((index + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, n, onIndex, onClose]);
  const a = photos[index];
  const arrow = { ...buttonStyle, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.35)', color: '#FFFFFF', fontSize: 18, width: 48, padding: 0, flex: 'none' } as const;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,17,20,0.92)', display: 'flex', flexDirection: 'column', fontFamily: font }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 16px', color: '#FFFFFF', fontSize: 13 }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {index + 1} / {n} · {fmtStamp(a.uploadedAt)}{a.uploadedBy ? ` · ${a.uploadedBy}` : ''}
        </span>
        <button type="button" onClick={onClose} style={{ ...arrow, width: 'auto', padding: '0 14px', fontSize: 13 }}>Close ✕</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px' }}>
        <button type="button" aria-label="Previous photo" style={arrow} disabled={n < 2} onClick={(e) => { e.stopPropagation(); onIndex((index + n - 1) % n); }}>‹</button>
        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={a.url} alt={a.name} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
        </div>
        <button type="button" aria-label="Next photo" style={arrow} disabled={n < 2} onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % n); }}>›</button>
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, padding: 12, overflowX: 'auto', justifyContent: n < 8 ? 'center' : 'flex-start' }}>
        {photos.map((p, i) => (
          <button key={`${p.url}-${i}`} type="button" aria-label={`Photo ${i + 1}`} aria-current={i === index} onClick={() => onIndex(i)}
            style={{ flex: 'none', width: 72, height: 54, padding: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: '#333', border: i === index ? '2px solid #FFFFFF' : '2px solid transparent', opacity: i === index ? 1 : 0.6 }}>
            <img src={p.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function PhotosPanel({ row, details, onOpen }: { row: QueueRow; details: TaskDetails | null; onOpen: (i: number) => void }) {
  const f = row.f;
  const expects = (f?.min_photos ?? 0) > 0;
  const atts = details?.attachments ?? [];
  const photos = photosOf(details);
  const files = atts.filter((a) => !isPhotoName(a.name));
  const flagged = row.flags.includes('no_photos');
  const times = photos.map((a) => a.uploadedAt).filter((t): t is string => !!t).sort();
  return (
    <Panel
      title={<>Photos <span style={{ color: flagged ? A.red : photos.length > 0 ? A.greenDark : undefined }}>{details ? photos.length : '—'}</span> <Soft>· {expects ? `at least one expected${f?.pm_type ? ` for a ${f.pm_type}` : ''}, or a thick note` : 'none expected for this PM'}</Soft></>}
      aside={times.length > 0 && (
        <span style={{ fontSize: 12, color: A.muted }}>
          uploaded {fmtClosed(times[0])}{times.length > 1 && times[times.length - 1] !== times[0] ? ` – ${fmtClosed(times[times.length - 1])}` : ''}
        </span>
      )}
    >
      {!details ? (
        <div style={{ fontSize: 13, color: A.muted }}>This task's details have not been pulled from Cove yet, so there is nothing to show.</div>
      ) : photos.length === 0 && !flagged ? (
        <div style={{ fontSize: 13, color: A.muted }}>{expects ? 'No photos — the note carries this one.' : 'No photos — none expected for this PM.'}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {photos.map((a, i) => <PhotoThumb key={`${a.url}-${i}`} a={a} onOpen={() => onOpen(i)} />)}
          {flagged && (
            <div style={{ aspectRatio: '4 / 3', borderRadius: 8, border: `1px dashed ${A.control}`, color: A.muted, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 8 }}>
              no photo, and no thick note
            </div>
          )}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ fontSize: 13, color: A.muted }}>
          Other files:{' '}
          {files.map((a, i) => (
            <span key={`${a.url}-${i}`}>{i > 0 && ', '}<a href={a.url} target="_blank" rel="noreferrer" style={{ color: A.blue }}>{a.name}</a></span>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------- checklist, timeline ----------

function stepDone(s: TaskStep): boolean {
  if (s.type === 'check_box') return s.value === true;
  return s.value !== null && s.value !== undefined && s.value !== '' && s.value !== false;
}

function ChecklistPanel({ row, details }: { row: QueueRow; details: TaskDetails | null }) {
  const steps = details?.steps ?? [];
  const done = steps.filter(stepDone).length;
  const open = details !== null && done < steps.length;
  const unexplained = row.flags.includes('steps_unexplained');
  return (
    <Panel
      title={<>Checklist <Soft>· {details ? `${done} / ${steps.length} checked` : 'not loaded'}</Soft></>}
      aside={open && (unexplained
        ? <ChipTag chip={{ key: 'steps', tone: 'orange', label: 'Unchecked, and the note does not say why' }} />
        : <span style={{ fontSize: 12, color: A.muted }}>unchecked step — see the note</span>)}
    >
      {!details ? (
        <div style={{ fontSize: 13, color: A.muted }}>Not pulled from Cove yet.</div>
      ) : steps.length === 0 ? (
        <div style={{ fontSize: 13, color: A.muted }}>This PM has no checklist steps.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
          {steps.map((s, i) => {
            const ok = stepDone(s);
            const text = s.type !== 'check_box' && typeof s.value === 'string' ? s.value.trim() : '';
            return (
              <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 8px', borderRadius: 6, background: ok ? undefined : A.orangeSoft }}>
                <span aria-hidden="true" style={{ flex: 'none', width: 18, height: 18, marginTop: 1, borderRadius: 4, boxSizing: 'border-box', background: ok ? A.blue : A.card, border: ok ? 0 : `2px solid ${A.orange}`, color: '#FFFFFF', fontSize: 12, textAlign: 'center', lineHeight: '18px' }}>{ok ? '✓' : ''}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="sr-only">{ok ? 'Done: ' : 'Not done: '}</span>
                  {s.description || (s.type === 'check_box' ? 'Step' : 'Text field')}
                  {!ok && <span style={{ color: A.orangeDark, fontWeight: 600 }}> — {s.type === 'check_box' ? 'not checked' : 'left empty'}</span>}
                  {text && <span style={{ display: 'block', color: A.muted, fontSize: 13 }}>“{text}”</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function TimelinePanel({ details }: { details: TaskDetails | null }) {
  const items = useMemo(() => buildTimeline(details?.history, details?.due_date), [details]);
  return (
    <Panel title={<>Timeline <Soft>· from Cove history</Soft></>}>
      {!details ? (
        <div style={{ fontSize: 13, color: A.muted }}>Not pulled from Cove yet.</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: A.muted }}>{details.history === null ? 'History was pruned for this task (older than 180 days and never queued).' : 'Cove returned no history for this task.'}</div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          {items.map((it) => (
            <li key={it.key} style={{ display: 'grid', gridTemplateColumns: '118px 14px 1fr', gap: 12, alignItems: 'start', padding: '6px 8px 6px 0' }}>
              <span style={{ color: A.muted, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtStamp(it.at)}</span>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 4, background: it.tone === 'photo' ? A.blue : '#C9CED6' }} />
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it.strong && <strong>{it.strong}</strong>}{it.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ---------- notes ----------

function NotesPanel({ row, details }: { row: QueueRow; details: TaskDetails | null }) {
  const f = row.f;
  const notes = details?.notes ?? [];
  const chars = f?.note_chars ?? 0;
  return (
    <Panel
      title={<>Notes <Soft>· {details ? notes.length : '—'}</Soft></>}
      aside={f && details && (f.note_thick
        ? <ChipTag chip={{ key: 'thick', tone: 'green', label: `Thick note · ${chars} chars` }} />
        : <span style={{ fontSize: 12, color: A.muted }}>{f.note_boilerplate ? 'boilerplate' : `${chars} chars`}{f.note_thin ? ' · thin' : ''} · thick at {THICK_NOTE_CHARS}</span>)}
    >
      {!details ? (
        <div style={{ fontSize: 13, color: A.muted }}>Not pulled from Cove yet.</div>
      ) : notes.length === 0 ? (
        <div style={{ fontSize: 14 }}>No note was written on this task.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notes.map((n, i) => (
            <div key={i}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: A.muted }}>
                <ChipTag chip={{ key: 'src', tone: 'grey', label: noteSourceLabel(n.source) }} />
                {n.by && <span>{shortName(n.by)}</span>}
                {n.at && <span>{fmtStamp(n.at)}</span>}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.text}</p>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.5 }}>
        A note of {THICK_NOTE_CHARS}+ characters counts as evidence on its own, photos or not. A short note is fine when every step is
        checked; unchecked steps need a note that says why.
        {f?.note_must_match === '\\d' && ' This template records a reading, so the note should contain a number.'}
      </div>
    </Panel>
  );
}

// ---------- verdict ----------

function VerdictBox({ review, canReview, saving, error, hotkeys, onSave }: {
  review: Review | null;
  canReview: boolean;
  saving: boolean;
  error: string | null;
  /** false while the photo viewer is open, so Enter doesn't save behind it. */
  hotkeys: boolean;
  onSave: (v: { verdict: Verdict; reasonTags: string[]; note: string }) => void;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(review?.verdict ?? null);
  const [tags, setTags] = useState<string[]>(review?.reason_tags ?? []);
  const [note, setNote] = useState(review?.note ?? '');

  // Enter = Save & next (Shift+Enter is a new line in the note). Buttons,
  // links and selects keep their own Enter.
  useEffect(() => {
    if (!canReview || !hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'INPUT') return;
      if (!verdict || saving) return;
      e.preventDefault();
      onSave({ verdict, reasonTags: tags, note });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canReview, hotkeys, verdict, tags, note, saving, onSave]);

  if (!canReview) {
    return (
      <Panel title="Verdict" style={{ border: `1px solid ${A.line}` }}>
        {review ? (
          <>
            <div><VerdictTag verdict={review.verdict} /></div>
            {(review.reason_tags ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(review.reason_tags ?? []).map((t) => <ChipTag key={t} chip={{ key: t, tone: 'grey', label: REASON_TAGS.find((r) => r.key === t)?.label ?? t }} />)}
              </div>
            )}
            {review.note && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{review.note}</p>}
            <div style={{ fontSize: 12, color: A.muted }}>Reviewed {fmtStamp(review.reviewed_at)}</div>
          </>
        ) : <div style={{ fontSize: 14, color: A.muted }}>Not reviewed yet.</div>}
        <div style={{ fontSize: 12, color: A.muted }}>View only — verdicts are entered by managers and leads.</div>
      </Panel>
    );
  }

  return (
    <Panel title="Your verdict" style={{ border: `2px solid ${A.blue}`, gap: 14 }}>
      <div role="group" aria-label="Verdict" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {VERDICTS.map((v) => {
          const t = VERDICT_TONE[v];
          const on = verdict === v;
          return (
            <button key={v} type="button" aria-pressed={on} onClick={() => setVerdict(v)}
              style={{ height: 48, borderRadius: 8, border: on ? `2px solid ${t.border}` : `1px solid ${A.control}`, background: on ? t.bg : A.card, font: `600 14px ${font}`, color: t.fg, cursor: 'pointer' }}>
              {t.glyph} {VERDICT_LABEL[v]}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: A.muted }}>Reason</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {REASON_TAGS.map((r) => {
            const on = tags.includes(r.key);
            return (
              <button key={r.key} type="button" aria-pressed={on}
                onClick={() => setTags((cur) => (cur.includes(r.key) ? cur.filter((k) => k !== r.key) : [...cur, r.key]))}
                style={{ height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? A.ink : A.control}`, background: on ? A.ink : A.card, color: on ? '#FFFFFF' : A.ink, font: `500 12px ${font}`, cursor: 'pointer' }}>
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      <label htmlFor="rv-note" style={{ fontSize: 12, fontWeight: 600, color: A.muted }}>Note to self / for the 1:1</label>
      <textarea id="rv-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: `1px solid ${A.control}`, font: `400 13px ${font}`, resize: 'vertical' }} />
      {error && <div role="alert" style={{ fontSize: 13, color: A.redDark }}>Not saved: {error}</div>}
      <button type="button" disabled={!verdict || saving} onClick={() => verdict && onSave({ verdict, reasonTags: tags, note })}
        style={{ ...primaryButtonStyle, height: 48, fontSize: 14, opacity: !verdict || saving ? 0.5 : 1, cursor: !verdict || saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : 'Save & next →'}
      </button>
      <div style={{ fontSize: 12, color: A.muted }}>
        {review ? `Saved ${fmtStamp(review.reviewed_at)} · saving again replaces it. ` : ''}Enter = Save &amp; next · Shift+Enter = new line
      </div>
    </Panel>
  );
}

// ---------- page ----------

export default function AuditReview() {
  const { week: weekParam, taskNo: taskParam } = useParams();
  const week = isWeekStart(weekParam) ? weekParam : null;
  const taskNo = taskParam ?? null;
  const access = useAuditAccess();
  const p = useAuditParams();
  const navigate = useNavigate();
  const queueQ = useAuditQueue(week, p.site);
  const cardQ = useAuditCard(week, taskNo);
  const save = useSaveReview();
  const [lightbox, setLightbox] = useState<number | null>(null);

  const all = useMemo(() => queueQ.data ?? [], [queueQ.data]);
  const list = useMemo(() => {
    const filtered = filterQueue(all, p.filter);
    return filtered.some((r) => r.task_no === taskNo) ? filtered : all;
  }, [all, p.filter, taskNo]);
  const idx = list.findIndex((r) => r.task_no === taskNo);
  const row = idx >= 0 ? list[idx] : null;

  const queueHref = `/audit${p.carry}${week ? `${p.carry ? '&' : '?'}week=${week}` : ''}`;
  const hrefOf = (r: QueueRow) => `/audit/${r.week_start}/${encodeURIComponent(r.task_no)}${p.carry}`;
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  const details = cardQ.data?.details ?? null;
  const photos = useMemo(() => photosOf(details), [details]);

  const onSave = (v: { verdict: Verdict; reasonTags: string[]; note: string }) => {
    if (!week || !taskNo) return;
    const after = nextOpen(list, taskNo); // decided on the list as it stood before this save
    save.mutate({ week, taskNo, ...v }, {
      onSuccess: () => navigate(after ? hrefOf(after) : queueHref),
    });
  };

  const crumb = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ fontSize: 13, color: A.muted }}>
        <Link to={queueHref} style={{ textDecoration: 'none', fontWeight: 500, color: A.blue }}>← Queue</Link>
        {idx >= 0 && <> &nbsp;·&nbsp; Review {idx + 1} of {list.length}</>}
        {week && <> &nbsp;·&nbsp; Week of {auditWeekLabel(week, p.site)}</>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={{ ...buttonStyle, opacity: prev ? 1 : 0.45 }} disabled={!prev} onClick={() => prev && navigate(hrefOf(prev))}>← Prev</button>
        <button type="button" style={{ ...buttonStyle, opacity: next ? 1 : 0.45 }} disabled={!next} onClick={() => next && navigate(hrefOf(next))}>Skip →</button>
      </div>
    </div>
  );

  if (!week || !taskNo) {
    return <AuditShell kicker="Section 05 · Review" title="PM Audit"><Notice tone="error">That address is not a review card. <Link to="/audit" style={{ color: A.blue }}>Back to the queue</Link>.</Notice></AuditShell>;
  }

  const f = row?.f ?? cardQ.data?.f ?? null;
  // A closed PM that was not queued can still be opened (a spot check): same
  // evidence, same verdict box, it just isn't part of the queue walk.
  const spot = !row && !!cardQ.data?.f;
  const cardRow: QueueRow | null = row ?? (cardQ.data?.f
    ? { task_no: taskNo, week_start: week, site_code: cardQ.data.f.site_code, reason: 'flagged', f: cardQ.data.f, flags: asFlagKeys(cardQ.data.f.flags), review: cardQ.data.review }
    : null);

  return (
    <AuditShell
      kicker={`Section 05 · Review${p.site === 'both' && cardRow ? ` · ${SITE_LABEL[cardRow.site_code as 'upark' | 'binney'] ?? cardRow.site_code}` : ''}`}
      title={f?.task_name ?? taskNo}
      subtitle={f ? [f.equipment, f.building_code, f.pm_type].filter(Boolean).join(' · ') : undefined}
    >
      {crumb}
      {queueQ.isLoading || cardQ.isLoading ? (
        <Notice>Loading {taskNo}…</Notice>
      ) : queueQ.isError || cardQ.isError ? (
        <Notice tone="error">Could not load this task: {((queueQ.error ?? cardQ.error) as Error).message}</Notice>
      ) : !cardRow ? (
        <Notice>No recurring PM {taskNo} was closed in the week of {auditWeekLabel(week, p.site)}. <Link to={queueHref} style={{ color: A.blue }}>Back to the queue</Link>.</Notice>
      ) : (
        <>
          <div style={{ ...cardStyle, padding: '18px 24px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: A.muted }}>{cardRow.task_no}</span>
              {rowChips(cardRow).map((c) => <ChipTag key={c.key} chip={c} />)}
              {spot && <ChipTag chip={{ key: 'spot', tone: 'grey', label: 'Spot check · not in the queue' }} />}
              {cardRow.review && <VerdictTag verdict={cardRow.review.verdict} />}
            </div>
            <dl style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
              {[
                ['Tech', f?.assigned_to_name ?? '—'],
                ['Closed', fmtClosed(f?.completed_on)],
              ].map(([k, v]) => (
                <div key={k}><dt style={{ ...labelStyle, fontSize: 11 }}>{k}</dt><dd style={{ margin: '3px 0 0', fontSize: 14, fontWeight: 600 }}>{v}</dd></div>
              ))}
              <div>
                <dt style={{ ...labelStyle, fontSize: 11 }}>Labor</dt>
                <dd style={{ margin: '3px 0 0', fontSize: 14, fontWeight: 600, color: cardRow.flags.includes('low_labor') ? A.red : undefined }}>
                  {fmtHours(f?.labor_hours)} <span style={{ color: A.muted, fontWeight: 400 }}>/ {fmtHours(f?.est_labor_hours)} h</span>
                </dd>
              </div>
              <div>
                <dt style={{ ...labelStyle, fontSize: 11 }}>Cove</dt>
                <dd style={{ margin: '3px 0 0', fontSize: 14, fontWeight: 600 }}>
                  <a href={coveTaskUrl(cardRow.site_code, details?.cove_task_id ?? f?.cove_task_id)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: A.blue }}>
                    {details?.cove_task_id ?? f?.cove_task_id ? 'Open task ↗' : 'Open PM list ↗'}
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <PhotosPanel row={cardRow} details={details} onOpen={setLightbox} />
              <ChecklistPanel row={cardRow} details={details} />
              <TimelinePanel details={details} />
            </div>
            <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <NotesPanel row={cardRow} details={details} />
              <Panel title={<>Prior notes on this equipment</>}>
                {(cardQ.data?.prior ?? []).length === 0 ? (
                  <div style={{ fontSize: 13, color: A.muted }}>{details ? 'No earlier PM on this equipment has details loaded.' : 'Not pulled from Cove yet.'}</div>
                ) : (
                  <div style={{ fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(cardQ.data?.prior ?? []).map((n) => (
                      <div key={n.task_no}>
                        <div style={{ color: A.muted, fontSize: 12 }}>{fmtDay(n.completed_at, f?.completed_on)} · {shortName(n.completed_by ?? n.assignee_name)} · {n.task_no}</div>
                        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: n.close_note ? undefined : A.muted }}>{n.close_note ?? 'no note'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <VerdictBox
                key={`${week}/${taskNo}/${cardRow.review?.reviewed_at ?? 'new'}`}
                review={cardRow.review}
                canReview={access.canReview}
                saving={save.isPending}
                error={save.isError ? (save.error as Error).message : null}
                hotkeys={lightbox === null}
                onSave={onSave}
              />
            </div>
          </div>
        </>
      )}
      {lightbox !== null && photos.length > 0 && (
        <Lightbox photos={photos} index={Math.min(lightbox, photos.length - 1)} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </AuditShell>
  );
}
