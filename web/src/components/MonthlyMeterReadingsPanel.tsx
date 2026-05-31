// §13 — Latest meter readings per building.
//
// Two subsections:
//   1. Monthly water meter readings — values from monthly compliance
//      completions. Requires per-building prefix-renamed logs in plantlog
//      so the watcher can attribute building from log_name.
//   2. Daily round meters — values from daily-round meter logs (CT Meters,
//      HW Meter, CHW Meter, Closed Loop Meter, etc.). Already has building
//      attribution via cluster inference, so flows today with no plantlog
//      admin work needed.
//
// Both subsections render one card per building. Daily cards have multiple
// meter logs stacked inside; monthly cards have a single meter log each.
import { useMemo } from 'react';
import {
  usePlantlogMonthlyMeterLatestReadings,
  usePlantlogDailyMeterLatestReadings,
  usePlantlogUserMap,
  type PlantlogMonthlyMeterLatestReading,
  type PlantlogDailyMeterLatestReading,
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

/** Sort numerically by leading-digit prefix found in the building name
 *  (e.g. "26 Landsdowne St" -> 26). Non-numeric names sink to the bottom. */
function compareBuildingsByNumber(a: string, b: string): number {
  const numA = parseInt((a.match(/^(\d+)/) ?? ['', ''])[1], 10);
  const numB = parseInt((b.match(/^(\d+)/) ?? ['', ''])[1], 10);
  const na = Number.isFinite(numA) ? numA : Number.POSITIVE_INFINITY;
  const nb = Number.isFinite(numB) ? numB : Number.POSITIVE_INFINITY;
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

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
    return n.toLocaleString(undefined, {
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    });
  }
  return v;
}

/** Color the days-ago label: today/yesterday neutral, 2+ days amber, 5+ red.
 *  Daily meter readings should be near-zero days; growing staleness flags
 *  a building that hasn't been rounded recently. */
function staleColor(days: number): string | undefined {
  if (days >= 5) return 'var(--color-danger)';
  if (days >= 2) return 'var(--color-warn, #d97706)';
  return undefined;
}

// ---------- Shared item table ----------

