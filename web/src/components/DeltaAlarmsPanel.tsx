// §08 — Delta enteliWEB alarms (Phase 7.0).
//
// Two-pane layout:
//   Left:  category breakdown (counts: open / active / unacked).
//   Right: alarms currently in non-normal state, sorted by BACnet priority.
// Subtitle surfaces daemon health (session_status + age of last full sync),
// so a stale feed is visible without digging into Supabase.
//
// Backed by v_delta_alarms_current, v_delta_alarms_by_category, delta_poll_state.
import { useMemo } from 'react';
import {
  useDeltaAlarmsCurrent,
  useDeltaAlarmsByCategory,
  useDeltaPollState,
  type DeltaAlarmOpen,
} from '../hooks/useDeltaAlarms';
import { Section } from './Section';

function fmtTime(utcIso: string | null): string {
  if (!utcIso) return '—';
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function minutesAgo(utcIso: string | null): number | null {
  if (!utcIso) return null;
  return Math.floor((Date.now() - new Date(utcIso).getTime()) / 60_000);
}

function fmtRelative(utcIso: string | null): string {
  const m = minutesAgo(utcIso);
  if (m === null) return '—';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / (60 * 24))}d ago`;
}

function stateColor(toState: string | null): string {
  switch ((toState ?? '').toLowerCase()) {
    case 'fault':     return 'var(--color-danger)';
    case 'offnormal': return 'var(--color-danger)';
    case 'normal':    return 'var(--color-text)';
    default:          return 'var(--color-warning, #d97706)';
  }
}

function CategoryTable({ rows }: { rows: { category_name: string | null; open_count: number; active_count: number; unacked_count: number }[] }) {
  if (rows.length === 0) return <p className="t-text t-muted">No category data yet.</p>;
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">Category</th>
          <th className="text-right pb-1 px-2">Open</th>
          <th className="text-right pb-1 px-2">Active</th>
          <th className="text-right pb-1 pl-2">Unacked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.category_name ?? '_null_'} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            <td className="py-1 pr-3">{r.category_name ?? '—'}</td>
            <td className="text-right px-2 py-1">{r.open_count.toLocaleString()}</td>
            <td
              className="text-right px-2 py-1 font-semibold"
              style={{ color: r.active_count > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}
            >
              {r.active_count.toLocaleString()}
            </td>
            <td
              className="text-right pl-2 py-1 font-semibold"
              style={{ color: r.unacked_count > 0 ? 'var(--color-warning, #d97706)' : 'var(--color-text)' }}
            >
              {r.unacked_count.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActiveAlarmsTable({ rows }: { rows: DeltaAlarmOpen[] }) {
  if (rows.length === 0) {
    return (
      <p className="t-text t-muted">
        No alarms in non-normal state. {''}
        <span className="t-small">All open alarms are awaiting ack only.</span>
      </p>
    );
  }
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-right pb-1 pr-2" style={{ width: '3rem' }}>Pri</th>
          <th className="text-left pb-1 pr-3">Point</th>
          <th className="text-left pb-1 pr-3">State</th>
          <th className="text-left pb-1 pr-3">Last change</th>
          <th className="text-right pb-1 pl-2">Acked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.event_ref} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            <td className="text-right pr-2 py-1 t-muted">
              {r.priority ?? '—'}
            </td>
            <td className="py-1 pr-3" style={{ maxWidth: '32rem' }}>
              <div>{r.input_name ?? r.event_name ?? r.event_ref}</div>
              {r.alarm_text && (
                <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                  {r.alarm_text}
                </div>
              )}
            </td>
            <td className="py-1 pr-3 font-semibold" style={{ color: stateColor(r.to_state) }}>
              {r.to_state ?? '—'}
            </td>
            <td className="py-1 pr-3">
              <div>{fmtTime(r.latest_at_utc ?? r.event_timestamp_utc)}</div>
              <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                {fmtRelative(r.latest_at_utc ?? r.event_timestamp_utc)}
              </div>
            </td>
            <td
              className="text-right pl-2 py-1 font-semibold"
              style={{ color: r.latest_acked === false ? 'var(--color-warning, #d97706)' : 'var(--color-text)' }}
            >
              {r.latest_acked === null ? '—' : r.latest_acked ? 'yes' : 'no'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DeltaAlarmsPanel() {
  const currentQ = useDeltaAlarmsCurrent();
  const categoryQ = useDeltaAlarmsByCategory();
  const stateQ = useDeltaPollState();

  const { active, totalOpen, unackedCount } = useMemo(() => {
    const all = currentQ.data ?? [];
    const act = all
      .filter((r) => r.to_state && r.to_state.toLowerCase() !== 'normal')
      // Sort by BACnet priority asc (lower = more urgent), then most-recent first.
      .sort((a, b) => {
        const pa = a.priority ?? 999;
        const pb = b.priority ?? 999;
        if (pa !== pb) return pa - pb;
        const ta = a.latest_at_utc ?? a.event_timestamp_utc ?? '';
        const tb = b.latest_at_utc ?? b.event_timestamp_utc ?? '';
        return tb.localeCompare(ta);
      });
    const unacked = all.filter((r) => r.latest_acked === false).length;
    return { active: act, totalOpen: all.length, unackedCount: unacked };
  }, [currentQ.data]);

  const lastSync = stateQ.data?.last_full_sync_at ?? null;
  const syncMin = minutesAgo(lastSync);
  // Feed is stale if the last full sync is more than 15 min old (3x the 5min
  // tier-2 cadence). Tier-1 errors also flip session_status off "ok".
  const feedStale =
    !stateQ.data ||
    stateQ.data.session_status !== 'ok' ||
    (syncMin !== null && syncMin > 15);

  const subtitle = (
    <span className="t-small t-muted">
      {totalOpen.toLocaleString()} open
      {active.length > 0 && (
        <span className="ml-2 font-semibold" style={{ color: 'var(--color-danger)' }}>
          · {active.length} actively firing
        </span>
      )}
      {unackedCount > 0 && (
        <span className="ml-2 font-semibold" style={{ color: 'var(--color-warning, #d97706)' }}>
          · {unackedCount} unacked
        </span>
      )}
      <span className="ml-2">
        · feed{' '}
        <span style={{ color: feedStale ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {feedStale ? 'STALE' : 'live'}
        </span>
        {lastSync && <span className="t-muted"> · sync {fmtRelative(lastSync)}</span>}
      </span>
    </span>
  );

  return (
    <Section title="§08 BMS alarms (Delta)" subtitle={subtitle} loading={currentQ.isLoading || categoryQ.isLoading}>
      {currentQ.error ? (
        <p className="t-text t-danger">Error: {(currentQ.error as Error).message}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-2">
              By category
            </div>
            <CategoryTable rows={categoryQ.data ?? []} />
          </div>
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-2">
              Currently in alarm
            </div>
            <ActiveAlarmsTable rows={active} />
          </div>
        </div>
      )}
    </Section>
  );
}
