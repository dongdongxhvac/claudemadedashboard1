// §12 — PTO coverage (Phase 12).
//
// Reads PTO records pulled from OnTheClock by the pto_poller.py service.
// Shows three things stacked:
//   1. Out today / next 7 / next 30 day quick counts at the top
//   2. Conflict alerts — PTO that collides with on-call week, OT signups,
//      or primary building assignments
//   3. Rest-of-year forecast grouped by month
//
// Conflict math is client-side: on-call is computed from the participants
// rotation (Friday + (cycle*N + idx)*7), OT from overtime_signups, primary
// buildings from building_assignments role='primary'.
import { useMemo } from 'react';
import {
  usePtoRecords, usePtoBalances, usePtoPollState, usePtoRealtime,
  type PtoRecord, type PtoBalance,
} from '../hooks/usePto';
import {
  useOncallParticipants, useOncallSettings,
  addDaysIso, fmtMd,
} from '../hooks/useOncall';
import {
  useOvertimePosts,
  type OvertimePost,
} from '../hooks/useOvertime';
import {
  useCurrentBuildingAssignments,
  type BuildingAssignment,
} from '../hooks/useBuildingAssignments';
import { useBuildings, type Building } from '../hooks/useBuildings';
import { Section } from './Section';

// ───────────────────────────── helpers

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
}
function rangeOverlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}
function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}
function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / (60 * 24))}d ago`;
}

// ───────────────────────────── conflict types

type Conflict = {
  pto: PtoRecord;
  kind: 'oncall' | 'overtime' | 'primary_building';
  severity: 'high' | 'medium';
  detail: string;
};

function computeConflicts(
  ptos: PtoRecord[],
  oncallWeeks: { user_id: string; week_start: string; week_end: string }[],
  otSignups: { user_id: string; post: OvertimePost }[],
  primaryByUser: Map<string, Building[]>,
): Conflict[] {
  const out: Conflict[] = [];
  for (const p of ptos) {
    if (!p.user_id) continue;
    if (p.status !== 'approved' && p.status !== 'pending') continue;
    // 1. On-call conflict — engineer is on call for any week overlapping PTO.
    for (const w of oncallWeeks) {
      if (w.user_id !== p.user_id) continue;
      if (!rangeOverlaps(p.starts_on, p.ends_on, w.week_start, w.week_end)) continue;
      out.push({
        pto: p,
        kind: 'oncall',
        severity: 'high',
        detail: `On call week of ${fmtMd(w.week_start)}–${fmtMd(w.week_end)}`,
      });
    }
    // 2. OT signup conflict — engineer signed up for OT post during PTO.
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
    // 3. Primary building — engineer is primary for buildings; PTO means
    //    those buildings need coverage. Medium severity (lead/coverage is
    //    available). Single conflict line listing all buildings.
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

// ───────────────────────────── component

export function PtoPanel() {
  // Only subscribe to PTO realtime here — the other tables (oncall, OT,
  // buildings) are already subscribed by their respective panels on this
  // same page, and they invalidate the shared react-query keys. Re-subscribing
  // to the same channel name throws "cannot add postgres_changes callbacks
  // after subscribe()" and crashes the page.
  usePtoRealtime();

  const ptosQ            = usePtoRecords();
  const balancesQ        = usePtoBalances();
  const stateQ           = usePtoPollState();
  const participantsQ    = useOncallParticipants();
  const settingsQ        = useOncallSettings();
  const otPostsQ         = useOvertimePosts();
  const assignmentsQ     = useCurrentBuildingAssignments();
  const buildingsQ       = useBuildings();

  const today = todayIso();
  const next7  = (() => { const d = new Date(); d.setDate(d.getDate() + 7);  return d.toLocaleDateString('en-CA'); })();
  const next30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toLocaleDateString('en-CA'); })();

  // ── PTO bucket counts
  const buckets = useMemo(() => {
    const ptos = (ptosQ.data ?? []).filter((p) => p.status === 'approved' || p.status === 'pending');
    const outToday = ptos.filter((p) => p.starts_on <= today && p.ends_on >= today);
    const startingNext7  = ptos.filter((p) => p.starts_on > today  && p.starts_on <= next7);
    const startingNext30 = ptos.filter((p) => p.starts_on > today  && p.starts_on <= next30);
    return { outToday, startingNext7, startingNext30 };
  }, [ptosQ.data, today, next7, next30]);

  // ── Compute upcoming on-call weeks per engineer for the conflict horizon.
  const oncallWeeks = useMemo(() => {
    const startFriday = settingsQ.data?.start_friday;
    const participants = participantsQ.data ?? [];
    if (!startFriday || participants.length === 0) return [];
    const N = participants.length;
    const rotations = settingsQ.data?.rotations_per_engineer ?? 4;
    const out: { user_id: string; week_start: string; week_end: string }[] = [];
    for (let cycle = 0; cycle <= rotations + 1; cycle++) {
      for (let i = 0; i < N; i++) {
        const ws = addDaysIso(startFriday, (cycle * N + i) * 7);
        out.push({
          user_id: participants[i].user_id,
          week_start: ws,
          week_end: addDaysIso(ws, 6),
        });
      }
    }
    return out;
  }, [settingsQ.data, participantsQ.data]);

  // ── OT signups flattened: one row per (post, signed-up user).
  const otSignups = useMemo(() => {
    const out: { user_id: string; post: OvertimePost }[] = [];
    for (const post of otPostsQ.data ?? []) {
      if (post.status !== 'open') continue;
      for (const s of post.signups ?? []) {
        out.push({ user_id: s.user_id, post });
      }
    }
    return out;
  }, [otPostsQ.data]);

  // ── Primary buildings per user.
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

  // ── All conflicts
  const conflicts = useMemo(
    () => computeConflicts(ptosQ.data ?? [], oncallWeeks, otSignups, primaryByUser),
    [ptosQ.data, oncallWeeks, otSignups, primaryByUser],
  );

  // ── Rest of year forecast grouped by month (today onwards)
  const forecast = useMemo(() => {
    const yearEnd = `${new Date().getFullYear()}-12-31`;
    const upcoming = (ptosQ.data ?? [])
      .filter((p) => (p.status === 'approved' || p.status === 'pending'))
      .filter((p) => p.ends_on >= today && p.starts_on <= yearEnd)
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    const byMonth = new Map<string, PtoRecord[]>();
    for (const p of upcoming) {
      const k = monthKey(p.starts_on);
      const cur = byMonth.get(k) ?? [];
      cur.push(p);
      byMonth.set(k, cur);
    }
    return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [ptosQ.data, today]);

  const lastRun = stateQ.data?.last_run_at ?? null;
  const lastRunMin = lastRun ? Math.floor((Date.now() - new Date(lastRun).getTime()) / 60_000) : null;
  // Generous staleness: OTC is a slow-moving feed (approvals happen daily,
  // not minute-by-minute) so 2h is fine.
  const feedStale = lastRunMin === null || lastRunMin > 120 || stateQ.data?.last_run_status !== 'ok';
  const noPoller  = !stateQ.data || !lastRun;

  const subtitle = (
    <span className="t-small t-muted">
      {(ptosQ.data?.length ?? 0).toLocaleString()} record{ptosQ.data?.length === 1 ? '' : 's'}
      <span className="ml-2">
        · feed{' '}
        <span style={{ color: noPoller ? 'var(--color-text-muted)' : feedStale ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {noPoller ? 'not running' : feedStale ? 'STALE' : 'live'}
        </span>
        {lastRun && <span className="t-muted"> · last poll {fmtRelative(lastRun)}</span>}
      </span>
    </span>
  );

  return (
    <Section title="§12 PTO coverage (OnTheClock)" subtitle={subtitle} loading={ptosQ.isLoading}>
      {ptosQ.error ? (
        <p className="t-text t-danger">Error: {(ptosQ.error as Error).message}</p>
      ) : (
        <div className="space-y-4">
          {/* Bucket counts */}
          <div className="grid grid-cols-4 gap-2">
            <BucketCard label="Out today"             value={buckets.outToday.length} list={buckets.outToday}        emphasize={buckets.outToday.length > 0} />
            <BucketCard label="Starts in next 7d"     value={buckets.startingNext7.length}  list={buckets.startingNext7} />
            <BucketCard label="Starts in next 30d"    value={buckets.startingNext30.length} list={buckets.startingNext30} />
            <BucketCard label="Conflicts"             value={conflicts.length} accent={conflicts.length > 0 ? 'danger' : undefined} />
          </div>

          {/* Empty / no-poller hint */}
          {(ptosQ.data?.length ?? 0) === 0 && (
            <div
              className="t-card t-small t-muted"
              style={{ padding: '0.75rem 1rem', background: 'rgba(168,85,247,0.05)', borderLeft: '3px solid #a855f7' }}
            >
              No PTO data yet. The poller (Phase B) writes here once OnTheClock credentials are configured.
              You can insert test rows directly in <code>pto_records</code> to preview the UI.
            </div>
          )}

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <div>
              <div className="t-small t-muted uppercase tracking-wider mb-2">Conflicts</div>
              <ul className="space-y-1">
                {conflicts.map((c, i) => (
                  <li
                    key={`${c.pto.id}-${c.kind}-${i}`}
                    className="t-small"
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderLeft: `3px solid ${c.severity === 'high' ? 'var(--color-danger)' : '#d97706'}`,
                      background: c.severity === 'high' ? 'rgba(220,38,38,0.06)' : 'rgba(217,119,6,0.06)',
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ marginRight: 6 }}>{c.severity === 'high' ? '🔴' : '🟡'}</span>
                    <strong>{c.pto.user_full_name ?? '?'}</strong>
                    <span className="t-muted"> · PTO {fmtMd(c.pto.starts_on)}{c.pto.starts_on === c.pto.ends_on ? '' : `–${fmtMd(c.pto.ends_on)}`}</span>
                    <span className="t-muted"> · </span>
                    {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Balances — per-engineer remaining hours for the current year */}
          {(balancesQ.data ?? []).length > 0 && <BalancesGrid balances={balancesQ.data ?? []} />}

          {/* Rest of year forecast */}
          {forecast.length > 0 && (
            <div>
              <div className="t-small t-muted uppercase tracking-wider mb-2">Rest of year forecast</div>
              <div className="space-y-3">
                {forecast.map(([month, rows]) => (
                  <MonthGroup key={month} month={month} rows={rows} today={today} next30={next30} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────── presentational

function BucketCard({ label, value, list, emphasize, accent }: {
  label: string;
  value: number;
  list?: PtoRecord[];
  emphasize?: boolean;
  accent?: 'danger' | undefined;
}) {
  return (
    <div className="t-card" style={{ padding: '0.5rem 0.75rem' }}>
      <div className="t-small t-muted uppercase tracking-wider">{label}</div>
      <div
        className="t-stat-num"
        style={{
          fontSize: '1.4rem',
          color:
            accent === 'danger' && value > 0 ? 'var(--color-danger)'
            : emphasize ? 'var(--color-warn, #d97706)'
            : 'var(--color-text)',
        }}
      >
        {value.toLocaleString()}
      </div>
      {list && list.length > 0 && (
        <div className="t-small t-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
          {list.slice(0, 3).map((p) => p.user_full_name ?? '?').join(', ')}
          {list.length > 3 && ` +${list.length - 3}`}
        </div>
      )}
    </div>
  );
}

function MonthGroup({ month, rows, today, next30 }: {
  month: string;
  rows: PtoRecord[];
  today: string;
  next30: string;
}) {
  return (
    <div>
      <div className="t-small font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
        {monthLabel(month)} <span className="t-muted ml-1">({rows.length})</span>
      </div>
      <table className="min-w-full t-text t-small border-collapse">
        <thead>
          <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
            <th className="py-0.5 pr-2">Engineer</th>
            <th className="py-0.5 pr-2">Dates</th>
            <th className="py-0.5 pr-2">Type</th>
            <th className="py-0.5 pr-2 text-right">Hours</th>
            <th className="py-0.5 pr-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isImminent = p.starts_on >= today && p.starts_on <= next30;
            const isActive   = p.starts_on <= today && p.ends_on >= today;
            return (
              <tr
                key={p.id}
                style={{
                  borderBottom: '1px solid var(--color-border-soft)',
                  background: isActive ? 'rgba(34,197,94,0.08)' : isImminent ? 'rgba(212,160,23,0.05)' : undefined,
                }}
              >
                <td className="py-0.5 pr-2 font-medium">{p.user_full_name ?? '?'}</td>
                <td className="py-0.5 pr-2 t-mono">
                  {fmtMd(p.starts_on)}{p.starts_on === p.ends_on ? '' : `–${fmtMd(p.ends_on)}`}
                  <span className="t-muted ml-1">({p.days}d)</span>
                </td>
                <td className="py-0.5 pr-2 t-muted">{p.pto_type ?? '—'}</td>
                <td className="py-0.5 pr-2 text-right t-mono">{p.hours != null ? `${p.hours}h` : '—'}</td>
                <td className="py-0.5 pr-2">
                  <StatusChip status={p.status} />
                  {isActive && <span className="ml-1 t-small" style={{ color: '#15803d' }}>active</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BalancesGrid({ balances }: { balances: PtoBalance[] }) {
  // One row per engineer for the current year. Filter out disabled buckets
  // (rule = "PTO Is Turned Off") so the panel doesn't show meaningless zeros.
  const currentYear = new Date().getFullYear();
  const rows = balances.filter((b) => b.year === currentYear)
    .sort((a, b) => (a.user_full_name ?? '').localeCompare(b.user_full_name ?? ''));
  if (rows.length === 0) return null;

  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider mb-2">
        Balances ({currentYear})
      </div>
      <table className="min-w-full t-text t-small border-collapse">
        <thead>
          <tr className="t-muted text-left" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
            <th className="py-1 pr-3">Engineer</th>
            <th className="py-1 pr-3 text-right">Vacation</th>
            <th className="py-1 pr-3 text-right">Sick</th>
            <th className="py-1 pr-3 text-right">Personal</th>
            <th className="py-1 pr-3 text-right">Holiday</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr
              key={b.id}
              style={{
                borderBottom: '1px solid var(--color-border-soft)',
                background: b.any_low ? 'rgba(217,119,6,0.05)' : undefined,
              }}
            >
              <td className="py-1 pr-3 font-medium">
                {b.user_full_name ?? <span className="t-muted italic">unmapped OTC #{b.ontheclock_employee_id}</span>}
              </td>
              <BalanceCell remaining={b.vacation_remaining} used={b.vacation_used} rule={b.vacation_rule} />
              <BalanceCell remaining={b.sick_remaining}     used={b.sick_used}     rule={b.sick_rule} />
              <BalanceCell remaining={b.personal_remaining} used={b.personal_used} rule={b.personal_rule} />
              <BalanceCell remaining={b.holiday_remaining}  used={b.holiday_used}  rule={b.holiday_rule} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceCell({ remaining, used, rule }: { remaining: number | null; used: number | null; rule: string | null }) {
  const disabled = !rule || rule === 'PTO Is Turned Off';
  if (disabled) {
    return <td className="py-1 pr-3 text-right t-muted">—</td>;
  }
  const r = remaining ?? 0;
  // <=0 = depleted (red), <=8 = low (amber), else default
  const color = r <= 0 ? 'var(--color-danger)' : r <= 8 ? 'var(--color-warn, #d97706)' : 'var(--color-text)';
  return (
    <td className="py-1 pr-3 text-right t-mono">
      <span style={{ color, fontWeight: r <= 8 ? 600 : 400 }}>{r}h</span>
      {used != null && (
        <span className="t-muted ml-1" style={{ fontSize: '0.7rem' }}>(used {used}h)</span>
      )}
    </td>
  );
}

function StatusChip({ status }: { status: PtoRecord['status'] }) {
  const cfg = {
    approved:  { bg: 'rgba(34,197,94,0.15)',  fg: '#15803d' },
    pending:   { bg: 'rgba(212,160,23,0.18)', fg: '#a16207' },
    denied:    { bg: 'rgba(244,63,94,0.15)',  fg: '#be123c' },
    cancelled: { bg: 'rgba(100,116,139,0.18)', fg: '#475569' },
  }[status];
  return (
    <span
      className="t-small px-1.5 py-0.5 rounded"
      style={{ background: cfg.bg, color: cfg.fg, fontWeight: 600, fontSize: 10, letterSpacing: '0.4px' }}
    >
      {status.toUpperCase()}
    </span>
  );
}
