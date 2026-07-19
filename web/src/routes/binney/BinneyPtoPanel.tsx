// Binney St PTO coverage — duplicated from web/src/components/PtoPanel.tsx
// (§12) per the isolate-new-features rule: UPark's panel and hooks stay
// untouched. Only the imports below differ — PTO + roster data come from the
// Binney-scoped hooks; shifts/on-call/overtime/building hooks are shared
// read-only (their data is user-keyed, so Binney users simply have none).
//
// Manager-side: submit PTO on behalf of any engineer, approve/deny pending
// requests, see who's out today / upcoming, monitor balances, enforce the
// 2-engineer vacation cap. Engineer self-serve comes in Phase 12b.
//
// Cap rule: at most 2 engineers on vacation any given day. Sick has no cap.
// Cap can be overridden by manager at submit OR approve time (logged with
// reason for audit).
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  usePtoRequests, usePtoSummary, usePtoBuckets, usePtoRealtime,
  useSubmitPto, useReviewPto, useCancelPto, useUpdatePto, useDeletePto, useUpdatePtoBalance,
  checkVacationCap, ptoTypeLabel,
  PTO_MANAGER_TYPE_OPTIONS, PTO_OTHER_LEAVE_TYPES,
  PTO_REQUEST_SOURCE_LABELS, PTO_MANAGER_SOURCE_OPTIONS,
  isPartialDay, partialDayLabel,
  type PtoRequest, type PtoSummary, type PtoType, type PtoStatus, type CapConflict,
  type PtoRequestSource,
} from './hooks/useBinneyPto';
import { useEngineerPtoDailyHours, SICK_ACCRUAL } from '../../hooks/usePto';
import { useEngineers, type EngineerRow } from './hooks/useBinneyEngineers';
import { BMR_HOLIDAYS } from './bmrHolidays';
import { useShifts } from '../../hooks/useShifts';
import {
  useOncallParticipants, useOncallSettings,
  addDaysIso, fmtMd as fmtMdOnc,
} from '../../hooks/useOncall';
import { useOvertimePosts, type OvertimePost } from '../../hooks/useOvertime';
import { useCurrentBuildingAssignments, type BuildingAssignment } from '../../hooks/useBuildingAssignments';
import { useBuildings, type Building } from '../../hooks/useBuildings';
import { Section } from '../../components/Section';
import { PtoCalRecipientsEditor } from '../../components/PtoCalRecipientsEditor';

// ───────────────────────────── helpers

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

