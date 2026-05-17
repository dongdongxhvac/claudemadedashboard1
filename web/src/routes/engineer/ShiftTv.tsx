// /engineer/shift — always-on shift handoff screen.
// Card grid of every engineer, each card showing their overdue + today PMs.
// V5 style (no RPG flourishes). data-mode="tv" bumps fonts up for across-the-room
// viewing — same trick used in Manager TV.
import { useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentPmRows } from '../../hooks/useCurrentSnapshots';
import { useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { useMe } from '../../hooks/useMe';
import { FocusBoardBanner } from '../../components/FocusBoardBanner';
import { OncallBadge } from '../../components/OncallBadge';
import { isClosed, localISODate, fmtMd } from '../../lib/dashboard';

const MAX_ITEMS_PER_CARD = 6;

export default function EngineerShiftTv() {
  const me = useMe();
  useSnapshotRealtime();
  useFocusBoardRealtime();
  const pmQ = useCurrentPmRows();

  // Enable the TV size token overrides while this route is mounted.
  useEffect(() => {
    document.documentElement.setAttribute('data-mode', 'tv');
    return () => document.documentElement.removeAttribute('data-mode');
  }, []);

  // After Phase 3.5 RLS, engineers can only see their own rows in pm_rows —
  // grouping by assignee would render exactly one card (themselves), useless
  // for shift handoff. Send them back to their personal /engineer/me view.
  // Same idea for clients (Phase 6 will refine).
  if (me.data && me.data.role !== 'admin' && me.data.role !== 'manager') {
    return <Navigate to="/engineer/me" replace />;
  }

  const todayStr = localISODate(new Date());
  const pmRows = pmQ.data ?? [];
  const snapshotTaken = pmRows[0]?.snapshot_taken_at;

  const groups = useMemo(() => {
    type Item = { taskNo: string; due: string; isOverdue: boolean; name: string };
    type Card = { name: string; overdue: number; today: number; items: Item[] };

    const map = new Map<string, Card>();
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date > todayStr) continue; // only overdue + today

      const a = (r.assigned_to_name ?? '').trim() || '(unassigned)';
      let c = map.get(a);
      if (!c) {
        c = { name: a, overdue: 0, today: 0, items: [] };
        map.set(a, c);
      }
      const isOverdue = r.due_date < todayStr;
      if (isOverdue) c.overdue++;
      else c.today++;
      c.items.push({
        taskNo: r.task_no ?? '—',
        due: r.due_date,
        isOverdue,
        name: r.name ?? '',
      });
    }

    const list = Array.from(map.values());
    for (const c of list) {
      // overdue first, then by due_date
      c.items.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
    }
    list.sort(
      (a, b) =>
        (b.overdue + b.today) - (a.overdue + a.today) ||
        b.overdue - a.overdue ||
        a.name.localeCompare(b.name),
    );

    return list;
  }, [pmRows, todayStr]);

  const totalDue = groups.reduce((s, c) => s + c.overdue + c.today, 0);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  return (
    <div className="min-h-screen t-bg flex flex-col">
      <header
        className="px-6 py-3 border-b flex items-baseline justify-between flex-wrap gap-2"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <div>
          <h1 className="t-section-title">COVE · Shift handoff</h1>
          <p className="t-small t-muted">
            {today} · {totalDue} total {totalDue === 1 ? 'PM' : 'PMs'} due
            {snapshotLocal && ` · snapshot ${snapshotLocal}`}
          </p>
        </div>
        <OncallBadge size="tv" />
      </header>

      <div className="px-4 pt-4">
        <FocusBoardBanner allowDismiss={false} />
      </div>

      <main className="flex-1 p-4">
        {pmQ.isLoading ? (
          <p className="t-text t-muted">Loading shift data...</p>
        ) : groups.length === 0 ? (
          <p className="t-text t-muted text-center py-16">
            ✓ No overdue PMs and nothing due today. Team is caught up.
          </p>
        ) : (
          <div className="grid gap-4"
               style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {groups.map((c) => {
              const total = c.overdue + c.today;
              const accentColor =
                c.overdue > 0 ? 'var(--color-danger)' :
                c.today >= 5   ? 'var(--color-warn)'   :
                'var(--color-accent)';
              return (
                <div
                  key={c.name}
                  className="t-card"
                  style={{ borderLeftWidth: 6, borderLeftColor: accentColor }}
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="t-section-title">{c.name}</h3>
                    <div className="t-stat-num" style={{ color: accentColor }}>
                      {total}
                    </div>
                  </div>
                  <p className="t-small t-muted mb-2">
                    {c.overdue > 0 && <span style={{ color: 'var(--color-danger)' }}>{c.overdue} overdue</span>}
                    {c.overdue > 0 && c.today > 0 && ' · '}
                    {c.today > 0 && <span>{c.today} today</span>}
                  </p>
                  <ul className="space-y-0.5">
                    {c.items.slice(0, MAX_ITEMS_PER_CARD).map((it, i) => (
                      <li key={`${it.taskNo}-${i}`}
                          className="grid grid-cols-[48px_1fr] gap-2 items-baseline">
                        <span className={`t-mono t-small ${it.isOverdue ? 't-danger font-medium' : 't-muted'}`}>
                          {fmtMd(it.due)}
                        </span>
                        <span className="t-text truncate" title={it.name}>{it.name}</span>
                      </li>
                    ))}
                    {c.items.length > MAX_ITEMS_PER_CARD && (
                      <li className="t-small t-muted italic">
                        +{c.items.length - MAX_ITEMS_PER_CARD} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
