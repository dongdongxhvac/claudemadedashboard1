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
  useMyLaborRows,
} from '../../hooks/useMyAssignedData';
import { isClosed, isCompletedStatus, isNpm, localISODate, fmtMd, mondayOf, addDays } from '../../lib/dashboard';
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
  const laborQ = useMyLaborRows(ctx.data?.cmms_assignee_name);

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
        {tab === 'now' && (
          <NowTab
            pmRows={pmQ.data ?? []}
            woRows={woQ.data ?? []}
            laborRows={laborQ.data ?? []}
            loading={pmQ.isLoading || woQ.isLoading}
          />
        )}
        {tab === 'mine' && (
          <MineTab
            engineerName={ctx.data.cmms_assignee_name ?? 'Engineer'}
            pmRows={pmQ.data ?? []}
            woRows={woQ.data ?? []}
            loading={pmQ.isLoading || woQ.isLoading}
          />
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
  laborRows,
  loading,
}: {
  pmRows: import('../../hooks/useCurrentSnapshots').PmRow[];
  woRows: import('../../hooks/useCurrentSnapshots').WoRow[];
  laborRows: import('../../hooks/useCurrentSnapshots').LaborRow[];
  loading: boolean;
}) {
  const focus = useActiveFocusItems();
  const todayStr = localISODate(new Date());
  const fb = focus.data ?? [];

  const weekStart = mondayOf(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekStartStr = localISODate(weekStart);
  const tomorrow = addDays(new Date(), 1);
  const tomorrowStr = localISODate(tomorrow);

  const { overdue, today, tomorrowPms, openWos, weekHours, doneThisWeek, snapshotTaken } = useMemo(() => {
    const overdue: typeof pmRows = [];
    const today: typeof pmRows = [];
    const tomorrowPms: typeof pmRows = [];
    let doneThisWeek = 0;

    for (const r of pmRows) {
      // Count completions falling in this week. Mirrors the §00 WeeklyCompletions
      // logic in Manager view.
      if (isCompletedStatus(r.status) && r.updated_at_cmms) {
        const d = new Date(r.updated_at_cmms);
        if (d >= weekStart && d <= addDays(weekEnd, 1)) doneThisWeek++;
      }

      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) overdue.push(r);
      else if (r.due_date === todayStr) today.push(r);
      else if (r.due_date === tomorrowStr) tomorrowPms.push(r);
    }
    overdue.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    today.sort((a, b) => (a.task_no ?? '').localeCompare(b.task_no ?? ''));
    tomorrowPms.sort((a, b) => (a.task_no ?? '').localeCompare(b.task_no ?? ''));

    const openWos = (woRows ?? []).filter((w) => w.is_open !== false);
    const weekHours = (laborRows ?? [])
      .filter((l) => l.week_start === weekStartStr)
      .reduce((s, l) => s + (l.labor_hours ?? 0), 0);
    const snapshotTaken = pmRows[0]?.snapshot_taken_at ?? null;
    return { overdue, today, tomorrowPms, openWos, weekHours, doneThisWeek, snapshotTaken };
  }, [pmRows, woRows, laborRows, todayStr, tomorrowStr, weekStartStr, weekStart, weekEnd]);

  if (loading) return <p className="t-text t-muted p-4">Loading your day...</p>;

  const dueNowTotal = overdue.length + today.length;
  const dueNowAccent: 'danger' | 'warn' | undefined =
    overdue.length > 0 ? 'danger' : today.length > 0 ? 'warn' : undefined;
  const dueNowSub =
    dueNowTotal === 0 ? 'all caught up' : `${overdue.length} overdue · ${today.length} today`;

  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  return (
    <div className="p-4 space-y-4">
      {/* focus board */}
      <FocusBoardBanner allowDismiss={false} />
      {fb.length === 0 && focus.isSuccess && (
        <p className="t-small t-muted italic">No announcements right now.</p>
      )}

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
          value={tomorrowPms.length}
          sub={tomorrowPms.length === 0 ? 'nothing scheduled' : 'PMs due tomorrow'}
        />
      </div>

      {/* WOs out of the strip since they get a full section below; keep the WOs
          count subtle if you want it back in the strip later. */}

      {overdue.length > 0 && (
        <Section title={`OVERDUE · ${overdue.length}`}>
          <PmList rows={overdue} highlightOverdue todayStr={todayStr} />
        </Section>
      )}

      {today.length > 0 && (
        <Section title={`DUE TODAY · ${today.length}`}>
          <PmList rows={today} todayStr={todayStr} />
        </Section>
      )}

      {tomorrowPms.length > 0 && (
        <Section title={`DUE TOMORROW · ${tomorrowPms.length}`}>
          <PmList rows={tomorrowPms} todayStr={todayStr} />
        </Section>
      )}

      {openWos.length > 0 && (
        <Section title={`OPEN WORK ORDERS · ${openWos.length}`}>
          <WoList rows={openWos} />
        </Section>
      )}

      {overdue.length === 0 && today.length === 0 && tomorrowPms.length === 0 && openWos.length === 0 && (
        <p className="t-text t-muted text-center py-8">All caught up. ✓</p>
      )}

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
// MINE TAB — full list of my open PMs + WOs, sortable
// ============================================================================
function MineTab({
  engineerName,
  pmRows,
  woRows,
  loading,
}: {
  engineerName: string;
  pmRows: import('../../hooks/useCurrentSnapshots').PmRow[];
  woRows: import('../../hooks/useCurrentSnapshots').WoRow[];
  loading: boolean;
}) {
  const todayStr = localISODate(new Date());
  const [filter, setFilter] = useState<'month' | 'all'>('month');
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null);

  const now = new Date();
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const eomStr = localISODate(eom);

  const openPms = useMemo(() => {
    return pmRows
      .filter((r) => !isClosed(r.status))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  }, [pmRows]);

  const monthPms = useMemo(
    () => openPms.filter((r) => r.due_date && r.due_date <= eomStr),
    [openPms, eomStr],
  );

  // First narrow by date, then (optionally) by equipment chip.
  const dateFiltered = filter === 'month' ? monthPms : openPms;

  // Equipment chips: counts computed against the date-filtered set so toggling
  // Month/All updates the chip counts; clicking a chip narrows displayedPms
  // without affecting the chip counts (otherwise the other chips would zero out).
  const equipmentChips = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dateFiltered) {
      const cat = r.equipment_category ?? r.equipment ?? 'Other';
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .filter(([, n]) => n > 4)
      .sort((a, b) => b[1] - a[1]);
  }, [dateFiltered]);

  const displayedPms = useMemo(() => {
    if (!equipmentFilter) return dateFiltered;
    return dateFiltered.filter(
      (r) => (r.equipment_category ?? r.equipment ?? 'Other') === equipmentFilter,
    );
  }, [dateFiltered, equipmentFilter]);

  // NPMs are scoped to ALL open PMs (no date filter), per the same rule used
  // in stat strip + §03 NPM column in Manager view.
  const myNpms = useMemo(
    () => pmRows.filter((r) => !isClosed(r.status) && isNpm(r)),
    [pmRows],
  );

  const myWos = useMemo(() => (woRows ?? []).filter((w) => w.is_open !== false), [woRows]);

  if (loading) return <p className="t-text t-muted p-4">Loading...</p>;

  return (
    <div className="p-4 space-y-4">
      {/* 1. WOs */}
      <Section title={`MY OPEN WOs · ${myWos.length}`}>
        {myWos.length === 0 ? (
          <p className="t-small t-muted italic px-3 py-2">None.</p>
        ) : (
          <WoList rows={myWos} />
        )}
      </Section>

      {/* 2. NPMs */}
      {myNpms.length > 0 && (
        <Section title={`MY OPEN NPMs · ${myNpms.length}`}>
          <PmList rows={myNpms} todayStr={todayStr} />
        </Section>
      )}

      {/* 3. Equipment chips + PMs */}
      {equipmentChips.length > 0 && (
        <section>
          <h3 className="t-small t-muted uppercase tracking-wider mb-2 px-1">
            EQUIPMENT · {filter === 'month' ? 'this month' : 'all open'} · count &gt; 4 · tap to filter
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {equipmentChips.map(([name, count]) => {
              const active = equipmentFilter === name;
              return (
                <button
                  key={name}
                  onClick={() => setEquipmentFilter(active ? null : name)}
                  className="inline-flex items-center gap-1 px-2 py-1 t-small border rounded transition-colors"
                  style={{
                    background: active ? 'var(--color-accent)' : 'var(--color-card)',
                    color: active ? '#fff' : 'var(--color-text)',
                    borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                  }}
                  title={active ? 'Tap to clear filter' : `Show only ${name}`}
                >
                  {name}
                  <span className={active ? 'opacity-90' : 't-muted'}>
                    {count}
                  </span>
                  {active && <span className="ml-1 opacity-90">✕</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
          <h3 className="t-small t-muted uppercase tracking-wider">
            MY OPEN PMs · {displayedPms.length}
            {displayedPms.length !== openPms.length && (
              <span className="t-muted ml-1">of {openPms.length}</span>
            )}
            {equipmentFilter && (
              <button
                onClick={() => setEquipmentFilter(null)}
                className="ml-2"
                style={{ color: 'var(--color-accent)' }}
                title="Clear equipment filter"
              >
                · {equipmentFilter} ✕
              </button>
            )}
          </h3>
          <div className="flex gap-1">
            <FilterBtn label="Month" active={filter === 'month'} onClick={() => setFilter('month')} />
            <FilterBtn label="All"   active={filter === 'all'}   onClick={() => setFilter('all')} />
          </div>
          <button
            onClick={() =>
              openPrintWindow(engineerName, displayedPms, filter, equipmentFilter)
            }
            disabled={displayedPms.length === 0}
            className="t-small px-2 py-0.5 rounded border disabled:opacity-40"
            style={{
              color: 'var(--color-accent)',
              borderColor: 'var(--color-border)',
              background: 'var(--color-card)',
            }}
            title="Open a printable view of the PMs currently shown"
          >
            ⎙ Print
          </button>
        </div>
        <div className="t-card p-0 overflow-hidden">
          {displayedPms.length === 0 ? (
            <p className="t-small t-muted italic px-3 py-2">None.</p>
          ) : (
            <PmList rows={displayedPms} todayStr={todayStr} highlightOverdue />
          )}
        </div>
      </section>
    </div>
  );
}

// Open a separate browser window with a print-friendly PM list (matches the
// V5 "section B" printable list — clean serif header, equipment table, signature
// block at the bottom). Window auto-triggers the print dialog.
function openPrintWindow(
  engineerName: string,
  pms: import('../../hooks/useCurrentSnapshots').PmRow[],
  filter: 'month' | 'all',
  equipmentFilter: string | null,
) {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    alert('Pop-up blocked. Allow pop-ups for this site and try again.');
    return;
  }

  const esc = (s: string | null | undefined) =>
    (s ?? '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const filterDesc =
    (filter === 'month' ? 'Due this month' : 'All open') +
    (equipmentFilter ? ` · ${equipmentFilter}` : '');

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const rows = pms
    .map((r) => `
      <tr>
        <td>${r.due_date ? new Date(r.due_date + 'T00:00:00').toLocaleDateString() : '—'}</td>
        <td><code>${esc(r.task_no)}</code></td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.building_code)}</td>
        <td>${esc(r.equipment)}</td>
        <td style="width:60px;"></td>
      </tr>`)
    .join('');

  win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${esc(engineerName)} — PM List · ${dateStr}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; padding: 24px; max-width: 8.5in; margin: 0 auto; color: #000; }
  header { border-bottom: 2px solid #000; margin-bottom: 14px; padding-bottom: 6px; }
  h1 { margin: 0 0 4px; font-size: 18pt; }
  .meta { font-size: 11pt; color: #444; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-weight: bold; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }
  .sign { margin-top: 32px; display: flex; gap: 32px; }
  .sign-line { flex: 1; border-bottom: 1px solid #000; padding-bottom: 28px; }
  .sign-label { font-size: 9pt; color: #666; margin-top: 4px; }
  .toolbar { margin-bottom: 16px; }
  .toolbar button { font-size: 11pt; padding: 6px 14px; cursor: pointer; }
  footer { margin-top: 24px; text-align: center; font-size: 9pt; color: #666; }
  @media print { body { padding: 0; } .toolbar { display: none; } }
</style>
</head><body>
<div class="toolbar">
  <button onclick="window.print()">Print</button>
  <button onclick="window.close()">Close</button>
</div>
<header>
  <h1>${esc(engineerName)} — PM List</h1>
  <div class="meta">${dateStr} · ${filterDesc} · ${pms.length} PM${pms.length === 1 ? '' : 's'}</div>
</header>
<table>
  <thead><tr>
    <th>Due Date</th>
    <th>Task #</th>
    <th>PM Name</th>
    <th>Building</th>
    <th>Equipment</th>
    <th>Notes / Initial</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="sign">
  <div class="sign-line"><div class="sign-label">Technician signature</div></div>
  <div class="sign-line"><div class="sign-label">Date</div></div>
</div>
<footer>COVE · PM Dashboard</footer>
</body></html>`);
  win.document.close();
  // Give the browser a moment to lay out before launching the print dialog.
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) { /* swallow */ } }, 150);
}

function FilterBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="t-small px-2 py-0.5 rounded border"
      style={{
        background: active ? 'var(--color-accent)' : 'var(--color-card)',
        color: active ? '#fff' : 'var(--color-text-muted)',
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
      }}
    >
      {label}
    </button>
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
