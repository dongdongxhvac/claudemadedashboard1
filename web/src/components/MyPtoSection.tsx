// Phase 12b — engineer self-serve PTO mini-section.
//
// Rendered inside /engineer/me (both Mobile + Pc layouts). Locked to the
// signed-in engineer's user_id (passed in by the parent) so the engineer
// only ever sees and acts on their own data.
//
// Capabilities:
//   • see this year's balances (vacation / sick / personal: remaining,
//     used, alloted)
//   • see this year's PTO log (every entry, status-colored)
//   • submit a new request — status forced to 'pending', goes to manager
//     queue for approval. The 2-engineer vacation cap is shown as a
//     warning if exceeded, but engineer can still submit (manager decides
//     at approve time).
//   • cancel their own pending request (RLS allows engineer → cancelled)
//
// RLS policies that make this work were added in migration
// `phase_12b_pto_self_serve_rls`. The existing useSubmitPto / useCancelPto
// hooks Just Work because they use the same supabase client.

import { useMemo, useState } from 'react';
import {
  usePtoRequests, usePtoSummary, usePtoRealtime,
  useSubmitPto, useCancelPto,
  checkVacationCap,
  type PtoRequest, type PtoType,
} from '../hooks/usePto';
import { PtoYearLog } from './PtoPanel';

// Engineer self-serve only exposes the two real time-off categories.
// Everything else (personal/holiday/bereavement/unpaid) goes through the
// manager who has the full set in Add PTO.
const PTO_TYPE_OPTIONS: { value: PtoType; label: string }[] = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick',     label: 'Sick' },
];

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000,
  ) + 1;
}

