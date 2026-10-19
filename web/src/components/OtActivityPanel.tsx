// §11c — Overtime activity log (0145): who did what, when, across both
// overtime boards. One row per change, newest first: the dashboard's own
// posts (sign-ups, withdrawals, new / cancelled / rescheduled posts) and
// the OT viewer (volunteers, Outlook changes). The TV strip shows the same
// feed's last few lines.
import { useMemo, useState } from 'react';
import {
  useOtActivity,
  useOtActivityRealtime,
  describeOtActivity,
  otActivityTone,
  type OtActivity,
} from '../hooks/useOtActivity';
import { Section } from './Section';

const TONE_COLOR: Record<ReturnType<typeof otActivityTone>, string> = {
  good:  'var(--color-ok, #10b981)',
  bad:   'var(--color-danger)',
  warn:  'var(--color-warn, #d97706)',
  muted: 'var(--color-text-muted)',
};

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).replace(/,\s*/g, ' ');
}

type Filter = 'all' | 'people' | 'dashboard' | 'ot_viewer';
const FILTERS: { v: Filter; label: string }[] = [
  { v: 'all',       label: 'All' },
  { v: 'people',    label: 'Sign-ups & withdrawals' },
  { v: 'dashboard', label: 'Dashboard posts' },
  { v: 'ot_viewer', label: 'OT viewer' },
];

function Row({ e }: { e: OtActivity }) {
  const d = describeOtActivity(e);
  const tone = otActivityTone(e.kind);
  return (
    <tr className="t-row-divider t-row-hover align-top">
      <td className="py-1 pr-3 whitespace-nowrap t-muted">{fmtStamp(e.at)}</td>
      <td className="py-1 pr-3 whitespace-nowrap" style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text)' }}>
        {d.who || <span className="t-muted">—</span>}
      </td>
      <td className="py-1 pr-3 whitespace-nowrap" style={{ color: TONE_COLOR[tone], fontWeight: 600 }}>
        {d.action}
        {d.extra && <span className="t-muted" style={{ fontWeight: 400 }}> {d.extra}</span>}
      </td>
      <td className="py-1 pr-3" style={{ fontFamily: 'var(--font-body)' }}>
        {d.job}
        {d.when && <span className="t-muted"> · {d.when}</span>}
      </td>
      <td className="py-1 whitespace-nowrap t-muted" style={{ fontSize: '0.72rem' }}>
        {e.source === 'ot_viewer' ? 'OT viewer' : 'Dashboard'}
      </td>
    </tr>
  );
}

export function OtActivityPanel() {
  useOtActivityRealtime();
  const q = useOtActivity(300);
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (filter === 'people')    return all.filter((e) => e.kind === 'signed_up' || e.kind === 'withdrew');
    if (filter === 'dashboard') return all.filter((e) => e.source === 'dashboard');
    if (filter === 'ot_viewer') return all.filter((e) => e.source === 'ot_viewer');
    return all;
  }, [q.data, filter]);

  const last = q.data?.[0];
  const subtitle = (
    <span className="t-small t-muted text-right block">
      {q.data?.length ? (
        <>
          <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>{q.data.length}</span> entries
          {last && <span> · latest {fmtStamp(last.at)}</span>}
        </>
      ) : 'no activity yet'}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>
        sign-ups, withdrawals and post changes on both boards · newest first · the TV shows the last 5
      </span>
    </span>
  );

  return (
    <Section collapsible title="§11c Overtime activity log" subtitle={subtitle} loading={q.isLoading}>
      {q.error ? (
        <p className="t-text t-danger">Error: {(q.error as Error).message}</p>
      ) : (
        <>
          <div className="flex gap-2 mb-2">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setFilter(f.v)}
                className="t-small px-2 py-0.5 rounded"
                style={{
                  background: filter === f.v ? 'var(--color-accent)' : 'var(--color-border-soft)',
                  color: filter === f.v ? 'white' : 'var(--color-text)',
                  fontWeight: filter === f.v ? 600 : 400,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="t-text t-muted">Nothing logged yet.</p>
          ) : (
            <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="t-muted">
                  <th className="text-left pb-1 pr-3">When</th>
                  <th className="text-left pb-1 pr-3">Engineer</th>
                  <th className="text-left pb-1 pr-3">Activity</th>
                  <th className="text-left pb-1 pr-3">Job</th>
                  <th className="text-left pb-1">Board</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => <Row key={e.key} e={e} />)}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}
