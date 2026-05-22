// §06 — Plantlog rounds activity (Phase 6.7).
//
// Two views in one section:
//   1. Per-building daily matrix (last N days)
//   2. Per-engineer daily building visits (collapsible)
//
// Data path: building_inferred is populated by plantlog_building_attribution.py
// (nearest-neighbor heuristic over the (log_name, group_name) -> building
// lookup from plantlog's /groups + /logs catalog). Some rows are "direct"
// (unambiguous) and some are "inferred" (nearest unambiguous in time). Both
// surface here as concrete building counts.
import { useMemo, useState } from 'react';
import { usePlantlogBuildingDaily, usePlantlogUserBuildingDaily } from '../hooks/usePlantlog';
import { Section } from './Section';

type Period = '4d' | '7d' | '14d';
const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: '4d',  label: '4d',  days: 4  },
  { key: '7d',  label: '7d',  days: 7  },
  { key: '14d', label: '14d', days: 14 },
];

// Local-midnight Date for a YYYY-MM-DD day string (avoid UTC shift).
function dayDate(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

function fmtShortDay(ymd: string): string {
  const d = dayDate(ymd);
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
}

function fmtDow(ymd: string): string {
  return dayDate(ymd).toLocaleDateString(undefined, { weekday: 'short' });
}

export function PlantlogRoundsPanel() {
  const [period, setPeriod] = useState<Period>('4d');
  const days = PERIODS.find((p) => p.key === period)!.days;
  const bdQ = usePlantlogBuildingDaily(days);
  const ubdQ = usePlantlogUserBuildingDaily(days);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const matrix = useMemo(() => {
    const rows = bdQ.data ?? [];
    const daysSet = new Set<string>();
    const bldgSet = new Set<string>();
    const byKey = new Map<string, number>();
    for (const r of rows) {
      daysSet.add(r.et_day);
      bldgSet.add(r.building);
      byKey.set(`${r.building}|${r.et_day}`, r.entries);
    }
    // Limit to the requested window (the view doesn't strictly enforce it).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const sortedDays = [...daysSet].filter((d) => d >= cutoffStr).sort();
    const buildingTotals: { building: string; total: number; perDay: number[] }[] = [];
    for (const b of bldgSet) {
      const perDay = sortedDays.map((d) => byKey.get(`${b}|${d}`) ?? 0);
      const total = perDay.reduce((a, c) => a + c, 0);
      if (total > 0) buildingTotals.push({ building: b, total, perDay });
    }
    buildingTotals.sort((a, b) => b.total - a.total);
    const dayTotals = sortedDays.map((_d, i) =>
      buildingTotals.reduce((a, r) => a + r.perDay[i], 0)
    );
    return { sortedDays, buildingTotals, dayTotals, grandTotal: dayTotals.reduce((a, c) => a + c, 0) };
  }, [bdQ.data, days]);

  const perUser = useMemo(() => {
    const rows = ubdQ.data ?? [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    // user -> day -> [{building, entries}]
    const byUserDay = new Map<string, Map<string, { building: string; entries: number }[]>>();
    for (const r of rows) {
      if (r.et_day < cutoffStr) continue;
      let dm = byUserDay.get(r.user_name);
      if (!dm) {
        dm = new Map();
        byUserDay.set(r.user_name, dm);
      }
      const list = dm.get(r.et_day) ?? [];
      list.push({ building: r.building, entries: r.entries });
      dm.set(r.et_day, list);
    }
    // Build per-user summary: total entries, days active
    const users: { user: string; total: number; daysActive: number; perDay: { day: string; entries: number; buildings: { building: string; entries: number }[] }[] }[] = [];
    for (const [user, dm] of byUserDay) {
      const perDay: { day: string; entries: number; buildings: { building: string; entries: number }[] }[] = [];
      for (const [day, blist] of dm) {
        blist.sort((a, b) => b.entries - a.entries);
        const e = blist.reduce((a, c) => a + c.entries, 0);
        perDay.push({ day, entries: e, buildings: blist });
      }
      perDay.sort((a, b) => (a.day < b.day ? 1 : -1));
      const total = perDay.reduce((a, c) => a + c.entries, 0);
      users.push({ user, total, daysActive: perDay.length, perDay });
    }
    users.sort((a, b) => b.total - a.total);
    return users;
  }, [ubdQ.data, days]);

  const loading = bdQ.isLoading || ubdQ.isLoading;
  const err = bdQ.error || ubdQ.error;

  const subtitle = (
    <div className="flex items-center gap-2">
      <span className="t-small t-muted">
        {matrix.grandTotal.toLocaleString()} entries · {matrix.buildingTotals.length} bldgs · {perUser.length} engineers
      </span>
      <div className="flex border rounded" style={{ borderColor: 'var(--color-border)' }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-2 py-0.5 t-small ${period === p.key ? 't-accent font-semibold' : 't-muted'}`}
            style={{
              background:
                period === p.key ? 'var(--color-card-elev)' : 'transparent',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Section title="§06 Plantlog rounds" subtitle={subtitle} loading={loading}>
      {err ? (
        <p className="t-text t-danger">Error loading plantlog data: {(err as Error).message}</p>
      ) : matrix.grandTotal === 0 ? (
        <p className="t-text t-muted">
          No attributed plantlog entries in this window. Run{' '}
          <code>python plantlog_building_attribution.py 30 --persist</code> to backfill.
        </p>
      ) : (
        <>
          {/* Building x Day matrix */}
          <div className="overflow-x-auto mb-6">
            <table className="t-mono t-small" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th className="text-left pb-2 pr-3" style={{ position: 'sticky', left: 0, background: 'var(--color-card)' }}>Building</th>
                  {matrix.sortedDays.map((d) => (
                    <th key={d} className="text-right pb-2 px-2">
                      <div>{fmtShortDay(d)}</div>
                      <div className="t-muted" style={{ fontSize: '0.7rem' }}>{fmtDow(d)}</div>
                    </th>
                  ))}
                  <th className="text-right pb-2 pl-3 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.buildingTotals.map((row) => (
                  <tr key={row.building} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                    <td className="py-1 pr-3" style={{ position: 'sticky', left: 0, background: 'var(--color-card)' }}>
                      {row.building}
                    </td>
                    {row.perDay.map((n, i) => (
                      <td key={i} className="text-right px-2 py-1" style={{ color: n === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                        {n === 0 ? '·' : n}
                      </td>
                    ))}
                    <td className="text-right pl-3 py-1 font-semibold">{row.total}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                  <td className="py-1 pr-3 font-semibold" style={{ position: 'sticky', left: 0, background: 'var(--color-card)' }}>
                    Total
                  </td>
                  {matrix.dayTotals.map((n, i) => (
                    <td key={i} className="text-right px-2 py-1 font-semibold">{n}</td>
                  ))}
                  <td className="text-right pl-3 py-1 font-semibold">{matrix.grandTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Per-engineer daily breakdown */}
          <div className="space-y-2">
            <div className="t-small t-muted uppercase tracking-wider mb-1">
              Per-engineer daily breakdown · click to expand
            </div>
            {perUser.map((u) => {
              const open = expandedUser === u.user;
              return (
                <div key={u.user} className="border rounded" style={{ borderColor: 'var(--color-border-soft)' }}>
                  <button
                    onClick={() => setExpandedUser(open ? null : u.user)}
                    className="w-full text-left flex justify-between items-baseline px-3 py-2"
                  >
                    <span className="t-text">
                      <span className="font-semibold">{u.user}</span>
                      <span className="t-small t-muted ml-2">{u.daysActive}d active</span>
                    </span>
                    <span className="t-mono">{u.total.toLocaleString()}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-2 border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
                      {u.perDay.map((d) => (
                        <div key={d.day} className="py-1 t-small" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                          <span className="t-mono t-muted">{fmtShortDay(d.day)}</span>{' '}
                          <span className="t-mono">[{String(d.entries).padStart(3, ' ')}]</span>
                          {' '}
                          {d.buildings.map((b, i) => (
                            <span key={b.building}>
                              {i > 0 && <span className="t-muted">, </span>}
                              {b.building}
                              <span className="t-muted">({b.entries})</span>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}
