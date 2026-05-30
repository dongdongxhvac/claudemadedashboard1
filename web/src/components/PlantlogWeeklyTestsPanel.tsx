// §07 — Plant Log Compliance Tests.
//
// Three sections in one panel:
//   * Generator Weekly Tests       (weekly cadence, Mon-Sun ET)
//   * Weekly Water Test            (weekly cadence, Mon-Sun ET)
//   * Monthly Water Meter Readings (monthly cadence, due in days 1-6 ET)
//
// Weekly compliance rule is CALENDAR-WEEK based, not rolling-7-days, because
// the real-world question is "did each item get done once this week (Mon-Sun)?"
// — not "is the gap between completions <=7 days":
//   - Fresh    ✓  — completed within the current week (Mon-Sun, ET)
//   - Pending  —   last week was completed, this week's window is open
//   - Overdue  ⚠   last week's window closed without a completion
//
// Monthly compliance rule (water meter readings):
//   - Fresh    ✓  — done in current month, on day 1-6 (in-window)
//   - Late     ⚠  — done in current month, on day 7+ (late but done)
//   - Pending  —   today is day 1-6 of current month, not yet done
//   - Overdue  ⚠  — today is day 7+ of current month, not done this month
//
// Backed by v_plantlog_weekly_tests_status (weekly) and
// v_plantlog_monthly_water_meters_status (monthly). The two views are
// independent so weekly compliance logic stays untouched.
import { useMemo } from 'react';
import {
  usePlantlogWeeklyTests,
  usePlantlogMonthlyWaterMeters,
  usePlantlogUserMap,
  type PlantlogWeeklyTest,
  type PlantlogMonthlyMeter,
} from '../hooks/usePlantlog';
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

// --- Monthly cadence (water meter readings) ---------------------------------
// Due in calendar days 1-6 of each month. 4-state classifier, distinct from
// the weekly one above because "late but done this month" deserves its own
// color (amber) — neither fully fresh nor fully overdue.

type MonthlyStatus = 'fresh' | 'late' | 'pending' | 'overdue';

/** Return {month: 1-12, day: 1-31} from a Date interpreted in ET. */
function etMonthDay(d: Date): { month: number; day: number; year: number } {
  // toLocaleString with timeZone gives us local ET parts as a parseable string.
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return { month: et.getMonth() + 1, day: et.getDate(), year: et.getFullYear() };
}

function monthlyComplianceStatus(lastDoneUtc: string): MonthlyStatus {
  const today = etMonthDay(new Date());
  const done  = etMonthDay(new Date(lastDoneUtc));
  const doneThisMonth = done.year === today.year && done.month === today.month;
  if (doneThisMonth && done.day <= 6)  return 'fresh';
  if (doneThisMonth && done.day > 6)   return 'late';
  // Not done this month at all (or done in a prior month/year):
  if (today.day <= 6) return 'pending';
  return 'overdue';
}

function monthlyStatusColor(s: MonthlyStatus): string {
  switch (s) {
    case 'fresh':   return 'var(--color-ok, #10b981)';
    case 'late':    return 'var(--color-warn, #d97706)';
    case 'pending': return 'var(--color-text)';
    case 'overdue': return 'var(--color-danger)';
  }
}

