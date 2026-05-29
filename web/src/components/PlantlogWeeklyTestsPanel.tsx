// §07 — Weekly compliance tests (Phase 6.7 follow-up).
//
// Two sections in one panel: Generator Weekly Tests and Weekly Water Test.
//
// Compliance rule is CALENDAR-WEEK based, not rolling-7-days, because the
// real-world question is "did each item get done once this week (Mon-Sun)?"
// — not "is the gap between completions <=7 days":
//   - Fresh    ✓  — completed within the current week (Mon-Sun, ET)
//   - Pending  —   last week was completed, this week's window is open
//   - Overdue  ⚠   last week's window closed without a completion
//
// Example: today Mon May 25. An item last completed Mon May 18 covered
// "last week" (May 18-24) so it's NOT overdue, even though days_ago=8 —
// the new week (May 25-31) has only just begun. Old rolling rule wrongly
// flagged it red.
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

/** Monday 00:00 ET of the week containing `d` (treats Sunday as the END of
 *  the previous week). */
function startOfWeekMondayET(d: Date): Date {
  // Convert to ET first so the week boundary is local (not UTC).
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(et);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - offset);
  return monday;
}

type ComplianceStatus = 'fresh' | 'pending' | 'overdue';

function complianceStatus(lastDoneUtc: string): ComplianceStatus {
  const lastDone = new Date(lastDoneUtc);
  const thisWeekStart = startOfWeekMondayET(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  if (lastDone >= thisWeekStart) return 'fresh';    // done this week
  if (lastDone >= lastWeekStart) return 'pending';  // done last week, this week open
  return 'overdue';                                 // missed last week
}

function statusColor(s: ComplianceStatus): string {
  switch (s) {
    case 'fresh':   return 'var(--color-ok, #10b981)';
    case 'pending': return 'var(--color-text)';
    case 'overdue': return 'var(--color-danger)';
  }
}

function statusBadge(s: ComplianceStatus): string {
  switch (s) {
    case 'fresh':   return ' ✓';
    case 'pending': return '';
    case 'overdue': return ' ⚠';
  }
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
            const s = complianceStatus(r.last_done_utc);
            const c = statusColor(s);
            const badge = statusBadge(s);
            const mapped = r.last_by_user ? userMap?.get(r.last_by_user) : null;
            // Recency row tint: today=green, yesterday=amber. Makes "did this
            // happen recently?" answerable from a glance instead of scanning
            // to the far-right Days-ago column.
            const rowBg =
              r.days_ago === 0 ? 'rgba(34,197,94,0.10)'   // light green
              : r.days_ago === 1 ? 'rgba(217,119,6,0.07)' // light amber
              : undefined;
            return (
              <tr
                key={r.log_name}
                style={{
                  borderTop: '1px solid var(--color-border-soft)',
                  background: rowBg,
                }}
              >
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
                  {r.days_ago}{badge}
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

  const { generators, waters, freshCount, overdueCount } = useMemo(() => {
    const all = testsQ.data ?? [];
    const gens = all.filter((r) => r.test_type === 'generator').sort((a, b) => b.days_ago - a.days_ago);
    const wat = all.filter((r) => r.test_type === 'water').sort((a, b) => b.days_ago - a.days_ago);
    const fresh = all.filter((r) => complianceStatus(r.last_done_utc) === 'fresh').length;
    const overdue = all.filter((r) => complianceStatus(r.last_done_utc) === 'overdue').length;
    return { generators: gens, waters: wat, freshCount: fresh, overdueCount: overdue };
  }, [testsQ.data]);

  const subtitle = (
    <span className="t-small t-muted text-right block">
      <span style={{ color: 'var(--color-ok, #10b981)', fontWeight: 600 }}>{freshCount} ✓ this week</span>
      <span className="ml-2">· {generators.length} generators · {waters.length} water tests</span>
      {overdueCount > 0 && (
        <span className="ml-2 font-semibold" style={{ color: 'var(--color-danger)' }}>
          · {overdueCount} ⚠ overdue
        </span>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>
        rule: ✓ done this calendar week (Mon-Sun ET) · ⚠ overdue = missed last week's window
      </span>
    </span>
  );

  return (
    <Section collapsible title="§07 Weekly compliance tests" subtitle={subtitle} loading={testsQ.isLoading}>
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
            Status: <span style={{ color: statusColor('fresh') }}>✓ done this week</span> ·{' '}
            <span style={{ color: statusColor('pending') }}>last week only (this week pending)</span> ·{' '}
            <span style={{ color: statusColor('overdue') }}>⚠ overdue (missed last week)</span>
          </p>
        </>
      )}
    </Section>
  );
}
