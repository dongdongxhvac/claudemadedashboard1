// §13 — Latest meter readings per building.
//
// Surfaces the actual meter VALUES (not just compliance) from the most-
// recent monthly water meter completion at each building. One sub-table
// per building, sorted by building-number prefix ascending so engineers
// see the same building order they'd see in plantlog itself.
//
// Data only flows for buildings whose monthly water meter log was renamed
// in plantlog with a building-number prefix (see
// plantlog_building_attribution.py + migration 0042). Empty state guides
// the user back to that workflow if no rows arrive.
import { useMemo } from 'react';
import {
  usePlantlogMonthlyMeterLatestReadings,
  usePlantlogUserMap,
  type PlantlogMonthlyMeterLatestReading,
  type PlantlogMeterReadingItem,
} from '../hooks/usePlantlog';
import { Section } from './Section';

function fmtDoneAt(utcIso: string): string {
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function daysAgoFromUtc(utcIso: string): number {
  const ms = Date.now() - new Date(utcIso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/** Sort numerically by building-number prefix. "10" < "26" < "300". */
function comparePrefix(a: string | null, b: string | null): number {
  const na = a ? parseInt(a, 10) : Number.POSITIVE_INFINITY;
  const nb = b ? parseInt(b, 10) : Number.POSITIVE_INFINITY;
  return na - nb;
}

/** Format the numeric value with thousands separators when it parses as a
 *  number. Otherwise pass through (engineers sometimes log "—" or "n/a"). */
function fmtValue(v: string): string {
  const n = Number(v);
  if (Number.isFinite(n) && v.trim() !== '') {
    // Preserve up to 2 decimals for fractional gallons.
    return n.toLocaleString(undefined, {
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    });
  }
  return v;
}

function BuildingReadingsTable({
  row,
  engineerName,
}: {
  row: PlantlogMonthlyMeterLatestReading;
  engineerName: string;
}) {
  const days = daysAgoFromUtc(row.completed_at_utc);
  const subheader = (
    <>
      last read <strong>{fmtDoneAt(row.completed_at_utc)}</strong> ({days}d ago)
      {' '}by <strong>{engineerName}</strong>
      {row.note && (
        <span className="t-muted ml-2" style={{ fontSize: '0.7rem' }}>· {row.note}</span>
      )}
    </>
  );

  return (
    <div className="mb-5">
      <div className="t-small uppercase tracking-wider mb-2">
        <span style={{ color: 'var(--color-text)' }}>{row.building ?? row.log_name}</span>{' '}
        <span className="t-text t-muted">— {subheader}</span>
      </div>
      <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="t-muted">
            <th className="text-left pb-1 pr-3">Meter</th>
            <th className="text-right pb-1 px-2">Value</th>
            <th className="text-left pb-1 pl-3">Unit</th>
          </tr>
        </thead>
        <tbody>
          {(row.readings ?? []).map((r: PlantlogMeterReadingItem, idx) => (
            <tr
              key={`${row.log_name}|${r.item}|${idx}`}
              style={{ borderTop: '1px solid var(--color-border-soft)' }}
            >
              <td className="py-1 pr-3">{r.item}</td>
              <td className="text-right px-2 py-1 font-semibold" style={{ color: 'var(--color-text)' }}>
                {fmtValue(r.value)}
              </td>
              <td className="py-1 pl-3 t-muted">{r.unit ?? '—'}</td>
            </tr>
          ))}
          {(row.readings ?? []).length === 0 && (
            <tr style={{ borderTop: '1px solid var(--color-border-soft)' }}>
              <td className="py-1 pr-3 t-muted" colSpan={3}>
                No meter items captured in the latest reading.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyMeterReadingsPanel() {
  const readingsQ = usePlantlogMonthlyMeterLatestReadings();
  const userMapQ = usePlantlogUserMap();

  const rows = useMemo(() => {
    const all = readingsQ.data ?? [];
    return [...all].sort((a, b) => comparePrefix(a.building_prefix, b.building_prefix));
  }, [readingsQ.data]);

  // Quick stats for the section subtitle: building count + total meter count.
  const { buildingCount, meterCount, latestRead } = useMemo(() => {
    let meters = 0;
    let latest: string | null = null;
    for (const r of rows) {
      meters += (r.readings ?? []).length;
      if (!latest || r.completed_at_utc > latest) latest = r.completed_at_utc;
    }
    return {
      buildingCount: rows.length,
      meterCount: meters,
      latestRead: latest,
    };
  }, [rows]);

  const subtitle = (
    <span className="t-small t-muted text-right block">
      {buildingCount === 0 ? (
        <span>no prefixed buildings yet</span>
      ) : (
        <>
          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            {buildingCount} building{buildingCount === 1 ? '' : 's'}
          </span>
          <span className="ml-2">· {meterCount} meter{meterCount === 1 ? '' : 's'}</span>
          {latestRead && (
            <span className="ml-2">· most recent {fmtDoneAt(latestRead)}</span>
          )}
        </>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>
        most recent monthly water meter reading per building
      </span>
    </span>
  );

  return (
    <Section
      collapsible
      title="§13 Latest meter readings per building"
      subtitle={subtitle}
      loading={readingsQ.isLoading}
    >
      {readingsQ.error ? (
        <p className="t-text t-danger">Error: {(readingsQ.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <p className="t-text t-muted">
          No per-building monthly water meter readings yet. After plantlog logs are
          renamed with a building-number prefix (e.g. "26 Monthly Water Meter
          Readings"), readings appear here automatically after the next hourly poll
          following a completion. Until the first prefixed completion is logged,
          this section stays empty.
        </p>
      ) : (
        rows.map((row) => {
          const mapped = row.completed_by_user ? userMapQ.data?.get(row.completed_by_user) : null;
          const engineerName = mapped ? mapped.full_name : row.completed_by_user ?? '—';
          return <BuildingReadingsTable key={row.log_name} row={row} engineerName={engineerName} />;
        })
      )}
    </Section>
  );
}
