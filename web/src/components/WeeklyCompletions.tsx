// §00 — Weekly completions by assignee.
// Ported from cove_pm_dashboard_REAL_DATA_v5.html#renderTrend.
import { useMemo } from 'react';
import { useCurrentPmRows, useCurrentLaborRows } from '../hooks/useCurrentSnapshots';
import { mondayOf, addDays, fmtDateShort, isCompletedStatus, localISODate, isNpm, isClosed } from '../lib/dashboard';
import { Section } from './Section';

type Card = { name: string; count: number; hours: number; npm: number; npmHours: number };

export function WeeklyCompletions() {
  const pmQ = useCurrentPmRows();
  const laborQ = useCurrentLaborRows();

  const data = useMemo(() => {
    const pmRows = pmQ.data ?? [];
    const laborRows = laborQ.data ?? [];

    // The anchor week is the snapshot date (or today if no snapshot).
    const snapshotTakenAt = pmRows[0]?.snapshot_taken_at;
    const anchor = snapshotTakenAt ? new Date(snapshotTakenAt) : new Date();
    const weekStart = mondayOf(anchor);
    const weekEnd = addDays(weekStart, 6);
    const weekStartStr = localISODate(weekStart);

    // Completed rows where updated_at_cmms is within this week.
    const completedThisWeek = pmRows.filter((r) => {
      if (!isCompletedStatus(r.status)) return false;
      const ts = (r as any).updated_at_cmms as string | null;
      if (!ts) return false;
      const d = new Date(ts);
      return d >= weekStart && d <= addDays(weekEnd, 1);
    });

    // Labor for this week, keyed by Monday-of-week ISO date.
    const laborByAssignee = new Map<string, number>();
    for (const l of laborRows) {
      if (l.week_start !== weekStartStr) continue;
      laborByAssignee.set(
        (l.assigned_to_name ?? 'Unassigned').trim() || 'Unassigned',
        (laborByAssignee.get(l.assigned_to_name ?? 'Unassigned') ?? 0) + (l.labor_hours ?? 0),
      );
    }
    const hasLabor = laborByAssignee.size > 0;

    // Per-assignee NPM totals — across ALL open PMs (no week filter), per user spec:
    // NPM rule + "all open PMs" definition lives in lib/dashboard.ts.
    const openNpmByAssignee = new Map<string, { count: number; hours: number }>();
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!isNpm(r)) continue;
      const a = (r.assigned_to_name ?? 'Unassigned').trim() || 'Unassigned';
      const cur = openNpmByAssignee.get(a) ?? { count: 0, hours: 0 };
      cur.count++;
      cur.hours += r.labor_hours ?? 0;
      openNpmByAssignee.set(a, cur);
    }

    // Aggregate PM completions by assignee (count always from PM12).
    const byAssignee = new Map<string, Card>();
    const blank = (a: string): Card => {
      const n = openNpmByAssignee.get(a);
      return { name: a, count: 0, hours: 0, npm: n?.count ?? 0, npmHours: n?.hours ?? 0 };
    };
    for (const r of completedThisWeek) {
      const a = (r.assigned_to_name ?? 'Unassigned').trim() || 'Unassigned';
      const card = byAssignee.get(a) ?? blank(a);
      card.count++;
      if (!hasLabor) card.hours += r.labor_hours ?? 0;
      byAssignee.set(a, card);
    }

    // Override hours from Labor CSV (and surface labor-only assignees).
    if (hasLabor) {
      for (const [a, hrs] of laborByAssignee) {
        const card = byAssignee.get(a) ?? blank(a);
        card.hours = hrs;
        byAssignee.set(a, card);
      }
    }

    // Also include assignees with any completed PM in *any* week (zero cards).
    for (const r of pmRows) {
      if (!isCompletedStatus(r.status)) continue;
      const a = (r.assigned_to_name ?? 'Unassigned').trim() || 'Unassigned';
      if (!byAssignee.has(a)) byAssignee.set(a, blank(a));
    }

    // ...and assignees who have open NPMs but no completions at all — so a
    // data-quality problem can't hide just because someone hasn't closed anything.
    for (const a of openNpmByAssignee.keys()) {
      if (!byAssignee.has(a)) byAssignee.set(a, blank(a));
    }

    const cards = Array.from(byAssignee.values()).sort(
      (a, b) => b.hours - a.hours || b.count - a.count || a.name.localeCompare(b.name),
    );

    const totalCount = cards.reduce((s, c) => s + c.count, 0);
    const totalHours = cards.reduce((s, c) => s + c.hours, 0);
    const totalNpm = cards.reduce((s, c) => s + c.npm, 0);
    const totalNpmHours = cards.reduce((s, c) => s + c.npmHours, 0);
    const activeCount = cards.filter((c) => c.count > 0).length;

    return { cards, totalCount, totalHours, totalNpm, totalNpmHours, activeCount, weekStart, weekEnd };
  }, [pmQ.data, laborQ.data]);

  if (pmQ.isLoading) return <Section title="§00 Weekly completions" loading />;

  return (
    <Section
      title="§00 Weekly completions · Total NPM by assignee"
      subtitle={`Snapshot week · ${fmtDateShort(data.weekStart)} → ${fmtDateShort(data.weekEnd)}`}
    >
      <div
        className="flex flex-wrap gap-8 px-4 py-3 mb-4 border rounded"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <SummaryItem label="Team total" value={data.totalCount} unit="PMs completed" />
        <SummaryItem label="Labor hours" value={data.totalHours.toFixed(1)} unit="hours logged" />
        <SummaryItem
          label="Active techs"
          value={data.activeCount}
          unit={`of ${data.cards.length}`}
        />
        <SummaryItem label="Open NPMs" value={data.totalNpm} unit="needs updating" />
        <SummaryItem label="NPM hours" value={data.totalNpmHours.toFixed(1)} unit="hours unassigned" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {data.cards.map((c) => {
          const isZero = c.count === 0;
          return (
            <div
              key={c.name}
              className={`relative pl-3 pr-3 py-3 rounded border ${
                isZero ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-200 bg-white'
              }`}
            >
              <div
                className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${
                  isZero ? 'bg-gray-300' : 'bg-purple-500'
                }`}
              />
              <div className="text-sm font-medium truncate" title={c.name}>
                {c.name}
              </div>
              <div className="mt-1">
                <span className="t-comp-num">{c.count}</span>{' '}
                <span className="t-small t-muted">PMs</span>
              </div>
              <div>
                <span className="t-comp-num">{c.hours.toFixed(1)}</span>{' '}
                <span className="t-small t-muted">hours</span>
              </div>
              <div
                className="mt-1 pt-1"
                style={{ borderTop: '1px solid var(--color-border-soft)' }}
                title="Total open NPMs assigned to this tech (all open PMs, not just this week)"
              >
                <span className="t-small t-muted">Open NPMs</span>{' '}
                <span className="t-mono t-small">{c.npm}</span>
                <span className="t-small t-muted"> · </span>
                <span className="t-mono t-small">{c.npmHours.toFixed(1)}</span>
                <span className="t-small t-muted">h</span>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SummaryItem({ label, value, unit }: { label: string; value: number | string; unit: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="text-xl font-medium text-gray-900">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{unit}</span>
    </div>
  );
}

