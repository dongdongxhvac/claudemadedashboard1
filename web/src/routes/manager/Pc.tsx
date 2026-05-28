import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useCurrentPmRows, useCurrentWoRows, type PmRow } from '../../hooks/useCurrentSnapshots';
import { isNpm, type Period } from '../../lib/dashboard';
import { WeeklyCompletions } from '../../components/WeeklyCompletions';
import { DueNowList } from '../../components/DueNowList';
import { DueThisMonth } from '../../components/DueThisMonth';
import { OpenPmsBreakdown } from '../../components/OpenPmsBreakdown';
import { PlantlogRoundsPanel } from '../../components/PlantlogRoundsPanel';
import { PlantlogWeeklyTestsPanel } from '../../components/PlantlogWeeklyTestsPanel';
import { DeltaAlarmsPanel } from '../../components/DeltaAlarmsPanel';
import { EmailAlarmsPanel } from '../../components/EmailAlarmsPanel';
import { BmsEmailAlarmsPanel } from '../../components/BmsEmailAlarmsPanel';
import { OvertimePanel } from '../../components/OvertimePanel';
import { PtoPanel } from '../../components/PtoPanel';
import { SectionsProvider, SectionsNav } from '../../components/SectionsNav';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { StyleSwitcher } from '../../components/StyleSwitcher';
import { FocusBoardBanner } from '../../components/FocusBoardBanner';
import { AnnouncementComposer } from '../../components/AnnouncementComposer';
import { OncallBadge } from '../../components/OncallBadge';
import { useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { useIsAdmin } from '../../hooks/useMe';
import { Link } from 'react-router-dom';

function isClosed(status: string | null): boolean {
  if (!status) return false;
  return /closed|complete|cancel/i.test(status);
}

// Compare due dates as YYYY-MM-DD strings to avoid any UTC-vs-local pitfall:
// `new Date("2026-06-01")` is UTC midnight, which is May 31 evening in Eastern
// time, and quietly slips a day. String compare on ISO dates is correct.
function isoLocal(d: Date): string {
  // Local YYYY-MM-DD (en-CA happens to produce ISO format).
  return d.toLocaleDateString('en-CA');
}

function computeStats(rows: PmRow[]) {
  const now = new Date();
  const todayStr = isoLocal(now);
  const twoWeeks = new Date(now);
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  const twoWeeksStr = isoLocal(twoWeeks);
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const eomStr = isoLocal(eom);

  let overdue = 0;
  let due2w = 0;
  let dueEom = 0;
  let totalOpen = 0;
  let npm = 0;

  for (const r of rows) {
    if (isClosed(r.status)) continue;

    // NPM counts across ALL open PMs, with or without a due_date.
    if (isNpm(r)) npm++;

    // Date-based buckets need a due_date; skip rows missing one.
    if (!r.due_date) continue;
    totalOpen++;
    const due = r.due_date; // already YYYY-MM-DD from the date column
    if (due < todayStr)    overdue++;
    if (due <= twoWeeksStr) due2w++;
    if (due <= eomStr)      dueEom++;
  }
  return { overdue, due2w, dueEom, totalOpen, npm };
}

function Card({
  label,
  value,
  accent,
  subLabel,
  subValue,
}: {
  label: string;
  value: number;
  accent?: 'red' | 'amber' | 'default';
  subLabel?: string;
  subValue?: number;
}) {
  const accentClass =
    accent === 'red' ? 't-danger' : accent === 'amber' ? 't-warn' : '';
  return (
    <div className="t-card">
      <div className="t-small t-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`t-stat-num ${accentClass}`} style={{ color: accent ? undefined : 'var(--color-text)' }}>
        {value.toLocaleString()}
      </div>
      {subValue !== undefined && (
        <div className="t-small t-muted mt-1 pt-1" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
          <span className="uppercase tracking-wider">{subLabel}</span>{' '}
          <span className="t-mono" style={{ color: 'var(--color-text)' }}>{subValue.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

export default function ManagerPc() {
  const { session, signOut } = useAuth();
  useSnapshotRealtime();
  useFocusBoardRealtime();
  const isAdmin = useIsAdmin();
  const pmQ = useCurrentPmRows();
  const woQ = useCurrentWoRows();

  // Shared period selector for the §00 Crew Performance family of tiles.
  const [period, setPeriod] = useState<Period>('7d');

  const pmStats = useMemo(() => computeStats(pmQ.data ?? []), [pmQ.data]);
  const woOpen = useMemo(
    () => (woQ.data ?? []).filter((w) => w.is_open !== false).length,
    [woQ.data],
  );

  const snapshotTaken = pmQ.data?.[0]?.snapshot_taken_at;
  // Use local time for both the "today" header and the snapshot timestamp.
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local TZ
  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="t-section-title">COVE · PM Dashboard</h1>
            <p className="t-small t-muted">
              {today}
              {snapshotLocal && <span> · snapshot {snapshotLocal}</span>}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <OncallBadge />
            <StyleSwitcher />
            {isAdmin && (
              <Link to="/admin" className="t-small t-accent hover:underline">
                Admin
              </Link>
            )}
            <span className="t-small t-muted">{session?.user.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <FocusBoardBanner />
        <AnnouncementComposer />
        {pmQ.isLoading || woQ.isLoading ? (
          <p className="text-gray-500">Loading current snapshot...</p>
        ) : pmQ.isError ? (
          <p className="text-red-600">Error loading PM data: {(pmQ.error as Error).message}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card label="Overdue" value={pmStats.overdue} accent="red" />
            <Card label="Due in 2 weeks" value={pmStats.due2w} accent="amber" />
            <Card
              label="Total open PMs"
              value={pmStats.totalOpen}
              subLabel="NPM"
              subValue={pmStats.npm}
            />
            <Card label="Due this month" value={pmStats.dueEom} />
            <Card label="WOs open" value={woOpen} />
          </div>
        )}

        <SectionsProvider>
          <div className="space-y-3 pt-2">
            <DueNowList />
            <DueThisMonth />
            <OpenPmsBreakdown />
            <WeeklyCompletions period={period} onPeriodChange={setPeriod} />
            <PlantlogRoundsPanel />
            <PlantlogWeeklyTestsPanel />
            <DeltaAlarmsPanel />
            <EmailAlarmsPanel />
            <BmsEmailAlarmsPanel />
            <OvertimePanel />
            <PtoPanel />
          </div>
          <SectionsNav />
        </SectionsProvider>
      </main>
    </div>
  );
}
