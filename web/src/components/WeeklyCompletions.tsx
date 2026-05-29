// §00 — Crew performance by assignee.
// Originally hard-anchored to Mon-Sun "this week"; rebuilt to support a
// configurable window so the section stays meaningful on Mondays (when the
// week-since-Monday count is naturally zero).
//
// Default window: trailing 7 days. Toggle bar offers Today / 7d / This wk /
// Last wk / 30d. Per-card trend arrow compares against the immediately
// preceding window. Sort selector lets the user reorder by metric.
import { useMemo, useState } from 'react';
import { useCurrentPmRows, useLaborDaily, useRecentPmCloses } from '../hooks/useCurrentSnapshots';
import {
  isNpm, isClosed,
  PERIODS, windowFor, prevWindow,
  type Period,
} from '../lib/dashboard';
import { Section } from './Section';
import { ClosedItems } from './ClosedItems';

type Sort = 'hours' | 'pms' | 'open_npms' | 'name';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'hours',     label: 'Hours' },
  { key: 'pms',       label: 'PMs' },
  { key: 'open_npms', label: 'Open NPMs' },
  { key: 'name',      label: 'Name' },
];

type Card = {
  name: string;
  count: number;
  hours: number;
  npm: number;       // open NPM count (current state — not window-bound)
  npmHours: number;
  prevCount: number; // for trend arrow
  prevHours: number;
};

