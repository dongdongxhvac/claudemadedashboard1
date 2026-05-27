// §12 — PTO coverage (Phase 12a, self-built).
//
// Manager-side: submit PTO on behalf of any engineer, approve/deny pending
// requests, see who's out today / upcoming, monitor balances, enforce the
// 2-engineer vacation cap. Engineer self-serve comes in Phase 12b.
//
// Cap rule: at most 2 engineers on vacation any given day. Sick has no cap.
// Cap can be overridden by manager at submit OR approve time (logged with
// reason for audit).
import { useMemo, useState } from 'react';
import {
  usePtoRequests, usePtoSummary, usePtoBuckets, usePtoRealtime,
  useSubmitPto, useReviewPto, useCancelPto, useUpdatePtoBalance,
  checkVacationCap, PTO_TYPE_LABELS,
  type PtoRequest, type PtoSummary, type PtoType, type PtoStatus, type CapConflict,
} from '../hooks/usePto';
import { useEngineers, type EngineerRow } from '../hooks/useEngineers';
import { useShifts } from '../hooks/useShifts';
import {
  useOncallParticipants, useOncallSettings,
  addDaysIso, fmtMd as fmtMdOnc,
} from '../hooks/useOncall';
import { useOvertimePosts, type OvertimePost } from '../hooks/useOvertime';
import { useCurrentBuildingAssignments, type BuildingAssignment } from '../hooks/useBuildingAssignments';
import { useBuildings, type Building } from '../hooks/useBuildings';
import { Section } from './Section';

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
};
const PTO_TYPE_BG: Record<PtoType, string> = {
  vacation:    'rgba(59,130,246,0.06)',
  sick:        'rgba(239,68,68,0.05)',
  personal:    'rgba(20,184,166,0.05)',
  bereavement: 'rgba(168,85,247,0.05)',
  holiday:     'rgba(16,185,129,0.05)',
  unpaid:      'rgba(100,116,139,0.05)',
};

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

export function PtoPanel() {
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
  const [showEditBalance, setShowEditBalance] = useState<PtoSummary | null>(null);

  const review     = useReviewPto();
  const cancel     = useCancelPto();

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
    <Section title="§12 PTO coverage" subtitle={subtitle} loading={requestsQ.isLoading}>
      {requestsQ.error ? (
        <p className="t-text t-danger">Error: {(requestsQ.error as Error).message}</p>
      ) : (
        <div className="space-y-4">
          {/* Pending approvals */}
          <PendingQueue
            pending={buckets.pending}
            all={buckets.all}
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

          {/* Today's attendance — every engineer as a chip, working ones
              clickable to one-click log them sick. */}
          <TodayAttendance
            engineers={engineersQ.data ?? []}
            shifts={shiftsQ.data ?? []}
            outToday={buckets.outToday}
          />

          {/* 9-week vacation-cap heatmap */}
          <CapHeatmap requests={buckets.all} weeks={9} />

          {/* Upcoming approved, grouped */}
          {buckets.upcoming.length > 0 && (
            <UpcomingGroupedList
              rows={buckets.upcoming.filter((r) => r.ends_on >= todayIso())}
              onCancel={(id) => {
                if (confirm('Cancel this approved PTO?')) cancel.mutate(id);
              }}
            />
          )}

          {/* Balances */}
          {(summaryQ.data ?? []).length > 0 && (
            <BalancesGrid
              summaries={summaryQ.data ?? []}
              onEdit={(s) => setShowEditBalance(s)}
            />
          )}
        </div>
      )}

      {showAdd && (
        <AddPtoModal
          engineers={engineersQ.data ?? []}
          allRequests={buckets.all}
          onClose={() => setShowAdd(false)}
        />
      )}
      {showEditBalance && (
        <EditBalanceModal
          summary={showEditBalance}
          onClose={() => setShowEditBalance(null)}
        />
      )}
    </Section>
  );
}

// ───────────────────────────── Pending approval queue

function PendingQueue({
  pending, all, onApprove, onDeny,
}: {
  pending: PtoRequest[];
  all: PtoRequest[];
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
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </ul>
    </div>
  );
}

