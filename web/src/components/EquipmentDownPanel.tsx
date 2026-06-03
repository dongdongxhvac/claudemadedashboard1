// §10.1 — Equipment with open issues across all buildings.
//
// After 0060: one row per OPEN equipment_issues row, so a single piece of
// equipment with two open problems shows up twice. The subtitle counts
// reflect issues, not equipment.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useBuildingEquipmentDown,
  useBuildingEquipmentDownRealtime,
  EQUIPMENT_STATUS_LABELS,
  type BuildingEquipmentStatusRow,
  type IssueStatus,
} from '../hooks/useBuildingKb';
import { useCanAccessAdmin } from '../hooks/useMe';
import { IssueCloseDialog } from './buildings/IssueCloseDialog';
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
  const canEdit = useCanAccessAdmin();
  const [closingRow, setClosingRow] = useState<BuildingEquipmentStatusRow | null>(null);
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
              <th className="text-center pb-1 pr-3" title="LOTO active">🔒</th>
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
                  <td className="py-1 pr-3 text-center">
                    {r.loto_applied_at && !r.loto_removed_at ? (
                      <span
                        title={`LOTO applied ${new Date(r.loto_applied_at).toLocaleString()}${r.loto_applied_by_name ? ' by ' + r.loto_applied_by_name : ''}`}
                        style={{ color: 'var(--color-danger)', fontWeight: 700 }}
                      >
                        🔒
                      </span>
                    ) : (
                      <span className="t-muted">—</span>
                    )}
                  </td>
                  <td
                    className="py-1 pr-3"
                    style={{
                      maxWidth: 320,
                      whiteSpace: 'normal',
                      overflow: 'hidden',
                      // 2-line wrap, then clamp with ellipsis — longer notes
                      // ("compressor 2 of 4 down — vendor scheduled Fri AM")
                      // fit without truncating mid-sentence.
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      lineHeight: 1.25,
                      wordBreak: 'break-word',
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
                        onClick={() => setClosingRow(r)}
                        className="t-small"
                        style={{
                          background: 'none', border: '1px solid var(--color-border)',
                          borderRadius: 4, padding: '2px 8px',
                          color: 'var(--color-ok, #10b981)',
                          cursor: 'pointer',
                        }}
                        title="Mark this issue resolved — opens a dialog to record how it was fixed"
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
      {closingRow && (
        <IssueCloseDialog
          ctx={{
            id: closingRow.id,
            equipment_id: closingRow.equipment_id,
            status: closingRow.status,
            detail: closingRow.status_detail,
            equipment_label: closingRow.short_name
              ? `${closingRow.short_name} · ${closingRow.full_name}`
              : closingRow.full_name,
            building_label: closingRow.building_short_code ?? closingRow.building_name,
            loto_applied_at: closingRow.loto_applied_at,
            loto_applied_by_name: closingRow.loto_applied_by_name,
            loto_removed_at: closingRow.loto_removed_at,
          }}
          onClose={() => setClosingRow(null)}
        />
      )}
    </Section>
  );
}
