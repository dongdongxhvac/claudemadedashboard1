// /engineer/me — field-tech mobile surface. Phone-first single-column,
// bottom-nav with Now / Mine / Profile. Locked to the signed-in user.
// Read-only per plan: engineers can't edit data here.
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useFocusBoardRealtime, useActiveFocusItems } from '../../hooks/useFocusBoard';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import {
  useMyEngineerContext,
  useMyPmRows,
  useMyWoRows,
} from '../../hooks/useMyAssignedData';
import { isClosed, localISODate, fmtMd } from '../../lib/dashboard';
import { FocusBoardBanner } from '../../components/FocusBoardBanner';

type Tab = 'now' | 'mine' | 'profile';

export default function EngineerMobile() {
  const { signOut } = useAuth();
  const me = useMe();
  const ctx = useMyEngineerContext();
  useSnapshotRealtime();
  useFocusBoardRealtime();

  const pmQ = useMyPmRows(ctx.data?.cmms_assignee_name);
  const woQ = useMyWoRows(ctx.data?.cmms_assignee_name);

  const [tab, setTab] = useState<Tab>('now');

  // Friendly routing: admin/manager who land here, send them home.
  if (me.data && me.data.role !== 'engineer') {
    return <Navigate to="/manager" replace />;
  }

  if (me.isLoading || ctx.isLoading) {
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

  return (
    <Wrap>
      {/* slim header */}
      <header className="px-4 py-3 border-b flex items-baseline justify-between" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
        <div>
          <h1 className="t-section-title">My Day</h1>
          <p className="t-small t-muted">{ctx.data.cmms_assignee_name}</p>
        </div>
        <button onClick={signOut} className="t-small t-accent hover:underline">Sign out</button>
      </header>

      {/* tab body — pad bottom for the fixed nav */}
      <main className="pb-24">
        {tab === 'now' && <NowTab pmRows={pmQ.data ?? []} woRows={woQ.data ?? []} loading={pmQ.isLoading || woQ.isLoading} />}
        {tab === 'mine' && <MineTab pmRows={pmQ.data ?? []} woRows={woQ.data ?? []} loading={pmQ.isLoading || woQ.isLoading} />}
        {tab === 'profile' && profileTabAllowed && (
          <Navigate to={`/engineer/${ctx.data.user_id}/profile`} replace />
        )}
      </main>

      {/* fixed bottom nav */}
      <nav
        className="fixed bottom-0 inset-x-0 border-t flex"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <TabBtn label="Now"  icon="•" active={tab === 'now'}  onClick={() => setTab('now')} />
        <TabBtn label="Mine" icon="▤" active={tab === 'mine'} onClick={() => setTab('mine')} />
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
// NOW TAB — what matters in the next few hours: today, overdue, focus board
// ============================================================================
function NowTab({
  pmRows,
  woRows,
  loading,
}: {
  pmRows: import('../../hooks/useCurrentSnapshots').PmRow[];
  woRows: import('../../hooks/useCurrentSnapshots').WoRow[];
  loading: boolean;
}) {
  const focus = useActiveFocusItems();
  const todayStr = localISODate(new Date());
  const fb = focus.data ?? [];

  const { overdue, today, openWos } = useMemo(() => {
    const overdue: typeof pmRows = [];
    const today: typeof pmRows = [];
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) overdue.push(r);
      else if (r.due_date === todayStr) today.push(r);
    }
    overdue.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    today.sort((a, b) => (a.task_no ?? '').localeCompare(b.task_no ?? ''));
    const openWos = (woRows ?? []).filter((w) => w.is_open !== false);
    return { overdue, today, openWos };
  }, [pmRows, woRows, todayStr]);

  if (loading) return <p className="t-text t-muted p-4">Loading your day...</p>;

  return (
    <div className="p-4 space-y-4">
      {/* focus board */}
      <FocusBoardBanner allowDismiss={false} />
      {fb.length === 0 && focus.isSuccess && (
        <p className="t-small t-muted italic">No announcements right now.</p>
      )}

      {/* glance stats */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Overdue" value={overdue.length} accent={overdue.length > 0 ? 'danger' : undefined} />
        <Stat label="Due today" value={today.length} accent={today.length > 0 ? 'warn' : undefined} />
        <Stat label="WOs open" value={openWos.length} />
      </div>

      {overdue.length > 0 && (
        <Section title="OVERDUE">
          <PmList rows={overdue} highlightOverdue todayStr={todayStr} />
        </Section>
      )}

      {today.length > 0 && (
        <Section title="DUE TODAY">
          <PmList rows={today} todayStr={todayStr} />
        </Section>
      )}

      {openWos.length > 0 && (
        <Section title="OPEN WORK ORDERS">
          <WoList rows={openWos} />
        </Section>
      )}

      {overdue.length === 0 && today.length === 0 && openWos.length === 0 && (
        <p className="t-text t-muted text-center py-8">All caught up. ✓</p>
      )}
    </div>
  );
}

// ============================================================================
// MINE TAB — full list of my open PMs + WOs, sortable
// ============================================================================
function MineTab({
  pmRows,
  woRows,
  loading,
}: {
  pmRows: import('../../hooks/useCurrentSnapshots').PmRow[];
  woRows: import('../../hooks/useCurrentSnapshots').WoRow[];
  loading: boolean;
}) {
  const todayStr = localISODate(new Date());

  const myPms = useMemo(() => {
    return pmRows
      .filter((r) => !isClosed(r.status))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  }, [pmRows]);

  const myWos = useMemo(() => (woRows ?? []).filter((w) => w.is_open !== false), [woRows]);

  if (loading) return <p className="t-text t-muted p-4">Loading...</p>;

  return (
    <div className="p-4 space-y-4">
      <Section title={`MY OPEN PMs · ${myPms.length}`}>
        {myPms.length === 0 ? (
          <p className="t-small t-muted italic px-1">None.</p>
        ) : (
          <PmList rows={myPms} todayStr={todayStr} highlightOverdue />
        )}
      </Section>
      <Section title={`MY OPEN WOs · ${myWos.length}`}>
        {myWos.length === 0 ? (
          <p className="t-small t-muted italic px-1">None.</p>
        ) : (
          <WoList rows={myWos} />
        )}
      </Section>
    </div>
  );
}

// ============================================================================
// Shared mobile-friendly primitives
// ============================================================================
function Stat({ label, value, accent }: { label: string; value: number; accent?: 'danger' | 'warn' }) {
  const color = accent === 'danger' ? 'var(--color-danger)' : accent === 'warn' ? 'var(--color-warn)' : 'var(--color-text)';
  return (
    <div className="t-card text-center">
      <div className="t-small t-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="text-3xl font-medium font-mono" style={{ color }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="t-small t-muted uppercase tracking-wider mb-2 px-1">{title}</h3>
      <div className="t-card p-0 overflow-hidden">{children}</div>
    </section>
  );
}

function PmList({
  rows,
  todayStr,
  highlightOverdue,
}: {
  rows: import('../../hooks/useCurrentSnapshots').PmRow[];
  todayStr: string;
  highlightOverdue?: boolean;
}) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-soft)' }}>
      {rows.map((r, i) => {
        const overdue = highlightOverdue && r.due_date && r.due_date < todayStr;
        return (
          <li key={`${r.task_no}-${i}`} className="px-3 py-2.5">
            <div className="flex items-start gap-3">
              <span className={`t-mono t-small shrink-0 ${overdue ? 't-danger font-medium' : 't-muted'}`} style={{ minWidth: 44 }}>
                {r.due_date ? fmtMd(r.due_date) : '—'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="t-text truncate" title={r.name ?? ''}>{r.name ?? '—'}</div>
                <div className="t-small t-muted truncate">
                  <span className="t-mono">{r.task_no ?? '—'}</span>
                  {(r.building_code || r.equipment) && (
                    <> · {[r.building_code, r.equipment].filter(Boolean).join(' / ')}</>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WoList({ rows }: { rows: import('../../hooks/useCurrentSnapshots').WoRow[] }) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-soft)' }}>
      {rows.map((w, i) => (
        <li key={`${w.wo_id}-${i}`} className="px-3 py-2.5">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="t-mono t-small t-muted">{w.wo_id ?? '—'}</span>
            <span className="t-small uppercase tracking-wide" style={{ color: 'var(--color-accent)' }}>
              {w.status ?? '—'}
            </span>
          </div>
          <div className="t-text">{w.description ?? '—'}</div>
          {w.building_code && (
            <div className="t-small t-muted mt-0.5">{w.building_code}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

// Allow admin/manager to use `/engineer/me` for previewing the layout —
// they're redirected upstream by the role check before this is reached.
// kept here so the file is self-contained.
export function _RoleRedirectFromMe() {
  return <Link to="/manager">Go to manager</Link>;
}