function PendingRow({
  req, allRequests, onApprove, onDeny,
}: {
  req: PtoRequest;
  allRequests: PtoRequest[];
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
          <span className="t-muted"> · {PTO_TYPE_LABELS[req.type]}</span>
          <span className="t-muted"> · {fmtRange(req.starts_on, req.ends_on)} ({req.days}d / {req.hours}h)</span>
        </div>
        <div className="t-small t-muted">
          submitted {new Date(req.submitted_at).toLocaleDateString()}
          {req.submitted_by_name && req.submitted_by_name !== req.user_full_name &&
            <> by {req.submitted_by_name}</>}
        </div>
      </div>
      {req.reason && <p className="t-small t-muted mt-1">{req.reason}</p>}

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
          placeholder="Reason for denial (sent to engineer)"
          className="flex-1 border rounded px-2 py-1 t-small"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', minWidth: 200 }}
        />
        <button
          onClick={() => onDeny(req.id, denyNote.trim() || null)}
          className="t-small px-3 py-1 rounded font-medium text-white"
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

function UpcomingGroupedList({ rows, onCancel }: { rows: PtoRequest[]; onCancel: (id: string) => void }) {
  const groups = useMemo(() => groupUpcoming(rows, todayIso()), [rows]);
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">Upcoming approved</div>
      <div className="space-y-3">
        {groups.thisWeek.length > 0  && <UpcomingBucket label="This week"  rows={groups.thisWeek}  onCancel={onCancel} />}
        {groups.thisMonth.length > 0 && <UpcomingBucket label="This month" rows={groups.thisMonth} onCancel={onCancel} />}
        {groups.later.length > 0     && <UpcomingBucket label="Later"      rows={groups.later}     onCancel={onCancel} />}
      </div>
    </div>
  );
}

function UpcomingBucket({ label, rows, onCancel }: { label: string; rows: PtoRequest[]; onCancel: (id: string) => void }) {
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
            <span className="t-muted" style={{ minWidth: 70 }}>{PTO_TYPE_LABELS[r.type]}</span>
            <span className="t-mono">{fmtRange(r.starts_on, r.ends_on)} <span className="t-muted">({r.days}d · {r.hours}h)</span></span>
            {r.reason && <span className="t-muted">· {r.reason}</span>}
            {r.cap_override && (
              <span
                className="px-1 py-0.5 rounded"
                style={{ background: 'rgba(234,88,12,0.15)', color: '#c2410c', fontSize: 9, fontWeight: 600 }}
                title={`Cap override: ${r.cap_override_reason ?? ''}`}
              >OVERRIDE</span>
            )}
            <button
              onClick={() => onCancel(r.id)}
              className="ml-auto t-muted hover:t-danger"
              title="Cancel this PTO"
              style={{ fontSize: 14, lineHeight: 1 }}
            >×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────────── Today attendance (interactive roll)

function TodayAttendance({
  engineers, shifts, outToday,
}: {
  engineers: EngineerRow[];
  shifts: { id: string; name: string; sort_order: number }[];
  outToday: PtoRequest[];
}) {
  const submit = useSubmitPto();
  // Build a quick lookup: user_id → today's active PTO record (if any).
  const ptoByUser = useMemo(() => {
    const m = new Map<string, PtoRequest>();
    for (const r of outToday) m.set(r.user_id, r);
    return m;
  }, [outToday]);

  // Group active engineers by shift in sort_order; engineers without a
  // shift go to a trailing "Other" bucket.
  const groups = useMemo(() => {
    const orderedShifts = shifts.slice().sort((a, b) => a.sort_order - b.sort_order);
    const byShift = new Map<string, EngineerRow[]>();
    const noShift: EngineerRow[] = [];
    for (const e of engineers) {
      if (!e.active || e.role !== 'engineer') continue;
      if (e.shift_id && byShift.has(e.shift_id) || e.shift_id) {
        const cur = byShift.get(e.shift_id!) ?? [];
        cur.push(e);
        byShift.set(e.shift_id!, cur);
      } else {
        noShift.push(e);
      }
    }
    const out = orderedShifts.map((s) => ({
      shift_id: s.id,
      label: s.name,
      engineers: (byShift.get(s.id) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    })).filter((g) => g.engineers.length > 0);
    if (noShift.length > 0) {
      out.push({
        shift_id: '_noshift',
        label: 'No shift',
        engineers: noShift.sort((a, b) => a.full_name.localeCompare(b.full_name)),
      });
    }
    return out;
  }, [engineers, shifts]);

  const onSick = (eng: EngineerRow) => {
    if (!confirm(`Mark ${eng.full_name} out sick today (8h)? This logs an approved sick PTO for today and deducts 8h from balance.`)) return;
    const today = todayIso();
    submit.mutate({
      user_id:  eng.user_id,
      type:     'sick',
      starts_on: today,
      ends_on:   today,
      hours:     8,
      status:   'approved',
      reason:   'called out',
    });
  };

  const outCount = outToday.length;
  const totalActive = engineers.filter((e) => e.active && e.role === 'engineer').length;
  const inCount = totalActive - outCount;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <div className="t-small t-muted uppercase tracking-wider">
          Today attendance · <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{inCount}/{totalActive} in</span>
          {outCount > 0 && (
            <span style={{ color: 'var(--color-warn, #d97706)', marginLeft: 6, fontWeight: 600 }}>
              · {outCount} out
            </span>
          )}
        </div>
        <span className="t-small t-muted" style={{ fontSize: 11 }}>
          Click a working engineer to mark them sick today
        </span>
      </div>

      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.shift_id}>
            <div className="t-small t-muted uppercase tracking-wider mb-1" style={{ fontSize: 10 }}>
              {g.label} shift
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.engineers.map((eng) => {
                const pto = ptoByUser.get(eng.user_id);
                return (
                  <AttendanceChip
                    key={eng.user_id}
                    engineer={eng}
                    pto={pto ?? null}
                    onSick={onSick}
                    disabled={submit.isPending}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendanceChip({
  engineer, pto, onSick, disabled,
}: {
  engineer: EngineerRow;
  pto: PtoRequest | null;
  onSick: (eng: EngineerRow) => void;
  disabled: boolean;
}) {
  const out  = pto !== null;
  const bg     = out ? PTO_TYPE_BG[pto!.type]    : 'rgba(34,197,94,0.08)';
  const border = out ? PTO_TYPE_COLOR[pto!.type] : '#10b981';
  const label  = out
    ? `${PTO_TYPE_LABELS[pto!.type]}${pto!.ends_on !== todayIso() ? ` · returns ${fmtMd(pto!.ends_on)}` : ''}${pto!.reason ? ' · ' + pto!.reason : ''}`
    : 'Working today — click to log sick';
  return (
    <button
      type="button"
      onClick={out ? undefined : () => onSick(engineer)}
      disabled={disabled || out}
      title={label}
      className="t-small"
      style={{
        padding: '0.25rem 0.55rem',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: out ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {out
        ? <span style={{ color: border, fontWeight: 600 }}>● {engineer.full_name}</span>
        : <span style={{ color: 'var(--color-text)' }}>○ {engineer.full_name}</span>}
      {out && (
        <span
          style={{
            background: border, color: 'white',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            padding: '0.05rem 0.3rem', borderRadius: 3,
          }}
        >
          {pto!.type === 'sick' ? 'SICK' : pto!.type === 'vacation' ? 'VAC' : pto!.type.slice(0, 4).toUpperCase()}
        </span>
      )}
    </button>
  );
}

// ───────────────────────────── Cap heatmap (9-week vacation calendar)

function CapHeatmap({ requests, weeks }: { requests: PtoRequest[]; weeks: number }) {
  // Build day-keyed map of engineers on approved/pending vacation. Each cell
  // shows the count + tooltip with names; color scales 0 (green) → 1 (yellow)
  // → 2 (red = cap pinned) → 3+ (deep red = overridden).
  const today = todayIso();
  // Start on the most recent Monday so the calendar grid aligns to weeks.
  const start = (() => {
    const d = new Date(today + 'T00:00:00');
    const dow = d.getDay();                       // 0=Sun ... 6=Sat
    const back = (dow + 6) % 7;                   // days back to Monday
    d.setDate(d.getDate() - back);
    return d.toISOString().slice(0, 10);
  })();
  const totalDays = weeks * 7;

  // Per-day list of engineer names on vacation (approved or pending), for
  // both heat color and tooltip.
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of requests) {
      if (r.type !== 'vacation') continue;
      if (r.status !== 'approved' && r.status !== 'pending') continue;
      // Walk dates from starts_on to ends_on, push name into each day's bucket
      let cur = r.starts_on;
      while (cur <= r.ends_on) {
        const cur2 = cur;
        const cur3 = cur2;
        const cur4 = cur3;
        const cur5 = cur4;
        void cur5; // (keep eslint happy if it complains about unused locals)
        const list = m.get(cur) ?? [];
        list.push(`${r.user_full_name ?? '?'}${r.status === 'pending' ? ' (pending)' : ''}`);
        m.set(cur, list);
        // Increment date
        const d = new Date(cur + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        cur = d.toISOString().slice(0, 10);
      }
    }
    return m;
  }, [requests]);

  // Render: rows = Mon..Sun, columns = weeks. Each cell is small (12px).
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  // Pre-compute the ISO date string for each cell, plus month labels.
  const cells: { iso: string; col: number; row: number; isToday: boolean; isWeekend: boolean; names: string[] }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const row = i % 7;
    const col = Math.floor(i / 7);
    const isWeekend = row >= 5;
    const isToday = iso === today;
    const names = byDay.get(iso) ?? [];
    cells.push({ iso, col, row, isWeekend, isToday, names });
  }

  // Month labels — one per week column showing the month boundary.
  const weekLabels: { col: number; label: string }[] = [];
  let lastMonth = '';
  for (let c = 0; c < weeks; c++) {
    const cellAtRow0 = cells[c * 7];
    const m = new Date(cellAtRow0.iso + 'T00:00:00').toLocaleString(undefined, { month: 'short' });
    weekLabels.push({ col: c, label: m === lastMonth ? '' : m });
    lastMonth = m;
  }

  const color = (count: number): string => {
    if (count <= 0) return '#dcfce7';   // green-100
    if (count === 1) return '#fef9c3';  // yellow-100
    if (count === 2) return '#fed7aa';  // orange-200 (cap pinned)
    return '#fecaca';                   // red-200 (override / over cap)
  };

  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2 flex items-baseline gap-2 flex-wrap">
        <span>Vacation cap heatmap · next {weeks} weeks</span>
        <span className="t-muted" style={{ textTransform: 'none', fontSize: 11 }}>
          0 ◻︎ &nbsp; 1 ◻︎ &nbsp; <span style={{ color: '#c2410c' }}>2 (cap)</span> &nbsp; <span style={{ color: 'var(--color-danger)' }}>3+ (override)</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {/* Day-of-week labels column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 18 }}>
          {days.map((d) => (
            <div key={d} className="t-muted" style={{ fontSize: 9, height: 14, lineHeight: '14px', textAlign: 'right', width: 24 }}>
              {d}
            </div>
          ))}
        </div>
        {/* Heatmap grid */}
        <div>
          {/* Month labels row */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, 14px)`, gap: 2, marginBottom: 4 }}>
            {weekLabels.map((w) => (
              <div key={w.col} className="t-muted" style={{ fontSize: 9, height: 12, textAlign: 'left' }}>
                {w.label}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, 14px)`, gridTemplateRows: 'repeat(7, 14px)', gap: 2, gridAutoFlow: 'column' }}>
            {cells.map((cell) => {
              const count = cell.names.length;
              return (
                <div
                  key={cell.iso}
                  title={
                    `${cell.iso}${cell.isToday ? ' (today)' : ''}\n` +
                    (count === 0 ? 'No one on vacation' : cell.names.join(', '))
                  }
                  style={{
                    width: 14, height: 14, borderRadius: 2,
                    background: color(count),
                    opacity: cell.isWeekend ? 0.55 : 1,
                    border: cell.isToday ? '1.5px solid var(--color-accent)' : '1px solid rgba(0,0,0,0.05)',
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Balances grid

function BalancesGrid({ summaries, onEdit }: { summaries: PtoSummary[]; onEdit: (s: PtoSummary) => void }) {
  const currentYear = new Date().getFullYear();
  const rows = summaries
    .filter((s) => s.year === currentYear)
    .sort((a, b) => (a.user_full_name ?? '').localeCompare(b.user_full_name ?? ''));
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">Balances ({currentYear})</div>
      <table className="min-w-full t-text t-small border-collapse">
        <thead>
          <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
            <th className="py-1 pr-3">Engineer</th>
            <th className="py-1 pr-3 text-right">Vacation</th>
            <th className="py-1 pr-3 text-right">Sick</th>
            <th className="py-1 pr-3 text-right">Personal</th>
            <th className="py-1 pl-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-3 font-medium">{s.user_full_name ?? '?'}</td>
              <BalanceCell remaining={s.vacation_remaining} used={s.vacation_used} alloted={s.vacation_alloted} />
              <BalanceCell remaining={s.sick_remaining}     used={s.sick_used}     alloted={s.sick_alloted} />
              <BalanceCell remaining={s.personal_remaining} used={s.personal_used} alloted={s.personal_alloted} />
              <td className="py-1 pl-2 text-right">
                <button onClick={() => onEdit(s)} className="t-small t-accent hover:underline">edit allotment</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceCell({ remaining, used, alloted }: { remaining: number; used: number; alloted: number }) {
  if (alloted === 0) return <td className="py-1 pr-3 text-right t-muted">—</td>;
  const color = remaining <= 0 ? 'var(--color-danger)' : remaining <= 8 ? 'var(--color-warn, #d97706)' : 'var(--color-text)';
  return (
    <td className="py-1 pr-3 text-right t-mono">
      <span style={{ color, fontWeight: remaining <= 8 ? 600 : 400 }}>{remaining}h</span>
      <span className="t-muted ml-1" style={{ fontSize: '0.7rem' }}>({used}/{alloted})</span>
    </td>
  );
}

// ───────────────────────────── Add PTO modal

function AddPtoModal({
  engineers, allRequests, onClose,
}: {
  engineers: ReturnType<typeof useEngineers>['data'];
  allRequests: PtoRequest[];
  onClose: () => void;
}) {
  const submit = useSubmitPto();
  const today  = todayIso();

  const [userId, setUserId]                 = useState<string>('');
  const [type, setType]                     = useState<PtoType>('vacation');
  const [startsOn, setStartsOn]             = useState<string>(today);
  const [endsOn, setEndsOn]                 = useState<string>(today);
  const [hoursOverride, setHoursOverride]   = useState<string>('');  // blank = auto (8 * weekdays)
  const [reason, setReason]                 = useState<string>('');
  const [statusChoice, setStatusChoice]     = useState<PtoStatus>('approved'); // manager-added defaults to approved
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [err, setErr]                       = useState<string | null>(null);

  // Auto-compute hours: 8h × number of weekdays in range.
  const computedHours = useMemo(() => {
    const days = daysBetween(startsOn, endsOn);
    if (days <= 0) return 0;
    let weekdays = 0;
    const cur = new Date(startsOn + 'T00:00:00');
    for (let i = 0; i < days; i++) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) weekdays++;
      cur.setDate(cur.getDate() + 1);
    }
    return weekdays * 8;
  }, [startsOn, endsOn]);
  const finalHours = hoursOverride === '' ? computedHours : Number(hoursOverride);

  const eng = engineers?.find((e) => e.user_id === userId);

  const cap = type === 'vacation' && userId && startsOn && endsOn
    ? checkVacationCap(allRequests, userId, startsOn, endsOn)
    : { exceeded: false, conflicts: [] as CapConflict[] };

  const onSave = async () => {
    setErr(null);
    if (!userId)         { setErr('Pick an engineer.'); return; }
    if (!startsOn || !endsOn) { setErr('Pick dates.'); return; }
    if (endsOn < startsOn) { setErr('End date can\'t be before start date.'); return; }
    if (finalHours <= 0)   { setErr('Hours must be > 0.'); return; }

    if (type === 'vacation' && cap.exceeded && statusChoice === 'approved' && !overrideReason.trim()) {
      setErr('2-engineer vacation cap is exceeded — provide an override reason to approve directly.');
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
      onClick={onClose}
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

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as PtoType)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              {(Object.entries(PTO_TYPE_LABELS) as [PtoType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
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
              Hours <span className="t-muted">(auto: {computedHours}h — 8h × weekdays. Override below to change)</span>
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

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Reason (optional)</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. vacation, doctor appt, family event"
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

// ───────────────────────────── Edit balance modal

function EditBalanceModal({ summary, onClose }: { summary: PtoSummary; onClose: () => void }) {
  const update = useUpdatePtoBalance();
  const [vac, setVac]   = useState<string>(String(summary.vacation_alloted));
  const [sick, setSick] = useState<string>(String(summary.sick_alloted));
  const [pers, setPers] = useState<string>(String(summary.personal_alloted));
  const [err, setErr]   = useState<string | null>(null);

  const onSave = async () => {
    setErr(null);
    try {
      await update.mutateAsync({
        user_id: summary.user_id,
        year:    summary.year,
        vacation_alloted: Number(vac),
        sick_alloted:     Number(sick),
        personal_alloted: Number(pers),
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
      onClick={onClose}
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
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Vacation alloted</span>
            <input type="number" min={0} value={vac} onChange={(e) => setVac(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }} />
            <p className="t-small t-muted mt-1">Used: {summary.vacation_used}h</p>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Sick alloted</span>
            <input type="number" min={0} value={sick} onChange={(e) => setSick(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }} />
            <p className="t-small t-muted mt-1">Used: {summary.sick_used}h</p>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Personal alloted</span>
            <input type="number" min={0} value={pers} onChange={(e) => setPers(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text t-mono"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }} />
            <p className="t-small t-muted mt-1">Used: {summary.personal_used}h</p>
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
