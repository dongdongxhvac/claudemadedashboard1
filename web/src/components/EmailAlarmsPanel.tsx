// §09 — Email-forwarded BMS alarms (Phase 8.0).
//
// Mirrors §08 (Delta) shape: 2-pane grid + subtitle health indicator. No
// raw transition feed (those flip Active/Quiet repeatedly and just add
// noise). Instead, the Active pane groups by point_ref and shows how many
// times each point has fired in the last 24h.
//
// Backed by v_email_alarms_open, v_email_alarms_by_building,
// v_email_alarms_recent (only used to compute the per-point flip counts),
// email_poll_state.
import { useMemo } from 'react';
import {
  useEmailAlarmsOpen,
  useEmailAlarmsByBuilding,
  useEmailAlarmsRecent,
  useEmailPollState,
  type EmailAlarmOpen,
} from '../hooks/useEmailAlarms';
import { Section } from './Section';

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

function classColor(eventClass: string | null): string {
  switch (eventClass) {
    case 'Fault':
    case 'Out of Service':
      return 'var(--color-danger)';
    case 'High Limit':
    case 'Low Limit':
      return 'var(--color-warning, #d97706)';
    default:
      return 'var(--color-text)';
  }
}

function BuildingTable({
  rows,
}: {
  rows: { building: string; open_count: number; off_normal_count: number; limit_count: number; fault_count: number }[];
}) {
  if (rows.length === 0) {
    return <p className="t-text t-muted">No active alarms — building counts will populate once one fires.</p>;
  }
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">Building</th>
          <th className="text-right pb-1 px-2">Active</th>
          <th className="text-right pb-1 px-2">Off-Norm</th>
          <th className="text-right pb-1 px-2">Limit</th>
          <th className="text-right pb-1 pl-2">Fault</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.building} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            <td className="py-1 pr-3">{r.building}</td>
            <td className="text-right px-2 py-1 font-semibold">{r.open_count.toLocaleString()}</td>
            <td className="text-right px-2 py-1">{r.off_normal_count.toLocaleString()}</td>
            <td
              className="text-right px-2 py-1"
              style={{ color: r.limit_count > 0 ? 'var(--color-warning, #d97706)' : undefined }}
            >
              {r.limit_count.toLocaleString()}
            </td>
            <td
              className="text-right pl-2 py-1"
              style={{ color: r.fault_count > 0 ? 'var(--color-danger)' : undefined }}
            >
              {r.fault_count.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActiveTable({
  rows,
  transitionCounts,
}: {
  rows: EmailAlarmOpen[];
  transitionCounts: Map<string, number>;
}) {
  if (rows.length === 0) {
    return <p className="t-text t-muted">No active email alarms right now.</p>;
  }
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">Point</th>
          <th className="text-left pb-1 pr-3">Class / Value</th>
          <th className="text-left pb-1 pr-3">Latest</th>
          <th className="text-right pb-1 pl-2" title="Number of transitions in the last 24h">Flips 24h</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const flips = r.point_ref ? (transitionCounts.get(r.point_ref) ?? 1) : 1;
          return (
            <tr key={r.gmail_msg_id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-3" style={{ maxWidth: '24rem' }}>
                <div>{r.point_name ?? r.point_ref ?? '—'}</div>
                <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                  {r.building ?? '—'}
                  {r.point_ref && r.point_name && r.point_ref !== r.point_name ? ` · ${r.point_ref}` : ''}
                </div>
              </td>
              <td className="py-1 pr-3" style={{ color: classColor(r.event_class) }}>
                <div className="font-semibold">{r.event_class ?? '—'}</div>
                {r.event_value && (
                  <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                    {r.event_value}
                  </div>
                )}
              </td>
              <td className="py-1 pr-3">
                <div>{fmtTime(r.alarm_time_utc ?? r.received_at_utc)}</div>
                <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                  {fmtRelative(r.alarm_time_utc ?? r.received_at_utc)}
                </div>
              </td>
              <td
                className="text-right pl-2 py-1 font-semibold"
                style={{ color: flips > 3 ? 'var(--color-warning, #d97706)' : undefined }}
              >
                {flips}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function EmailAlarmsPanel() {
  const openQ = useEmailAlarmsOpen();
  const byBldgQ = useEmailAlarmsByBuilding();
  // Recent feed is fetched purely to compute the "flips 24h" column. Not
  // rendered as a list — that was noisy and got dropped per Rule 1+2.
  const recentQ = useEmailAlarmsRecent(200);
  const stateQ = useEmailPollState();

  // Group recent transitions by point_ref to derive flip counts.
  const transitionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recentQ.data ?? []) {
      if (!r.point_ref) continue;
      m.set(r.point_ref, (m.get(r.point_ref) ?? 0) + 1);
    }
    return m;
  }, [recentQ.data]);

  const activeCount = openQ.data?.length ?? 0;

  const lastRun = stateQ.data?.last_run_at ?? null;
  const lastRunMin = minutesAgo(lastRun);
  // Feed is stale if poller hasn't run in >15 min (3× the 5min cadence) or
  // last run errored.
  const feedStale =
    !stateQ.data ||
    stateQ.data.last_run_status !== 'ok' ||
    (lastRunMin !== null && lastRunMin > 15);

  const subtitle = (
    <span className="t-small t-muted">
      <span className="font-semibold" style={{ color: activeCount > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
        {activeCount.toLocaleString()} active
      </span>
      <span className="ml-2">
        · feed{' '}
        <span style={{ color: feedStale ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {feedStale ? 'STALE' : 'live'}
        </span>
        {lastRun && <span className="t-muted"> · last poll {fmtRelative(lastRun)}</span>}
      </span>
    </span>
  );

  return (
    <Section
      title="§09 BMS alarms via email (Siemens / UPark)"
      subtitle={subtitle}
      loading={openQ.isLoading || byBldgQ.isLoading}
    >
      {openQ.error ? (
        <p className="t-text t-danger">Error: {(openQ.error as Error).message}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-2">By building</div>
            <BuildingTable rows={byBldgQ.data ?? []} />
          </div>
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-2">Currently active</div>
            <ActiveTable rows={openQ.data ?? []} transitionCounts={transitionCounts} />
          </div>
        </div>
      )}
    </Section>
  );
}
