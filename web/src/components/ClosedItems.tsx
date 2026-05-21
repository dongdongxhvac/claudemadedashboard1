// §00a — PMs & WOs closed in the selected window.
// Sub-section of §00 Crew Performance: reads the same `period` selector that
// §00 owns, so toggling the chips up there filters this tile to match.
//
// Activity-feed style — most recent close at top. Toggle between PMs and WOs.
import { useMemo, useState } from 'react';
import { useRecentPmCloses, useRecentWoCloses } from '../hooks/useCurrentSnapshots';
import { PERIODS, windowFor, type Period } from '../lib/dashboard';
import { Section } from './Section';

type Tab = 'pms' | 'wos';

export function ClosedItems({ period }: { period: Period }) {
  // Fetch 40d (covers the longest period option), filter client-side by window.
  const pmsQ = useRecentPmCloses(40);
  const wosQ = useRecentWoCloses(40);
  const [tab, setTab] = useState<Tab>('pms');

  const data = useMemo(() => {
    const win = windowFor(period, new Date());
    const inWin = (iso: string): boolean => {
      const d = new Date(iso);
      return d >= win.start && d < win.end;
    };
    const pms = (pmsQ.data ?? []).filter((r) => inWin(r.completed_on));
    const wos = (wosQ.data ?? []).filter((r) => inWin(r.completed_on));
    return { win, pms, wos };
  }, [pmsQ.data, wosQ.data, period]);

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '';
  const titleStr = `§00a Closed PMs & WOs · ${periodLabel}`;
  const loading = pmsQ.isLoading || wosQ.isLoading;

  if (loading) return <Section title={titleStr} loading />;

  return (
    <Section
      title={titleStr}
      subtitle={
        <span>
          Window · {data.win.label} · <b>{data.pms.length}</b> PMs · <b>{data.wos.length}</b> WOs closed
        </span>
      }
    >
      {/* Tab toggle */}
      <div className="flex items-center gap-2 mb-3">
        <TabPill active={tab === 'pms'} onClick={() => setTab('pms')}>
          PMs ({data.pms.length})
        </TabPill>
        <TabPill active={tab === 'wos'} onClick={() => setTab('wos')}>
          WOs ({data.wos.length})
        </TabPill>
      </div>

      {tab === 'pms' ? <PmTable rows={data.pms} /> : <WoTable rows={data.wos} />}
    </Section>
  );
}

function TabPill({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="t-small px-2.5 py-0.5 rounded-full border"
      style={
        active
          ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: 'white', fontWeight: 600 }
          : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
      }
    >
      {children}
    </button>
  );
}

function PmTable({ rows }: { rows: ReturnType<typeof useRecentPmCloses>['data'] }) {
  if (!rows || rows.length === 0) {
    return <p className="t-text t-muted">No PMs closed in this window.</p>;
  }
  return (
    <table className="w-full t-small">
      <thead>
        <tr className="t-muted text-left">
          <th className="py-1">Task</th>
          <th className="py-1">Name</th>
          <th className="py-1">Tech</th>
          <th className="py-1">Building</th>
          <th className="py-1 text-right">Closed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`${r.task_no}-${r.completed_on}`}
            className="border-t"
            style={{ borderColor: 'var(--color-border-soft)' }}
          >
            <td className="py-1 pr-2 t-mono">{r.task_no ?? '—'}</td>
            <td className="py-1 pr-2" title={r.task_name ?? ''}>
              {truncate(r.task_name, 70)}
            </td>
            <td className="py-1 pr-2">{r.assigned_to_name ?? '—'}</td>
            <td className="py-1 pr-2 t-muted">{r.building_code ?? '—'}</td>
            <td className="py-1 text-right t-mono t-muted">{fmtRelative(r.completed_on)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WoTable({ rows }: { rows: ReturnType<typeof useRecentWoCloses>['data'] }) {
  if (!rows || rows.length === 0) {
    return <p className="t-text t-muted">No WOs closed in this window.</p>;
  }
  return (
    <table className="w-full t-small">
      <thead>
        <tr className="t-muted text-left">
          <th className="py-1">WO</th>
          <th className="py-1">Description</th>
          <th className="py-1">Tech</th>
          <th className="py-1">Building</th>
          <th className="py-1 text-right">Closed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`${r.wo_id}-${r.completed_on}`}
            className="border-t"
            style={{ borderColor: 'var(--color-border-soft)' }}
          >
            <td className="py-1 pr-2 t-mono">{r.wo_id ?? '—'}</td>
            <td className="py-1 pr-2" title={r.description ?? ''}>
              {truncate(r.description, 70)}
            </td>
            <td className="py-1 pr-2">{r.assigned_to_name ?? '—'}</td>
            <td className="py-1 pr-2 t-muted">{r.building_code ?? '—'}</td>
            <td className="py-1 text-right t-mono t-muted">{fmtRelative(r.completed_on)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '—';
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

/** "8m ago" / "3h ago" / "May 15 2:30 PM" depending on freshness. */
function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
