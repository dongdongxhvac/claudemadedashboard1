// §09 — BMS heartbeats from 4 systems (Phase 8.1, refactored Phase 8.2).
//
// Scope: ONLY the daily-test heartbeat emails from the 4 BMS systems
// (Delta @ Takeda, Delta @ 10 Green, Northeast Tech 730/750, Siemens).
// Actual alarm content lives in §10 (multi-vendor) and §08 (Delta direct).
//
// This panel is the pipeline-health canary — it answers "is each BMS
// still emailing us?" with weekday-aware staleness. A stale row means
// the BMS itself, its SMTP path, Outlook, Power Automate, Gmail, or
// the poller has broken somewhere; the alarm panels can't tell you
// that on their own.
//
// Backed by v_bms_heartbeat_latest + email_poll_state.
import { useMemo } from 'react';
import {
  useBmsHeartbeats,
  useEmailPollState,
  type BmsHeartbeat,
} from '../hooks/useEmailAlarms';
import { Section } from './Section';

// Per-vendor staleness rule.
//
// BMS heartbeats fire Mon-Fri, one per day per system — weekday-aware:
//   - Weekday past noon ET, expect today's HB (else >28h is stale)
//   - Mon before noon ET, last expected HB was Friday (allow up to ~80h)
//   - Sat/Sun, last expected HB was Friday
//
// Power Automate heartbeat fires every 15 min, 24/7. Independent cadence,
// no weekday logic. >1h is stale (covers 4 missed cycles).
function isHeartbeatStale(vendor: string, hoursSince: number): boolean {
  if (vendor === 'power_automate') return hoursSince > 1;
  const now = new Date();
  const etNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  const dow = etNow.getDay();    // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = etNow.getHours();

  if (dow === 0) return hoursSince > 76;                   // Sunday
  if (dow === 6) return hoursSince > 52;                   // Saturday
  if (dow === 1 && hour < 12) return hoursSince > 80;      // Mon morning
  return hoursSince > 28;                                  // weekday after expected time
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

function HeartbeatTable({ rows }: { rows: BmsHeartbeat[] }) {
  if (rows.length === 0) {
    return (
      <p className="t-text t-muted">
        No BMS heartbeats received yet — pipeline health unknown.
      </p>
    );
  }
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">BMS</th>
          <th className="text-left pb-1 pr-3">Building</th>
          <th className="text-left pb-1 pr-3">Last heartbeat (ET)</th>
          <th className="text-left pb-1 pr-3">Age</th>
          <th className="text-left pb-1 pl-2">Pipeline</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const stale = isHeartbeatStale(r.vendor, r.hours_since);
          return (
            <tr key={r.vendor} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-3">{r.vendor_label ?? r.vendor}</td>
              <td className="py-1 pr-3 t-muted">{r.building ?? '—'}</td>
              <td className="py-1 pr-3">{fmtTime(r.last_seen_utc)}</td>
              <td className="py-1 pr-3 t-muted">{fmtRelative(r.last_seen_utc)}</td>
              <td
                className="py-1 pl-2 font-semibold"
                style={{ color: stale ? 'var(--color-danger)' : 'var(--color-ok, #10b981)' }}
              >
                {stale ? '⚠ STALE' : '✓ live'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function EmailAlarmsPanel() {
  const hbQ = useBmsHeartbeats();
  const stateQ = useEmailPollState();

  const hbRows = hbQ.data ?? [];
  const totalSystems = hbRows.length;
  const staleCount = useMemo(
    () => hbRows.filter((r) => isHeartbeatStale(r.vendor, r.hours_since)).length,
    [hbRows],
  );
  const liveCount = totalSystems - staleCount;

  const lastRun = stateQ.data?.last_run_at ?? null;
  const lastRunMin = minutesAgo(lastRun);
  // Feed (poller) is stale if it hasn't run in >15 min or it errored last run.
  // This is independent of per-BMS staleness.
  const pollerStale =
    !stateQ.data ||
    stateQ.data.last_run_status !== 'ok' ||
    (lastRunMin !== null && lastRunMin > 15);

  const subtitle = (
    <span className="t-small t-muted">
      {totalSystems > 0 && (
        <>
          <span
            className="font-semibold"
            style={{ color: liveCount === totalSystems ? 'var(--color-ok, #10b981)' : 'var(--color-text)' }}
          >
            {liveCount}/{totalSystems} live
          </span>
          {staleCount > 0 && (
            <span className="ml-2 font-semibold" style={{ color: 'var(--color-danger)' }}>
              · {staleCount} stale
            </span>
          )}
        </>
      )}
      <span className="ml-2">
        · poller{' '}
        <span style={{ color: pollerStale ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {pollerStale ? 'STALE' : 'live'}
        </span>
        {lastRun && <span className="t-muted"> · last run {fmtRelative(lastRun)}</span>}
      </span>
    </span>
  );

  return (
    <Section
      title="§09 BMS heartbeats (4 systems via email)"
      subtitle={subtitle}
      loading={hbQ.isLoading}
    >
      {hbQ.error ? (
        <p className="t-text t-danger">Error: {(hbQ.error as Error).message}</p>
      ) : (
        <HeartbeatTable rows={hbRows} />
      )}
    </Section>
  );
}
