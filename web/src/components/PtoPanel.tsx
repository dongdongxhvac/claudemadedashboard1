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
import { useEngineers } from '../hooks/useEngineers';
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

// ───────────────────────────── component

export function PtoPanel() {
  usePtoRealtime();
  const requestsQ  = usePtoRequests();
  const summaryQ   = usePtoSummary();
  const engineersQ = useEngineers();
  const buckets    = usePtoBuckets();

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

          {/* Out today */}
          {buckets.outToday.length > 0 && (
            <div>
              <div className="t-small t-muted uppercase tracking-wider mb-2">Out today</div>
              <ul className="space-y-1">
                {buckets.outToday.map((r) => (
                  <li
                    key={r.id}
                    className="t-small"
                    style={{
                      padding: '0.3rem 0.6rem',
                      borderLeft: `3px solid ${r.type === 'vacation' ? '#3b82f6' : '#ef4444'}`,
                      background: r.type === 'vacation' ? 'rgba(59,130,246,0.06)' : 'rgba(239,68,68,0.05)',
                      borderRadius: 4,
                    }}
                  >
                    <strong>{r.user_full_name ?? '?'}</strong>
                    <span className="t-muted"> · {PTO_TYPE_LABELS[r.type]}</span>
                    <span className="t-muted"> · returns {fmtMd(r.ends_on)}</span>
                    {r.reason && <span className="t-muted"> · {r.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Upcoming approved */}
          {buckets.upcoming.length > 0 && (
            <UpcomingList
              rows={buckets.upcoming.filter((r) => r.ends_on >= todayIso()).slice(0, 10)}
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

function UpcomingList({ rows, onCancel }: { rows: PtoRequest[]; onCancel: (id: string) => void }) {
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">Upcoming approved</div>
      <table className="min-w-full t-text t-small border-collapse">
        <thead>
          <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
            <th className="py-1 pr-2">Engineer</th>
            <th className="py-1 pr-2">Type</th>
            <th className="py-1 pr-2">Dates</th>
            <th className="py-1 pr-2 text-right">Hours</th>
            <th className="py-1 pr-2">Reason</th>
            <th className="py-1 pl-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-2 font-medium">{r.user_full_name ?? '?'}</td>
              <td className="py-1 pr-2">{PTO_TYPE_LABELS[r.type]}</td>
              <td className="py-1 pr-2 t-mono">{fmtRange(r.starts_on, r.ends_on)} ({r.days}d)</td>
              <td className="py-1 pr-2 text-right t-mono">{r.hours}h</td>
              <td className="py-1 pr-2 t-muted">
                {r.reason ?? '—'}
                {r.cap_override && (
                  <span
                    className="ml-1 px-1 py-0.5 rounded"
                    style={{ background: 'rgba(234,88,12,0.15)', color: '#c2410c', fontSize: 9, fontWeight: 600 }}
                    title={`Cap override: ${r.cap_override_reason ?? ''}`}
                  >OVERRIDE</span>
                )}
              </td>
              <td className="py-1 pl-2 text-right">
                <button onClick={() => onCancel(r.id)} className="t-small t-muted hover:t-danger" title="Cancel">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
