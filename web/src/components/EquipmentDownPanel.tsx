// §10.1 — Equipment currently off-PM or down-CM across all buildings.
//
// Sits directly under §10 BMS email alarms on the manager view. Reads
// from v_building_equipment_status which only returns equipment with
// status in ('off_pm','down_cm'). Empty when nothing is down — collapses
// nicely.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  useBuildingEquipmentDown,
  useBuildingEquipmentDownRealtime,
  EQUIPMENT_STATUS_LABELS,
  type EquipmentStatus,
} from '../hooks/useBuildingKb';
import { Section } from './Section';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  // YYYY-MM-DD → "May 30"
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

/** "3d ago", "5h ago", "now" — for the last-status-change column. */
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

function statusPillColor(s: EquipmentStatus): { bg: string; fg: string } {
  // Both off_pm and down_cm are red — but down_cm gets the stronger fill
  // to communicate "broken" vs "intentionally offline for PM".
  if (s === 'down_cm') {
    return { bg: 'var(--color-danger)', fg: 'white' };
  }
  if (s === 'off_pm') {
    return { bg: 'rgba(239, 68, 68, 0.18)', fg: 'var(--color-danger)' };
  }
  return { bg: 'var(--color-text-muted)', fg: 'white' };
}

export function EquipmentDownPanel() {
  useBuildingEquipmentDownRealtime();
  const rowsQ = useBuildingEquipmentDown();
  const rows = rowsQ.data ?? [];

  // Sort: down_cm first (most urgent), then off_pm. Within each group,
  // most-recently-changed first so what just broke surfaces up top.
  const sorted = useMemo(() => {
    const order: Record<EquipmentStatus, number> = {
      down_cm: 0, off_pm: 1,
      operational: 2, standby_auto: 3, defaulted: 4,
    };
    return [...rows].sort((a, b) => {
      const d = (order[a.status] ?? 99) - (order[b.status] ?? 99);
      if (d !== 0) return d;
      return b.last_status_change_at.localeCompare(a.last_status_change_at);
    });
  }, [rows]);

  const downCm = rows.filter((r) => r.status === 'down_cm').length;
  const offPm  = rows.filter((r) => r.status === 'off_pm').length;

  const subtitle = (
    <span className="t-small t-muted text-right block">
      {rows.length === 0 ? (
        <span>nothing down</span>
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
        </>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>
        equipment currently off-PM or down-CM · auto-clears when status flips to operational / standby auto
      </span>
    </span>
  );

  return (
    <Section
      collapsible
      title="§10.1 Equipment down / off"
      subtitle={subtitle}
      loading={rowsQ.isLoading}
    >
      {rowsQ.error ? (
        <p className="t-text t-danger">Error: {(rowsQ.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="t-text t-muted">
          All catalogued equipment is operational or on standby auto.
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
              <th className="text-right pb-1 pl-3">Last change</th>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
