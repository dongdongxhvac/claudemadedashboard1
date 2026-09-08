// /engineer/me — field-tech mobile surface. Phone-first single-column,
// one scrolling page: 4 compact stat tiles + PTO. Locked to the signed-in
// user. Read-only per plan: engineers can't edit data here.
//
// 2026-09-08 (per user): the Now / PTO / Profile bottom tabs and the
// Buildings link are gone. After the 08-10 trim there was too little content
// to justify tabs, and the technician surface should focus on performance
// (the tiles) and PTO. Profile, when shared by the admin, is a header link.
//
// Trimmed 2026-08-10 (per user): the UPark engineer view is now stats + PTO
// + snapshot footer only. The Now tab's PM/WO lists, the whole "Mine" tab
// (open PMs / NPMs / WOs / equipment filters / print), overtime and the
// focus board were removed from this surface. The PM/labor/close hooks that
// feed the stat strip still run — "Done this week" and "Due now" derive
// from them.
import { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useMySiteAccess } from '../../hooks/useSiteScope';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import {
  useMyEngineerContext,
  useMyPmRows,
  useMyLaborRows,
  useMyPmCloses,
} from '../../hooks/useMyAssignedData';
import type { PmCloseEvent } from '../../hooks/useCurrentSnapshots';
import { isClosed, localISODate, fmtMd, mondayOf, addDays } from '../../lib/dashboard';
import { OncallBadge } from '../../components/OncallBadge';
import { MyPtoSection } from '../../components/MyPtoSection';


