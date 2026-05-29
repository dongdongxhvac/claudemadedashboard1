// /engineer/me on viewports >= 768px. Wide desk-view layout with dense
// table of PMs + WOs + NPMs side-by-side. Same data hooks as Mobile.
// Read-only per plan.
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe, useIsAdmin } from '../../hooks/useMe';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { FocusBoardBanner } from '../../components/FocusBoardBanner';
import { OncallBadge } from '../../components/OncallBadge';
import {
  useMyEngineerContext, useMyPmRows, useMyWoRows, useMyLaborRows, useMyPmCloses,
} from '../../hooks/useMyAssignedData';
import { MyPtoSection } from '../../components/MyPtoSection';
import { MyOvertimeSection } from '../../components/MyOvertimeSection';
import type { PmRow, WoRow } from '../../hooks/useCurrentSnapshots';
import {
  isClosed, isNpm, localISODate, fmtMd,
  mondayOf, addDays, TYPE_COLORS, type PmType,
} from '../../lib/dashboard';
import { openPrintWindow } from '../../lib/printPmList';

const WO_STATUS_COLOR: Record<string, string> = {
  on_hold:     'bg-red-500',
  in_progress: 'bg-sky-400',
  submitted:   'bg-amber-500',
  accepted:    'bg-teal-500',
};
function woStatusClass(s: string | null): string {
  const key = (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return WO_STATUS_COLOR[key] ?? 'bg-gray-400';
}

export default function EngineerPc() {
  const { session, signOut } = useAuth();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const canAdmin = isAdmin || me.data?.is_lead === true;
  const ctx = useMyEngineerContext();
  useSnapshotRealtime();
  useFocusBoardRealtime();

  const pmQ = useMyPmRows(ctx.data?.cmms_assignee_name);
  const woQ = useMyWoRows(ctx.data?.cmms_assignee_name);
  const laborQ = useMyLaborRows(ctx.data?.cmms_assignee_name);
  // Phase 5.5: PM completions live in pm_close_events now.
  const closesQ = useMyPmCloses(ctx.data?.cmms_assignee_name, 14);

  const [filter, setFilter] = useState<'month' | 'all'>('month');
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null);
  const [buildingFilter, setBuildingFilter] = useState<string | null>(null);

  const todayStr = localISODate(new Date());
  const tomorrow = addDays(new Date(), 1);
  const tomorrowStr = localISODate(tomorrow);
  const weekStart = mondayOf(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekStartStr = localISODate(weekStart);
  const now = new Date();
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const eomStr = localISODate(eom);

  const pmRows = pmQ.data ?? [];
  const woRows = woQ.data ?? [];
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

  // --- PMs (filterable) ---
  const openPms = useMemo(
    () => pmRows.filter((r) => !isClosed(r.status))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
    [pmRows],
  );
  const monthPms = useMemo(
    () => openPms.filter((r) => r.due_date && r.due_date <= eomStr),
    [openPms, eomStr],
  );
  const dateFiltered = filter === 'month' ? monthPms : openPms;
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
  const buildingChips = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dateFiltered) {
      const code = (r.building_code ?? '').trim() || '—';
      map.set(code, (map.get(code) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [dateFiltered]);
  const displayedPms = useMemo(() => {
    let out = dateFiltered;
    if (equipmentFilter) {
      out = out.filter(
        (r) => (r.equipment_category ?? r.equipment ?? 'Other') === equipmentFilter,
      );
    }
    if (buildingFilter) {
      out = out.filter(
        (r) => ((r.building_code ?? '').trim() || '—') === buildingFilter,
      );
    }
    return out;
  }, [dateFiltered, equipmentFilter, buildingFilter]);

  const myWos = useMemo(() => woRows.filter((w) => w.is_open !== false), [woRows]);
  const myNpms = useMemo(
    () => pmRows.filter((r) => !isClosed(r.status) && isNpm(r)),
    [pmRows],
  );

  const snapshotTaken = pmRows[0]?.snapshot_taken_at;
  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  if (me.isLoading || ctx.isLoading) {
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
        <FocusBoardBanner allowDismiss={false} />

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

        {/* toolbar + PM table */}
        <section>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="t-section-title flex-1">
              My open PMs
              <span className="t-muted t-small ml-2">
                · {displayedPms.length}
                {displayedPms.length !== openPms.length && ` of ${openPms.length}`}
              </span>
              {equipmentFilter && (
                <button onClick={() => setEquipmentFilter(null)} className="ml-2 t-small"
                  style={{ color: 'var(--color-accent)' }}>
                  · {equipmentFilter} ✕
                </button>
              )}
              {buildingFilter && (
                <button onClick={() => setBuildingFilter(null)} className="ml-2 t-small"
                  style={{ color: 'var(--color-accent)' }}>
                  · Building {buildingFilter} ✕
                </button>
              )}
            </h2>
            <div className="flex gap-1">
              <ToolbarBtn label="Month" active={filter === 'month'} onClick={() => setFilter('month')} />
              <ToolbarBtn label="All"   active={filter === 'all'}   onClick={() => setFilter('all')} />
            </div>
            <button
              onClick={() => openPrintWindow(
                ctx.data!.cmms_assignee_name ?? 'Engineer',
                displayedPms, filter,
                [equipmentFilter, buildingFilter ? `Building ${buildingFilter}` : null]
                  .filter(Boolean).join(' · ') || null,
              )}
              disabled={displayedPms.length === 0}
              className="t-small px-3 py-1 rounded border disabled:opacity-40"
              style={{
                color: 'var(--color-accent)',
                borderColor: 'var(--color-border)',
                background: 'var(--color-card)',
              }}
            >
              ⎙ Print
            </button>
          </div>

          {equipmentChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
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
                  >
                    {name}<span className={active ? 'opacity-90' : 't-muted'}>{count}</span>
                    {active && <span className="ml-1 opacity-90">✕</span>}
                  </button>
                );
              })}
            </div>
          )}

          {buildingChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="t-small t-muted uppercase tracking-wider self-center mr-1">By building</span>
              {buildingChips.map(([code, count]) => {
                const active = buildingFilter === code;
                return (
                  <button
                    key={code}
                    onClick={() => setBuildingFilter(active ? null : code)}
                    className="inline-flex items-center gap-1 px-2 py-1 t-small border rounded transition-colors"
                    style={{
                      background: active ? '#7e22ce' : 'rgba(168, 85, 247, 0.08)',
                      color: active ? '#fff' : '#6b21a8',
                      borderColor: active ? '#7e22ce' : 'rgba(168, 85, 247, 0.35)',
                    }}
                    title={`Filter to ${count} PM${count === 1 ? '' : 's'} at building ${code}`}
                  >
                    {code}
                    <span className={active ? 'opacity-90' : ''} style={!active ? { color: '#9d6cd2' } : undefined}>
                      {count}
                    </span>
                    {active && <span className="ml-1 opacity-90">✕</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="t-card p-0 overflow-x-auto">
            {pmQ.isLoading ? (
              <p className="t-text t-muted p-3">Loading...</p>
            ) : displayedPms.length === 0 ? (
              <p className="t-small t-muted italic px-3 py-2">No PMs in this window.</p>
            ) : (
              <PmTable rows={displayedPms} todayStr={todayStr} />
            )}
          </div>
        </section>

        {/* WOs + NPMs in a two-column row below */}
        <div className="grid md:grid-cols-2 gap-6">
          <section>
            <h2 className="t-section-title mb-3">
              Open WOs <span className="t-muted t-small">· {myWos.length}</span>
            </h2>
            <div className="t-card p-0 overflow-hidden">
              {myWos.length === 0 ? (
                <p className="t-small t-muted italic px-3 py-2">None.</p>
              ) : (
                <WoList rows={myWos} />
              )}
            </div>
          </section>

          <section>
            <h2 className="t-section-title mb-3">
              Open NPMs <span className="t-muted t-small">· {myNpms.length}</span>
            </h2>
            <div className="t-card p-0 overflow-hidden">
              {myNpms.length === 0 ? (
                <p className="t-small t-muted italic px-3 py-2">None.</p>
              ) : (
                <PmTable rows={myNpms} todayStr={todayStr} compact />
              )}
            </div>
          </section>
        </div>

        {/* Phase 11b — engineer self-serve OT coverage. NEW posts pinned to top. */}
        <MyOvertimeSection userId={ctx.data.user_id} />

        {/* Phase 12b — engineer self-serve PTO. Locked to the signed-in user. */}
        <MyPtoSection userId={ctx.data.user_id} />

        {snapshotLocal && (
          <p className="t-small t-muted text-center pt-2">Data as of {snapshotLocal}</p>
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

function ToolbarBtn({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="t-small px-2 py-1 rounded border"
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

function PmTable({ rows, todayStr, compact }: { rows: PmRow[]; todayStr: string; compact?: boolean }) {
  return (
    <table className="w-full t-text">
      <thead>
        <tr className="text-left t-small t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
          <th className="py-2 px-3">Due</th>
          <th className="py-2 px-2">Task #</th>
          {!compact && <th className="py-2 px-2">Building</th>}
          {!compact && <th className="py-2 px-2">Equipment</th>}
          <th className="py-2 px-2">PM Name</th>
          {!compact && <th className="py-2 px-2">Type</th>}
          {!compact && <th className="py-2 px-2 text-right">Hours</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const overdue = r.due_date && r.due_date < todayStr;
          const type = (r.pm_type ?? 'Minor') as PmType;
          return (
            <tr key={`${r.task_no}-${i}`} className="border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
              <td className={`py-1.5 px-3 t-mono t-small whitespace-nowrap ${overdue ? 't-danger' : ''}`}>
                {r.due_date ? fmtMd(r.due_date) : '—'}
              </td>
              <td className="py-1.5 px-2 t-mono t-small t-muted whitespace-nowrap">{r.task_no ?? '—'}</td>
              {!compact && <td className="py-1.5 px-2 t-small">{r.building_code ?? '—'}</td>}
              {!compact && <td className="py-1.5 px-2 t-small">{r.equipment ?? '—'}</td>}
              <td className="py-1.5 px-2">{r.name ?? '—'}</td>
              {!compact && (
                <td className="py-1.5 px-2 t-small">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                    style={{ background: TYPE_COLORS[type] }} />
                  {type}
                </td>
              )}
              {!compact && (
                <td className="py-1.5 px-2 t-mono t-small text-right">
                  {r.labor_hours ?? r.est_labor_hours ?? '—'}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WoList({ rows }: { rows: WoRow[] }) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--color-border-soft)' }}>
      {rows.map((w, i) => (
        <li key={`${w.wo_id}-${i}`} className="px-3 py-2.5">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="t-mono t-small t-muted">{w.wo_id ?? '—'}</span>
            <span className={`text-[10px] font-medium tracking-wide text-white text-center rounded px-1 py-0.5 ${woStatusClass(w.status)}`}>
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