function fmtMd(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtRange(starts: string, ends: string): string {
  return starts === ends ? fmtMd(starts) : `${fmtMd(starts)} – ${fmtMd(ends)}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000,
  ) + 1;
}

// Each PTO type maps to an accent color used across the panel (out-today
// chips, upcoming-row left border, heatmap intensity). Kept here so any
// future component can import a single source of truth.
export const PTO_TYPE_COLOR: Record<PtoType, string> = {
  vacation:    '#3b82f6',   // blue
  sick:        '#ef4444',   // red
  personal:    '#14b8a6',   // teal
  bereavement: '#a855f7',   // purple
  holiday:     '#10b981',   // green
  unpaid:      '#64748b',   // slate
  leave:       '#f59e0b',   // amber
  short_term:  '#ec4899',   // pink
  jury_duty:   '#6366f1',   // indigo
};
const PTO_TYPE_BG: Record<PtoType, string> = {
  vacation:    'rgba(59,130,246,0.06)',
  sick:        'rgba(239,68,68,0.05)',
  personal:    'rgba(20,184,166,0.05)',
  bereavement: 'rgba(168,85,247,0.05)',
  holiday:     'rgba(16,185,129,0.05)',
  unpaid:      'rgba(100,116,139,0.05)',
  leave:       'rgba(245,158,11,0.06)',
  short_term:  'rgba(236,72,153,0.06)',
  jury_duty:   'rgba(99,102,241,0.06)',
};

/** <option>s for a PTO type <select>, in the given display order. If `ensure`
 *  is a type not already in the list (e.g. a legacy 'unpaid'/'personal' row
 *  being edited), it's prepended so the select can still display it. */
function PtoTypeOptions({ options, ensure }: { options: PtoType[]; ensure?: PtoType }) {
  const list = ensure && !options.includes(ensure) ? [ensure, ...options] : options;
  return (
    <>
      {list.map((t) => (
        <option key={t} value={t}>{ptoTypeLabel(t)}</option>
      ))}
    </>
  );
}

// ── Conflict detection: surface approved PTO that overlaps an on-call
// week, an OT signup, or covers a primary-building assignment so the
// manager knows what to backfill.

type Conflict = {
  pto: PtoRequest;
  kind: 'oncall' | 'overtime' | 'primary_building';
  severity: 'high' | 'medium';
  detail: string;
};

function rangeOverlaps(a1: string, a2: string, b1: string, b2: string): boolean {
  return a1 <= b2 && a2 >= b1;
}

function computeConflicts(
  approved: PtoRequest[],
  oncallWeeks: { user_id: string; week_start: string; week_end: string }[],
  otSignups: { user_id: string; post: OvertimePost }[],
  primaryByUser: Map<string, Building[]>,
): Conflict[] {
  const out: Conflict[] = [];
  for (const p of approved) {
    // On-call conflict — engineer scheduled on call during their PTO.
    for (const w of oncallWeeks) {
      if (w.user_id !== p.user_id) continue;
      if (!rangeOverlaps(p.starts_on, p.ends_on, w.week_start, w.week_end)) continue;
      out.push({
        pto: p,
        kind: 'oncall',
        severity: 'high',
        detail: `On call week of ${fmtMdOnc(w.week_start)}–${fmtMdOnc(w.week_end)}`,
      });
    }
    // OT signup conflict.
    for (const s of otSignups) {
      if (s.user_id !== p.user_id) continue;
      const otDay = (s.post.starts_at ?? '').slice(0, 10);
      if (!otDay) continue;
      if (otDay >= p.starts_on && otDay <= p.ends_on) {
        out.push({
          pto: p,
          kind: 'overtime',
          severity: 'high',
          detail: `OT signup ${otDay}${s.post.scope ? ' — ' + s.post.scope : ''}`,
        });
      }
    }
    // Primary buildings — softer; coverage handled by lead in practice but
    // worth surfacing once per engineer per PTO.
    const prims = primaryByUser.get(p.user_id);
    if (prims && prims.length > 0) {
      out.push({
        pto: p,
        kind: 'primary_building',
        severity: 'medium',
        detail: `Primary on ${prims.map((b) => b.short_code ?? b.code).join(', ')} — assign coverage`,
      });
    }
  }
  return out;
}

/** Split upcoming-approved into chrono buckets so the manager doesn't have
 *  to scan a flat list. "This week" = starts on or before next Sunday. */
function groupUpcoming(rows: PtoRequest[], todayStr: string): {
  thisWeek: PtoRequest[];
  thisMonth: PtoRequest[];
  later: PtoRequest[];
} {
  const today = new Date(todayStr + 'T00:00:00');
  const endOfWeek = new Date(today);
  // Days remaining until Sunday (0=Sun ... 6=Sat). 0 means today is Sun → 0 more days.
  endOfWeek.setDate(today.getDate() + ((7 - today.getDay()) % 7));
  const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
  // Last day of the current calendar month.
  const eom = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const eomStr = eom.toISOString().slice(0, 10);

  const thisWeek:  PtoRequest[] = [];
  const thisMonth: PtoRequest[] = [];
  const later:     PtoRequest[] = [];
  for (const r of rows) {
    if (r.starts_on <= endOfWeekStr)  thisWeek.push(r);
    else if (r.starts_on <= eomStr)   thisMonth.push(r);
    else                              later.push(r);
  }
  return { thisWeek, thisMonth, later };
}

// ───────────────────────────── component

export function BinneyPtoPanel() {
  usePtoRealtime();
  const requestsQ      = usePtoRequests();
  const summaryQ       = usePtoSummary();
  const engineersQ     = useEngineers();
  const shiftsQ        = useShifts();
  const buckets        = usePtoBuckets();
  // Read-only — no realtime subs here. The respective panels on this page
  // (OvertimePanel, OncallBadge, etc.) already subscribe to these tables
  // and invalidate the shared react-query keys.
  const participantsQ  = useOncallParticipants();
  const settingsQ      = useOncallSettings();
  const otPostsQ       = useOvertimePosts();
  const assignmentsQ   = useCurrentBuildingAssignments();
  const buildingsQ     = useBuildings();

  // Crew per engineer (from shifts.crew) — powers the balances crew split
  // below; the roll and the User Profiles filter read the same column.
  const crewByUserId = useMemo(() => {
    const byShift = new Map((shiftsQ.data ?? []).map((s) => [s.id, (s.crew ?? null) as Crew]));
    const m = new Map<string, Crew | undefined>();
    for (const e of engineersQ.data ?? []) {
      m.set(e.user_id, e.shift_id ? byShift.get(e.shift_id) : undefined);
    }
    return m;
  }, [engineersQ.data, shiftsQ.data]);

  // Pre-compute on-call weeks for everyone in the rotation horizon.
  const oncallWeeks = useMemo(() => {
    const startFriday = settingsQ.data?.start_friday;
    const parts = participantsQ.data ?? [];
    if (!startFriday || parts.length === 0) return [];
    const N = parts.length;
    const cycles = settingsQ.data?.rotations_per_engineer ?? 4;
    const out: { user_id: string; week_start: string; week_end: string }[] = [];
    for (let c = 0; c <= cycles + 1; c++) {
      for (let i = 0; i < N; i++) {
        const ws = addDaysIso(startFriday, (c * N + i) * 7);
        out.push({ user_id: parts[i].user_id, week_start: ws, week_end: addDaysIso(ws, 6) });
      }
    }
    return out;
  }, [participantsQ.data, settingsQ.data]);

  const otSignups = useMemo(() => {
    const out: { user_id: string; post: OvertimePost }[] = [];
    for (const post of otPostsQ.data ?? []) {
      if (post.status !== 'open') continue;
      for (const s of post.signups ?? []) out.push({ user_id: s.user_id, post });
    }
    return out;
  }, [otPostsQ.data]);

  const primaryByUser = useMemo(() => {
    const bldById = new Map((buildingsQ.data ?? []).map((b) => [b.id, b]));
    const m = new Map<string, Building[]>();
    for (const a of (assignmentsQ.data ?? []) as BuildingAssignment[]) {
      if (a.role_in_building !== 'primary') continue;
      const b = bldById.get(a.building_id);
      if (!b) continue;
      const cur = m.get(a.user_id) ?? [];
      cur.push(b);
      m.set(a.user_id, cur);
    }
    return m;
  }, [assignmentsQ.data, buildingsQ.data]);

  const conflicts = useMemo(
    () => computeConflicts(buckets.upcoming, oncallWeeks, otSignups, primaryByUser),
    [buckets.upcoming, oncallWeeks, otSignups, primaryByUser],
  );

  const [showAdd, setShowAdd]               = useState(false);
  const [addPresetDate, setAddPresetDate]   = useState<string | null>(null);
  const [showEditBalance, setShowEditBalance] = useState<PtoSummary | null>(null);
  const [editingRequest, setEditingRequest]   = useState<PtoRequest | null>(null);

  const review     = useReviewPto();
  const cancel     = useCancelPto();
  const delPto     = useDeletePto();

  const subtitle = (
    <span className="t-small t-muted">
      <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{buckets.pending.length}</span> pending
      {' · '}
      <span style={{ color: buckets.outToday.length > 0 ? 'var(--color-warn, #d97706)' : 'var(--color-text)' }}>
        {buckets.outToday.length} out today
      </span>
      {' · '}
      {buckets.upcoming.length} upcoming
      {conflicts.length > 0 && (
        <>
          {' · '}
          <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}
          </span>
        </>
      )}
      <button
        onClick={() => setShowAdd(true)}
        className="ml-3 t-accent hover:underline"
        style={{ fontWeight: 600 }}
      >
        + Add PTO
      </button>
    </span>
  );

  return (
    <Section collapsible title="§12 PTO & Staffing — Binney St" subtitle={subtitle} loading={requestsQ.isLoading}>
      {requestsQ.error ? (
        <p className="t-text t-danger">Error: {(requestsQ.error as Error).message}</p>
      ) : (
        <div className="space-y-4">
          {/* Pending approvals */}
          <PendingQueue
            pending={buckets.pending}
            all={buckets.all}
            summaries={summaryQ.data ?? []}
            onApprove={(id, opts) => review.mutate({ id, decision: 'approved', ...opts })}
            onDeny={(id, note)    => review.mutate({ id, decision: 'denied', review_note: note })}
          />

          {/* Conflict alerts — approved PTO vs on-call/OT/primary building */}
          {conflicts.length > 0 && (
            <div>
              <div className="t-small uppercase tracking-wider mb-2" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                Conflicts ({conflicts.length}) — assign coverage
              </div>
              <ul className="space-y-1">
                {conflicts.map((c, i) => (
                  <li
                    key={`${c.pto.id}-${c.kind}-${i}`}
                    className="t-small"
                    style={{
                      padding: '0.3rem 0.6rem',
                      borderLeft: `3px solid ${c.severity === 'high' ? 'var(--color-danger)' : '#d97706'}`,
                      background: c.severity === 'high' ? 'rgba(220,38,38,0.06)' : 'rgba(217,119,6,0.05)',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ marginRight: 6 }}>{c.severity === 'high' ? '🔴' : '🟡'}</span>
                    <strong>{c.pto.user_full_name ?? '?'}</strong>
                    <span className="t-muted"> · PTO {fmtRange(c.pto.starts_on, c.pto.ends_on)} · </span>
                    {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Coverage section: rotated heatmap (weeks as rows, Mon–Sun
              across the top) on the left, 7-day attendance roll beside it.
              StaffingForecast (staffing vs labor model) is PARKED — still
              defined below, removed from the layout 2026-07-17 at the
              user's request; likely to return. */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* Pinned to the grid's width (34 labels + 4 gap + 7×40 cells +
                18 gaps = 336) — otherwise the title/legend rows set the
                flex-basis and starve the roll beside it. */}
            <div style={{ flex: '0 0 336px', width: 336 }}>
              <CapHeatmap
                requests={buckets.all}
                onPickDate={(iso) => { setAddPresetDate(iso); setShowAdd(true); }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TodayAttendance
                engineers={engineersQ.data ?? []}
                shifts={shiftsQ.data ?? []}
                allApproved={buckets.all.filter((r) => r.status === 'approved')}
              />
            </div>
          </div>

          {/* Upcoming approved + balances share one band: list on the left,
              balances grid filling the rest. Either side alone goes full
              width; on narrow viewports they wrap to stacked. */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* 380px basis leaves the balances grid ≥ ~950px inside the
                1600px container, enough for its two half-tables to sit
                side by side instead of stacking. */}
            {buckets.upcoming.length > 0 && (
              <div style={{ flex: '0 1 380px', minWidth: 300 }}>
                <UpcomingGroupedList
                  rows={buckets.upcoming.filter((r) => r.ends_on >= todayIso())}
                  onCancel={(id) => {
                    if (confirm('Cancel this approved PTO?')) cancel.mutate(id);
                  }}
                  onEdit={(r) => setEditingRequest(r)}
                  onDelete={(id) => {
                    if (confirm('Delete this PTO entry? This removes it from history — use Cancel instead if you want to keep an audit record.')) delPto.mutate(id);
                  }}
                />
              </div>
            )}
            {/* Balances — rendered even with zero pto_balances rows: the grid
                synthesizes "not set" placeholder rows per engineer, which is
                the entry path for seeding allotments. */}
            {(engineersQ.data ?? []).length > 0 && (
              <div style={{ flex: '1 1 640px', minWidth: 0 }}>
                <BalancesGrid
                  summaries={summaryQ.data ?? []}
                  allRequests={buckets.all}
                  engineers={engineersQ.data ?? []}
                  crewByUser={crewByUserId}
                  onEdit={(s) => setShowEditBalance(s)}
                  onEditRequest={(r) => setEditingRequest(r)}
                  onDeleteRequest={(id) => {
                    if (confirm('Delete this PTO entry? This removes it from history — use Cancel instead if you want to keep an audit record.')) delPto.mutate(id);
                  }}
                />
              </div>
            )}
          </div>

          {/* Calendar-invite recipient list (manager-editable) */}
          <PtoCalRecipientsEditor siteCode="binney" />
        </div>
      )}

      {showAdd && (
        <AddPtoModal
          engineers={engineersQ.data ?? []}
          allRequests={buckets.all}
          presetDate={addPresetDate}
          onClose={() => { setShowAdd(false); setAddPresetDate(null); }}
        />
      )}
      {showEditBalance && (
        <EditBalanceModal
          summary={showEditBalance}
          onClose={() => setShowEditBalance(null)}
        />
      )}
      {editingRequest && (
        <EditPtoModal
          request={editingRequest}
          onClose={() => setEditingRequest(null)}
        />
      )}
    </Section>
  );
}

// ───────────────────────────── Pending approval queue

function PendingQueue({
  pending, all, summaries, onApprove, onDeny,
}: {
  pending: PtoRequest[];
  all: PtoRequest[];
  summaries: PtoSummary[];
  onApprove: (id: string, opts: { cap_override?: boolean; cap_override_reason?: string }) => void;
  onDeny: (id: string, note: string | null) => void;
}) {
  if (pending.length === 0) {
    return (
      <div>
        <div className="t-small t-muted uppercase tracking-wider mb-2">Pending approval</div>
        <p className="t-small t-muted italic">No pending requests.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">
        Pending approval <span className="ml-1">({pending.length})</span>
      </div>
      <ul className="space-y-2">
        {pending.map((r) => (
          <PendingRow
            key={r.id}
            req={r}
            allRequests={all}
            summaries={summaries}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </ul>
    </div>
  );
}

/** One-line balance context on a pending card: hours left now → what
 *  approval would leave, red when it would overdraw. Only the three tracked
 *  balance types; other leave kinds have no allotment to check. */
function BalanceHint({ req, summaries }: { req: PtoRequest; summaries: PtoSummary[] }) {
  if (req.type !== 'vacation' && req.type !== 'sick' && req.type !== 'holiday') return null;
  const s = summaries.find((x) => x.user_id === req.user_id);
  if (!s) {
    return (
      <p className="t-small t-muted mt-1 italic">
        No balance set for this engineer this year — set the allotment in Balances below.
      </p>
    );
  }
  const remaining = Number(
    req.type === 'vacation' ? s.vacation_remaining :
    req.type === 'sick'     ? s.sick_remaining     : s.holiday_remaining,
  );
  const alloted = Number(
    req.type === 'vacation' ? s.vacation_alloted :
    req.type === 'sick'     ? s.sick_alloted     : s.holiday_alloted,
  );
  const after = remaining - Number(req.hours);
  return (
    <p className="t-small mt-1" style={{ color: after < 0 ? 'var(--color-danger)' : undefined }}>
      <span className="t-muted">{ptoTypeLabel(req.type)} balance:</span>{' '}
      <strong>{remaining}h</strong> of {alloted}h left
      <span className="t-muted"> → </span>
      <strong>{after}h</strong> after approval
      {after < 0 && <strong> — exceeds balance</strong>}
    </p>
  );
}

function PendingRow({
  req, allRequests, summaries, onApprove, onDeny,
}: {
  req: PtoRequest;
  allRequests: PtoRequest[];
  summaries: PtoSummary[];
  onApprove: (id: string, opts: { cap_override?: boolean; cap_override_reason?: string }) => void;
  onDeny: (id: string, note: string | null) => void;
}) {
  const cap = req.type === 'vacation'
    ? checkVacationCap(allRequests, req.user_id, req.starts_on, req.ends_on)
    : { exceeded: false, conflicts: [] as CapConflict[] };

  return (
    <li
      className="t-card"
      style={{
        padding: '0.5rem 0.75rem',
        borderLeft: `3px solid ${cap.exceeded ? 'var(--color-danger)' : 'var(--color-warn, #d97706)'}`,
      }}
    >
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="t-text">
          <strong>{req.user_full_name ?? '?'}</strong>
          <span className="t-muted"> · {ptoTypeLabel(req.type)}</span>
          <span className="t-muted"> · {fmtRange(req.starts_on, req.ends_on)} ({req.days}d / {req.hours}h)</span>
        </div>
        <div className="t-small t-muted">
          submitted {new Date(req.submitted_at).toLocaleDateString()}
          {req.submitted_by_name && req.submitted_by_name !== req.user_full_name &&
            <> by {req.submitted_by_name}</>}
        </div>
      </div>
      {req.reason && <p className="t-small t-muted mt-1">{req.reason}</p>}

      <BalanceHint req={req} summaries={summaries} />

      {cap.exceeded && (
        <div
          className="t-small mt-1 px-2 py-1 rounded"
          style={{ background: 'rgba(220,38,38,0.10)', color: 'var(--color-danger)' }}
        >
          <strong>2-engineer cap exceeded.</strong> Already approved/pending for these dates:{' '}
          {cap.conflicts.map((c) => c.user_full_name ?? '?').join(', ')}.
          Approving requires override.
        </div>
      )}
      {!cap.exceeded && cap.conflicts.length > 0 && (
        <p className="t-small t-muted mt-1">
          Note: {cap.conflicts.map((c) => c.user_full_name).join(', ')} also off these dates (within cap).
        </p>
      )}

      <ApprovalControls
        req={req}
        capExceeded={cap.exceeded}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    </li>
  );
}

function ApprovalControls({
  req, capExceeded, onApprove, onDeny,
}: {
  req: PtoRequest;
  capExceeded: boolean;
  onApprove: (id: string, opts: { cap_override?: boolean; cap_override_reason?: string }) => void;
  onDeny: (id: string, note: string | null) => void;
}) {
  const [denyMode, setDenyMode]               = useState(false);
  const [denyNote, setDenyNote]               = useState('');
  const [overrideMode, setOverrideMode]       = useState(false);
  const [overrideReason, setOverrideReason]   = useState('');

  if (denyMode) {
    return (
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={denyNote}
          onChange={(e) => setDenyNote(e.target.value)}
          placeholder="Reason for denial — required, sent to engineer"
          className="flex-1 border rounded px-2 py-1 t-small"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 200 }}
        />
        <button
          onClick={() => onDeny(req.id, denyNote.trim())}
          disabled={!denyNote.trim()}
          title={denyNote.trim() ? undefined : 'A denial reason is required'}
          className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-danger)' }}
        >Confirm deny</button>
        <button onClick={() => { setDenyMode(false); setDenyNote(''); }} className="t-small">Cancel</button>
      </div>
    );
  }

  if (overrideMode) {
    return (
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          placeholder="Why override the 2-engineer cap? (logged for audit)"
          className="flex-1 border rounded px-2 py-1 t-small"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 280 }}
          autoFocus
        />
        <button
          onClick={() => onApprove(req.id, { cap_override: true, cap_override_reason: overrideReason.trim() || 'no reason' })}
          disabled={!overrideReason.trim()}
          className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--color-danger)' }}
        >Approve with override</button>
        <button onClick={() => { setOverrideMode(false); setOverrideReason(''); }} className="t-small">Cancel</button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      {capExceeded ? (
        <button
          onClick={() => setOverrideMode(true)}
          className="t-small px-3 py-1 rounded font-medium text-white"
          style={{ background: '#ea580c' }}
        >Approve (override cap)</button>
      ) : (
        <button
          onClick={() => onApprove(req.id, {})}
          className="t-small px-3 py-1 rounded font-medium text-white"
          style={{ background: 'var(--color-ok, #10b981)' }}
        >Approve</button>
      )}
      <button
        onClick={() => setDenyMode(true)}
        className="t-small px-3 py-1 rounded border"
        style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
      >Deny</button>
    </div>
  );
}

// ───────────────────────────── Upcoming approved

type UpcomingActions = {
  onCancel: (id: string) => void;
  onEdit:   (r: PtoRequest) => void;
  onDelete: (id: string) => void;
};

function UpcomingGroupedList({ rows, ...actions }: { rows: PtoRequest[] } & UpcomingActions) {
  const groups = useMemo(() => groupUpcoming(rows, todayIso()), [rows]);
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">Upcoming approved</div>
      <div className="space-y-3">
        {groups.thisWeek.length > 0  && <UpcomingBucket label="This week"  rows={groups.thisWeek}  {...actions} />}
        {groups.thisMonth.length > 0 && <UpcomingBucket label="This month" rows={groups.thisMonth} {...actions} />}
        {groups.later.length > 0     && <UpcomingBucket label="Later"      rows={groups.later}     {...actions} />}
      </div>
    </div>
  );
}

function UpcomingBucket({ label, rows, onCancel, onEdit, onDelete }: { label: string; rows: PtoRequest[] } & UpcomingActions) {
  return (
    <div>
      <div className="t-small font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
        {label} <span className="t-muted ml-1">({rows.length})</span>
      </div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.id}
            className="t-small flex items-baseline gap-2 flex-wrap"
            style={{
              padding: '0.3rem 0.6rem',
              borderLeft: `3px solid ${PTO_TYPE_COLOR[r.type]}`,
              background: PTO_TYPE_BG[r.type],
              borderRadius: 4,
            }}
          >
            <strong style={{ minWidth: 130 }}>{r.user_full_name ?? '?'}</strong>
            <span className="t-muted" style={{ minWidth: 70 }}>{ptoTypeLabel(r.type)}</span>
            <span className="t-mono">{fmtRange(r.starts_on, r.ends_on)} <span className="t-muted">({r.days}d · {r.hours}h)</span></span>
            {r.reason && <span className="t-muted">· {r.reason}</span>}
            {r.cap_override && (
              <span
                className="px-1 py-0.5 rounded"
                style={{ background: 'rgba(234,88,12,0.15)', color: '#c2410c', fontSize: 9, fontWeight: 600 }}
                title={`Cap override: ${r.cap_override_reason ?? ''}`}
              >OVERRIDE</span>
            )}
            <span className="ml-auto" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={() => onEdit(r)}
                className="t-muted hover:t-accent"
                title="Edit"
                style={{ fontSize: 12, lineHeight: 1 }}
              >✎</button>
              <button
                onClick={() => onCancel(r.id)}
                className="t-muted hover:t-danger"
                title="Cancel (keeps audit row)"
                style={{ fontSize: 14, lineHeight: 1 }}
              >×</button>
              <button
                onClick={() => onDelete(r.id)}
                className="t-muted hover:t-danger"
                title="Delete (hard-remove)"
                style={{ fontSize: 12, lineHeight: 1 }}
              >🗑</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────────── Today attendance (interactive roll)

/** Compute today + next N calendar days. Binney runs 4×10 with two crews
 *  covering all 7 days, so — unlike UPark's Mon–Fri panel — weekends are
 *  real workdays and are never skipped. */
function computeWorkDays(extra: number): { iso: string; label: string; isToday: boolean }[] {
  const fmt = (d: Date): string => d.toLocaleDateString('en-CA');
  const labelOf = (d: Date) => {
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
    return `${dow} ${d.getMonth() + 1}/${d.getDate()}`;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [{ iso: fmt(today), label: labelOf(today), isToday: true }];
  const cursor = new Date(today);
  while (out.length < 1 + extra) {
    cursor.setDate(cursor.getDate() + 1);
    out.push({ iso: fmt(cursor), label: labelOf(cursor), isToday: false });
  }
  return out;
}

/** Binney crew calendar, keyed off shifts.crew (the single source of truth
 *  shared with the balances split and the User Profiles crew filter):
 *    'sunday'   crew works Sun(0) Mon(1) Tue(2) Wed(3)   — Sun–Wed shifts
 *    'saturday' crew works Wed(3) Thu(4) Fri(5) Sat(6)   — Wed–Sat shifts
 *    null       = a Mon–Fri day shift (works Mon–Fri)
 *    undefined  = no shift assigned → scheduled every day, so unassigned
 *                 techs stay visible in the roll instead of vanishing. */
type Crew = 'saturday' | 'sunday' | null;
function crewWorksOn(crew: Crew | undefined, iso: string): boolean {
  if (crew === undefined) return true;
  const dow = new Date(iso + 'T00:00:00').getDay(); // 0=Sun .. 6=Sat
  if (crew === 'sunday') return dow <= 3;
  if (crew === 'saturday') return dow >= 3;
  return dow >= 1 && dow <= 5; // Mon–Fri day shift
}

function TodayAttendance({
  engineers, shifts, allApproved,
}: {
  engineers: EngineerRow[];
  shifts: { id: string; name: string; sort_order: number; crew?: Crew }[];
  allApproved: PtoRequest[];
}) {
  const submit = useSubmitPto();

  // 7 date columns: today + the next 6 calendar days — a full week, so both
  // crew rotations (Sun–Wed and Wed–Sat) appear in their entirety.
  const days = useMemo(() => computeWorkDays(6), []);

  // Lookup: `${user_id}|${iso}` → PTO record covering that day (approved only).
  const ptoByUserDay = useMemo(() => {
    const m = new Map<string, PtoRequest>();
    for (const r of allApproved) {
      for (const d of days) {
        if (d.iso >= r.starts_on && d.iso <= r.ends_on) {
          m.set(`${r.user_id}|${d.iso}`, r);
        }
      }
    }
    return m;
  }, [allApproved, days]);

  // Group active engineers by shift in sort_order; engineers without a
  // shift go to a trailing "Other" bucket.
  const groups = useMemo(() => {
    const orderedShifts = shifts.slice().sort((a, b) => a.sort_order - b.sort_order);
    const byShift = new Map<string, EngineerRow[]>();
    const noShift: EngineerRow[] = [];
    for (const e of engineers) {
      if (!e.active || e.role !== 'engineer') continue;
      if (e.shift_id) {
        const cur = byShift.get(e.shift_id) ?? [];
        cur.push(e);
        byShift.set(e.shift_id, cur);
      } else {
        noShift.push(e);
      }
    }
    const out = orderedShifts.map((s) => ({
      shift_id: s.id,
      label: s.name,
      crew: (s.crew ?? null) as Crew | undefined,
      engineers: (byShift.get(s.id) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    })).filter((g) => g.engineers.length > 0);
    if (noShift.length > 0) {
      out.push({
        shift_id: '_noshift',
        label: 'No shift',
        crew: undefined,   // unassigned → shown every day
        engineers: noShift.sort((a, b) => a.full_name.localeCompare(b.full_name)),
      });
    }
    return out;
  }, [engineers, shifts]);

  // Rolling counts across the 7-day horizon for the header. Partial-day
  // engineers are counted as "in" (they're around for part of the day) but
  // get a separate "partial" tally so the manager sees them at a glance.
  // Binney: the in/total denominators count only engineers whose CREW works
  // that day (Sun–Wed vs Wed–Sat vs Mon–Fri), so the Sunday crew doesn't
  // read as "out" on a Friday.
  const crewByShiftId = useMemo(
    () => new Map(shifts.map((s) => [s.id, (s.crew ?? null) as Crew])),
    [shifts],
  );
  const counts = useMemo(() => {
    return days.map((d) => {
      let fullOut = 0;
      let partial = 0;
      let scheduled = 0;
      for (const e of engineers) {
        if (!e.active || e.role !== 'engineer') continue;
        if (!crewWorksOn(e.shift_id ? crewByShiftId.get(e.shift_id) : undefined, d.iso)) continue;
        scheduled++;
        const p = ptoByUserDay.get(`${e.user_id}|${d.iso}`);
        if (!p) continue;
        if (isPartialDay(p)) partial++;
        else fullOut++;
      }
      return {
        iso: d.iso,
        out: fullOut,
        partial,
        in: scheduled - fullOut,
        total: scheduled,
      };
    });
  }, [days, engineers, ptoByUserDay, crewByShiftId]);

  // Clicking an empty DayChip opens a QuickPtoModal pre-filled for that
  // (engineer, date) so the manager can pick a type (defaults to sick),
  // optionally narrow to a partial-day time window, and pick a source.
  const [logTarget, setLogTarget] = useState<{
    engineer: EngineerRow; dateIso: string; dayLabel: string;
  } | null>(null);
  const onLogClick = (eng: EngineerRow, dateIso: string, dayLabel: string) => {
    setLogTarget({ engineer: eng, dateIso, dayLabel });
  };

  // 7 columns: today (wider, featured) + 6 preview days. Shares its section
  // row with the rotated heatmap (pinned at 336px), so the minimums are
  // tight: 220 + 6×135 + 60 gaps = 1090px, which fits unscrolled beside the
  // heatmap inside the 1600px page container on a 1536px laptop and up.
  // Smaller windows scroll horizontally instead of squeezing — PC is the
  // primary target, phone is backup.
  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1.5fr) repeat(6, minmax(135px, 1fr))',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        {days.map((d, i) => (
          <DayAttendanceGroup
            key={d.iso}
            day={d}
            counts={counts[i]}
            shiftGroups={groups}
            ptoLookup={ptoByUserDay}
            disabled={submit.isPending}
            onLogClick={onLogClick}
            isPrimary={i === 0}
          />
        ))}
      </div>
      {logTarget && (
        <QuickPtoModal
          engineer={logTarget.engineer}
          dateIso={logTarget.dateIso}
          dayLabel={logTarget.dayLabel}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  );
}

/** One day's attendance roll — matches the original single-day chip design,
 *  rendered once per day in the 7-column row. Today's column is wider and
 *  gets a slightly larger font + accent treatment so the eye lands there
 *  first. */
function DayAttendanceGroup({
  day, counts, shiftGroups, ptoLookup, disabled, onLogClick, isPrimary,
}: {
  day: { iso: string; label: string; isToday: boolean };
  counts: { in: number; out: number; partial: number; total: number };
  shiftGroups: { shift_id: string; label: string; crew: Crew | undefined; engineers: EngineerRow[] }[];
  ptoLookup: Map<string, PtoRequest>;
  disabled: boolean;
  onLogClick: (eng: EngineerRow, iso: string, label: string) => void;
  isPrimary: boolean;
}) {
  // Today's chips & labels are full size; the secondary columns drop a step
  // down so they read as "preview" without losing legibility.
  const headerSize = isPrimary ? '0.85rem' : '0.78rem';

  // Capped cards ("capped + expand" UX): Wednesday lists BOTH crews (~2× the
  // chips of other days), which would balloon that card and wreck the row.
  // Over-cap cards collapse behind a "+N more" toggle. Engineers who are
  // out/partial are ALWAYS kept visible — the cap only hides healthy "in"
  // chips, so collapsed cards never mask an absence. The remaining in-chip
  // budget is dealt round-robin across the crew groups so no crew renders as
  // a bare label and the visible sample isn't biased to the first crew; each
  // group shows a muted "+n" for its own hidden share.
  const CHIP_CAP = isPrimary ? 14 : 10;
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = shiftGroups.filter((g) => crewWorksOn(g.crew, day.iso));
  const allEngineers  = visibleGroups.flatMap((g) => g.engineers);
  const overCap = allEngineers.length > CHIP_CAP;
  let shownIds: Set<string> | null = null;   // null = show everyone
  if (overCap && !expanded) {
    const ids = new Set<string>();
    for (const e of allEngineers) {
      if (ptoLookup.get(`${e.user_id}|${day.iso}`)) ids.add(e.user_id);
    }
    // In-chip budget: at least one per group (so every crew keeps a face)
    // and at least a few overall so a bad day still reads as staffed.
    let budget = Math.max(CHIP_CAP - ids.size, visibleGroups.length, 4);
    const queues = visibleGroups.map((g) => g.engineers.filter((e) => !ids.has(e.user_id)));
    let dealt = true;
    while (budget > 0 && dealt) {
      dealt = false;
      for (const q of queues) {
        if (budget <= 0) break;
        const e = q.shift();
        if (e) { ids.add(e.user_id); budget--; dealt = true; }
      }
    }
    // If the cap wouldn't actually hide anyone (e.g. most of the card is
    // out-chips), fall back to show-all so no "+0 more" ghost renders.
    shownIds = ids.size >= allEngineers.length ? null : ids;
  }
  const hiddenCount = shownIds ? allEngineers.length - shownIds.size : 0;

  return (
    <div
      style={{
        padding: isPrimary ? '0.5rem 0.75rem' : '0.4rem 0.55rem',
        border: day.isToday
          ? '1px solid var(--color-accent)'
          : '1px solid var(--color-border-soft)',
        borderLeftWidth: day.isToday ? 3 : 1,
        background: day.isToday ? 'rgba(99,102,241,0.05)' : 'var(--color-card)',
        borderRadius: 4,
      }}
    >
      <div className="mb-1 flex items-baseline gap-2 flex-wrap" style={{ fontSize: headerSize }}>
        <span style={{ fontWeight: isPrimary ? 700 : 600, color: day.isToday ? 'var(--color-accent)' : 'var(--color-text)' }}>
          {day.label}{day.isToday && ' · today'}
        </span>
        <span className="t-muted t-small">
          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{counts.in}/{counts.total} in</span>
          {counts.out > 0 && (
            <span style={{ color: 'var(--color-warn, #d97706)', marginLeft: 6, fontWeight: 600 }}>
              · {counts.out} out
            </span>
          )}
          {counts.partial > 0 && (
            <span style={{ color: 'var(--color-accent, #4f46e5)', marginLeft: 6, fontWeight: 600 }}>
              · {counts.partial} partial
            </span>
          )}
        </span>
      </div>
      <div className="space-y-2">
        {/* Hide a crew's whole row on days its rotation doesn't work —
            the '_noshift' bucket (crew undefined) shows every day. */}
        {visibleGroups.map((g) => {
          const shown = shownIds;   // const capture so TS narrows in closures
          const engs = shown
            ? g.engineers.filter((e) => shown.has(e.user_id))
            : g.engineers;
          const hiddenInGroup = g.engineers.length - engs.length;
          return (
            <div key={g.shift_id}>
              {/* Label sits tight on top of its chip group (2px) — as a
                  side column it wrapped onto its own line with a visible
                  gap in the narrow 7-day cards. Group-to-group spacing
                  (8px, space-y-2 above) is wider than label-to-chips, so
                  each label reads as belonging to the chips below it. */}
              <div
                className="t-muted uppercase tracking-wider"
                style={{ fontSize: 9, marginBottom: 2, lineHeight: 1.2 }}
              >
                {g.label}
              </div>
              <div className="flex flex-wrap gap-1" style={{ alignItems: 'center' }}>
                {engs.map((eng) => {
                  const pto = ptoLookup.get(`${eng.user_id}|${day.iso}`) ?? null;
                  return (
                    <DayChip
                      key={eng.user_id}
                      engineer={eng}
                      pto={pto}
                      dateIso={day.iso}
                      dayLabel={day.label}
                      disabled={disabled}
                      onLogClick={onLogClick}
                      isPrimary={isPrimary}
                    />
                  );
                })}
                {hiddenInGroup > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="t-muted hover:t-accent"
                    style={{ fontSize: 9, lineHeight: 1, whiteSpace: 'nowrap' }}
                    title={`${hiddenInGroup} more on ${g.label} (all in) — click to expand`}
                  >
                    +{hiddenInGroup}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(expanded || hiddenCount > 0) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="t-accent hover:underline"
          style={{ marginTop: 4, fontSize: 10, fontWeight: 600 }}
          title={expanded ? 'Collapse back to the compact view' : `Show the ${hiddenCount} hidden engineers (all of them are in — anyone out always shows)`}
        >
          {expanded ? 'show less ▴' : `+${hiddenCount} more ▾`}
        </button>
      )}
    </div>
  );
}

function DayChip({
  engineer, pto, dateIso, dayLabel, disabled, onLogClick, isPrimary,
}: {
  engineer: EngineerRow;
  pto: PtoRequest | null;
  dateIso: string;
  dayLabel: string;
  disabled: boolean;
  onLogClick: (eng: EngineerRow, iso: string, label: string) => void;
  isPrimary?: boolean;
}) {
  const out      = pto !== null;
  const partial  = out && isPartialDay(pto!);
  const label    = out ? partialDayLabel(pto!) : null;
  const bg       = out
    ? (partial ? 'transparent' : PTO_TYPE_BG[pto!.type])
    : 'rgba(34,197,94,0.08)';
  const border   = out ? PTO_TYPE_COLOR[pto!.type] : '#10b981';
  const tipBase  = out
    ? `${engineer.full_name} · ${ptoTypeLabel(pto!.type)}${pto!.ends_on !== dateIso ? ` (returns ${fmtMd(pto!.ends_on)})` : ''}${pto!.reason ? ' · ' + pto!.reason : ''}`
    : `${engineer.full_name} working ${dayLabel} — click to log PTO`;
  const tip = partial && label ? `${tipBase} · ${label}` : tipBase;
  return (
    <button
      type="button"
      onClick={out ? undefined : () => onLogClick(engineer, dateIso, dayLabel)}
      disabled={disabled || out}
      title={tip}
      style={{
        padding: isPrimary ? '0.15rem 0.5rem' : '0.1rem 0.4rem',
        fontSize: isPrimary ? '0.75rem' : '0.68rem',
        background: bg,
        border: `1px ${partial ? 'dashed' : 'solid'} ${border}`,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: isPrimary ? 5 : 3,
        cursor: out ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {out
        ? <span style={{ color: border, fontWeight: 600 }}>● {shortName(engineer.full_name)}</span>
        : <span style={{ color: 'var(--color-text)' }}>○ {shortName(engineer.full_name)}</span>}
      {out && (
        <span
          style={{
            background: partial ? 'transparent' : border,
            color: partial ? border : 'white',
            border: partial ? `1px solid ${border}` : 'none',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            padding: '0.05rem 0.3rem', borderRadius: 3,
          }}
        >
          {pto!.type === 'sick' ? 'SICK' : pto!.type === 'vacation' ? 'VAC' : pto!.type.slice(0, 4).toUpperCase()}
          {label && <span style={{ marginLeft: 4, fontWeight: 500, letterSpacing: 0 }}>{label}</span>}
        </span>
      )}
    </button>
  );
}

/** "Sean Martell" → "Sean M." */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ───────────────────────────── Quick PTO modal (click on empty chip)
//
// Lightweight centered modal. Defaults type=sick, source=phone (most common
// call-out channel). Optional out_from / out_until time fields for partial
// days; hours auto-adjust (8 full / 4 partial) but stay editable.

function QuickPtoModal({
  engineer, dateIso, dayLabel, onClose,
}: {
  engineer: EngineerRow;
  dateIso: string;
  dayLabel: string;
  onClose: () => void;
}) {
  const submit = useSubmitPto();
  const [type, setType]               = useState<PtoType>('sick');
  const [outFrom, setOutFrom]         = useState<string>('');
  const [outUntil, setOutUntil]       = useState<string>('');
  const [source, setSource]           = useState<PtoRequestSource>('phone');
  const [sourceDetail, setSourceDetail] = useState<string>('');
  const [reason, setReason]           = useState<string>('called out');
  const [hours, setHours]             = useState<string>('8');
  const [hoursManuallyEdited, setHoursManuallyEdited] = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  // Vacation cap check — this form saves straight to APPROVED, so it must
  // run the same 2-engineer gate as Add PTO: an over-cap save requires a
  // logged override reason and stamps cap_override. (Closed the "quick
  // call-out skips the cap" known gap, 2026-07-19.) usePtoRequests here is
  // the Binney-scoped hook, so the check matches the panel's picture.
  const capReqQ = usePtoRequests();
  const [overrideReason, setOverrideReason] = useState('');
  const cap = useMemo(
    () => type === 'vacation'
      ? checkVacationCap(capReqQ.data ?? [], engineer.user_id, dateIso, dateIso)
      : { exceeded: false, conflicts: [] as CapConflict[] },
    [type, capReqQ.data, engineer.user_id, dateIso],
  );

  // Live balance card — same as AddPtoModal. Engineer is locked here so
  // we always know who to look up.
  const summaryQ = usePtoSummary();
  const currentYear = new Date().getFullYear();
  const balance = useMemo(() => {
    const all = (summaryQ.data ?? []).filter((s) => s.user_id === engineer.user_id);
    if (all.length === 0) return null;
    return (
      all.find((s) => s.year === currentYear) ??
      all.slice().sort((a, b) => b.year - a.year)[0]
    );
  }, [summaryQ.data, engineer.user_id, currentYear]);

  // Binney default is 10h/day; per-engineer override wins (McCarthy = 8).
  const dailyHoursQ = useEngineerPtoDailyHours(engineer.user_id);
  const dailyHours = dailyHoursQ.data != null ? dailyHoursQ.data : 10;

  // Auto-adjust hours when the partial-day window (or the resolved daily
  // rate) changes — unless the manager already typed a custom value.
  useEffect(() => {
    if (hoursManuallyEdited) return;
    const isPartial = !!outFrom || !!outUntil;
    setHours(String(isPartial ? dailyHours / 2 : dailyHours));
  }, [outFrom, outUntil, hoursManuallyEdited, dailyHours]);

  // Switching type: keep "called out" tied to sick, blank otherwise so the
  // manager doesn't accidentally log "called out" for a planned vacation.
  useEffect(() => {
    if (type === 'sick' && !reason) setReason('called out');
    if (type !== 'sick' && reason === 'called out') setReason('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const onSave = async () => {
    setErr(null);
    if (!source) { setErr('Source required for audit trail.'); return; }
    if (outFrom && outUntil && outUntil <= outFrom) {
      setErr('"Out until" must be later than "Out from".');
      return;
    }
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) { setErr('Hours must be > 0.'); return; }
    if (type === 'vacation' && cap.exceeded && !overrideReason.trim()) {
      setErr('2-engineer vacation cap is exceeded — provide an override reason to log this.');
      return;
    }

    try {
      await submit.mutateAsync({
        user_id:   engineer.user_id,
        type,
        starts_on: dateIso,
        ends_on:   dateIso,
        hours:     h,
        status:    'approved',
        reason:    reason.trim() || null,
        request_source:        source,
        request_source_detail: sourceDetail.trim() || null,
        out_from:  outFrom  || null,
        out_until: outUntil || null,
        cap_override:        type === 'vacation' && cap.exceeded,
        cap_override_reason: type === 'vacation' && cap.exceeded ? overrideReason.trim() : null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const isPartial = !!outFrom || !!outUntil;

  return (
    <div
      // No backdrop close — stray clicks must not nuke a half-filled form.
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{
          width: 'min(440px, 92vw)', padding: '1.25rem',
          borderRadius: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          maxHeight: '90vh', overflow: 'auto',
        }}
      >
        <div className="flex items-baseline justify-between mb-2 gap-2">
          <h3 className="t-section-title">Log PTO</h3>
          <button onClick={onClose} className="t-small t-muted" aria-label="Close">✕</button>
        </div>
        <p className="t-small t-muted mb-3">
          <strong>{engineer.full_name}</strong> · {dayLabel}
        </p>

        {/* Live balance — engineer is locked so the card always shows.
            Personal removed per ops decision (not offered). */}
        {balance && (
          <div className="mb-3">
            <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontSize: '0.65rem' }}>
              Balance · {balance.year}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <BalanceTile
                label="Vacation"
                used={balance.vacation_used}
                alloted={balance.vacation_alloted}
                remaining={balance.vacation_remaining}
                pending={Number(hours) || 0}
                active={type === 'vacation'}
              />
              <BalanceTile
                label="Sick"
                used={balance.sick_used}
                alloted={balance.sick_alloted}
                remaining={balance.sick_remaining}
                pending={Number(hours) || 0}
                active={type === 'sick'}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PtoType)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              {/* Manager-loggable types in display order; ensure keeps any
                  legacy value (personal/unpaid) selectable when editing. */}
              <PtoTypeOptions options={PTO_MANAGER_TYPE_OPTIONS} ensure={type} />
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Source <span style={{ color: 'var(--color-danger)' }}>*</span>
            </span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as PtoRequestSource)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              {PTO_MANAGER_SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{PTO_REQUEST_SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Out from <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(blank = start)</span>
            </span>
            <input
              type="time"
              value={outFrom}
              onChange={(e) => setOutFrom(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Out until <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(blank = end)</span>
            </span>
            <input
              type="time"
              value={outUntil}
              onChange={(e) => setOutUntil(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Hours</span>
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={hours}
              onChange={(e) => { setHours(e.target.value); setHoursManuallyEdited(true); }}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Source detail <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(opt)</span>
            </span>
            <input
              type="text"
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              placeholder="text 7:42am, voicemail, etc."
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Reason (optional)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. flu, kid school pickup, doctor appt"
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>
        </div>

        {isPartial && (
          <p className="t-small t-muted mt-2">
            Partial day — {engineer.full_name.split(' ')[0]} will be counted as in (partial) on the Coverage panel. Hours auto-set to {dailyHours / 2}h (half a {dailyHours}h day); override above if needed.
          </p>
        )}

        {/* Cap warning — same gate as Add PTO; this form saves as approved
            directly, so the override reason is always required over-cap. */}
        {type === 'vacation' && cap.exceeded && (
          <div className="mt-3 p-2 rounded" style={{ background: 'rgba(220,38,38,0.10)' }}>
            <p className="t-small" style={{ color: 'var(--color-danger)' }}>
              <strong>2-engineer cap exceeded.</strong>{' '}
              {cap.conflicts.map((c) => c.user_full_name).join(', ')} already off this date.
            </p>
            <label className="block mt-2">
              <span className="t-small uppercase tracking-wider block mb-1" style={{ color: 'var(--color-danger)' }}>Override reason (logged)</span>
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. urgent family matter — already arranged coverage"
                className="w-full border rounded px-2 py-1 t-small"
                style={{ borderColor: 'var(--color-danger)', background: 'var(--color-card)' }}
              />
            </label>
          </div>
        )}
        {type === 'vacation' && !cap.exceeded && cap.conflicts.length > 0 && (
          <p className="t-small t-muted mt-2">
            Note: {cap.conflicts.map((c) => c.user_full_name).join(', ')} also off this date (within 2-engineer cap).
          </p>
        )}

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="t-small px-3 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={submit.isPending}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {submit.isPending ? 'Saving…' : 'Log PTO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Cap heatmap (9-week vacation calendar)

function CapHeatmap({ requests, onPickDate }: {
  requests: PtoRequest[];
  onPickDate?: (iso: string) => void;
}) {
  // Horizon picker — 4 / 9 / 13 FUTURE weeks (1mo / 2mo / 3mo). On top of
  // that, PAST_WEEKS weeks of history always render before the current week
  // so last week's call-outs stay visible (faded, not clickable) — useful
  // when reconciling documented hours in COVE after the fact.
  const [weeks, setWeeks] = useState<4 | 9 | 13>(9);
  const PAST_WEEKS = 2;
  const today = todayIso();

  // Calendar grid aligns weeks to Mon–Sun so the day-of-week header stays
  // stable. Start = Monday of the current week, minus the history window.
  const start = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    const dow = d.getDay();
    const back = (dow + 6) % 7;
    d.setDate(d.getDate() - back - PAST_WEEKS * 7);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const totalWeeks = weeks + PAST_WEEKS;
  const totalDays = totalWeeks * 7;

  // Per-day list of engineers on vacation (approved or pending). Store
  // {name, status} so we can build initials + tooltip with status hints.
  type DayInfo = { name: string; status: 'approved' | 'pending'; label?: string };

  // Generic per-day grouper for one PTO type. Reused for vacation (drives the
  // cell colour + cap count) and sick (drives the non-counting corner dot).
  const groupByDay = (type: PtoType): Map<string, DayInfo[]> => {
    const m = new Map<string, DayInfo[]>();
    for (const r of requests) {
      if (r.type !== type) continue;
      if (r.status !== 'approved' && r.status !== 'pending') continue;
      let cur = r.starts_on;
      while (cur <= r.ends_on) {
        const list = m.get(cur) ?? [];
        list.push({ name: r.user_full_name ?? '?', status: r.status });
        m.set(cur, list);
        const d = new Date(cur + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
    }
    return m;
  };
  const byDay     = useMemo(() => groupByDay('vacation'), [requests]);
  // Sick is shown as a corner dot only — it never counts toward the vacation
  // cap colour, so the 2-engineer cap math stays untouched.
  const sickByDay = useMemo(() => groupByDay('sick'), [requests]);
  // Other absence types (bereavement / leave / short-term / jury duty) — a
  // second non-counting marker, labelled per type in the tooltip. Never
  // touches the 2-engineer cap math.
  const otherByDay = useMemo(() => {
    const m = new Map<string, DayInfo[]>();
    const otherSet = new Set<PtoType>(PTO_OTHER_LEAVE_TYPES);
    for (const r of requests) {
      if (!otherSet.has(r.type)) continue;
      if (r.status !== 'approved' && r.status !== 'pending') continue;
      let cur = r.starts_on;
      while (cur <= r.ends_on) {
        const list = m.get(cur) ?? [];
        list.push({ name: r.user_full_name ?? '?', status: r.status, label: ptoTypeLabel(r.type) });
        m.set(cur, list);
        const d = new Date(cur + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
    }
    return m;
  }, [requests]);

  // BMR-observed holiday lookup (see bmrHolidays.ts). Marker only — outlines
  // the cell + names the day in the tooltip; never counts toward the cap.
  // Duplicate dates (actual + observed colliding) join their names.
  const holidayByDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of BMR_HOLIDAYS) {
      const cur = m.get(h.date);
      m.set(h.date, cur ? `${cur} / ${h.name}` : h.name);
    }
    return m;
  }, []);

  // Cell geometry: wider than tall so two engineers' initials ("J·E") fit
  // legibly on cap-pinned days; height stays compact to keep 11+ week rows
  // on screen.
  const CELL_W = 40;
  const CELL_H = 26;

  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  type Cell = {
    iso: string;
    col: number;
    row: number;
    isToday: boolean;
    isPast: boolean;
    isWeekend: boolean;
    people: DayInfo[];
    sick: DayInfo[];
    other: DayInfo[];
    holiday: string | null;
  };
  const cells: Cell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const row = i % 7;
    const col = Math.floor(i / 7);
    cells.push({
      iso,
      col,
      row,
      isToday:   iso === today,
      isPast:    iso < today,
      isWeekend: row >= 5,
      people:    byDay.get(iso) ?? [],
      sick:      sickByDay.get(iso) ?? [],
      other:     otherByDay.get(iso) ?? [],
      holiday:   holidayByDay.get(iso) ?? null,
    });
  }

  // Row labels — the grid is rotated (days across the top, weeks stacked
  // down), so each week row is labelled with its Monday date as m/d
  // ("7/13") and any date can be located without hovering cell by cell.
  // The current week's row gets accent styling.
  const todayRow = cells.find((c) => c.isToday)?.col ?? -1;
  const weekLabels: { col: number; label: string }[] = [];
  for (let c = 0; c < totalWeeks; c++) {
    weekLabels.push({ col: c, label: fmtMd(cells[c * 7].iso) });
  }

  // Slightly more saturated palette so the eye reads cap-pinning quickly.
  // Past cells use the SAME palette — the 0.4 opacity on the cell fades them
  // — so the two history weeks still show who was out, not just grey.
  const color = (count: number): string => {
    if (count <= 0) return 'rgba(34,197,94,0.18)';   // soft green
    if (count === 1) return 'rgba(234,179,8,0.30)';  // amber
    if (count === 2) return 'rgba(234,88,12,0.45)';  // orange — cap pinned
    return 'rgba(220,38,38,0.50)';                   // red — over cap (override)
  };

  // In-cell label covers vacation AND sick people. Initials = first LETTER
  // of the first and last name words — words without letters are skipped
  // ("301 Tommy" → "T") — so numbers in a cell always mean head-counts,
  // never someone's name.
  //   Everyone fits (≤ ~3 short initials): per-person initials, sick ones
  //   rendered red. Otherwise: vacation head-count as a bare number (the
  //   cap colours) plus a red "+n" sick count. Sick NEVER changes the cell
  //   colour — the 2-engineer cap stays vacation-only.
  const initialsOf = (name: string): string => {
    const words = name.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
    if (words.length === 0) return '?';
    const first = (w: string) => w.match(/[A-Za-z]/)![0].toUpperCase();
    if (words.length === 1) return first(words[0]);
    return first(words[0]) + first(words[words.length - 1]);
  };
  type LabelPart = { text: string; sick?: boolean };
  const cellParts = (vac: DayInfo[], sick: DayInfo[]): LabelPart[] => {
    if (vac.length === 0 && sick.length === 0) return [];
    // Prefer initials for everyone; fall back to counts when the combined
    // text would overflow the 40px cell.
    const initials: LabelPart[] = [
      ...vac.map((p) => ({ text: initialsOf(p.name) })),
      ...sick.map((p) => ({ text: initialsOf(p.name), sick: true })),
    ];
    const len = initials.reduce((s, p) => s + p.text.length, 0) + initials.length - 1;
    if (len <= 6) return initials;
    const out: LabelPart[] = [];
    if (vac.length > 0) out.push({ text: String(vac.length) });
    if (sick.length > 0) out.push({ text: `+${sick.length}`, sick: true });
    return out;
  };

  const tooltip = (cell: Cell): string => {
    // Lead with a human-readable date ("Tue, Jul 21") so the hover confirms
    // the day being booked/checked at a glance; keep the ISO for precision.
    const nice = new Date(cell.iso + 'T00:00:00')
      .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const date = `${nice} · ${cell.iso}${cell.isToday ? ' (today)' : ''}${cell.isPast ? ' (past)' : ''}`;
    const holLine = cell.holiday ? `\n★ BMR holiday — ${cell.holiday}` : '';
    const sickLine = cell.sick.length > 0
      ? `\nSick: ${cell.sick.map((p) => `${p.name}${p.status === 'pending' ? ' (pending)' : ''}`).join(', ')}`
      : '';
    const otherLine = cell.other.length > 0
      ? `\n${cell.other.map((p) => `${p.name} (${p.label ?? 'leave'})${p.status === 'pending' ? ' pending' : ''}`).join(', ')}`
      : '';
    if (cell.people.length === 0) {
      // Binney covers all 7 days (two 4×10 crews), so weekend cells get the
      // same click-to-add affordance as weekdays.
      const base = cell.isPast
        ? `${date}${holLine}\n(past — no vacation)`
        : `${date}${holLine}\nNo one on vacation — click to add`;
      return base + sickLine + otherLine;
    }
    const names = cell.people.map((p) =>
      `${p.name}${p.status === 'pending' ? ' (pending)' : ''}`
    ).join(', ');
    return `${date}${holLine}\nVacation: ${names}${sickLine}${otherLine}${cell.isPast ? '' : '\n(click to add another PTO)'}`;
  };

  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2 flex items-baseline justify-between gap-2 flex-wrap">
        {/* Short title — the column is pinned at 246px; the prev-{PAST_WEEKS}w
            history shows as the faded rows above the accent-marked current
            week, so it doesn't need to be spelled out here. */}
        <span>Vacation cap heatmap</span>
        <span style={{ textTransform: 'none', display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
          {([4, 9, 13] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              className="t-small"
              style={{
                padding: '0.05rem 0.4rem',
                border: '1px solid var(--color-border)',
                borderRadius: 999,
                background: w === weeks ? 'var(--color-accent)' : 'var(--color-card)',
                color: w === weeks ? 'white' : 'var(--color-text-muted)',
                fontWeight: w === weeks ? 600 : 400,
                fontSize: 10,
                cursor: 'pointer',
              }}
            >{w}w</button>
          ))}
        </span>
      </div>

      {/* Legend chips — kept on one line. Click hint moved to a tiny
          footer below the grid so the legend doesn't wrap. The vacation
          colours show the cap count; the red dot flags sick (uncapped). */}
      <div className="t-small t-muted mb-2 flex items-center gap-2" style={{ fontSize: 10, flexWrap: 'wrap' }}>
        <LegendChip color="rgba(34,197,94,0.18)" label="0" />
        <LegendChip color="rgba(234,179,8,0.30)" label="1" />
        <LegendChip color="rgba(234,88,12,0.45)" label="2 cap" />
        <LegendChip color="rgba(220,38,38,0.50)" label="3+" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: '#ef4444', border: '1px solid rgba(0,0,0,0.15)' }} />
          <span>sick</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: '#8b5cf6', border: '1px solid rgba(0,0,0,0.15)' }} />
          <span>leave</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, border: '2px solid #10b981', background: 'transparent', boxSizing: 'border-box' }} />
          <span>BMR holiday</span>
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {/* Week-label column — one label per week ROW (Monday's m/d date).
            paddingTop matches the day-of-week header row (14 + 4 margin). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 18 }}>
          {weekLabels.map((w) => (
            <div
              key={w.col}
              className="t-mono"
              style={{
                fontSize: 9, height: 26, lineHeight: '26px', textAlign: 'right', width: 34,
                color: w.col === todayRow ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: w.col === todayRow ? 700 : 400,
              }}
            >
              {w.label}
            </div>
          ))}
        </div>
        {/* Heatmap grid — rotated: days Mon–Sun across, weeks stacked down */}
        <div>
          {/* Day-of-week header row */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL_W}px)`, gap: 3, marginBottom: 4 }}>
            {dayLabels.map((d) => (
              <div key={d} className="t-muted" style={{ fontSize: 9, height: 14, lineHeight: '14px', textAlign: 'center' }}>
                {d}
              </div>
            ))}
          </div>
          {/* Row-major flow: cells are in date order, so each 7-cell run is
              one Mon–Sun week row. */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL_W}px)`, gridTemplateRows: `repeat(${totalWeeks}, ${CELL_H}px)`, gap: 3 }}>
            {cells.map((cell) => {
              const count = cell.people.length;
              const parts = cellParts(cell.people, cell.sick);
              // Approximate rendered length (chars + separators) for sizing.
              const labelLen = parts.reduce((s, p) => s + p.text.length + 1, -1);
              const clickable = !cell.isPast && !!onPickDate;
              const hasSick = cell.sick.length > 0;
              const hasOther = cell.other.length > 0;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={clickable ? () => onPickDate!(cell.iso) : undefined}
                  disabled={!clickable}
                  title={tooltip(cell)}
                  style={{
                    position: 'relative',
                    width: CELL_W, height: CELL_H, padding: 0,
                    borderRadius: 3,
                    background: color(count),
                    // No weekend dimming — Binney's crews work Sat + Sun.
                    opacity: cell.isPast ? 0.4 : 1,
                    // Today's accent ring wins over the holiday outline; the
                    // tooltip still names the holiday either way.
                    border: cell.isToday
                      ? '2px solid var(--color-accent)'
                      : cell.holiday
                        ? '2px solid #10b981'
                        : '1px solid rgba(0,0,0,0.08)',
                    cursor: clickable ? 'pointer' : 'default',
                    // "TS" and counts render full size; longer combos like
                    // "TS·JM" step down to fit the 40px cell.
                    fontSize: labelLen >= 4 ? 10 : 13,
                    fontWeight: 700,
                    color: count >= 2 ? 'white' : 'var(--color-text)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  {parts.map((p, i) => (
                    <Fragment key={i}>
                      {/* No middot before a "+n" sick count — "2+1" reads
                          as one expression. */}
                      {i > 0 && !p.text.startsWith('+') && (
                        <span style={{ opacity: 0.6 }}>·</span>
                      )}
                      <span style={p.sick ? { color: '#dc2626' } : undefined}>
                        {p.text}
                      </span>
                    </Fragment>
                  ))}
                  {hasSick && (
                    // Non-counting sick marker: red corner dot. Shows count if
                    // more than one person is sick that day.
                    <span
                      style={{
                        position: 'absolute', top: 1, right: 1,
                        minWidth: 7, height: 7, borderRadius: 999,
                        background: '#ef4444',
                        border: '1px solid rgba(255,255,255,0.85)',
                        fontSize: 7, lineHeight: '6px', color: '#fff',
                        fontWeight: 700, padding: cell.sick.length > 1 ? '0 1px' : 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {cell.sick.length > 1 ? cell.sick.length : ''}
                    </span>
                  )}
                  {hasOther && (
                    // Non-counting "other leave" marker (bereavement/leave/
                    // short-term/jury): purple corner square, bottom-right.
                    <span
                      style={{
                        position: 'absolute', bottom: 1, right: 1,
                        minWidth: 7, height: 7, borderRadius: 2,
                        background: '#8b5cf6',
                        border: '1px solid rgba(255,255,255,0.85)',
                        fontSize: 7, lineHeight: '6px', color: '#fff',
                        fontWeight: 700, padding: cell.other.length > 1 ? '0 1px' : 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {cell.other.length > 1 ? cell.other.length : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="t-muted" style={{ fontSize: 9, marginTop: 4, fontStyle: 'italic' }}>
        Click a future cell to add PTO
      </div>
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 12, height: 12, background: color, borderRadius: 2, border: '1px solid rgba(0,0,0,0.1)' }} />
      <span>{label}</span>
    </span>
  );
}

// ───────────────────────────── Staffing vs labor model (range checker)
//
// ⚠ PARKED — removed from the layout 2026-07-17 at the user's request but
// kept working (and exported, so tsc doesn't flag it unused) because it is
// expected to return. To re-add, render:
//   <StaffingForecast engineers={engineersQ.data ?? []}
//                     shifts={shiftsQ.data ?? []} requests={buckets.all} />
// (it previously sat beside CapHeatmap) and restore the manual paragraph
// (see git history of manualContent.ts).
//
// Manager workflow: pick a date range and compare expected documented hours
// per engineer against the labor model. Binney runs 4×10s and a worked day
// documents ~8.5 h in COVE, so a full week is 4 × 8.5 = 34 h and one full-day
// absence drops it to 3 × 8.5 = 25.5 h. The per-day figure is editable in the
// block header so the model can be tuned (e.g. 8.75 → 35 h/wk) without a code
// change.
const DEFAULT_DOC_HRS_PER_DAY = 8.5;

export function StaffingForecast({ engineers, shifts, requests }: {
  engineers: EngineerRow[];
  shifts: { id: string; name: string; sort_order: number; crew?: Crew }[];
  requests: PtoRequest[];
}) {
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo]     = useState(addDaysIso(today, 6));
  const [hrsStr, setHrsStr] = useState(String(DEFAULT_DOC_HRS_PER_DAY));
  const hrs = Number(hrsStr) > 0 ? Number(hrsStr) : DEFAULT_DOC_HRS_PER_DAY;

  // Sun–Sat presets — both crews (Sun–Wed / Wed–Sat) fit inside one
  // Sunday-anchored week, so that's the natural labor-model window.
  const sunday = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    return addDaysIso(today, -d.getDay());
  }, [today]);
  const presets: { label: string; from: string; to: string }[] = [
    { label: 'This wk', from: sunday,                to: addDaysIso(sunday, 6) },
    { label: 'Next wk', from: addDaysIso(sunday, 7), to: addDaysIso(sunday, 13) },
    { label: 'Next 7d', from: today,                 to: addDaysIso(today, 6) },
  ];

  // Enumerate the range, capped so a typo'd year can't render thousands of
  // rows — the cap is surfaced next to the day count when it bites.
  const MAX_DAYS = 62;
  const { dates, clamped } = useMemo(() => {
    const out: string[] = [];
    if (from && to && to >= from) {
      let cur = from;
      while (cur <= to && out.length < MAX_DAYS) {
        out.push(cur);
        cur = addDaysIso(cur, 1);
      }
    }
    return { dates: out, clamped: out.length === MAX_DAYS && to > out[out.length - 1] };
  }, [from, to]);

  const crewByShiftId = useMemo(
    () => new Map(shifts.map((s) => [s.id, (s.crew ?? null) as Crew])),
    [shifts],
  );
  const shiftById = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  // Per engineer over the range: scheduled crew days, full-day absences
  // (approved, any type — they all remove the day's documented hours),
  // partial days (still count as worked), pending requests (surfaced but
  // never subtracted). Engineers without a shift can't be scheduled against
  // a crew calendar, so they're listed separately and excluded from hours.
  type Row = {
    eng: EngineerRow; shiftName: string; sortOrder: number;
    sched: number; outFull: number; partial: number; pending: number;
  };
  const { rows, noShift } = useMemo(() => {
    const first = dates[0] ?? '';
    const last  = dates[dates.length - 1] ?? '';
    const inRange  = (r: PtoRequest) => r.starts_on <= last && r.ends_on >= first;
    const approved = requests.filter((r) => r.status === 'approved' && inRange(r));
    const pendingReqs = requests.filter((r) => r.status === 'pending' && inRange(r));
    const rows: Row[] = [];
    const noShift: EngineerRow[] = [];
    for (const e of engineers) {
      if (!e.active || e.role !== 'engineer') continue;
      if (!e.shift_id) { noShift.push(e); continue; }
      const crew  = crewByShiftId.get(e.shift_id);
      const shift = shiftById.get(e.shift_id);
      let sched = 0, outFull = 0, partial = 0, pending = 0;
      for (const iso of dates) {
        if (!crewWorksOn(crew, iso)) continue;
        sched++;
        const ap = approved.find((r) => r.user_id === e.user_id && r.starts_on <= iso && r.ends_on >= iso);
        if (ap) { if (isPartialDay(ap)) partial++; else outFull++; }
        if (pendingReqs.some((r) => r.user_id === e.user_id && r.starts_on <= iso && r.ends_on >= iso)) pending++;
      }
      rows.push({
        eng: e, shiftName: shift?.name ?? '—', sortOrder: shift?.sort_order ?? 999,
        sched, outFull, partial, pending,
      });
    }
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.eng.full_name.localeCompare(b.eng.full_name));
    noShift.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return { rows, noShift };
  }, [engineers, requests, dates, crewByShiftId, shiftById]);

  const fmtH = (n: number) => String(Math.round(n * 10) / 10);
  const totalExpected = rows.reduce((s, r) => s + (r.sched - r.outFull) * hrs, 0);
  const totalTarget   = rows.reduce((s, r) => s + r.sched * hrs, 0);

  const inputStyle = {
    borderColor: 'var(--color-border)', background: 'var(--color-card)',
    fontSize: 11, padding: '0.1rem 0.3rem',
  } as const;
  const cellPad = { padding: '0.15rem 0.5rem' } as const;

  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2 flex items-baseline gap-2 flex-wrap">
        <span>Staffing vs labor model</span>
        <span style={{ textTransform: 'none', fontStyle: 'italic', letterSpacing: 0 }}>
          expected COVE doc-hours for the range
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2 t-small">
        <input
          type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="border rounded t-text t-mono" style={inputStyle}
        />
        <span className="t-muted">→</span>
        <input
          type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
          className="border rounded t-text t-mono" style={inputStyle}
        />
        <span className="t-muted" style={{ fontSize: 10 }}>
          {dates.length}d{clamped ? ` (capped at ${MAX_DAYS})` : ''}
        </span>
        {presets.map((p) => {
          const active = from === p.from && to === p.to;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => { setFrom(p.from); setTo(p.to); }}
              style={{
                padding: '0.05rem 0.4rem',
                border: '1px solid var(--color-border)',
                borderRadius: 999,
                background: active ? 'var(--color-accent)' : 'var(--color-card)',
                color: active ? 'white' : 'var(--color-text-muted)',
                fontWeight: active ? 600 : 400,
                fontSize: 10,
                cursor: 'pointer',
              }}
            >{p.label}</button>
          );
        })}
        <span className="t-muted flex items-center gap-1" style={{ marginLeft: 'auto', fontSize: 10 }}>
          <input
            type="number" min={1} max={12} step={0.25}
            value={hrsStr} onChange={(e) => setHrsStr(e.target.value)}
            className="border rounded t-text t-mono" style={{ ...inputStyle, width: 52 }}
          />
          doc-hrs / worked day
        </span>
      </div>

      <table className="t-small" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr
            className="t-muted uppercase tracking-wider"
            style={{ fontSize: 9, borderBottom: '1px solid var(--color-border)' }}
          >
            <th style={{ ...cellPad, textAlign: 'left' }}>Engineer</th>
            <th style={{ ...cellPad, textAlign: 'left' }}>Shift</th>
            <th style={{ ...cellPad, textAlign: 'right' }} title="Scheduled crew days in the range">Days</th>
            <th style={{ ...cellPad, textAlign: 'left' }}>Out</th>
            <th style={{ ...cellPad, textAlign: 'right' }}>Doc hrs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expected = (r.sched - r.outFull) * hrs;
            const target   = r.sched * hrs;
            const short    = r.outFull > 0;
            return (
              <tr
                key={r.eng.user_id}
                style={{
                  borderBottom: '1px solid var(--color-border-soft)',
                  background: short ? 'rgba(217,119,6,0.06)' : undefined,
                }}
              >
                <td style={cellPad}>{shortName(r.eng.full_name)}</td>
                <td className="t-muted" style={{ ...cellPad, fontSize: 10 }}>{r.shiftName}</td>
                <td className="t-mono" style={{ ...cellPad, textAlign: 'right' }}>{r.sched}</td>
                <td style={cellPad}>
                  {short
                    ? <span style={{ color: 'var(--color-warn, #d97706)', fontWeight: 600 }}>{r.outFull}d</span>
                    : <span className="t-muted">—</span>}
                  {r.partial > 0 && <span className="t-muted" style={{ fontSize: 10 }}> · {r.partial} partial</span>}
                  {r.pending > 0 && <span style={{ color: 'var(--color-accent)', fontSize: 10 }}> · +{r.pending} pending</span>}
                </td>
                <td className="t-mono" style={{ ...cellPad, textAlign: 'right' }}>
                  <span style={{ fontWeight: 600, color: short ? 'var(--color-warn, #d97706)' : 'var(--color-text)' }}>
                    {fmtH(expected)}
                  </span>
                  {short && <span className="t-muted"> / {fmtH(target)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600 }}>
            <td style={cellPad} colSpan={3}>Total</td>
            <td style={cellPad} />
            <td className="t-mono" style={{ ...cellPad, textAlign: 'right' }}>
              {fmtH(totalExpected)}
              {totalExpected !== totalTarget && <span className="t-muted" style={{ fontWeight: 400 }}> / {fmtH(totalTarget)}</span>}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="t-muted" style={{ fontSize: 9, marginTop: 4, fontStyle: 'italic' }}>
        Full-day absences (any approved type) subtract {fmtH(hrs)} h · partial days count as worked ·
        pending shown but not subtracted
      </div>
      {noShift.length > 0 && (
        <div className="t-muted" style={{ fontSize: 9, marginTop: 2 }}>
          No shift assigned — excluded from hours: {noShift.map((e) => shortName(e.full_name)).join(', ')}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Balances grid

/** "2025-11-24" → "Hired 11/24/25 · 6 mo" (or "· 2.5 yr"). Months are rounded
 *  to the nearest whole; years to one decimal once we cross 12 months. */
function fmtHireSeniority(hireIso: string | null): string {
  if (!hireIso) return '';
  const hire = new Date(hireIso + 'T00:00:00');
  if (isNaN(hire.getTime())) return '';
  const now = new Date();
  const monthsTotal =
    (now.getFullYear() - hire.getFullYear()) * 12 +
    (now.getMonth() - hire.getMonth()) +
    (now.getDate() >= hire.getDate() ? 0 : -1);
  const months = Math.max(0, monthsTotal);
  const seniority = months < 12
    ? `${months} mo`
    : `${(months / 12).toFixed(months % 12 === 0 ? 0 : 1)} yr`;
  const mm = hire.getMonth() + 1;
  const dd = hire.getDate();
  const yy = String(hire.getFullYear()).slice(2);
  return `Hired ${mm}/${dd}/${yy} · ${seniority}`;
}

function BalancesGrid({
  summaries, allRequests, engineers, crewByUser, onEdit, onEditRequest, onDeleteRequest,
}: {
  summaries: PtoSummary[];
  allRequests: PtoRequest[];
  engineers: EngineerRow[];
  /** user_id → crew (shifts.crew). Drives the two-sided crew split. */
  crewByUser?: Map<string, Crew | undefined>;
  onEdit: (s: PtoSummary) => void;
  onEditRequest?: (r: PtoRequest) => void;
  onDeleteRequest?: (id: string) => void;
}) {
  const currentYear = new Date().getFullYear();
  // Column sorting: name (default) or one of the three balances. A balance
  // header click sorts lowest-first (who's running out); click again to
  // flip. "not set" rows always sink to the bottom of balance sorts.
  type SortKey = 'name' | 'vacation' | 'sick' | 'holiday';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const onSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(k);
      setSortDir(1);
    }
  };
  const sortArrow = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? ' ↑' : ' ↓') : '');
  // v_pto_summary is keyed off pto_balances, so a brand-new engineer with
  // no balance row is invisible — and there was no UI path to create that
  // first row. Synthesize a zero-allotment placeholder for every active
  // engineer who lacks a current-year row, so they always appear and get
  // a "set allotment" action. Saving upserts on (user_id, year), which
  // creates the real row. BalanceSplitCells already renders "—" when
  // alloted is 0, so placeholders read as "not set" rather than negative.
  const realRows = summaries.filter((s) => s.year === currentYear);
  const haveRow = new Set(realRows.map((s) => s.user_id));
  const placeholders: PtoSummary[] = engineers
    .filter((e) => e.active && e.role === 'engineer' && !haveRow.has(e.user_id))
    .map((e) => ({
      id: `new:${e.user_id}`,            // 'new:' prefix flags a not-yet-saved row
      user_id: e.user_id,
      user_full_name: e.full_name,
      year: currentYear,
      vacation_alloted: 0, vacation_used: 0, vacation_remaining: 0,
      sick_alloted: 0, sick_used: 0, sick_remaining: 0,
      holiday_alloted: 0, holiday_used: 0, holiday_remaining: 0,
      notes: null, updated_at: '',
    }));
  const rows = [...realRows, ...placeholders].sort((a, b) => {
    if (sortKey === 'name') {
      return sortDir * (a.user_full_name ?? '').localeCompare(b.user_full_name ?? '');
    }
    const pick = (s: PtoSummary): [number, number] =>
      sortKey === 'vacation' ? [s.vacation_alloted, s.vacation_remaining]
      : sortKey === 'sick'   ? [s.sick_alloted, s.sick_remaining]
      :                        [s.holiday_alloted, s.holiday_remaining];
    const [aAlloted, aRem] = pick(a);
    const [bAlloted, bRem] = pick(b);
    if ((aAlloted === 0) !== (bAlloted === 0)) return aAlloted === 0 ? 1 : -1;
    if (aRem !== bRem) return sortDir * (aRem - bRem);
    return (a.user_full_name ?? '').localeCompare(b.user_full_name ?? '');
  });
  // Track which engineer row is currently expanded to show the full year log.
  // Single-open accordion — clicking a different name swaps the open row.
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Hire-date lookup keyed by user_id. We get this from useEngineers (which
  // already pulls users.hiring_date as part of EngineerRow) so we don't have
  // to widen v_pto_summary.
  const hireByUser = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const e of engineers) m.set(e.user_id, e.hiring_date);
    return m;
  }, [engineers]);

  // Pre-group all requests (approved + pending + cancelled) by user_id for the
  // current year so each expansion just slices into the map. Sorted ascending
  // so the log reads top-to-bottom chronological.
  const logByUser = useMemo(() => {
    const yr = String(currentYear);
    const m = new Map<string, PtoRequest[]>();
    for (const r of allRequests) {
      if (!r.starts_on.startsWith(yr)) continue;
      const cur = m.get(r.user_id) ?? [];
      cur.push(r);
      m.set(r.user_id, cur);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    }
    return m;
  }, [allRequests, currentYear]);

  if (rows.length === 0) return null;

  // Two-sided crew split (user 2026-07-13): left = Saturday crew, right =
  // Sunday crew, plus a trailing bucket for Mon–Fri / unassigned so nobody
  // vanishes. Crew comes from shifts.crew via crewByUser — the same source
  // the roll and the User Profiles filter use. Falls back to an
  // alphabetical half-split while no crews are assigned.
  const crewOf = (uid: string) => crewByUser?.get(uid);
  const sat = rows.filter((s) => crewOf(s.user_id) === 'saturday');
  const sun = rows.filter((s) => crewOf(s.user_id) === 'sunday');
  const rest = rows.filter((s) => crewOf(s.user_id) !== 'saturday' && crewOf(s.user_id) !== 'sunday');
  const mid = Math.ceil(rows.length / 2);
  const halves: { label: string | null; rows: PtoSummary[] }[] =
    sat.length > 0 || sun.length > 0
      ? [
          { label: `Saturday crew (${sat.length})`, rows: sat },
          { label: `Sunday crew (${sun.length})`, rows: sun },
          { label: `Mon–Fri / no crew (${rest.length})`, rows: rest },
        ].filter((h) => h.rows.length > 0)
      : rows.length > 6
        ? [{ label: null, rows: rows.slice(0, mid) }, { label: null, rows: rows.slice(mid) }]
        : [{ label: null, rows }];

  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">
        Balances ({currentYear}) <span className="t-muted normal-case ml-1" style={{ textTransform: 'none' }}>· click a name to see the log · click a column to sort</span>
      </div>
      <div className="flex flex-wrap items-start" style={{ columnGap: '1.75rem', rowGap: '1rem' }}>
      {halves.map((half, hi) => (
      <div key={hi} style={hi > 0 ? { borderLeft: '1px solid var(--color-border)', paddingLeft: '1.75rem' } : undefined}>
      {half.label && (
        <div className="t-small t-muted uppercase tracking-wider mb-1">{half.label}</div>
      )}
      <table className="t-text t-small border-collapse" style={{ width: 'auto' }}>
        <thead>
          {/* Single compact header row — each type column shows "balance
              used/allotted" in one cell so two half-tables fit side by side
              within the page container. */}
          <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
            <th className="py-1 pr-3">
              <button type="button" onClick={() => onSort('name')} className="hover:t-accent" title="Sort by name">Engineer{sortArrow('name')}</button>
            </th>
            <th className="py-1 px-2 text-right" style={{ borderLeft: '1px solid var(--color-border-soft)', whiteSpace: 'nowrap' }}>
              <button type="button" onClick={() => onSort('vacation')} className="hover:t-accent" title="Balance · used/allotted — click to sort by balance, lowest first">Vacation{sortArrow('vacation')}</button>
            </th>
            <th className="py-1 px-2 text-right" style={{ borderLeft: '1px solid var(--color-border-soft)', whiteSpace: 'nowrap' }}>
              <button type="button" onClick={() => onSort('sick')} className="hover:t-accent" title="Balance · used/allotted — click to sort by balance, lowest first">Sick{sortArrow('sick')}</button>
            </th>
            <th className="py-1 px-2 text-right" style={{ borderLeft: '1px solid var(--color-border-soft)', whiteSpace: 'nowrap' }}>
              <button type="button" onClick={() => onSort('holiday')} className="hover:t-accent" title="Balance · used/allotted — click to sort by balance, lowest first">Fl. Holiday{sortArrow('holiday')}</button>
            </th>
            <th className="py-1 pl-2" style={{ whiteSpace: 'nowrap' }}></th>
          </tr>
        </thead>
        <tbody>
          {half.rows.map((s) => {
            const isOpen = expandedUserId === s.user_id;
            const log = logByUser.get(s.user_id) ?? [];
            const hireLine = fmtHireSeniority(hireByUser.get(s.user_id) ?? null);
            const notSet = s.id.startsWith('new:');
            return (
              <Fragment key={s.id}>
                <tr style={{ borderBottom: isOpen ? 'none' : '1px solid var(--color-border-soft)' }}>
                  <td className="py-1 pr-3 align-top">
                    <button
                      type="button"
                      onClick={() => setExpandedUserId(isOpen ? null : s.user_id)}
                      className="t-accent hover:underline text-left"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      title={isOpen ? 'Hide log' : `Show ${currentYear} log (${log.length} entr${log.length === 1 ? 'y' : 'ies'})`}
                    >
                      <span style={{ display: 'inline-block', width: 10, fontSize: 10, color: 'var(--color-text-muted)' }}>
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <span className="font-medium">{s.user_full_name ?? '?'}</span>
                      {notSet && (
                        <span
                          className="t-small uppercase tracking-wider"
                          style={{ fontSize: 9, fontWeight: 700, padding: '0.05rem 0.3rem', borderRadius: 3, background: 'rgba(245,158,11,0.18)', color: '#b45309' }}
                          title="No allotment set yet — click “set allotment”"
                        >
                          not set
                        </span>
                      )}
                    </button>
                    {hireLine && (
                      <div className="t-muted" style={{ fontSize: '0.7rem', marginLeft: 14, marginTop: 1, whiteSpace: 'nowrap' }}>
                        {hireLine}
                      </div>
                    )}
                  </td>
                  <BalanceCell remaining={s.vacation_remaining} used={s.vacation_used} alloted={s.vacation_alloted} />
                  <BalanceCell remaining={s.sick_remaining}     used={s.sick_used}     alloted={s.sick_alloted} />
                  <BalanceCell remaining={s.holiday_remaining}  used={s.holiday_used}  alloted={s.holiday_alloted} />
                  <td className="py-1 pl-2 text-right align-top" style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => onEdit(s)} className="t-small t-accent hover:underline" title={notSet ? 'Set allotment' : 'Edit allotment'}>{notSet ? 'set' : 'edit'}</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                    <td colSpan={5} style={{ background: 'rgba(0,0,0,0.02)', padding: '0.5rem 0.75rem' }}>
                      <PtoYearLog
                        rows={log}
                        year={currentYear}
                        onEdit={onEditRequest}
                        onDelete={onDeleteRequest}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
      ))}
      </div>
    </div>
  );
}

/** One compact cell per PTO type: emphasized balance + muted used/allotted
 *  ("34h 8/42"). Single-cell keeps each half-table narrow enough for the
 *  split two-column balances layout to fit side by side. */
function BalanceCell({ remaining, used, alloted }: { remaining: number; used: number; alloted: number }) {
  if (alloted === 0) {
    return (
      <td className="py-1 px-2 text-right t-muted align-top" style={{ borderLeft: '1px solid var(--color-border-soft)', whiteSpace: 'nowrap' }}>—</td>
    );
  }
  // Red only when the balance is truly low (< 4h, incl. negatives) — per
  // user 2026-07-12. No amber tier.
  const low = remaining < 4;
  const color = low ? 'var(--color-danger)' : 'var(--color-text)';
  return (
    <td className="py-1 px-2 text-right t-mono align-top" style={{ borderLeft: '1px solid var(--color-border-soft)', whiteSpace: 'nowrap' }}>
      <span style={{ color, fontWeight: low ? 600 : 400 }}>{remaining}h</span>
      <span className="t-muted" style={{ fontSize: '0.72rem', marginLeft: 4 }}>{used}/{alloted}</span>
    </td>
  );
}

/** Chronological log of every PTO entry (any status) for one engineer in one year.
 *  Used by both the manager-side BalancesGrid drill-down and the engineer
 *  self-serve MyPtoSection (Phase 12b). When onEdit/onDelete are passed, the
 *  manager-only edit + delete icons render on each row. */
export function PtoYearLog({
  rows, year, onEdit, onDelete,
}: {
  rows: PtoRequest[];
  year: number;
  onEdit?: (r: PtoRequest) => void;
  onDelete?: (id: string) => void;
}) {
  const canEdit = !!onEdit || !!onDelete;
  if (rows.length === 0) {
    return <p className="t-small t-muted italic">No PTO entries in {year}.</p>;
  }
  // Split approved/pending vs cancelled/denied — cancelled rows are kept
  // but visually de-emphasized so the running picture is still accurate.
  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === 'approved' || r.status === 'pending') {
        const key = r.type as PtoType;
        acc[key] = (acc[key] ?? 0) + Number(r.hours);
      }
      return acc;
    },
    {} as Partial<Record<PtoType, number>>,
  );
  const summaryLine = (Object.keys(totals) as PtoType[])
    .sort()
    .map((t) => `${ptoTypeLabel(t)} ${totals[t]!.toFixed(2).replace(/\.00$/, '')}h`)
    .join(' · ');
  return (
    <div>
      <div className="t-small t-muted mb-1.5">
        <span className="font-medium">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'}</span>
        {summaryLine && <span className="ml-2">· {summaryLine}</span>}
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => {
          const isLive = r.status === 'approved' || r.status === 'pending';
          return (
            <li
              key={r.id}
              className="t-small flex items-baseline gap-2 flex-wrap"
              style={{
                padding: '0.2rem 0.5rem',
                borderLeft: `3px solid ${PTO_TYPE_COLOR[r.type as PtoType]}`,
                background: isLive ? PTO_TYPE_BG[r.type as PtoType] : 'transparent',
                borderRadius: 3,
                opacity: isLive ? 1 : 0.55,
              }}
              title={[
                r.reason,
                r.request_source && `via ${PTO_REQUEST_SOURCE_LABELS[r.request_source]}`,
                r.request_source_detail,
              ].filter(Boolean).join(' · ') || undefined}
            >
              <span className="t-mono" style={{ minWidth: 90 }}>{fmtRange(r.starts_on, r.ends_on)}</span>
              <span style={{ minWidth: 72 }}>{ptoTypeLabel(r.type as PtoType)}</span>
              <span className="t-mono">{Number(r.hours)}h</span>
              <span
                className="px-1 py-0.5 rounded uppercase tracking-wide"
                style={{
                  fontSize: 9, fontWeight: 600,
                  background: r.status === 'approved' ? 'rgba(16,185,129,0.15)' :
                              r.status === 'pending'  ? 'rgba(234,179,8,0.18)'  :
                              r.status === 'denied'   ? 'rgba(239,68,68,0.15)'  :
                                                         'rgba(100,116,139,0.15)',
                  color: r.status === 'approved' ? '#047857' :
                         r.status === 'pending'  ? '#a16207' :
                         r.status === 'denied'   ? '#b91c1c' : '#475569',
                }}
              >
                {r.status}
              </span>
              {r.reviewed_by_name && (r.status === 'approved' || r.status === 'denied') && (
                <span
                  className="t-muted"
                  style={{ fontSize: 10 }}
                  title={r.review_note ? `Note: ${r.review_note}` : undefined}
                >
                  by {r.reviewed_by_name}
                </span>
              )}
              {r.request_source && (
                <span
                  className="t-muted"
                  style={{ fontSize: 10, fontStyle: 'italic' }}
                  title={r.request_source_detail ?? undefined}
                >
                  via {PTO_REQUEST_SOURCE_LABELS[r.request_source]}
                  {r.request_source_detail && ` (${r.request_source_detail})`}
                </span>
              )}
              {r.reason && <span className="t-muted truncate" style={{ maxWidth: 240 }}>· {r.reason}</span>}
              {canEdit && (
                <span className="ml-auto" style={{ display: 'inline-flex', gap: 6 }}>
                  {onEdit && (
                    <button
                      onClick={() => onEdit(r)}
                      className="t-muted hover:t-accent"
                      title="Edit"
                      style={{ fontSize: 11, lineHeight: 1 }}
                    >✎</button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => onDelete(r.id)}
                      className="t-muted hover:t-danger"
                      title="Delete (hard-remove from history)"
                      style={{ fontSize: 11, lineHeight: 1 }}
                    >🗑</button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────────────────────────── Add PTO modal

/** Compact balance tile used inside AddPtoModal — one tile per PTO type.
 *  Highlighted when its type matches the currently-selected Type dropdown.
 *  `pending` lets us optionally show a "would leave Xh" hint so the
 *  manager sees the consequence of the in-progress submit before saving. */
function BalanceTile({
  label, used, alloted, remaining, pending, active,
}: {
  label: string;
  used: number;
  alloted: number;
  remaining: number;
  pending: number;
  active: boolean;
}) {
  // Only show the "after submit" forecast when this tile matches the
  // selected type — otherwise it'd be misleading.
  const afterSubmit = active ? Math.max(0, remaining - (pending || 0)) : null;
  const wouldExceed = active && (pending || 0) > remaining;

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 4,
        border: active
          ? '1px solid var(--color-accent)'
          : '1px solid var(--color-border)',
        background: active ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
      }}
    >
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.65rem' }}>
        {label}
      </div>
      <div
        className="t-mono"
        style={{
          fontSize: '1.05rem',
          fontWeight: 700,
          color: wouldExceed ? 'var(--color-danger)' : 'var(--color-text)',
          lineHeight: 1.1,
        }}
      >
        {remaining}h <span className="t-muted" style={{ fontSize: '0.7rem', fontWeight: 400 }}>left</span>
      </div>
      <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
        {used}h used · {alloted}h allotted
      </div>
      {afterSubmit !== null && pending > 0 && (
        <div
          className="t-small"
          style={{
            fontSize: '0.7rem',
            marginTop: 3,
            color: wouldExceed ? 'var(--color-danger)' : 'var(--color-text-muted)',
            fontWeight: wouldExceed ? 600 : 400,
          }}
        >
          {wouldExceed ? '⚠ ' : '→ '}
          after submit: <strong>{afterSubmit}h</strong>
          {wouldExceed && <span> (over by {pending - remaining}h)</span>}
        </div>
      )}
    </div>
  );
}

function AddPtoModal({
  engineers, allRequests, presetDate, onClose,
}: {
  engineers: ReturnType<typeof useEngineers>['data'];
  allRequests: PtoRequest[];
  presetDate?: string | null;
  onClose: () => void;
}) {
  const submit = useSubmitPto();
  const today  = todayIso();
  // When opened from a heatmap cell click, default to that date (the manager
  // wants to add PTO FOR that day) and pre-select vacation since that's what
  // the cap heatmap visualizes.
  const initialDate = presetDate || today;
  const initialType: PtoType = presetDate ? 'vacation' : 'vacation';

  const [userId, setUserId]                 = useState<string>('');
  const [type, setType]                     = useState<PtoType>(initialType);
  const [startsOn, setStartsOn]             = useState<string>(initialDate);
  const [endsOn, setEndsOn]                 = useState<string>(initialDate);
  const [hoursOverride, setHoursOverride]   = useState<string>('');  // blank = auto (8 * weekdays)
  const [reason, setReason]                 = useState<string>('');
  const [statusChoice, setStatusChoice]     = useState<PtoStatus>('approved'); // manager-added defaults to approved
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [source, setSource]                 = useState<PtoRequestSource | ''>('');
  const [sourceDetail, setSourceDetail]     = useState<string>('');
  // Partial-day time range. Empty strings = full day. Engineer sees them as
  // "Out from" / "Out until"; chip rendering computes the label.
  const [outFrom, setOutFrom]               = useState<string>('');
  const [outUntil, setOutUntil]             = useState<string>('');
  const [err, setErr]                       = useState<string | null>(null);

  // Binney default is 10h/day; per-engineer override wins (McCarthy = 8).
  // Reacts to whichever engineer is picked in the form.
  const dailyHoursQ = useEngineerPtoDailyHours(userId || null);
  const dailyHours = dailyHoursQ.data != null ? dailyHoursQ.data : 10;

  // Auto-compute hours: rate × every day in range. Binney's two 4×10 crews
  // cover all 7 days, so weekends are working days here.
  const computedHours = useMemo(() => {
    const days = daysBetween(startsOn, endsOn);
    if (days <= 0) return 0;
    return days * dailyHours;
  }, [startsOn, endsOn, dailyHours]);
  const finalHours = hoursOverride === '' ? computedHours : Number(hoursOverride);

  const eng = engineers?.find((e) => e.user_id === userId);

  // Per-engineer PTO balance for the live balance card that pops in once
  // an engineer is selected. We pick the current-year row (or the most
  // recent one if a current row doesn't exist yet for the engineer).
  const summaryQ = usePtoSummary();
  const currentYear = new Date().getFullYear();
  const balance = useMemo(() => {
    if (!userId) return null;
    const all = (summaryQ.data ?? []).filter((s) => s.user_id === userId);
    if (all.length === 0) return null;
    return (
      all.find((s) => s.year === currentYear) ??
      all.slice().sort((a, b) => b.year - a.year)[0]
    );
  }, [summaryQ.data, userId, currentYear]);

  const cap = type === 'vacation' && userId && startsOn && endsOn
    ? checkVacationCap(allRequests, userId, startsOn, endsOn)
    : { exceeded: false, conflicts: [] as CapConflict[] };

  const onSave = async () => {
    setErr(null);
    if (!userId)         { setErr('Pick an engineer.'); return; }
    if (!startsOn || !endsOn) { setErr('Pick dates.'); return; }
    if (endsOn < startsOn) { setErr('End date can\'t be before start date.'); return; }
    if (finalHours <= 0)   { setErr('Hours must be > 0.'); return; }
    if (!source)         { setErr('Pick a request source (audit trail).'); return; }

    if (type === 'vacation' && cap.exceeded && statusChoice === 'approved' && !overrideReason.trim()) {
      setErr('2-engineer vacation cap is exceeded — provide an override reason to approve directly.');
      return;
    }
    if (outFrom && outUntil && outUntil <= outFrom) {
      setErr('"Out until" must be later than "Out from".');
      return;
    }

    try {
      await submit.mutateAsync({
        user_id: userId,
        type,
        starts_on: startsOn,
        ends_on:   endsOn,
        hours:     finalHours,
        reason:    reason.trim() || null,
        status:    statusChoice,
        cap_override:        cap.exceeded && statusChoice === 'approved',
        cap_override_reason: cap.exceeded && statusChoice === 'approved' ? overrideReason.trim() : null,
        request_source:        source,
        request_source_detail: sourceDetail.trim() || null,
        out_from:  outFrom  || null,
        out_until: outUntil || null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 50,
      }}
      // No backdrop close — stray clicks must not nuke a half-filled form.
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{
          width: 'min(460px, 92vw)', height: '100%', overflow: 'auto', padding: '1.25rem',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-section-title">Add PTO</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>

        <p className="t-small t-muted mb-3">
          Manager-side direct entry. Use <strong>Pending</strong> for an engineer-style request that you still want to review; <strong>Approved</strong> for direct logging (e.g., bereavement, OnTheClock backfill).
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Engineer</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="">— pick —</option>
              {(engineers ?? [])
                .filter((e) => e.active && e.role === 'engineer')
                .sort((a, b) => a.full_name.localeCompare(b.full_name))
                .map((e) => (
                  <option key={e.user_id} value={e.user_id}>{e.full_name}</option>
                ))}
            </select>
          </label>

          {/* Per-engineer balance card. Appears once an engineer is picked.
              Personal type removed per ops decision (not offered) — tile
              and dropdown option both gone, grid drops to 2 cols. */}
          {userId && (
            <div className="col-span-2">
              {summaryQ.isLoading ? (
                <p className="t-small t-muted">Loading balance…</p>
              ) : balance ? (
                <div>
                  <div className="t-small t-muted uppercase tracking-wider mb-1">
                    Balance · {balance.year}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <BalanceTile
                      label="Vacation"
                      used={balance.vacation_used}
                      alloted={balance.vacation_alloted}
                      remaining={balance.vacation_remaining}
                      pending={finalHours}
                      active={type === 'vacation'}
                    />
                    <BalanceTile
                      label="Sick"
                      used={balance.sick_used}
                      alloted={balance.sick_alloted}
                      remaining={balance.sick_remaining}
                      pending={finalHours}
                      active={type === 'sick'}
                    />
                  </div>
                </div>
              ) : (
                <p className="t-small t-muted">No balance row for this engineer yet — log the request and the balance will track once a row is seeded.</p>
              )}
            </div>
          )}

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as PtoType)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              {/* Manager-loggable types in display order; ensure keeps any
                  legacy value (personal/unpaid) selectable when editing. */}
              <PtoTypeOptions options={PTO_MANAGER_TYPE_OPTIONS} ensure={type} />
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Status</span>
            <select value={statusChoice} onChange={(e) => setStatusChoice(e.target.value as PtoStatus)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="approved">Approved (direct)</option>
              <option value="pending">Pending (review queue)</option>
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Start date</span>
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">End date</span>
            <input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Hours <span className="t-muted">(auto: {computedHours}h — {dailyHours}h × days. Override below to change)</span>
            </span>
            <input
              type="number" min={0.5} step={0.5}
              value={hoursOverride}
              onChange={(e) => setHoursOverride(e.target.value)}
              placeholder={String(computedHours)}
              className="w-32 border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          {/* Partial-day window: optional. Leave both blank = full day(s).
              For "Mark comes in at noon": Out from blank, Out until 12:00.
              For "Mark leaves at 2pm":     Out from 14:00, Out until blank.
              For mid-day window:            both filled. */}
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Out from <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(leave blank = start of day)</span>
            </span>
            <input
              type="time"
              value={outFrom}
              onChange={(e) => setOutFrom(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Out until <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(leave blank = end of day)</span>
            </span>
            <input
              type="time"
              value={outUntil}
              onChange={(e) => setOutUntil(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          {(outFrom || outUntil) && (
            <p className="t-small t-muted col-span-2" style={{ marginTop: -6 }}>
              Partial day — engineer will be counted as "in (partial)" on the Coverage panel.
            </p>
          )}

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Reason (optional)</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. vacation, doctor appt, family event"
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          {/* Audit trail: where did this request come from? Required so every
              manager-entered PTO has a paper trail back to its origin. */}
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Request source <span style={{ color: 'var(--color-danger)' }}>*</span>
            </span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as PtoRequestSource | '')}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="">— pick —</option>
              {PTO_MANAGER_SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{PTO_REQUEST_SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Source detail <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(optional)</span>
            </span>
            <input
              type="text"
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              placeholder="e.g. text 3:42pm, voicemail, hallway"
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>
        </div>

        {/* Cap warning */}
        {type === 'vacation' && cap.exceeded && (
          <div className="mt-3 p-2 rounded" style={{ background: 'rgba(220,38,38,0.10)' }}>
            <p className="t-small" style={{ color: 'var(--color-danger)' }}>
              <strong>2-engineer cap exceeded.</strong>{' '}
              {cap.conflicts.map((c) => c.user_full_name).join(', ')} already off these dates.
            </p>
            {statusChoice === 'approved' && (
              <label className="block mt-2">
                <span className="t-small uppercase tracking-wider block mb-1" style={{ color: 'var(--color-danger)' }}>Override reason (logged)</span>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. urgent family matter — already arranged coverage"
                  className="w-full border rounded px-2 py-1 t-small"
                  style={{ borderColor: 'var(--color-danger)', background: 'var(--color-card)' }}
                />
              </label>
            )}
          </div>
        )}
        {type === 'vacation' && !cap.exceeded && cap.conflicts.length > 0 && (
          <p className="t-small t-muted mt-2">
            Note: {cap.conflicts.map((c) => c.user_full_name).join(', ')} also off these dates (within 2-engineer cap).
          </p>
        )}

        {eng && (
          <p className="t-small t-muted mt-2">
            For <strong>{eng.full_name}</strong> — {daysBetween(startsOn, endsOn)} day{daysBetween(startsOn, endsOn) === 1 ? '' : 's'}, {finalHours}h
          </p>
        )}

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={submit.isPending}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {submit.isPending ? 'Saving…' : 'Save PTO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Edit PTO request modal

function EditPtoModal({ request, onClose }: { request: PtoRequest; onClose: () => void }) {
  const update = useUpdatePto();
  const [type, setType]                 = useState<PtoType>(request.type);
  const [startsOn, setStartsOn]         = useState<string>(request.starts_on);
  const [endsOn, setEndsOn]             = useState<string>(request.ends_on);
  const [hours, setHours]               = useState<string>(String(request.hours));
  const [status, setStatus]             = useState<PtoStatus>(request.status);
  const [reason, setReason]             = useState<string>(request.reason ?? '');
  const [source, setSource]             = useState<PtoRequestSource | ''>(request.request_source ?? '');
  const [sourceDetail, setSourceDetail] = useState<string>(request.request_source_detail ?? '');
  // Postgres returns time as 'HH:MM:SS'; the <input type="time"> wants 'HH:MM'.
  const [outFrom, setOutFrom]           = useState<string>((request.out_from  ?? '').slice(0, 5));
  const [outUntil, setOutUntil]         = useState<string>((request.out_until ?? '').slice(0, 5));
  const [err, setErr]                   = useState<string | null>(null);

  // Live balance for this engineer (same card as Add and Quick modals).
  const summaryQ = usePtoSummary();
  const currentYear = new Date().getFullYear();
  const balance = useMemo(() => {
    const all = (summaryQ.data ?? []).filter((s) => s.user_id === request.user_id);
    if (all.length === 0) return null;
    return (
      all.find((s) => s.year === currentYear) ??
      all.slice().sort((a, b) => b.year - a.year)[0]
    );
  }, [summaryQ.data, request.user_id, currentYear]);

  const onSave = async () => {
    setErr(null);
    if (endsOn < startsOn) { setErr('End date can\'t be before start date.'); return; }
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) { setErr('Hours must be > 0.'); return; }
    if (outFrom && outUntil && outUntil <= outFrom) {
      setErr('"Out until" must be later than "Out from".');
      return;
    }
    try {
      await update.mutateAsync({
        id: request.id,
        patch: {
          type, starts_on: startsOn, ends_on: endsOn, hours: h, status,
          reason: reason.trim() || null,
          request_source: source || null,
          request_source_detail: sourceDetail.trim() || null,
          out_from:  outFrom  || null,
          out_until: outUntil || null,
        },
      });
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 50,
      }}
      // No backdrop close — stray clicks must not nuke a half-filled form.
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{
          width: 'min(460px, 92vw)', height: '100%', overflow: 'auto', padding: '1.25rem',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-section-title">Edit PTO</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>

        <p className="t-small t-muted mb-3">
          Editing <strong>{request.user_full_name ?? '?'}</strong>'s entry. Engineer is locked — use Delete + Add PTO if you need to reassign to a different engineer.
        </p>

        {/* Live balance for this engineer. NOTE: passing pending=0 so the
            forecast doesn't double-count the CURRENT request's hours
            (those are already inside balance.X_used). Personal removed
            per ops decision (not offered). */}
        {balance && (
          <div className="mb-3">
            <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontSize: '0.65rem' }}>
              Balance · {balance.year}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <BalanceTile
                label="Vacation"
                used={balance.vacation_used}
                alloted={balance.vacation_alloted}
                remaining={balance.vacation_remaining}
                pending={0}
                active={type === 'vacation'}
              />
              <BalanceTile
                label="Sick"
                used={balance.sick_used}
                alloted={balance.sick_alloted}
                remaining={balance.sick_remaining}
                pending={0}
                active={type === 'sick'}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as PtoType)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              {/* Manager-loggable types in display order; ensure keeps any
                  legacy value (personal/unpaid) selectable when editing. */}
              <PtoTypeOptions options={PTO_MANAGER_TYPE_OPTIONS} ensure={type} />
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as PtoStatus)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="denied">Denied</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Start date</span>
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">End date</span>
            <input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Hours</span>
            <input type="number" min={0.25} step={0.25}
              value={hours} onChange={(e) => setHours(e.target.value)}
              className="w-32 border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Out from <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(blank = start of day)</span>
            </span>
            <input type="time" value={outFrom} onChange={(e) => setOutFrom(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">
              Out until <span className="t-muted normal-case" style={{ textTransform: 'none' }}>(blank = end of day)</span>
            </span>
            <input type="time" value={outUntil} onChange={(e) => setOutUntil(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Reason</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value as PtoRequestSource | '')}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="">— none —</option>
              {PTO_MANAGER_SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{PTO_REQUEST_SOURCE_LABELS[s]}</option>
              ))}
              {/* Allow keeping the original source even if it's a system value */}
              {request.request_source && !PTO_MANAGER_SOURCE_OPTIONS.includes(request.request_source) && (
                <option value={request.request_source}>
                  {PTO_REQUEST_SOURCE_LABELS[request.request_source]} (existing)
                </option>
              )}
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Source detail</span>
            <input type="text" value={sourceDetail} onChange={(e) => setSourceDetail(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>
        </div>

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={update.isPending}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Edit balance modal

function EditBalanceModal({ summary, onClose }: { summary: PtoSummary; onClose: () => void }) {
  const update = useUpdatePtoBalance();
  // Binney default is 10h/day; per-engineer override (e.g. McCarthy = 8) wins.
  const dailyHoursQ = useEngineerPtoDailyHours(summary.user_id);
  const sickDailyHours = dailyHoursQ.data != null ? dailyHoursQ.data : 10;
  const [vac, setVac]   = useState<string>(String(summary.vacation_alloted));
  const [sick, setSick] = useState<string>(String(summary.sick_alloted));
  const [holiday, setHoliday] = useState<string>(String(summary.holiday_alloted));
  const [err, setErr]   = useState<string | null>(null);

  const onSave = async () => {
    setErr(null);
    try {
      await update.mutateAsync({
        user_id: summary.user_id,
        year:    summary.year,
        vacation_alloted: Number(vac),
        sick_alloted:     Number(sick),
        holiday_alloted:  Number(holiday),
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 50,
      }}
      // No backdrop close — stray clicks must not nuke a half-filled form.
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{
          width: 'min(380px, 92vw)', height: '100%', overflow: 'auto', padding: '1.25rem',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-section-title">{summary.user_full_name} · {summary.year} allotment</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>

        <p className="t-small t-muted mb-3">
          Used hours are computed from approved requests — only the annual allotment is editable here.
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Vacation Allotted</span>
            <input type="number" min={0} value={vac} onChange={(e) => setVac(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }} />
            <p className="t-small t-muted mt-1">Used: {summary.vacation_used}h</p>
            <details className="mt-1">
              <summary className="t-small t-muted cursor-pointer" style={{ fontSize: '0.7rem' }}>
                Vacation entitlement schedule (by length of service)
              </summary>
              <table className="t-small t-mono mt-1" style={{ borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))' }}>
                    <td className="pr-3 py-0.5 t-muted">After probation – &lt;3 yrs</td>
                    <td className="text-right py-0.5">2 wks</td>
                    <td className="pl-2 py-0.5 t-muted">80h</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))' }}>
                    <td className="pr-3 py-0.5 t-muted">3 yrs – &lt;8 yrs</td>
                    <td className="text-right py-0.5">3 wks</td>
                    <td className="pl-2 py-0.5 t-muted">120h</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))' }}>
                    <td className="pr-3 py-0.5 t-muted">8 yrs – &lt;18 yrs</td>
                    <td className="text-right py-0.5">4 wks</td>
                    <td className="pl-2 py-0.5 t-muted">160h</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5 t-muted">18+ yrs</td>
                    <td className="text-right py-0.5">5 wks</td>
                    <td className="pl-2 py-0.5 t-muted">200h</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Sick Allotted</span>
            <input type="number" min={0} value={sick} onChange={(e) => setSick(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }} />
            <p className="t-small t-muted mt-1">Used: {summary.sick_used}h</p>
            <details className="mt-1">
              <summary className="t-small t-muted cursor-pointer" style={{ fontSize: '0.7rem' }}>
                Sick day schedule ({sickDailyHours}h/day · by length of service)
              </summary>
              <table className="t-small t-mono mt-1" style={{ borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                <tbody>
                  {SICK_ACCRUAL.map((r, i) => (
                    <tr
                      key={r.label}
                      style={i < SICK_ACCRUAL.length - 1
                        ? { borderBottom: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))' }
                        : undefined}
                    >
                      <td className="pr-3 py-0.5 t-muted">{r.label}</td>
                      <td className="text-right py-0.5">{r.days} days</td>
                      <td className="pl-2 py-0.5 t-muted">{r.days * sickDailyHours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Floating Holiday Allotted</span>
            <input type="number" min={0} value={holiday} onChange={(e) => setHoliday(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }} />
            <p className="t-small t-muted mt-1">Used: {summary.holiday_used}h</p>
          </label>
        </div>

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={update.isPending}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