export function MyPtoSection({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const reqQ     = usePtoRequests();
  const summaryQ = usePtoSummary();
  usePtoRealtime();

  const year = new Date().getFullYear();

  const myRequests = useMemo(
    () => (reqQ.data ?? []).filter((r) => r.user_id === userId),
    [reqQ.data, userId],
  );
  const mySummary = useMemo(
    () => (summaryQ.data ?? []).find((s) => s.user_id === userId && s.year === year) ?? null,
    [summaryQ.data, userId, year],
  );
  const myYearLog = useMemo(
    () => myRequests.filter((r) => r.starts_on.startsWith(String(year))),
    [myRequests, year],
  );

  const pendingMine = useMemo(
    () => myRequests.filter((r) => r.status === 'pending'),
    [myRequests],
  );

  const [showForm, setShowForm] = useState(false);

  return (
    <section className={compact ? '' : 't-card'} style={compact ? undefined : { padding: 0 }}>
      <div className={compact ? 'px-3 py-2' : 'px-4 py-3'} style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="t-section-title">My time off</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="t-small px-2 py-1 rounded border"
            style={{
              background: showForm ? 'var(--color-card)' : 'var(--color-accent)',
              color: showForm ? 'var(--color-text-muted)' : '#fff',
              borderColor: showForm ? 'var(--color-border)' : 'var(--color-accent)',
            }}
          >
            {showForm ? 'Cancel' : '+ Request PTO'}
          </button>
        </div>

        {/* Balances strip */}
        {mySummary && (
          <div className="flex flex-wrap gap-3 mt-2 t-small">
            <BalanceChip label="Vacation" remaining={mySummary.vacation_remaining} used={mySummary.vacation_used} alloted={mySummary.vacation_alloted} />
            <BalanceChip label="Sick"     remaining={mySummary.sick_remaining}     used={mySummary.sick_used}     alloted={mySummary.sick_alloted} />
            {mySummary.personal_alloted > 0 && (
              <BalanceChip label="Personal" remaining={mySummary.personal_remaining} used={mySummary.personal_used} alloted={mySummary.personal_alloted} />
            )}
          </div>
        )}
      </div>

      {showForm && (
        <RequestForm
          userId={userId}
          allRequests={reqQ.data ?? []}
          onDone={() => setShowForm(false)}
        />
      )}

      {/* Pending — surface separately so engineer can cancel quickly */}
      {pendingMine.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
          <div className="t-small t-muted uppercase tracking-wider mb-1.5">
            Awaiting manager approval ({pendingMine.length})
          </div>
          <PendingMineList rows={pendingMine} />
        </div>
      )}

      {/* Year log */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
        <div className="t-small t-muted uppercase tracking-wider mb-1.5">
          {year} log
        </div>
        {reqQ.isLoading ? (
          <p className="t-small t-muted italic">Loading…</p>
        ) : (
          <PtoYearLog rows={myYearLog} year={year} />
        )}
      </div>
    </section>
  );
}

function BalanceChip({
  label, remaining, used, alloted,
}: {
  label: string; remaining: number; used: number; alloted: number;
}) {
  if (alloted === 0) {
    return (
      <span className="t-small t-muted" style={{
        padding: '0.2rem 0.55rem', borderRadius: 999,
        border: '1px solid var(--color-border-soft)',
      }}>
        {label}: —
      </span>
    );
  }
  const color = remaining <= 0 ? 'var(--color-danger)'
              : remaining <= 8 ? 'var(--color-warn, #d97706)'
              : 'var(--color-text)';
  return (
    <span style={{
      padding: '0.2rem 0.55rem', borderRadius: 999,
      border: '1px solid var(--color-border-soft)',
      background: 'var(--color-card)',
      display: 'inline-flex', alignItems: 'baseline', gap: 4,
    }}>
      <span className="t-muted">{label}:</span>
      <span style={{ color, fontWeight: remaining <= 8 ? 600 : 500 }}>{remaining}h</span>
      <span className="t-muted t-mono" style={{ fontSize: '0.65rem' }}>({used}/{alloted})</span>
    </span>
  );
}

function PendingMineList({ rows }: { rows: PtoRequest[] }) {
  const cancel = useCancelPto();
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.id}
          className="t-small flex items-baseline gap-2 flex-wrap"
          style={{
            padding: '0.3rem 0.6rem',
            background: 'rgba(234,179,8,0.08)',
            borderLeft: '3px solid #f59e0b',
            borderRadius: 4,
          }}
        >
          <span className="t-mono" style={{ minWidth: 90 }}>
            {r.starts_on === r.ends_on
              ? new Date(r.starts_on + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : `${new Date(r.starts_on + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(r.ends_on + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
          </span>
          <span>{r.type}</span>
          <span className="t-mono">{Number(r.hours)}h</span>
          {r.reason && <span className="t-muted">· {r.reason}</span>}
          <button
            onClick={() => { if (confirm('Withdraw this pending PTO request?')) cancel.mutate(r.id); }}
            className="ml-auto t-muted hover:t-danger"
            style={{ fontSize: 13 }}
            title="Withdraw request"
          >Withdraw</button>
        </li>
      ))}
    </ul>
  );
}

function RequestForm({
  userId, allRequests, onDone,
}: {
  userId: string;
  allRequests: PtoRequest[];
  onDone: () => void;
}) {
  const submit = useSubmitPto();
  const today = todayIso();
  const [type, setType]         = useState<PtoType>('vacation');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn]     = useState(today);
  const [hoursOverride, setHoursOverride] = useState('');
  const [reason, setReason]     = useState('');
  const [err, setErr]           = useState<string | null>(null);

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

  const cap = type === 'vacation' && startsOn && endsOn
    ? checkVacationCap(allRequests, userId, startsOn, endsOn)
    : { exceeded: false, conflicts: [] as { user_full_name: string | null }[] };

  const onSubmit = async () => {
    setErr(null);
    if (endsOn < startsOn) { setErr("End date can't be before start date."); return; }
    if (finalHours <= 0)   { setErr('Hours must be > 0.'); return; }
    try {
      await submit.mutateAsync({
        user_id: userId,
        type,
        starts_on: startsOn,
        ends_on:   endsOn,
        hours:     finalHours,
        reason:    reason.trim() || null,
        status:    'pending',
        request_source: 'self_serve',
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--color-border-soft)', background: 'rgba(59,130,246,0.04)' }}>
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as PtoType)} className="t-input">
            {PTO_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="t-input" />
        </Field>
        <Field label="To">
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="t-input" />
        </Field>
        <Field label={`Hours (auto: ${computedHours})`}>
          <input
            type="number" step="0.25" min="0"
            value={hoursOverride}
            onChange={(e) => setHoursOverride(e.target.value)}
            placeholder={String(computedHours)}
            className="t-input"
            style={{ width: 100 }}
          />
        </Field>
      </div>
      <Field label="Reason (optional)">
        <input
          type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          className="t-input" style={{ width: '100%' }}
          placeholder="e.g. family trip, doctor visit"
        />
      </Field>

      {cap.exceeded && (
        <div className="t-small" style={{
          padding: '0.4rem 0.6rem', background: 'rgba(234,88,12,0.1)',
          color: '#9a3412', borderRadius: 4,
        }}>
          ⚠ 2-engineer vacation cap already met on these dates
          ({cap.conflicts.map((c) => c.user_full_name).join(', ')}).
          You can still submit — manager will decide.
        </div>
      )}
      {err && (
        <div className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onDone} className="t-small px-3 py-1 rounded border" style={{
          background: 'var(--color-card)', borderColor: 'var(--color-border)',
        }}>Cancel</button>
        <button
          onClick={onSubmit}
          disabled={submit.isPending}
          className="t-small px-3 py-1 rounded"
          style={{
            background: 'var(--color-accent)', color: '#fff',
            opacity: submit.isPending ? 0.6 : 1,
          }}
        >
          {submit.isPending ? 'Submitting…' : `Submit ${finalHours}h`}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="t-small t-muted">{label}</span>
      {children}
    </label>
  );
}