export default function EngineerMobile() {
  const { signOut } = useAuth();
  const me = useMe();
  const ctx = useMyEngineerContext();
  const siteAccess = useMySiteAccess();
  useSnapshotRealtime();

  const pmQ = useMyPmRows(ctx.data?.cmms_assignee_name);
  const laborQ = useMyLaborRows(ctx.data?.cmms_assignee_name);
  const closesQ = useMyPmCloses(ctx.data?.cmms_assignee_name, 14);


  // Friendly routing: admin/manager who land here, send them home.
  if (me.data && me.data.role !== 'engineer') {
    return <Navigate to="/manager" replace />;
  }

  if (me.isLoading || ctx.isLoading || siteAccess.isLoading) {
    return <Wrap><p className="t-text t-muted p-6">Loading...</p></Wrap>;
  }

  if (!ctx.data) {
    // User is an engineer but no engineer_profile row matched — shouldn't happen
    // with our seed, but handle gracefully.
    return (
      <Wrap>
        <div className="p-6 text-center">
          <h2 className="t-section-title mb-2">Setup pending</h2>
          <p className="t-text t-muted">Your profile is being set up. Check back later.</p>
          <button onClick={signOut} className="mt-4 t-small t-accent hover:underline">Sign out</button>
        </div>
      </Wrap>
    );
  }

  const profileAllowed = ctx.data.visible_to_self;

  // Binney St engineers have no CMMS feed (PMs/WOs/labor are UPark-only), so
  // their phone surface is PTO-only: header + PTO, no tab nav.
  if (siteAccess.homeSite === 'binney') {
    return (
      <Wrap>
        <header className="px-4 py-3 border-b flex items-baseline justify-between gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
          <div>
            <h1 className="t-section-title">My PTO</h1>
            <p className="t-small t-muted">{ctx.data.cmms_assignee_name}</p>
          </div>
          <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
        </header>
        <main className="p-4 space-y-4 pb-8">
          <MyPtoSection userId={ctx.data.user_id} compact />
        </main>
      </Wrap>
    );
  }

  return (
    <Wrap>
      {/* slim header */}
      <header className="px-4 py-3 border-b flex items-baseline justify-between gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
        <div>
          <h1 className="t-section-title">My Day</h1>
          <p className="t-small t-muted">{ctx.data.cmms_assignee_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <OncallBadge />
          {profileAllowed && (
            <Link to={`/engineer/${ctx.data.user_id}/profile`} className="t-small t-accent hover:underline">
              Profile
            </Link>
          )}
          {/* Buildings link removed 2026-09-08 per user — technicians don't
              need the KB index from this surface. */}
          {/* No Admin link on the phone surface (removed 2026-07-29 per user):
              the admin tabs are desktop-density pages, and leads should do
              proposal work from a PC. Leads still get "Admin (lead)" in the
              desk view (Pc.tsx). The role==='admin' case was dead code here —
              non-engineers are redirected off this page above. */}
          <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
        </div>
      </header>

      {/* one page: compact stat tiles, then PTO — no tabs */}
      <main className="pb-8">
        <NowTab
          pmRows={pmQ.data ?? []}
          laborRows={laborQ.data ?? []}
          closes={closesQ.data ?? []}
          loading={pmQ.isLoading}
        />
        <div className="px-4 pb-4">
          {/* Phase 12b — engineer self-serve PTO. Locked to the signed-in user. */}
          <MyPtoSection userId={ctx.data.user_id} compact />
        </div>
      </main>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen t-bg" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="max-w-2xl mx-auto" style={{ minHeight: '100vh' }}>
        {children}
      </div>
    </div>
  );
}

// ============================================================================
// NOW TAB — the 4 glance stats + snapshot freshness
// ============================================================================
function NowTab({
  pmRows,
  laborRows,
  closes,
  loading,
}: {
  pmRows: import('../../hooks/useCurrentSnapshots').PmRow[];
  laborRows: import('../../hooks/useCurrentSnapshots').LaborRow[];
  closes: PmCloseEvent[];
  loading: boolean;
}) {
  const todayStr = localISODate(new Date());

  const weekStart = mondayOf(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekStartStr = localISODate(weekStart);
  // "Next 7 days" tile (2026-09-08 per user): tomorrow plus the six days
  // after it, calendar days.
  const tomorrow = addDays(new Date(), 1);
  const tomorrowStr = localISODate(tomorrow);
  const windowEnd = addDays(tomorrow, 6);
  const windowEndStr = localISODate(windowEnd);

  const { overdue, today, tomorrowPms, weekHours, doneThisWeek, snapshotTaken } = useMemo(() => {
    let overdue = 0, today = 0, tomorrowPms = 0;
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) overdue++;
      else if (r.due_date === todayStr) today++;
      else if (r.due_date >= tomorrowStr && r.due_date <= windowEndStr) tomorrowPms++;
    }

    // PM completions this week — from explicit close-event log (Phase 5.5).
    const weekEndExclusive = addDays(weekEnd, 1);
    let doneThisWeek = 0;
    for (const c of closes) {
      const d = new Date(c.completed_on);
      if (d >= weekStart && d < weekEndExclusive) doneThisWeek++;
    }

    const weekHours = (laborRows ?? [])
      .filter((l) => l.week_start === weekStartStr)
      .reduce((s, l) => s + (l.labor_hours ?? 0), 0);
    const snapshotTaken = pmRows[0]?.snapshot_taken_at ?? null;
    return { overdue, today, tomorrowPms, weekHours, doneThisWeek, snapshotTaken };
  }, [pmRows, laborRows, closes, todayStr, tomorrowStr, windowEndStr, weekStartStr, weekStart, weekEnd]);

  if (loading) return <p className="t-text t-muted p-4">Loading your day...</p>;

  const dueNowTotal = overdue + today;
  const dueNowAccent: 'danger' | 'warn' | undefined =
    overdue > 0 ? 'danger' : today > 0 ? 'warn' : undefined;
  // Always show the split (2026-09-08 per user): due today and past due.
  const dueNowSub = `${today} today · ${overdue} past due`;

  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  return (
    <div className="p-4 space-y-2">
      {/* glance stats — 4 compact cards in 2x2 (phones) / 1x4 (md+) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat
          label="Hours"
          value={weekHours.toFixed(1)}
          sub={`/ ${workingDaysElapsed(weekStart)} ${workingDaysElapsed(weekStart) === 1 ? 'day' : 'days'}`}
        />
        <Stat
          label="Completed PMs"
          value={doneThisWeek}
          sub={`/ ${workingDaysElapsed(weekStart)} ${workingDaysElapsed(weekStart) === 1 ? 'day' : 'days'}`}
        />
        <Stat
          label="Due now"
          value={dueNowTotal}
          accent={dueNowAccent}
          sub={dueNowSub}
        />
        <Stat
          label="Next 7 days"
          value={tomorrowPms}
          sub={`${fmtMd(tomorrowStr)} → ${fmtMd(windowEndStr)}`}
        />
      </div>

      {/* snapshot freshness footer */}
      {snapshotLocal && (
        <p className="t-small t-muted text-center">
          Data as of {snapshotLocal}
        </p>
      )}
    </div>
  );
}

/** Weekdays elapsed so far this week, Monday through today, capped at 5.
 *  The hours tile renders "12.5 / 2 days" (2026-09-08 per user) — hours logged
 *  over the working days so far — instead of the week's date range. */
function workingDaysElapsed(weekStart: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let n = 0;
  for (let d = new Date(weekStart); d <= today && n < 5; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

// ============================================================================
// Shared mobile-friendly primitives
// ============================================================================
function Stat({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: number | string;
  accent?: 'danger' | 'warn';
  sub?: string;
}) {
  const color =
    accent === 'danger' ? 'var(--color-danger)' :
    accent === 'warn'   ? 'var(--color-warn)'   :
    'var(--color-text)';
  // Compact two-line tile (2026-09-08 per user): label on top, then the
  // number with its note beside it on one line, so the 2x2 grid stays
  // short and PTO is visible below it without scrolling.
  return (
    <div className="t-card" style={{ padding: '8px 10px' }}>
      <div className="t-muted uppercase tracking-wider" style={{ fontSize: 10 }}>{label}</div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-medium font-mono leading-tight" style={{ color }}>{value}</span>
        {sub && <span className="t-small t-muted">{sub}</span>}
      </div>
    </div>
  );
}
