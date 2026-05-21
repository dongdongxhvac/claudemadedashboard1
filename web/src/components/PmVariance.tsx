// §01a — PM estimate accuracy over the last 30 days.
// Surfaces actual labor vs estimated labor per closed PM. Reads from the
// pm_variance_recent view which already filters out closes missing either
// number, so every row here is a usable comparison.
//
// Three views in one card:
//   - Summary row:   total closes compared + average variance %
//   - By-type table: avg variance % grouped by pm_type
//   - Outliers list: top over-estimate and under-estimate closes
import { useMemo, useState } from 'react';
import { usePmVariance } from '../hooks/useCurrentSnapshots';
import { Section } from './Section';

type Bucket = { type: string; n: number; avgPct: number };

function bucketByType(rows: ReturnType<typeof usePmVariance>['data'] | undefined): Bucket[] {
  if (!rows || rows.length === 0) return [];
  const map = new Map<string, { sumPct: number; n: number }>();
  for (const r of rows) {
    if (r.variance_pct == null) continue;
    const t = r.pm_type ?? 'Unclassified';
    const cur = map.get(t) ?? { sumPct: 0, n: 0 };
    cur.sumPct += r.variance_pct;
    cur.n++;
    map.set(t, cur);
  }
  return Array.from(map.entries())
    .map(([type, v]) => ({ type, n: v.n, avgPct: v.sumPct / v.n }))
    .sort((a, b) => b.n - a.n);
}

export function PmVariance() {
  const q = usePmVariance(30);
  const [tab, setTab] = useState<'over' | 'under'>('over');

  const data = useMemo(() => {
    const rows = q.data ?? [];
    const total = rows.length;
    const avgPct = total === 0
      ? null
      : rows.reduce((s, r) => s + (r.variance_pct ?? 0), 0) / total;
    const buckets = bucketByType(q.data);

    // Outliers: top 5 over (took longest vs estimate) + top 5 under (fastest)
    const sorted = [...rows].filter((r) => r.variance_pct != null);
    const over = [...sorted].sort((a, b) => (b.variance_pct ?? 0) - (a.variance_pct ?? 0)).slice(0, 5);
    const under = [...sorted].sort((a, b) => (a.variance_pct ?? 0) - (b.variance_pct ?? 0)).slice(0, 5);

    return { total, avgPct, buckets, over, under };
  }, [q.data]);

  if (q.isLoading) return <Section title="§01a PM estimate accuracy · 30d" loading />;
  if (data.total === 0) {
    return (
      <Section
        title="§01a PM estimate accuracy · 30d"
        subtitle="No closed PMs with both estimated and actual labor yet."
      >
        <p className="t-text t-muted">As pm12 polls capture closures, this will populate.</p>
      </Section>
    );
  }

  return (
    <Section
      title="§01a PM estimate accuracy · 30d"
      subtitle={
        <span>
          {data.total} closes with both numbers · avg{' '}
          <Pct v={data.avgPct ?? 0} />
        </span>
      }
    >
      {/* By-type strip */}
      <div className="flex flex-wrap gap-2 mb-4">
        {data.buckets.map((b) => (
          <div
            key={b.type}
            className="rounded border px-3 py-2"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
          >
            <div className="t-small t-muted uppercase tracking-wider">{b.type}</div>
            <div className="flex items-baseline gap-2">
              <Pct v={b.avgPct} bold />
              <span className="t-small t-muted">avg · {b.n} PMs</span>
            </div>
          </div>
        ))}
      </div>

      {/* Outliers toggle */}
      <div className="flex items-center gap-2 mb-2">
        <span className="t-small t-muted uppercase tracking-wider">Outliers</span>
        <button
          onClick={() => setTab('over')}
          className="t-small px-2.5 py-0.5 rounded-full border"
          style={
            tab === 'over'
              ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'white', fontWeight: 600 }
              : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
          }
        >
          Took longest
        </button>
        <button
          onClick={() => setTab('under')}
          className="t-small px-2.5 py-0.5 rounded-full border"
          style={
            tab === 'under'
              ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'white', fontWeight: 600 }
              : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
          }
        >
          Closed fastest
        </button>
      </div>

      <table className="w-full t-small">
        <thead>
          <tr className="t-muted text-left">
            <th className="py-1">Task</th>
            <th className="py-1">Tech</th>
            <th className="py-1 text-right">Est.</th>
            <th className="py-1 text-right">Actual</th>
            <th className="py-1 text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          {(tab === 'over' ? data.over : data.under).map((r) => (
            <tr key={`${r.task_no}-${r.completed_on}`} className="border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
              <td className="py-1 pr-2" title={r.task_name ?? ''}>
                <span className="t-mono">{r.task_no ?? '—'}</span>{' '}
                <span className="t-muted">{truncate(r.task_name, 60)}</span>
              </td>
              <td className="py-1 pr-2">{r.assigned_to_name ?? '—'}</td>
              <td className="py-1 pr-2 text-right t-mono">{r.est_labor_hours.toFixed(2)}h</td>
              <td className="py-1 pr-2 text-right t-mono">{r.labor_hours.toFixed(2)}h</td>
              <td className="py-1 text-right">
                <Pct v={r.variance_pct ?? 0} bold />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Pct({ v, bold }: { v: number; bold?: boolean }) {
  // Color: over-estimate (positive) = red; under = green; near-zero = muted.
  const color = v > 5 ? '#dc2626' : v < -5 ? '#16a34a' : 'var(--color-text-muted)';
  return (
    <span style={{ color, fontWeight: bold ? 600 : 500 }}>
      {v > 0 ? '+' : ''}{v.toFixed(0)}%
    </span>
  );
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
