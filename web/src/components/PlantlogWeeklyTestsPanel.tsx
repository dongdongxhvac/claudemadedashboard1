// §07 — Weekly compliance tests (Phase 6.7 follow-up).
//
// Two sections in one panel: Generator Weekly Tests and Weekly Water Test.
// Each lists every piece of equipment with its last-completed timestamp and
// days-since. Color thresholds: <6 green, 6 amber, >=7 red — these mark
// "approaching due" and "overdue" relative to the weekly cadence.
//
// Backed by v_plantlog_weekly_tests_status — latest completion per
// (test_type, log_name).
import { useMemo } from 'react';
import { usePlantlogWeeklyTests, usePlantlogUserMap, type PlantlogWeeklyTest } from '../hooks/usePlantlog';
import { Section } from './Section';

function fmtDoneAt(utcIso: string): string {
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ageColor(daysAgo: number): string {
  if (daysAgo > 7)  return 'var(--color-danger)';
  if (daysAgo >= 6) return 'var(--color-warning, #d97706)';
  return 'var(--color-text)';
}

function TestTable({
  title,
  rows,
  userMap,
}: {
  title: string;
  rows: PlantlogWeeklyTest[];
  userMap: Map<string, { full_name: string; user_id: string }> | undefined;
}) {
  return (
    <div className="mb-5">
      <div className="t-small t-muted uppercase tracking-wider mb-2">
        {title} <span className="t-text">— {rows.length} completed in window</span>
      </div>
      <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="t-muted">
            <th className="text-left pb-1 pr-3">Equipment</th>
            <th className="text-left pb-1 pr-3">Building</th>
            <th className="text-left pb-1 pr-3">Last by</th>
            <th className="text-right pb-1 px-2">Last done (ET)</th>
            <th className="text-right pb-1 pl-3">Days ago</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = ageColor(r.days_ago);
            const mapped = r.last_by_user ? userMap?.get(r.last_by_user) : null;
            return (
              <tr key={r.log_name} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                <td className="py-1 pr-3">
                  <span>{r.log_name}</span>
                  {r.activity_name && r.activity_name !== r.log_name && (
                    <span className="t-muted ml-2" style={{ fontSize: '0.7rem' }}>{r.activity_name}</span>
                  )}
                </td>
                <td className="py-1 pr-3 t-muted">{r.building ?? '—'}</td>
                <td className="py-1 pr-3">
                  {mapped ? mapped.full_name : r.last_by_user ?? '—'}
                </td>
                <td className="text-right px-2 py-1">{fmtDoneAt(r.last_done_utc)}</td>
                <td className="text-right pl-3 py-1 font-semibold" style={{ color: c }}>
                  {r.days_ago}
                  {r.days_ago > 7 ? ' ⚠' : r.days_ago >= 6 ? ' •' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PlantlogWeeklyTestsPanel() {
  const testsQ = usePlantlogWeeklyTests();
  const userMapQ = usePlantlogUserMap();

  const { generators, waters } = useMemo(() => {
    const all = testsQ.data ?? [];
    const gens = all.filter((r) => r.test_type === 'generator').sort((a, b) => b.days_ago - a.days_ago);
    const wat = all.filter((r) => r.test_type === 'water').sort((a, b) => b.days_ago - a.days_ago);
    return { generators: gens, waters: wat };
  }, [testsQ.data]);

  const subtitle = (
    <span className="t-small t-muted">
      {generators.length} generators · {waters.length} water tests
    </span>
  );

  return (
    <Section title="§07 Weekly compliance tests" subtitle={subtitle} loading={testsQ.isLoading}>
      {testsQ.error ? (
        <p className="t-text t-danger">Error: {(testsQ.error as Error).message}</p>
      ) : generators.length === 0 && waters.length === 0 ? (
        <p className="t-text t-muted">
          No completed weekly tests in the ingested window. (Polling runs hourly 7 AM-7 PM.)
        </p>
      ) : (
        <>
          <TestTable title="Generator Weekly Tests" rows={generators} userMap={userMapQ.data} />
          <TestTable title="Weekly Water Test"      rows={waters}      userMap={userMapQ.data} />
          <p className="t-small t-muted">
            Color: <span style={{ color: ageColor(0) }}>0-5 days fresh</span> ·{' '}
            <span style={{ color: ageColor(6) }}>6-7 days approaching</span> ·{' '}
            <span style={{ color: ageColor(8) }}>&gt;7 days overdue</span>
          </p>
        </>
      )}
    </Section>
  );
}