function ItemsTable({
  rows,
  logName,
}: {
  rows: PlantlogMeterReadingItem[];
  logName: string;
}) {
  return (
    <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="t-muted">
          <th className="text-left pb-1 pr-3">Meter</th>
          <th className="text-right pb-1 px-2">Value</th>
          <th className="text-left pb-1 pl-3">Unit</th>
        </tr>
      </thead>
      <tbody>
        {(rows ?? []).map((r, idx) => (
          <tr
            key={`${logName}|${r.item}|${idx}`}
            style={{ borderTop: '1px solid var(--color-border-soft)' }}
          >
            <td className="py-1 pr-3">{r.item}</td>
            <td
              className="text-right px-2 py-1 font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              {fmtValue(r.value)}
            </td>
            <td className="py-1 pl-3 t-muted">{r.unit ?? '—'}</td>
          </tr>
        ))}
        {(rows ?? []).length === 0 && (
          <tr style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            <td className="py-1 pr-3 t-muted" colSpan={3}>
              No meter items captured.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ---------- Monthly subsection ----------

function MonthlyBuildingTable({
  row,
  engineerName,
}: {
  row: PlantlogMonthlyMeterLatestReading;
  engineerName: string;
}) {
  const days = daysAgoFromUtc(row.completed_at_utc);
  return (
    <div className="mb-4">
      <div className="t-small uppercase tracking-wider mb-2">
        <span style={{ color: 'var(--color-text)' }}>{row.building ?? row.log_name}</span>
        <span className="t-text t-muted">
          {' '}— last read <strong>{fmtDoneAt(row.completed_at_utc)}</strong> ({days}d ago) by{' '}
          <strong>{engineerName}</strong>
          {row.note && <span style={{ fontSize: '0.7rem' }} className="ml-2">· {row.note}</span>}
        </span>
      </div>
      <ItemsTable rows={row.readings ?? []} logName={row.log_name} />
    </div>
  );
}

// ---------- Daily subsection ----------

function DailyMeterLog({
  row,
  engineerName,
}: {
  row: PlantlogDailyMeterLatestReading;
  engineerName: string;
}) {
  const days = daysAgoFromUtc(row.completed_at_utc);
  const color = staleColor(days);
  const daysLabel = days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;
  return (
    <div className="mb-3" style={{ paddingLeft: 8 }}>
      <div className="t-small mb-1">
        <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{row.log_name}</span>
        <span className="t-muted">
          {' '}— {fmtDoneAt(row.completed_at_utc)} ·{' '}
        </span>
        <span style={{ color, fontWeight: color ? 600 : undefined }}>{daysLabel}</span>
        <span className="t-muted"> · by <strong>{engineerName}</strong></span>
        {row.attribution_source === 'inferred' && (
          <span className="t-muted ml-2" style={{ fontSize: '0.65rem' }}>
            (building inferred from neighbors)
          </span>
        )}
      </div>
      <ItemsTable rows={row.readings ?? []} logName={row.log_name} />
    </div>
  );
}

function DailyBuildingCard({
  building,
  logs,
  userMap,
}: {
  building: string;
  logs: PlantlogDailyMeterLatestReading[];
  userMap: Map<string, { full_name: string; user_id: string }> | undefined;
}) {
  // Sort logs by log_name alphabetically for stable display order within
  // a building. Could sort by recency instead, but alphabetical is more
  // predictable when comparing across buildings.
  const sorted = useMemo(
    () => [...logs].sort((a, b) => a.log_name.localeCompare(b.log_name)),
    [logs],
  );
  return (
    <div className="mb-5">
      <div className="t-small uppercase tracking-wider mb-2">
        <span style={{ color: 'var(--color-text)' }}>{building}</span>
        <span className="t-text t-muted"> — {logs.length} meter log{logs.length === 1 ? '' : 's'}</span>
      </div>
      {sorted.map((row) => {
        const mapped = row.completed_by_user ? userMap?.get(row.completed_by_user) : null;
        const engineerName = mapped ? mapped.full_name : row.completed_by_user ?? '—';
        return (
          <DailyMeterLog
            key={`${building}|${row.log_name}`}
            row={row}
            engineerName={engineerName}
          />
        );
      })}
    </div>
  );
}

// ---------- Panel ----------

export function MonthlyMeterReadingsPanel() {
  const monthlyQ = usePlantlogMonthlyMeterLatestReadings();
  const dailyQ = usePlantlogDailyMeterLatestReadings();
  const userMapQ = usePlantlogUserMap();

  // Monthly: sort by building-number prefix.
  const monthlyRows = useMemo(() => {
    const all = monthlyQ.data ?? [];
    return [...all].sort((a, b) => comparePrefix(a.building_prefix, b.building_prefix));
  }, [monthlyQ.data]);

  // Daily: group by building, then sort buildings numerically.
  const dailyByBuilding = useMemo(() => {
    const all = dailyQ.data ?? [];
    const map = new Map<string, PlantlogDailyMeterLatestReading[]>();
    for (const r of all) {
      const list = map.get(r.building) ?? [];
      list.push(r);
      map.set(r.building, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => compareBuildingsByNumber(a, b));
  }, [dailyQ.data]);

  // Subtitle counters.
  const {
    monthlyBuildingCount,
    monthlyMeterCount,
    dailyBuildingCount,
    dailyMeterCount,
    latestRead,
  } = useMemo(() => {
    let mMeters = 0;
    let dMeters = 0;
    let latest: string | null = null;
    for (const r of monthlyRows) {
      mMeters += (r.readings ?? []).length;
      if (!latest || r.completed_at_utc > latest) latest = r.completed_at_utc;
    }
    for (const [, logs] of dailyByBuilding) {
      for (const r of logs) {
        dMeters += (r.readings ?? []).length;
        if (!latest || r.completed_at_utc > latest) latest = r.completed_at_utc;
      }
    }
    return {
      monthlyBuildingCount: monthlyRows.length,
      monthlyMeterCount: mMeters,
      dailyBuildingCount: dailyByBuilding.length,
      dailyMeterCount: dMeters,
      latestRead: latest,
    };
  }, [monthlyRows, dailyByBuilding]);

  const subtitle = (
    <span className="t-small t-muted text-right block">
      <span>
        monthly:{' '}
        <strong style={{ color: 'var(--color-text)' }}>
          {monthlyBuildingCount} building{monthlyBuildingCount === 1 ? '' : 's'}
        </strong>{' '}
        · {monthlyMeterCount} meter{monthlyMeterCount === 1 ? '' : 's'}
      </span>
      <span className="ml-3">
        daily:{' '}
        <strong style={{ color: 'var(--color-text)' }}>
          {dailyBuildingCount} building{dailyBuildingCount === 1 ? '' : 's'}
        </strong>{' '}
        · {dailyMeterCount} meter{dailyMeterCount === 1 ? '' : 's'}
      </span>
      {latestRead && (
        <span className="ml-3">· most recent {fmtDoneAt(latestRead)}</span>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.75 }}>
        latest reading per meter per building · monthly + daily-round cadences
      </span>
    </span>
  );

  const isLoading = monthlyQ.isLoading || dailyQ.isLoading;
  const error = monthlyQ.error || dailyQ.error;
  const empty = monthlyRows.length === 0 && dailyByBuilding.length === 0;

  return (
    <Section
      collapsible
      title="§13 Latest meter readings per building"
      subtitle={subtitle}
      loading={isLoading}
    >
      {error ? (
        <p className="t-text t-danger">Error: {(error as Error).message}</p>
      ) : empty ? (
        <p className="t-text t-muted">
          No meter readings ingested yet. (Polling runs hourly 7 AM-7 PM.)
        </p>
      ) : (
        <>
          {/* --- Monthly subsection --- */}
          <div className="mb-6">
            <div className="t-small t-muted uppercase tracking-wider mb-3">
              Monthly water meter readings{' '}
              <span className="t-text">— {monthlyBuildingCount} building{monthlyBuildingCount === 1 ? '' : 's'}</span>
            </div>
            {monthlyRows.length === 0 ? (
              <p className="t-text t-muted mb-4">
                No per-building monthly readings yet. After plantlog logs are renamed with
                a building-number prefix (e.g. "26 Monthly Water Meter Readings"), readings
                appear here automatically after the next hourly poll.
              </p>
            ) : (
              monthlyRows.map((row) => {
                const mapped = row.completed_by_user ? userMapQ.data?.get(row.completed_by_user) : null;
                const engineerName = mapped ? mapped.full_name : row.completed_by_user ?? '—';
                return (
                  <MonthlyBuildingTable
                    key={row.log_name}
                    row={row}
                    engineerName={engineerName}
                  />
                );
              })
            )}
          </div>

          {/* --- Daily subsection --- */}
          <div>
            <div className="t-small t-muted uppercase tracking-wider mb-3">
              Daily round meter readings{' '}
              <span className="t-text">— {dailyBuildingCount} building{dailyBuildingCount === 1 ? '' : 's'}</span>
            </div>
            {dailyByBuilding.length === 0 ? (
              <p className="t-text t-muted">
                No daily-round meter readings in the attribution window.
              </p>
            ) : (
              dailyByBuilding.map(([building, logs]) => (
                <DailyBuildingCard
                  key={building}
                  building={building}
                  logs={logs}
                  userMap={userMapQ.data}
                />
              ))
            )}
          </div>
        </>
      )}
    </Section>
  );
}
