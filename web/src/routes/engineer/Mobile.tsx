// /engineer/me — field-tech mobile surface. Phone-first single-column,
// bottom-nav with Now / PTO / Profile. Locked to the signed-in user.
// Read-only per plan: engineers can't edit data here.
//
// Trimmed 2026-08-10 (per user): the UPark engineer view is now stats + PTO
// + snapshot footer only. The Now tab's PM/WO lists, the whole "Mine" tab
// (open PMs / NPMs / WOs / equipment filters / print), overtime and the
// focus board were removed from this surface. The PM/labor/close hooks that
// feed the stat strip still run — "Done this week" and "Due now" derive
// from them.
import { useMemo, useState } from 'react';
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

type Tab = 'now' | 'pto' | 'profile';

export default function EngineerMobile() {
  const { signOut } = useAuth();
  const me = useMe();
  const ctx = useMyEngineerContext();
  const siteAccess = useMySiteAccess();
  useSnapshotRealtime();

  const pmQ = useMyPmRows(ctx.data?.cmms_assignee_name);
  const laborQ = useMyLaborRows(ctx.data?.cmms_assignee_name);
  const closesQ = useMyPmCloses(ctx.data?.cmms_assignee_name, 14);

  const [tab, setTab] = useState<Tab>('now');

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

  const profileTabAllowed = ctx.data.visible_to_self;

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
          <Link to="/buildings" className="t-small t-accent hover:underline">
            Buildings
          </Link>
          {/* No Admin link on the phone surface (removed 2026-07-29 per user):
              the admin tabs are desktop-density pages, and leads should do
              proposal work from a PC. Leads still get "Admin (lead)" in the
              desk view (Pc.tsx). The role==='admin' case was dead code here —
              non-engineers are redirected off this page above. */}
          <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
        </div>
      </header>

      {/* tab body — pad bottom for the fixed nav */}
      <main className="pb-24">
        {tab === 'now' && (
          <NowTab
            pmRows={pmQ.data ?? []}
            laborRows={laborQ.data ?? []}
            closes={closesQ.data ?? []}
            loading={pmQ.isLoading}
          />
        )}
        {tab === 'pto' && (
          <div className="p-4">
            {/* Phase 12b — engineer self-serve PTO. Locked to the signed-in user. */}
            <MyPtoSection userId={ctx.data.user_id} compact />
          </div>
        )}
        {tab === 'profile' && profileTabAllowed && (
          <Navigate to={`/engineer/${ctx.data.user_id}/profile`} replace />
        )}
      </main>

      {/* fixed bottom nav */}
      <nav
        className="fixed bottom-0 inset-x-0 border-t flex"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <TabBtn label="Now" icon="•" active={tab === 'now'} onClick={() => setTab('now')} />
        <TabBtn label="PTO" icon="▤" active={tab === 'pto'} onClick={() => setTab('pto')} />
        {profileTabAllowed ? (
          <TabBtn label="Profile" icon="◆" active={tab === 'profile'} onClick={() => setTab('profile')} />
        ) : (
          <div className="flex-1 py-3 text-center t-small" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} title="Profile not yet shared by your admin">
            <div>—</div>
            <div className="t-small">Profile</div>
          </div>
        )}
      </nav>
    </Wrap>
  );
}

function TabBtn({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-3 text-center"
      style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
    >
      <div className="text-lg">{icon}</div>
      <div className="t-small">{label}</div>
    </button>
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
  const tomorrow = addDays(new Date(), 1);
  const tomorrowStr = localISODate(tomorrow);

  const { overdue, today, tomorrowPms, weekHours, doneThisWeek, snapshotTaken } = useMemo(() => {
    let overdue = 0, today = 0, tomorrowPms = 0;
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) overdue++;
      else if (r.due_date === todayStr) today++;
      else if (r.due_date === tomorrowStr) tomorrowPms++;
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
  }, [pmRows, laborRows, closes, todayStr, tomorrowStr, weekStartStr, weekStart, weekEnd]);

  if (loading) return <p className="t-text t-muted p-4">Loading your day...</p>;

  const dueNowTotal = overdue + today;
  const dueNowAccent: 'danger' | 'warn' | undefined =
    overdue > 0 ? 'danger' : today > 0 ? 'warn' : undefined;
  const dueNowSub =
    dueNowTotal === 0 ? 'all caught up' : `${overdue} overdue · ${today} today`;

  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  return (
    <div className="p-4 space-y-4">
      {/* glance stats — 4 cards in 2x2 (phones) / 1x4 (md+) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat
          label="Hours · this week"
          value={weekHours.toFixed(1)}
          sub={`${fmtMd(localISODate(weekStart))} → ${fmtMd(localISODate(weekEnd))}`}
        />
        <Stat
          label="Done · this week"
          value={doneThisWeek}
          sub="completed PMs"
        />
        <Stat
          label="Due now"
          value={dueNowTotal}
          accent={dueNowAccent}
          sub={dueNowSub}
        />
        <Stat
          label="Tomorrow"
          value={tomorrowPms}
          sub={tomorrowPms === 0 ? 'nothing scheduled' : 'PMs due tomorrow'}
        />
      </div>

      {/* snapshot freshness footer */}
      {snapshotLocal && (
        <p className="t-small t-muted text-center pt-2 pb-1">
          Data as of {snapshotLocal}
        </p>
      )}
    </div>
  );
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
  return (
    <div className="t-card text-center">
      <div className="t-small t-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="text-3xl font-medium font-mono" style={{ color }}>{value}</div>
      {sub && <div className="t-small t-muted mt-1">{sub}</div>}
    </div>
  );
}
