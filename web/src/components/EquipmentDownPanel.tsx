// §10.1 — Equipment with open issues across all buildings.
//
// After 0060: one row per OPEN equipment_issues row, so a single piece of
// equipment with two open problems shows up twice. The subtitle counts
// reflect issues, not equipment.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useBuildingEquipmentDown,
  useBuildingEquipmentDownRealtime,
  useCloseEquipmentIssue,
  EQUIPMENT_STATUS_LABELS,
  type IssueStatus,
} from '../hooks/useBuildingKb';
import { useCanAccessAdmin } from '../hooks/useMe';
import { Section } from './Section';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function relTime(utcIso: string): string {
  const ms = Date.now() - new Date(utcIso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function statusPillColor(s: IssueStatus): { bg: string; fg: string } {
  if (s === 'down_cm') {
    return { bg: 'var(--color-danger)', fg: 'white' };
  }
  if (s === 'off_pm') {
    return { bg: 'rgba(239, 68, 68, 0.18)', fg: 'var(--color-danger)' };
  }
  if (s === 'degraded' || s === 'bypass') {
    return { bg: 'rgba(217, 119, 6, 0.18)', fg: 'var(--color-warn, #d97706)' };
  }
  return { bg: 'var(--color-text-muted)', fg: 'white' };
}

export function EquipmentDownPanel() {
  useBuildingEquipmentDownRealtime();
  const rowsQ = useBuildingEquipmentDown();
  const close = useCloseEquipmentIssue();
  const canEdit = useCanAccessAdmin();
  const rows = rowsQ.data ?? [];

  // Sort: down_cm first (most urgent), then off_pm, then degraded/bypass.
  // Within each group, most-recently-opened first.
  const sorted = useMemo(() => {
    const order: Record<IssueStatus, number> = {
      down_cm: 0, off_pm: 1, degraded: 2, bypass: 3,
    };
    return [...rows].sort((a, b) => {
      const d = (order[a.status] ?? 99) - (order[b.status] ?? 99);
      if (d !== 0) return d;
      return b.last_status_change_at.localeCompare(a.last_status_change_at);
    });
  }, [rows]);

  const downCm   = rows.filter((r) => r.status === 'down_cm').length;
  const offPm    = rows.filter((r) => r.status === 'off_pm').length;
  const degraded = rows.filter((r) => r.status === 'degraded').length;
  const bypass   = rows.filter((r) => r.status === 'bypass').length;
  const warnTotal = degraded + bypass;

  const subtitle = (
    <span className="t-small t-muted text-right block">
      {rows.length === 0 ? (
        <span>everything operational</span>
      ) : (
        <>
          {downCm > 0 && (
            <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>
              {downCm} down-CM
            </span>
          )}
          {downCm > 0 && offPm > 0 && <span> · </span>}
          {offPm > 0 && (
            <span style={{ color: 'var(--color-danger)' }}>
              {offPm} off-PM
            </span>
          )}
          {(downCm > 0 || offPm > 0) && warnTotal > 0 && <span> · </span>}
          {degraded > 0 && (
            <span style={{ color: 'var(--color-warn, #d97706)', fontWeight: 700 }}>
              {degraded} degraded
            </span>
          )}
          {degraded > 0 && bypass > 0 && <span> · </span>}
          {bypass > 0 && (
            <span style={{ color: 'var(--color-warn, #d97706)' }}>
              {bypass} bypass
            </span>
          )}
        </>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>
        one row per open issue · equipment with two open problems appears twice · close from the building detail or the row's Close button
      </span>
    </span>
  );

  return (
    <Section
      collapsible
      title="§10.1 Equipment needing attention"
      subtitle={subtitle}
      loading={rowsQ.isLoading}
    >
      {rowsQ.error ? (
        <p className="t-text t-danger">Error: {(rowsQ.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="t-text t-muted">
          No open equipment issues across catalogued buildings.
        </p>
      ) : (
        <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="t-muted">
              <th className="text-left pb-1 pr-3">Bldg</th>
              <th className="text-left pb-1 pr-3">Short</th>
              <th className="text-left pb-1 pr-3">Equipment</th>
              <th className="text-left pb-1 pr-3">Status</th>
              <th className="text-left pb-1 pr-3">Date</th>
              <th className="text-left pb-1 pr-3">WO #</th>
              <th className="text-left pb-1 pr-3">RSP</th>
              <th className="text-left pb-1 pr-3">Detail</th>
              <th className="text-right pb-1 pl-3">Opened</th>
              {canEdit && <th className="text-right pb-1 pl-3">{/* close */}</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const pill = statusPillColor(r.status);
              const slug = r.building_short_code ?? r.building_name;
              return (
                <tr
                  key={r.id}
                  style={{ borderTop: '1px solid var(--color-border-soft)' }}
                >
                  <td className="py-1 pr-3">
                    <Link
                      to={`/buildings/${encodeURIComponent(slug)}`}
                      className="t-accent hover:underline"
                      style={{ fontWeight: 600 }}
                    >
                      {r.building_short_code ?? r.building_name}
                    </Link>
                  </td>
                  <td className="py-1 pr-3 t-mono">{r.short_name ?? '—'}</td>
                  <td className="py-1 pr-3" style={{ color: 'var(--color-text)' }}>
                    {r.full_name}
                  </td>
                  <td className="py-1 pr-3">
                    <span
                      style={{
                        padding: '2px 8px', borderRadius: 4,
                        fontSize: '0.65rem', fontWeight: 700,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        background: pill.bg, color: pill.fg,
                      }}
                    >
                      {EQUIPMENT_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="py-1 pr-3 t-muted">{fmtDate(r.status_date)}</td>
                  <td className="py-1 pr-3 t-mono">{r.wo_number ?? '—'}</td>
                  <td className="py-1 pr-3">{r.rsp ?? '—'}</td>
                  <td
                    className="py-1 pr-3"
                    style={{
                      maxWidth: 280, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title={r.status_detail ?? ''}
                  >
                    {r.status_detail ?? '—'}
                  </td>
                  <td
                    className="text-right pl-3 t-muted"
                    title={new Date(r.last_status_change_at).toLocaleString()}
                  >
                    {relTime(r.last_status_change_at)}
                  </td>
                  {canEdit && (
                    <td className="text-right pl-3">
                      <button
                        type="button"
                        onClick={async () => {
                          const label = `${r.short_name ?? r.full_name} — ${EQUIPMENT_STATUS_LABELS[r.status]}`;
                          if (!confirm(`Close issue: ${label}?`)) return;
                          await close.mutateAsync({ id: r.id, equipment_id: r.equipment_id });
                        }}
                        className="t-small"
                        style={{
                          background: 'none', border: '1px solid var(--color-border)',
                          borderRadius: 4, padding: '2px 8px',
                          color: 'var(--color-ok, #10b981)',
                          cursor: 'pointer',
                        }}
                        title="Mark this issue resolved"
                      >
                        Close
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