function monthlyStatusBadge(s: MonthlyStatus): string {
  switch (s) {
    case 'fresh':   return ' ✓';
    case 'late':    return ' ⚠ late';
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

function MonthlyMeterTable({
  title,
  rows,
  userMap,
}: {
  title: string;
  rows: PlantlogMonthlyMeter[];
  userMap: Map<string, { full_name: string; user_id: string }> | undefined;
}) {
  // Sub-header reminds the user of the rule even when no rows exist yet.
  const todayDay = etMonthDay(new Date()).day;
  return (
    <div className="mb-5">
      <div className="t-small t-muted uppercase tracking-wider mb-2">
        {title}{' '}
        <span className="t-text">
          — due days 1-6 of the month (today is day {todayDay})
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="t-text t-muted">
          No monthly water meter readings ingested yet. (Polling runs hourly 7 AM-7 PM.)
        </p>
      ) : (
        <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="t-muted">
              <th className="text-left pb-1 pr-3">Log</th>
              <th className="text-left pb-1 pr-3">Building</th>
              <th className="text-left pb-1 pr-3">Last by</th>
              <th className="text-right pb-1 px-2">Last done (ET)</th>
              <th className="text-right pb-1 pl-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = monthlyComplianceStatus(r.last_done_utc);
              const c = monthlyStatusColor(s);
              const badge = monthlyStatusBadge(s);
              const mapped = r.last_by_user ? userMap?.get(r.last_by_user) : null;
              return (
                <tr
                  key={r.log_name}
                  style={{ borderTop: '1px solid var(--color-border-soft)' }}
                >
                  <td className="py-1 pr-3">{r.log_name}</td>
                  <td className="py-1 pr-3 t-muted">{r.building ?? '—'}</td>
                  <td className="py-1 pr-3">
                    {mapped ? mapped.full_name : r.last_by_user ?? '—'}
                  </td>
                  <td className="text-right px-2 py-1">{fmtDoneAt(r.last_done_utc)}</td>
                  <td
                    className="text-right pl-3 py-1 font-semibold"
                    style={{ color: c }}
                  >
                    {r.days_ago}d ago{badge}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function PlantlogWeeklyTestsPanel() {
  const testsQ = usePlantlogWeeklyTests();
  const monthlyQ = usePlantlogMonthlyWaterMeters();
  const userMapQ = usePlantlogUserMap();

  const { generators, waters, weeklyFresh, weeklyOverdue } = useMemo(() => {
    const all = testsQ.data ?? [];
    const gens = all.filter((r) => r.test_type === 'generator').sort((a, b) => b.days_ago - a.days_ago);
    const wat = all.filter((r) => r.test_type === 'water').sort((a, b) => b.days_ago - a.days_ago);
    const fresh = all.filter((r) => complianceStatus(r.last_done_utc) === 'fresh').length;
    const overdue = all.filter((r) => complianceStatus(r.last_done_utc) === 'overdue').length;
    return { generators: gens, waters: wat, weeklyFresh: fresh, weeklyOverdue: overdue };
  }, [testsQ.data]);

  const { meters, monthlyFresh, monthlyOverdue, monthlyLate } = useMemo(() => {
    const all = monthlyQ.data ?? [];
    const sorted = [...all].sort((a, b) => b.days_ago - a.days_ago);
    let fresh = 0, overdue = 0, late = 0;
    for (const r of all) {
      const s = monthlyComplianceStatus(r.last_done_utc);
      if (s === 'fresh') fresh++;
      else if (s === 'overdue') overdue++;
      else if (s === 'late') late++;
    }
    return { meters: sorted, monthlyFresh: fresh, monthlyOverdue: overdue, monthlyLate: late };
  }, [monthlyQ.data]);

  const totalOverdue = weeklyOverdue + monthlyOverdue;

  const subtitle = (
    <span className="t-small t-muted text-right block">
      <span style={{ color: 'var(--color-ok, #10b981)', fontWeight: 600 }}>
        {weeklyFresh} ✓ this week
      </span>
      <span className="ml-2">· {generators.length} generators · {waters.length} water tests</span>
      <span className="ml-2">· {meters.length} monthly meter{meters.length === 1 ? '' : 's'}</span>
      {monthlyFresh > 0 && (
        <span className="ml-2" style={{ color: 'var(--color-ok, #10b981)' }}>
          · {monthlyFresh} ✓ this month
        </span>
      )}
      {monthlyLate > 0 && (
        <span className="ml-2" style={{ color: 'var(--color-warn, #d97706)' }}>
          · {monthlyLate} ⚠ late
        </span>
      )}
      {totalOverdue > 0 && (
        <span className="ml-2 font-semibold" style={{ color: 'var(--color-danger)' }}>
          · {totalOverdue} ⚠ overdue
        </span>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>
        weekly: ✓ done this Mon-Sun ET · monthly: ✓ done days 1-6 of the month
      </span>
    </span>
  );

  const isLoading = testsQ.isLoading || monthlyQ.isLoading;
  const error = testsQ.error || monthlyQ.error;
  const empty = generators.length === 0 && waters.length === 0 && meters.length === 0;

  return (
    <Section
      collapsible
      title="§07 Plant Log Compliance Tests"
      subtitle={subtitle}
      loading={isLoading}
    >
      {error ? (
        <p className="t-text t-danger">Error: {(error as Error).message}</p>
      ) : empty ? (
        <p className="t-text t-muted">
          No completed compliance tests in the ingested window. (Polling runs hourly 7 AM-7 PM.)
        </p>
      ) : (
        <>
          <TestTable title="Generator Weekly Tests" rows={generators} userMap={userMapQ.data} />
          <TestTable title="Weekly Water Test"      rows={waters}      userMap={userMapQ.data} />
          <MonthlyMeterTable
            title="Monthly Water Meter Readings"
            rows={meters}
            userMap={userMapQ.data}
          />
          <p className="t-small t-muted">
            Weekly status:{' '}
            <span style={{ color: statusColor('fresh') }}>✓ done this week</span> ·{' '}
            <span style={{ color: statusColor('pending') }}>last week only (this week pending)</span> ·{' '}
            <span style={{ color: statusColor('overdue') }}>⚠ overdue (missed last week)</span>
          </p>
          <p className="t-small t-muted">
            Monthly status:{' '}
            <span style={{ color: monthlyStatusColor('fresh') }}>✓ done days 1-6</span> ·{' '}
            <span style={{ color: monthlyStatusColor('late') }}>⚠ late (done after day 6)</span> ·{' '}
            <span style={{ color: monthlyStatusColor('pending') }}>pending (still in days 1-6)</span> ·{' '}
            <span style={{ color: monthlyStatusColor('overdue') }}>⚠ overdue (past day 6, not done)</span>
          </p>
        </>
      )}
    </Section>
  );
}
