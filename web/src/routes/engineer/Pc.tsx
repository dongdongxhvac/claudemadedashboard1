// /engineer/me on viewports >= 768px. Desk-view layout. Same data hooks as
// Mobile. Read-only per plan.
//
// Trimmed 2026-08-10 (per user): the UPark engineer view is now stats + PTO
// + snapshot footer only. The PM table / WOs / NPMs / overtime / focus board
// panels were removed from this surface — the data hooks that feed the stat
// strip still run, since "Done this week" and "Due now" derive from them.
import { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe, useIsAdmin } from '../../hooks/useMe';
import { useMySiteAccess } from '../../hooks/useSiteScope';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { OncallBadge } from '../../components/OncallBadge';
import {
  useMyEngineerContext, useMyPmRows, useMyLaborRows, useMyPmCloses,
} from '../../hooks/useMyAssignedData';
import { MyPtoSection } from '../../components/MyPtoSection';
import type { PmRow } from '../../hooks/useCurrentSnapshots';
import {
  isClosed, localISODate, fmtMd, mondayOf, addDays,
} from '../../lib/dashboard';

export default function EngineerPc() {
  const { session, signOut } = useAuth();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const canAdmin = isAdmin || me.data?.is_lead === true;
  const ctx = useMyEngineerContext();
  const siteAccess = useMySiteAccess();
  useSnapshotRealtime();

  const pmQ = useMyPmRows(ctx.data?.cmms_assignee_name);
  const laborQ = useMyLaborRows(ctx.data?.cmms_assignee_name);
  // Phase 5.5: PM completions live in pm_close_events now.
  const closesQ = useMyPmCloses(ctx.data?.cmms_assignee_name, 14);

  const todayStr = localISODate(new Date());
  const tomorrow = addDays(new Date(), 1);
  const tomorrowStr = localISODate(tomorrow);
  const weekStart = mondayOf(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekStartStr = localISODate(weekStart);

  const pmRows = pmQ.data ?? [];
  const laborRows = laborQ.data ?? [];
  const closes = closesQ.data ?? [];

  // --- stats ---
  const stats = useMemo(() => {
    const overdue: PmRow[] = [];
    const today: PmRow[] = [];
    const tomorrowPms: PmRow[] = [];
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) overdue.push(r);
      else if (r.due_date === todayStr) today.push(r);
      else if (r.due_date === tomorrowStr) tomorrowPms.push(r);
    }
    // PM completions this week — from explicit close-event log.
    const weekEndExclusive = addDays(weekEnd, 1);
    let doneThisWeek = 0;
    for (const c of closes) {
      const d = new Date(c.completed_on);
      if (d >= weekStart && d < weekEndExclusive) doneThisWeek++;
    }
    // Labor hours this week — week-aligned filter already correct since
    // current_labor_snapshot returns the latest WTD per (week, tech).
    const weekHours = laborRows
      .filter((l) => l.week_start === weekStartStr)
      .reduce((s, l) => s + (l.labor_hours ?? 0), 0);
    return { overdue, today, tomorrowPms, weekHours, doneThisWeek };
  }, [pmRows, laborRows, closes, todayStr, tomorrowStr, weekStart, weekEnd, weekStartStr]);

  const snapshotTaken = pmRows[0]?.snapshot_taken_at;
  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  if (me.isLoading || ctx.isLoading || siteAccess.isLoading) {
    return <div className="min-h-screen t-bg p-8 t-text t-muted">Loading...</div>;
  }
  // Non-engineers (admin/manager/etc.) have no engineer context — send them to
  // the manager dashboard instead of the "Setup pending" dead-end. Mirrors the
  // guard the mobile layout already has.
  if (me.data && me.data.role !== 'engineer') {
    return <Navigate to="/manager" replace />;
  }
  if (!ctx.data) {
    return (
      <div className="min-h-screen t-bg p-8">
        <h2 className="t-section-title mb-2">Setup pending</h2>
        <p className="t-text t-muted">Your profile is being set up. Check back later.</p>
        <button onClick={signOut} className="mt-4 t-small t-accent hover:underline">Sign out</button>
      </div>
    );
  }

  const dueNowTotal = stats.overdue.length + stats.today.length;
  const dueNowAccent: 'red' | 'amber' | undefined =
    stats.overdue.length > 0 ? 'red' : stats.today.length > 0 ? 'amber' : undefined;
  const profileAllowed = ctx.data.visible_to_self;
  // Binney St engineers have no CMMS feed (PMs/WOs/labor are UPark-only), so
  // their dashboard is PTO-only. Everything else would just render empty.
  const binneyOnly = siteAccess.homeSite === 'binney';

  return (
    <div className="min-h-screen t-bg">
      {/* slim header */}
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="t-section-title">{ctx.data.cmms_assignee_name ?? 'Engineer'}</h1>
            <p className="t-small t-muted">
              LVL {ctx.data.level} · {ctx.data.xp.toLocaleString()} XP
              {ctx.data.discipline && ` · ${ctx.data.discipline}`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <OncallBadge />
            {profileAllowed && (
              <Link to={`/engineer/${ctx.data.user_id}/profile`} className="t-small t-accent hover:underline">
                View profile →
              </Link>
            )}
            {/* /buildings is the UPark KB index (site-fenced in App.tsx) —
                Binney has no buildings surface yet, so don't offer the link. */}
            {!binneyOnly && (
              <Link to="/buildings" className="t-small t-accent hover:underline">
                Buildings
              </Link>
            )}
            {canAdmin && (
              <Link to="/admin" className="t-small t-accent hover:underline">
                {isAdmin ? 'Admin' : 'Admin (lead)'}
              </Link>
            )}
            <span className="t-small t-muted">{session?.user.email}</span>
            <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {binneyOnly ? (
          /* Binney St: PTO-only view — no CMMS-backed panels for this site yet. */
          <MyPtoSection userId={ctx.data.user_id} />
        ) : (
        <>
        {/* stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Hours · this week" value={stats.weekHours.toFixed(1)}
            sub={`${fmtMd(localISODate(weekStart))} → ${fmtMd(localISODate(weekEnd))}`} />
          <StatCard label="Done · this week" value={stats.doneThisWeek} sub="completed PMs" />
          <StatCard label="Due now" value={dueNowTotal} accent={dueNowAccent}
            sub={dueNowTotal === 0 ? 'all caught up' : `${stats.overdue.length} ovd · ${stats.today.length} td`} />
          <StatCard label="Tomorrow" value={stats.tomorrowPms.length}
            sub={stats.tomorrowPms.length === 0 ? 'nothing' : 'PMs due tomorrow'} />
        </div>

        {/* Phase 12b — engineer self-serve PTO. Locked to the signed-in user. */}
        <MyPtoSection userId={ctx.data.user_id} />

        {snapshotLocal && (
          <p className="t-small t-muted text-center pt-2">Data as of {snapshotLocal}</p>
        )}
        </>
        )}
      </main>
    </div>
  );
}

// ----- Small helpers -----------------------------------------------------

function StatCard({
  label, value, sub, accent,
}: {
  label: string; value: number | string; sub?: string; accent?: 'red' | 'amber';
}) {
  const color =
    accent === 'red'   ? 'var(--color-danger)' :
    accent === 'amber' ? 'var(--color-warn)'   :
    'var(--color-text)';
  return (
    <div className="t-card">
      <div className="t-small t-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="t-stat-num" style={{ color }}>{value}</div>
      {sub && <div className="t-small t-muted mt-1">{sub}</div>}
    </div>
  );
}

