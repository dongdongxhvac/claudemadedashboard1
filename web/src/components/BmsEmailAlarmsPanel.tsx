// §10 — BMS alarms via email, multi-vendor consolidated view (Phase 8.2).
//
// Reads from the same v_email_alarms_open view that §09 uses, but groups
// by vendor and shows all of them side by side. §09 (Siemens detail) and
// §10 (multi-vendor overview) coexist intentionally — §10 is the panoramic
// view, §09 is the deep-dive for the most active vendor.
//
// Heads-up: Delta @ Takeda rows that appear here ALSO appear in §08 Delta
// (which polls the BMS directly via API). That's by design — email is the
// belt to §08's suspenders. The "src" column on the active table makes the
// source label visible so it's not confusing.
import { useMemo } from 'react';
import {
  useEmailAlarmsOpen,
  useEmailPollState,
  useBmsHeartbeats,
  type EmailAlarmOpen,
} from '../hooks/useEmailAlarms';
import { Section } from './Section';

const VENDOR_LABEL: Record<string, string> = {
  siemens:      'Siemens',
  delta_takeda: 'Delta @ Takeda',
  delta_10green:'Delta @ 10 Green',
  delta:        'Delta',
  northeasttech_730_750: 'Northeast Tech 730/750',
  northeast:    'Northeast Tech',
};

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

function vendorLabel(v: string | null | undefined): string {
  if (!v) return '(unknown)';
  return VENDOR_LABEL[v] ?? v;
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

function VendorBreakdown({ rows }: { rows: EmailAlarmOpen[] }) {
  const byVendor = useMemo(() => {
    const m = new Map<string, { active: number; buildings: Set<string> }>();
    for (const r of rows) {
      const v = r.vendor ?? 'unknown';
      const cur = m.get(v) ?? { active: 0, buildings: new Set<string>() };
      cur.active += 1;
      if (r.building) cur.buildings.add(r.building);
      m.set(v, cur);
    }
    return Array.from(m.entries())
      .map(([vendor, x]) => ({ vendor, active: x.active, building_count: x.buildings.size }))
      .sort((a, b) => b.active - a.active);
  }, [rows]);

  if (byVendor.length === 0) {
    return <p className="t-text t-muted">No active email-source alarms across any vendor.</p>;
  }
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">Vendor</th>
          <th className="text-right pb-1 px-2">Active</th>
          <th className="text-right pb-1 pl-2">Buildings</th>
        </tr>
      </thead>
      <tbody>
        {byVendor.map((r) => (
          <tr key={r.vendor} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            <td className="py-1 pr-3">{vendorLabel(r.vendor)}</td>
            <td
              className="text-right px-2 py-1 font-semibold"
              style={{ color: r.active > 0 ? 'var(--color-danger)' : undefined }}
            >
              {r.active.toLocaleString()}
            </td>
            <td className="text-right pl-2 py-1 t-muted">{r.building_count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActiveAcrossVendorsTable({ rows }: { rows: EmailAlarmOpen[] }) {
  if (rows.length === 0) {
    return <p className="t-text t-muted">No active alarms via any email source right now.</p>;
  }
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">Vendor</th>
          <th className="text-left pb-1 pr-3">Point / Building</th>
          <th className="text-left pb-1 pr-3">Class</th>
          <th className="text-left pb-1 pl-2">Latest</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.gmail_msg_id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            <td className="py-1 pr-3">
              <div>{vendorLabel(r.vendor)}</div>
              {r.vendor === 'delta_takeda' && (
                <div className="t-muted" style={{ fontSize: '0.7rem' }}>(also in §08)</div>
              )}
            </td>
            <td className="py-1 pr-3" style={{ maxWidth: '20rem' }}>
              <div>{r.point_name ?? r.point_ref ?? '—'}</div>
              <div className="t-muted" style={{ fontSize: '0.7rem' }}>{r.building ?? '—'}</div>
            </td>
            <td className="py-1 pr-3" style={{ color: classColor(r.event_class) }}>
              <div>{r.event_class ?? '—'}</div>
              {r.event_value && (
                <div className="t-muted" style={{ fontSize: '0.7rem', maxWidth: '14rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.event_value}
                </div>
              )}
            </td>
            <td className="py-1 pl-2">
              <div>{fmtTime(r.alarm_time_utc ?? r.received_at_utc)}</div>
              <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                {fmtRelative(r.alarm_time_utc ?? r.received_at_utc)}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BmsEmailAlarmsPanel() {
  const openQ = useEmailAlarmsOpen();
  const stateQ = useEmailPollState();
  const hbQ = useBmsHeartbeats();

  const totalActive = openQ.data?.length ?? 0;
  const vendorCount = useMemo(() => {
    const s = new Set<string>();
    for (const r of openQ.data ?? []) s.add(r.vendor ?? 'unknown');
    return s.size;
  }, [openQ.data]);

  const lastRun = stateQ.data?.last_run_at ?? null;
  const lastRunMin = minutesAgo(lastRun);
  const feedStale =
    !stateQ.data ||
    stateQ.data.last_run_status !== 'ok' ||
    (lastRunMin !== null && lastRunMin > 15);

  // PA heartbeat: upstream pipeline canary. If it goes stale, Power
  // Automate itself is dead and the email feed is about to silence even
  // if the poller is still running.
  const paHb = useMemo(
    () => (hbQ.data ?? []).find((r) => r.vendor === 'power_automate') ?? null,
    [hbQ.data],
  );
  const paStale = paHb ? paHb.hours_since > 2.5 : null; // null = not configured yet; 30-min cadence with 2.5h tolerance
  const paLastSeen = paHb?.last_seen_utc ?? null;

  const subtitle = (
    <span className="t-small t-muted">
      <span
        className="font-semibold"
        style={{ color: totalActive > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}
      >
        {totalActive.toLocaleString()} active
      </span>
      {vendorCount > 0 && <span className="ml-2 t-muted"> across {vendorCount} vendor{vendorCount === 1 ? '' : 's'}</span>}
      <span className="ml-2">
        · feed{' '}
        <span style={{ color: feedStale ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {feedStale ? 'STALE' : 'live'}
        </span>
        {lastRun && <span className="t-muted"> · last poll {fmtRelative(lastRun)}</span>}
      </span>
      {paHb && (
        <span className="ml-2">
          · PA{' '}
          <span style={{ color: paStale ? 'var(--color-danger)' : 'var(--color-ok, #10b981)' }}>
            {paStale ? 'STALE' : '✓'}
          </span>
          {paLastSeen && <span className="t-muted"> {fmtRelative(paLastSeen)}</span>}
        </span>
      )}
    </span>
  );

  return (
    <Section
      title="§10 BMS alarms via email (Siemens · Delta · 730/750)"
      subtitle={subtitle}
      loading={openQ.isLoading}
    >
      {openQ.error ? (
        <p className="t-text t-danger">Error: {(openQ.error as Error).message}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-2">By vendor</div>
            <VendorBreakdown rows={openQ.data ?? []} />
          </div>
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-2">Currently active (all vendors)</div>
            <ActiveAcrossVendorsTable rows={openQ.data ?? []} />
          </div>
        </div>
      )}
    </Section>
  );
}
