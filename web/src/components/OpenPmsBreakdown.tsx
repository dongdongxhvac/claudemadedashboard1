// §01 — Open PMs · by type & by equipment family.
// Ports cove_pm_dashboard_REAL_DATA_v5.html §01 (the 4 type cards + equipment family table).
// Chart is deferred; table only for now.
import { useMemo } from 'react';
import { useCurrentPmRows } from '../hooks/useCurrentSnapshots';
import { isClosed, TYPE_ORDER, TYPE_COLORS, type PmType } from '../lib/dashboard';
import { Section } from './Section';

export function OpenPmsBreakdown() {
  const pmQ = useCurrentPmRows();

  const { typeCounts, totalOpen, equipmentRows } = useMemo(() => {
    const pmRows = pmQ.data ?? [];
    const open = pmRows.filter((r) => !isClosed(r.status) && r.due_date);

    const typeCounts: Record<PmType, number> = {
      Major: 0, 'Filter Swap': 0, 'Test/Record': 0, Minor: 0,
    };
    const eqMap = new Map<string, Record<PmType, number> & { total: number }>();

    for (const r of open) {
      const t = (r.pm_type ?? 'Minor') as PmType;
      if (t in typeCounts) typeCounts[t]++;

      const eq = (r.equipment_category as string | null | undefined) ?? r.equipment ?? 'Other';
      let row = eqMap.get(eq);
      if (!row) {
        row = { Major: 0, 'Filter Swap': 0, 'Test/Record': 0, Minor: 0, total: 0 };
        eqMap.set(eq, row);
      }
      if (t in row) row[t]++;
      row.total++;
    }

    const equipmentRows = Array.from(eqMap.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12); // top 12 equipment families

    return { typeCounts, totalOpen: open.length, equipmentRows };
  }, [pmQ.data]);

  if (pmQ.isLoading) return <Section title="§01 Open PMs · by type & equipment" loading />;

  return (
    <Section
      title="§01 Open PMs · by type & equipment"
      subtitle={`${totalOpen} open PMs`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {TYPE_ORDER.map((t) => {
          const n = typeCounts[t];
          const pct = totalOpen ? Math.round((n / totalOpen) * 100) : 0;
          return (
            <div
              key={t}
              className="relative pl-3 pr-3 py-3 rounded border border-gray-200 bg-white"
            >
              <div
                className="absolute left-0 top-3 bottom-3 w-1 rounded-r"
                style={{ background: TYPE_COLORS[t] }}
              />
              <div className="text-xs uppercase tracking-wider text-gray-500">{t}</div>
              <div className="mt-1">
                <span className="t-stat-num">{n}</span>
                <span className="ml-2 t-small t-muted">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
        By equipment family
      </div>
      {equipmentRows.length === 0 ? (
        <p className="text-sm text-gray-500">No equipment data.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">Equipment</th>
                {TYPE_ORDER.map((t) => (
                  <th key={t} className="py-2 px-2 text-right whitespace-nowrap">{t}</th>
                ))}
                <th className="py-2 px-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {equipmentRows.map((r) => (
                <tr key={r.name} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3 truncate max-w-[260px]" title={r.name}>{r.name}</td>
                  {TYPE_ORDER.map((t) => (
                    <td key={t} className="py-1.5 px-2 text-right font-mono text-xs">
                      {r[t] || ''}
                    </td>
                  ))}
                  <td className="py-1.5 px-2 text-right font-mono text-xs font-medium">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