/** Local-midnight Date for a YYYY-MM-DD day string (avoids UTC shift). */
function dayDate(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

export function WeeklyCompletions({
  period,
  onPeriodChange,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
}) {
  const pmQ = useCurrentPmRows();
  // Phase 5.5: completed-PM counts come from the close-event log, not pm_rows
  // (pm_rows no longer holds Completed rows). 40d covers the 30d window plus
  // the prior-period trend arrow comparison.
  const closesQ = useRecentPmCloses(40);
  // Labor hours: per-tech-per-day from labor_daily view (end-of-day deltas).
  // Replaces the prior "sum overlapping weeks" approximation which double-counted.
  const laborDailyQ = useLaborDaily(40);

  const [sort, setSort] = useState<Sort>('hours');

  const data = useMemo(() => {
    const pmRows = pmQ.data ?? [];
    const closes = closesQ.data ?? [];
    const laborDaily = laborDailyQ.data ?? [];

    // Anchor on the latest pm snapshot timestamp, falling back to "now".
    const snapshotTakenAt = pmRows[0]?.snapshot_taken_at;
    const anchor = snapshotTakenAt ? new Date(snapshotTakenAt) : new Date();
    const win  = windowFor(period, anchor);
    const prev = prevWindow(win);

    // Open NPMs are a CURRENT-STATE metric — same across all windows.
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

    const cardByName = new Map<string, Card>();
    const blank = (a: string): Card => {
      const n = openNpmByAssignee.get(a);
      return {
        name: a,
        count: 0, hours: 0,
        npm: n?.count ?? 0, npmHours: n?.hours ?? 0,
        prevCount: 0, prevHours: 0,
      };
    };
    const bump = (a: string, bucket: 'cur' | 'prev', count = 0, hours = 0) => {
      const card = cardByName.get(a) ?? blank(a);
      if (bucket === 'cur')  { card.count    += count; card.hours    += hours; }
      else                   { card.prevCount += count; card.prevHours += hours; }
      cardByName.set(a, card);
    };

    // PM completions: one row per close event from pm_close_events.
    // assigned_to_name is captured at time of close (the tech who completed it).
    for (const c of closes) {
      const d = new Date(c.completed_on);
      const a = (c.assigned_to_name ?? 'Unassigned').trim() || 'Unassigned';
      if (d >= win.start  && d < win.end)  bump(a, 'cur',  1, 0);
      if (d >= prev.start && d < prev.end) bump(a, 'prev', 1, 0);
    }

    // Labor hours: per-tech-per-day actual hours from labor_daily.
    // Each row is already a day's hours (not a cumulative running total) so
    // summing across the window is correct — no week-overlap fudge needed.
    for (const l of laborDaily) {
      const d = dayDate(l.day_et);
      const a = (l.assigned_to_name ?? 'Unassigned').trim() || 'Unassigned';
      const hrs = l.hours_that_day ?? 0;
      if (d >= win.start  && d < win.end)  bump(a, 'cur',  0, hrs);
      if (d >= prev.start && d < prev.end) bump(a, 'prev', 0, hrs);
    }

    // Ensure assignees with open NPMs but no completions/labor still appear.
    for (const a of openNpmByAssignee.keys()) {
      if (!cardByName.has(a)) cardByName.set(a, blank(a));
    }

    const cards = Array.from(cardByName.values());
    sortCards(cards, sort);

    const totalCount     = cards.reduce((s, c) => s + c.count, 0);
    const totalHours     = cards.reduce((s, c) => s + c.hours, 0);
    const totalPrevCount = cards.reduce((s, c) => s + c.prevCount, 0);
    const totalPrevHours = cards.reduce((s, c) => s + c.prevHours, 0);
    const totalNpm       = cards.reduce((s, c) => s + c.npm, 0);
    const totalNpmHours  = cards.reduce((s, c) => s + c.npmHours, 0);
    const activeCount    = cards.filter((c) => c.count > 0).length;

    return {
      cards, win, prev,
      totalCount, totalHours, totalPrevCount, totalPrevHours,
      totalNpm, totalNpmHours, activeCount,
      snapshotTakenAt,
    };
  }, [pmQ.data, closesQ.data, laborDailyQ.data, period, sort]);

  if (pmQ.isLoading) return <Section title="§00 Crew performance" loading />;

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '';

  return (
    <Section
      collapsible
      title={`§00 Crew performance · ${periodLabel}`}
      subtitle={
        <>
          Window · {data.win.label}
          {data.snapshotTakenAt && (
            <span title={`Latest pm12 snapshot ${new Date(data.snapshotTakenAt).toLocaleString()}`}>
              {' · '}
              <span className="t-mono">snapshot {new Date(data.snapshotTakenAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </span>
          )}
        </>
      }
    >
      {/* Controls strip */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-1" role="tablist" aria-label="Period">
          {PERIODS.map((p) => {
            const active = p.key === period;
            return (
              <button
                key={p.key}
                onClick={() => onPeriodChange(p.key)}
                role="tab"
                aria-selected={active}
                className="t-small px-2.5 py-0.5 rounded-full border"
                style={
                  active
                    ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'white', fontWeight: 600 }
                    : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="t-small t-muted uppercase tracking-wider">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="t-small border rounded px-2 py-0.5"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Summary strip */}
      <div
        className="flex flex-wrap gap-8 px-4 py-3 mb-4 border rounded"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <SummaryItem
          label="Team total"
          value={data.totalCount}
          unit="PMs completed"
          delta={data.totalCount - data.totalPrevCount}
        />
        <SummaryItem
          label="Labor hours"
          value={data.totalHours.toFixed(1)}
          unit="hours logged"
          delta={data.totalHours - data.totalPrevHours}
          fmtDelta={(d) => d.toFixed(1)}
        />
        <SummaryItem
          label="Active techs"
          value={data.activeCount}
          unit={`of ${data.cards.length}`}
        />
        <SummaryItem label="Open NPMs" value={data.totalNpm} unit="needs updating" />
        <SummaryItem label="NPM hours" value={data.totalNpmHours.toFixed(1)} unit="hours unassigned" />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {data.cards.map((c) => {
          const isZero = c.count === 0 && c.hours === 0;
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
              <div className="mt-1 flex items-baseline gap-1">
                <span className="t-comp-num">{c.count}</span>
                <span className="t-small t-muted">PMs</span>
                <TrendArrow delta={c.count - c.prevCount} />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="t-comp-num">{c.hours.toFixed(1)}</span>
                <span className="t-small t-muted">hours</span>
                <TrendArrow delta={c.hours - c.prevHours} fmt={(d) => d.toFixed(1)} />
              </div>
              <div
                className="mt-1 pt-1"
                style={{ borderTop: '1px solid var(--color-border-soft)' }}
                title="Total open NPMs assigned to this tech (all open PMs, not just this window)"
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

      {/* Closed items drill-down — was the standalone §00a tile, now part of §00 */}
      <div
        className="mt-5 pt-4"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <ClosedItems period={period} />
      </div>
    </Section>
  );
}

function sortCards(cards: Card[], sort: Sort): void {
  switch (sort) {
    case 'hours':
      cards.sort((a, b) => b.hours - a.hours || b.count - a.count || a.name.localeCompare(b.name));
      break;
    case 'pms':
      cards.sort((a, b) => b.count - a.count || b.hours - a.hours || a.name.localeCompare(b.name));
      break;
    case 'open_npms':
      cards.sort((a, b) => b.npm - a.npm || b.npmHours - a.npmHours || a.name.localeCompare(b.name));
      break;
    case 'name':
      cards.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
}

function SummaryItem({
  label, value, unit, delta, fmtDelta,
}: {
  label: string;
  value: number | string;
  unit: string;
  delta?: number;
  fmtDelta?: (d: number) => string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="text-xl font-medium text-gray-900">{value}</span>
      {delta !== undefined && <TrendArrow delta={delta} fmt={fmtDelta} />}
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{unit}</span>
    </div>
  );
}

function TrendArrow({ delta, fmt }: { delta: number; fmt?: (d: number) => string }) {
  // Hide trend if both periods are zero (no signal).
  if (delta === 0) return null;
  const positive = delta > 0;
  const text = fmt ? fmt(Math.abs(delta)) : String(Math.abs(Math.round(delta)));
  return (
    <span
      className="t-small"
      style={{
        color: positive ? '#16a34a' : '#dc2626',
        fontSize: 10,
        fontWeight: 600,
      }}
      title={`vs prior period: ${positive ? '+' : '−'}${text}`}
    >
      {positive ? '▲' : '▼'}{text}
    </span>
  );
}
