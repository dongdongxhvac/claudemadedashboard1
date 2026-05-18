// §03 — Due this month · by assignee (table with PM type breakdown).
// Ported from cove_pm_dashboard_REAL_DATA_v5.html#renderAssigneeView (EOM window).
import { useMemo } from 'react';
import { useCurrentPmRows, type PmRow } from '../hooks/useCurrentSnapshots';
import { isClosed, isNpm, localISODate, TYPE_ORDER, type PmType } from '../lib/dashboard';
import { openPrintWindow } from '../lib/printPmList';
import { Section } from './Section';

type Row = {
  name: string;
  counts: Record<PmType, number>;
  total: number;
  npm: number;
  equipment: Array<{ name: string; count: number }>;
  pms: PmRow[]; // open + due-this-month PMs for this assignee (for print)
};

export function DueThisMonth() {
  const pmQ = useCurrentPmRows();

  const { rows, totals } = useMemo(() => {
    const pmRows = pmQ.data ?? [];
    const now = new Date();
    const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const eomStr = localISODate(eom);

    // Per-assignee NPM count — across ALL open PMs, no date filter (per user spec).
    const npmByAssignee = new Map<string, number>();
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!isNpm(r)) continue;
      const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
      npmByAssignee.set(a, (npmByAssignee.get(a) ?? 0) + 1);
    }

    const groups = new Map<string, Row>();
    const blank = (a: string): Row => ({
      name: a,
      counts: { Major: 0, 'Filter Swap': 0, 'Test/Record': 0, Minor: 0 },
      total: 0,
      npm: npmByAssignee.get(a) ?? 0,
      equipment: [],
      pms: [],
    });

    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date > eomStr) continue;

      const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
      let g = groups.get(a);
      if (!g) {
        g = blank(a);
        groups.set(a, g);
      }
      const t = (r.pm_type ?? 'Minor') as PmType;
      if (t in g.counts) g.counts[t]++;
      g.total++;
      g.pms.push(r);

      // Group chips by equipment_category (Pump, Fan, AHU, etc.) to match V5,
      // not the granular `equipment` field (e.g. "65LS RTU-2") which produces
      // one chip per asset.
      const eq = r.equipment_category ?? r.equipment ?? 'Other';
      const existing = g.equipment.find((e) => e.name === eq);
      if (existing) existing.count++;
      else g.equipment.push({ name: eq, count: 1 });
    }

    // Also surface assignees who have NPMs but no due-this-month PMs, so a
    // data-quality problem can't hide just because that tech has nothing
    // scheduled this month.
    for (const a of npmByAssignee.keys()) {
      if (!groups.has(a)) groups.set(a, blank(a));
    }

    for (const g of groups.values()) {
      g.equipment.sort((a, b) => b.count - a.count);
    }
    const rows = Array.from(groups.values()).sort(
      (a, b) => b.total - a.total || b.npm - a.npm,
    );

    const totals: Record<PmType, number> & { total: number; npm: number } = {
      Major: 0,
      'Filter Swap': 0,
      'Test/Record': 0,
      Minor: 0,
      total: 0,
      npm: 0,
    };
    for (const r of rows) {
      for (const t of TYPE_ORDER) totals[t] += r.counts[t];
      totals.total += r.total;
      totals.npm += r.npm;
    }

    return { rows, totals };
  }, [pmQ.data]);

  if (pmQ.isLoading) return <Section title="§03 Due this month · by assignee" loading />;

  return (
    <Section
      title="§03 Due this month · by assignee"
      subtitle={`${totals.total} PMs · ${totals.npm} NPMs · ${rows.length} ${rows.length === 1 ? 'assignee' : 'assignees'}`}
    >
      <style>{`
        .eq-chip:hover { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25); filter: brightness(1.04); }
      `}</style>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No PMs due this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">Assignee</th>
                {TYPE_ORDER.map((t) => (
                  <th key={t} className="py-2 px-2 text-right whitespace-nowrap">
                    {t}
                  </th>
                ))}
                <th className="py-2 px-2 text-right">Total</th>
                <th className="py-2 px-2 text-right" title="Total open NPMs (no date filter)">NPM</th>
                <th className="py-2 pl-3">Equipment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-medium">
                    <div className="flex items-center gap-1">
                      <span>{r.name}</span>
                      {r.pms.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openPrintWindow(r.name, r.pms, 'month', null)}
                          className="t-small px-1.5 py-0.5 rounded border"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)', background: 'var(--color-card)' }}
                          title={`Open & print all ${r.pms.length} due-this-month PMs for ${r.name}`}
                        >
                          ⎙
                        </button>
                      )}
                    </div>
                  </td>
                  {TYPE_ORDER.map((t) => (
                    <td key={t} className="py-2 px-2 text-right font-mono text-xs">
                      {r.counts[t] || ''}
                    </td>
                  ))}
                  <td className="py-2 px-2 text-right font-mono text-xs font-medium">{r.total || ''}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs font-medium">{r.npm || ''}</td>
                  <td className="py-2 pl-3">
                    <div className="flex flex-wrap gap-1">
                      {r.npm > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 t-small border rounded"
                          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                          title="Open NPMs (no building/equipment, name contains 'unscheduled', or type is On-Demand) — across all open PMs, not just this month"
                        >
                          NPM<span className="t-muted">{r.npm}</span>
                        </span>
                      )}
                      {r.equipment.map((e) => {
                        const subset = r.pms.filter(
                          (p) => (p.equipment_category ?? p.equipment ?? 'Other') === e.name,
                        );
                        return (
                          <button
                            type="button"
                            key={e.name}
                            onClick={() => openPrintWindow(r.name, subset, 'month', e.name)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 t-small border rounded eq-chip"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', cursor: 'pointer', font: 'inherit' }}
                            title={`Click to view & print ${e.count} ${e.name} PM${e.count === 1 ? '' : 's'} for ${r.name}`}
                          >
                            {e.name}
                            <span className="t-muted">{e.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 font-medium">
                <td className="py-2 pr-3">Total</td>
                {TYPE_ORDER.map((t) => (
                  <td key={t} className="py-2 px-2 text-right font-mono text-xs">
                    {totals[t]}
                  </td>
                ))}
                <td className="py-2 px-2 text-right font-mono text-xs">{totals.total}</td>
                <td className="py-2 px-2 text-right font-mono text-xs">{totals.npm}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

