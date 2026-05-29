// §02 — Due today / overdue · or WOs · by assignee.
// Ported from cove_pm_dashboard_REAL_DATA_v5.html#renderDueToday.
import { useMemo, useState } from 'react';
import { useCurrentPmRows, useCurrentWoRows } from '../hooks/useCurrentSnapshots';
import { isClosed, localISODate, fmtMd } from '../lib/dashboard';
import { Section } from './Section';

type Sort = 'pms' | 'wos' | 'total';

const WO_STATUS_COLOR: Record<string, string> = {
  on_hold:     'bg-red-500',
  in_progress: 'bg-sky-400',
  submitted:   'bg-amber-500',
  accepted:    'bg-teal-500',
};

// Compact 4-char labels so the pill leaves room for the WO description.
const WO_STATUS_LABEL: Record<string, string> = {
  on_hold:     'HOLD',
  in_progress: 'PROG',
  submitted:   'SUBM',
  accepted:    'ACPT',
};

function statusKey(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}
function woStatusClass(s: string | null): string {
  return WO_STATUS_COLOR[statusKey(s)] ?? 'bg-gray-400';
}
function woStatusLabel(s: string | null): string {
  return WO_STATUS_LABEL[statusKey(s)] ?? (s ?? '—').slice(0, 4).toUpperCase();
}

function SortBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

export function DueNowList() {
  const pmQ = useCurrentPmRows();
  const woQ = useCurrentWoRows();

  const [sort, setSort] = useState<Sort>('pms');
  // Assignee names whose WOs are currently HIDDEN. Default = WOs visible.
  const [hiddenWos, setHiddenWos] = useState<Set<string>>(new Set());
  const toggleWos = (name: string) =>
    setHiddenWos((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const groups = useMemo(() => {
    const pmRows = pmQ.data ?? [];
    const woRows = woQ.data ?? [];
    const todayStr = localISODate(new Date());

    type Group = {
      name: string;
      pms: { taskNo: string; due: string; isOverdue: boolean; name: string }[];
      wos: { id: string; status: string; desc: string }[];
    };

    const map = new Map<string, Group>();
    const bucket = (a: string): Group => {
      let g = map.get(a);
      if (!g) {
        g = { name: a, pms: [], wos: [] };
        map.set(a, g);
      }
      return g;
    };

    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date > todayStr) continue;
      const a = (r.assigned_to_name ?? '').trim() || '(unassigned)';
      bucket(a).pms.push({
        taskNo: r.task_no ?? '—',
        due: r.due_date,
        isOverdue: r.due_date < todayStr,
        name: r.name ?? '',
      });
    }

    for (const r of woRows) {
      if (r.is_open === false) continue;
      const a = (r.assigned_to_name ?? '').trim() || '(unassigned)';
      bucket(a).wos.push({
        id: r.wo_id ?? '—',
        status: r.status ?? '—',
        desc: r.description ?? '',
      });
    }

    const list = Array.from(map.values());
    for (const g of list) {
      g.pms.sort((a, b) => a.due.localeCompare(b.due));
      g.wos.sort((a, b) => a.id.localeCompare(b.id));
    }
    const sortKey = (g: { pms: unknown[]; wos: unknown[] }) =>
      sort === 'pms' ? g.pms.length : sort === 'wos' ? g.wos.length : g.pms.length + g.wos.length;
    list.sort(
      (a, b) => sortKey(b) - sortKey(a) || a.name.localeCompare(b.name),
    );

    const totalPms = list.reduce((s, g) => s + g.pms.length, 0);
    const totalWos = list.reduce((s, g) => s + g.wos.length, 0);

    return { list, totalPms, totalWos };
  }, [pmQ.data, woQ.data, sort]);

  if (pmQ.isLoading || woQ.isLoading)
    return <Section title="§02 Due today / overdue · or WOs · by assignee" loading />;

  const subtitle =
    groups.list.length === 0
      ? '0 items'
      : `${groups.totalPms} PMs · ${groups.totalWos} WOs · ${groups.list.length} ${
          groups.list.length === 1 ? 'assignee' : 'assignees'
        }`;

  return (
    <Section collapsible title="§02 Due today / overdue · or WOs · by assignee" subtitle={subtitle}>
      <div className="flex items-center gap-2 mb-3">
        <span className="t-small t-muted uppercase tracking-wider">Sort</span>
        <SortBtn label="PMs"   active={sort === 'pms'}   onClick={() => setSort('pms')} />
        <SortBtn label="WOs"   active={sort === 'wos'}   onClick={() => setSort('wos')} />
        <SortBtn label="Total" active={sort === 'total'} onClick={() => setSort('total')} />
      </div>

      {groups.list.length === 0 ? (
        <p className="t-text t-muted">No PMs due today or overdue and no open WOs.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.list.map((g) => {
            const counts: string[] = [];
            if (g.pms.length) counts.push(`${g.pms.length} ${g.pms.length === 1 ? 'PM' : 'PMs'}`);
            if (g.wos.length) counts.push(`${g.wos.length} ${g.wos.length === 1 ? 'WO' : 'WOs'}`);
            const wosHidden = hiddenWos.has(g.name);
            return (
              <div
                key={g.name}
                className="border rounded p-3"
                style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-baseline justify-between mb-2 pb-2 t-row-divider">
                  <span className="font-medium">{g.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="t-small t-muted">{counts.join(' · ')}</span>
                    {g.wos.length > 0 && (
                      <button
                        onClick={() => toggleWos(g.name)}
                        className="t-small px-2 py-0.5 rounded border"
                        style={{
                          background: wosHidden ? 'transparent' : 'var(--color-accent-soft)',
                          borderColor: 'var(--color-border)',
                          color: wosHidden ? 'var(--color-text-muted)' : 'var(--color-accent)',
                        }}
                        title={wosHidden ? 'Show WOs' : 'Hide WOs'}
                      >
                        {wosHidden ? '+ WOs' : '− WOs'}
                      </button>
                    )}
                  </div>
                </div>

                {g.pms.length > 0 && (
                  <>
                    <div className="t-small t-muted uppercase tracking-wider mt-2 mb-1">
                      PMs · due today / overdue
                    </div>
                    <ul className="t-text">
                      {g.pms.map((p, i) => (
                        <li
                          key={`${p.taskNo}-${i}`}
                          className="grid grid-cols-[64px_40px_1fr] gap-2 py-1 t-row-divider last:border-b-0"
                        >
                          <span className="t-mono t-small t-muted truncate" title={p.taskNo}>
                            {p.taskNo}
                          </span>
                          <span className={`t-mono t-small ${p.isOverdue ? 't-danger font-medium' : 't-muted'}`}>
                            {fmtMd(p.due)}
                          </span>
                          <span className="truncate" title={p.name}>{p.name}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {g.wos.length > 0 && !wosHidden && (
                  <>
                    <div className="t-small t-muted uppercase tracking-wider mt-3 mb-1">
                      WOs · open
                    </div>
                    <ul className="t-text">
                      {g.wos.map((w, i) => (
                        <li
                          key={`${w.id}-${i}`}
                          className="grid grid-cols-[64px_44px_1fr] gap-2 py-1 t-row-divider last:border-b-0 items-center"
                        >
                          <span className="t-mono t-small t-muted truncate" title={w.id}>
                            {w.id}
                          </span>
                          <span
                            className={`text-[10px] font-medium tracking-wide text-white text-center rounded px-1 py-0.5 ${woStatusClass(w.status)}`}
                            title={w.status}
                          >
                            {woStatusLabel(w.status)}
                          </span>
                          <span className="truncate" title={w.desc}>{w.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

