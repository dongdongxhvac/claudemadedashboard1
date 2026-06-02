// §10.2 — BMS email alarms history + manual-close audit log.
//
// Sits under §10. Default view shows the most recent 100 events (any state)
// from email_alarm_events; toggle to "Manual closes only" to see just the
// audit trail of clicks on the §10 Close button.
//
// Reads from v_email_alarms_history which flattens parsed_fields into:
//   is_manual_close, closed_by_name, manual_close_reason, sourced_from_msg.
import { useState } from 'react';
import {
  useEmailAlarmsHistory,
  type EmailAlarmHistoryRow,
} from '../hooks/useEmailAlarms';
import { Section } from './Section';

const VENDOR_LABEL: Record<string, string> = {
  siemens:               'Siemens',
  delta_takeda:          'Delta @ Takeda',
  delta_10green:         'Delta @ 10 Green',
  delta:                 'Delta',
  northeasttech_730_750: 'Northeast Tech 730/750',
  northeast:             'Northeast Tech',
  power_automate:        'Power Automate',
  power_automate_pa:     'PA canary',
};

function vendorLabel(v: string | null): string {
  if (!v) return '—';
  return VENDOR_LABEL[v] ?? v;
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

function fmtRelative(utcIso: string | null): string {
  if (!utcIso) return '—';
  const ms = Date.now() - new Date(utcIso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function statePillColor(state: string | null, isManual: boolean): { bg: string; fg: string } {
  if (isManual) {
    return { bg: 'rgba(99, 102, 241, 0.18)', fg: '#6366f1' };  // indigo for manual
  }
  if (state === 'Active') {
    return { bg: 'rgba(239, 68, 68, 0.18)', fg: 'var(--color-danger)' };
  }
  if (state === 'Quiet') {
    return { bg: 'rgba(16, 185, 129, 0.18)', fg: 'var(--color-ok, #10b981)' };
  }
  return { bg: 'var(--color-border-soft)', fg: 'var(--color-text-muted)' };
}

export function EmailAlarmsHistoryPanel() {
  const [manualOnly, setManualOnly] = useState(false);
  const limit = 100;
  const histQ = useEmailAlarmsHistory({ manualOnly, limit });
  const rows = histQ.data ?? [];

  // Quick counters for the subtitle
  const manualCount = manualOnly
    ? rows.length
    : rows.filter((r) => r.is_manual_close).length;

  const subtitle = (
    <span className="t-small t-muted">
      <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
        {rows.length}
      </span>{' '}
      {manualOnly ? 'manual close' : 'event'}{rows.length === 1 ? '' : 's'}
      {!manualOnly && manualCount > 0 && (
        <span className="ml-2">· {manualCount} manual close{manualCount === 1 ? '' : 's'}</span>
      )}
      <span className="ml-2 t-muted">· last {limit}</span>
    </span>
  );

  return (
    <Section
      collapsible
      title="§10.2 Alarm history / manual close log"
      subtitle={subtitle}
      loading={histQ.isLoading}
    >
      {histQ.error ? (
        <p className="t-text t-danger">Error: {(histQ.error as Error).message}</p>
      ) : (
        <>
          {/* Filter pills */}
          <div className="flex gap-2 mb-3">
            <FilterPill
              label="All events"
              active={!manualOnly}
              onClick={() => setManualOnly(false)}
            />
            <FilterPill
              label="Manual closes only"
              active={manualOnly}
              onClick={() => setManualOnly(true)}
              accent="indigo"
            />
          </div>

          {rows.length === 0 ? (
            <p className="t-text t-muted">
              {manualOnly
                ? 'No manual closes yet. They\'ll show here when an admin/manager/lead uses the Close button on §10.'
                : 'No alarm events recorded yet.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="t-muted">
                    <th className="text-left pb-1 pr-3">When</th>
                    <th className="text-left pb-1 pr-3">Vendor</th>
                    <th className="text-left pb-1 pr-3">Point / Building</th>
                    <th className="text-left pb-1 pr-3">State</th>
                    <th className="text-left pb-1 pr-3">Class</th>
                    <th className="text-left pb-1 pr-3">By</th>
                    <th className="text-left pb-1 pl-3">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <HistoryRow key={r.gmail_msg_id} row={r} />
                  ))}
                </tbody>
              </table>
              {rows.length === limit && (
                <p className="t-small t-muted mt-2">
                  Showing the most recent {limit} events. Older history lives in
                  email_alarm_events — query it directly via Supabase for deeper digs.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function HistoryRow({ row }: { row: EmailAlarmHistoryRow }) {
  const pill = statePillColor(row.alarm_state, row.is_manual_close);
  const stateLabel = row.is_manual_close
    ? 'MANUAL CLOSE'
    : (row.alarm_state ?? '—').toUpperCase();
  const byName = row.is_manual_close
    ? row.closed_by_name ?? '?'
    : row.original_sender ?? '—';

  return (
    <tr style={{ borderTop: '1px solid var(--color-border-soft)' }}>
      <td className="py-1 pr-3" style={{ whiteSpace: 'nowrap' }}>
        <div>{fmtTime(row.received_at_utc)}</div>
        <div className="t-muted" style={{ fontSize: '0.7rem' }}>{fmtRelative(row.received_at_utc)}</div>
      </td>
      <td className="py-1 pr-3">{vendorLabel(row.vendor)}</td>
      <td className="py-1 pr-3" style={{ maxWidth: '20rem' }}>
        <div>{row.point_name ?? row.point_ref ?? '—'}</div>
        <div className="t-muted" style={{ fontSize: '0.7rem' }}>{row.building ?? '—'}</div>
      </td>
      <td className="py-1 pr-3">
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            background: pill.bg,
            color: pill.fg,
            whiteSpace: 'nowrap',
          }}
        >
          {stateLabel}
        </span>
      </td>
      <td className="py-1 pr-3 t-muted">{row.event_class ?? '—'}</td>
      <td className="py-1 pr-3" style={{ whiteSpace: 'nowrap' }}>
        {byName}
      </td>
      <td
        className="py-1 pl-3 t-muted"
        style={{
          maxWidth: '24rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={
          row.is_manual_close
            ? (row.manual_close_reason ?? row.subject_clean ?? '')
            : (row.event_value ?? row.subject_clean ?? '')
        }
      >
        {row.is_manual_close
          ? row.manual_close_reason ?? '(no reason given)'
          : row.event_value ?? row.subject_clean ?? '—'}
      </td>
    </tr>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  accent,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accent?: 'indigo';
}) {
  const activeBg = accent === 'indigo'
    ? 'rgba(99, 102, 241, 0.18)'
    : 'var(--color-accent)';
  const activeFg = accent === 'indigo'
    ? '#6366f1'
    : 'white';
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-small"
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        border: `1px solid ${active ? activeFg : 'var(--color-border)'}`,
        background: active ? activeBg : 'transparent',
        color: active ? activeFg : 'var(--color-text-muted)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
