// §10.2 — BMS alarm insights (Phase 8.3 follow-on).
//
// Goal: tech-ops-manager view of the BMS alarm noise. Same data as the §10
// active list + v_email_alarms_history, but reorganized so the ops question
// "where's the noise concentrated and is it getting better or worse?" reads
// at a glance.
//
// Three layers:
//   1. Stat cards    — 4 headline numbers (active now / events in window /
//                       manual closes / top building)
//   2. Group leaderboard — group by building / point / vendor / class with
//                       per-row counts + last-seen + manual-close marker.
//                       Sorted by event count desc, so repeat offenders
//                       float to the top.
//   3. Recent events  — collapsed sub-section with the flat chronological
//                       list (was the entire panel pre-rewrite). Toggle to
//                       "Manual closes only" for the audit-trail use case.
import { useMemo, useState } from 'react';
import {
  useEmailAlarmsInWindow,
  useEmailAlarmsHistory,
  type EmailAlarmHistoryRow,
} from '../hooks/useEmailAlarms';
import { Section } from './Section';

const VENDOR_LABEL: Record<string, string> = {
  siemens:               'Siemens',
  delta_takeda:          'Delta @ Takeda',
  delta_10green:         'Delta @ 10 Green',
  delta:                 'Delta',
  northeasttech_730_750: 'Northeast Tech 730/750',
  northeast:             'Northeast Tech',
  power_automate:        'Power Automate',
  power_automate_pa:     'PA canary',
};

function vendorLabel(v: string | null | undefined): string {
  if (!v) return '—';
  return VENDOR_LABEL[v] ?? v;
}

function fmtTime(utcIso: string | null): string {
  if (!utcIso) return '—';
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtRelative(utcIso: string | null): string {
  if (!utcIso) return '—';
  const ms = Date.now() - new Date(utcIso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

type GroupKey = 'building' | 'point' | 'vendor' | 'class';
type WindowDays = 7 | 30 | 90;

const GROUP_LABEL: Record<GroupKey, string> = {
  building: 'Building',
  point:    'Point',
  vendor:   'Vendor',
  class:    'Event class',
};

const GROUP_KEY_LABELS: Record<GroupKey, string> = {
  building: 'By building',
  point:    'By point',
  vendor:   'By vendor',
  class:    'By class',
};

/** Per-row key extractor and friendly display label. Building uses
 *  building_resolved (raw `building` → structured-field inference →
 *  body-text inference) so 730/750 rows that arrive without an explicit
 *  building tag still cluster correctly. */
function keyOf(r: EmailAlarmHistoryRow, g: GroupKey): { key: string; label: string } {
  if (g === 'building') {
    const resolved = r.building_resolved ?? '(unknown)';
    const inferred = !r.building && !!r.building_resolved;
    return {
      key: resolved,
      label: inferred ? `${resolved} (inferred)` : resolved,
    };
  }
  if (g === 'point') {
    const k = r.point_ref ?? r.point_name ?? '(unknown)';
    return { key: k, label: r.point_name ?? r.point_ref ?? '(unknown)' };
  }
  if (g === 'vendor') {
    const k = r.vendor ?? '(unknown)';
    return { key: k, label: vendorLabel(k) };
  }
  // class
  const k = r.event_class ?? '(unknown)';
  return { key: k, label: k };
}

type GroupRow = {
  key: string;
  label: string;
  events: number;
  active: number;   // rows with alarm_state='Active' AND not is_manual_close
  quiet: number;    // rows with alarm_state='Quiet' AND not is_manual_close
  manual: number;   // rows with is_manual_close=true
  lastSeenIso: string;
  topPoint?: string;     // for building / vendor / class views
  topPointCount?: number;
};

export function EmailAlarmsHistoryPanel() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [groupBy, setGroupBy]       = useState<GroupKey>('building');

  const windowQ = useEmailAlarmsInWindow(windowDays);
  const rows = windowQ.data ?? [];

  // Aggregations
  const stats = useMemo(() => {
    let active = 0, quiet = 0, manual = 0;
    let lastEventIso: string | null = null;
    for (const r of rows) {
      if (r.is_manual_close) manual++;
      else if (r.alarm_state === 'Active') active++;
      else if (r.alarm_state === 'Quiet')  quiet++;
      if (!lastEventIso || r.received_at_utc > lastEventIso) lastEventIso = r.received_at_utc;
    }
    return { totalEvents: rows.length, active, quiet, manual, lastEventIso };
  }, [rows]);

  // "Active right now" — derived from the latest event per point. Mirrors
  // v_email_alarms_open logic so the card matches what §10 shows above.
  const activeNow = useMemo(() => {
    const latestByPoint = new Map<string, EmailAlarmHistoryRow>();
    // Iterate rows newest-first (the data is already sorted that way) and
    // keep the first hit per point_ref.
    for (const r of rows) {
      if (!r.point_ref) continue;
      if (!latestByPoint.has(r.point_ref)) latestByPoint.set(r.point_ref, r);
    }
    let count = 0;
    for (const r of latestByPoint.values()) {
      if (r.alarm_state === 'Active' && !r.is_manual_close) count++;
    }
    return count;
  }, [rows]);

  const grouped: GroupRow[] = useMemo(() => {
    const map = new Map<string, GroupRow>();
    // For "top point in group" we also need per-(group,point) counters when
    // groupBy is building/vendor/class. Skip when groupBy is already point.
    const subPoint = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const { key, label } = keyOf(r, groupBy);
      const g = map.get(key) ?? {
        key, label,
        events: 0, active: 0, quiet: 0, manual: 0,
        lastSeenIso: r.received_at_utc,
      };
      g.events++;
      if (r.is_manual_close) g.manual++;
      else if (r.alarm_state === 'Active') g.active++;
      else if (r.alarm_state === 'Quiet')  g.quiet++;
      if (r.received_at_utc > g.lastSeenIso) g.lastSeenIso = r.received_at_utc;
      map.set(key, g);

      // sub-point count for non-point groupings
      if (groupBy !== 'point' && r.point_ref) {
        const sm = subPoint.get(key) ?? new Map<string, number>();
        sm.set(r.point_ref, (sm.get(r.point_ref) ?? 0) + 1);
        subPoint.set(key, sm);
      }
    }
    // Resolve top sub-point per group
    if (groupBy !== 'point') {
      for (const [k, g] of map) {
        const sm = subPoint.get(k);
        if (!sm) continue;
        let topP: string | undefined;
        let topC = 0;
        for (const [p, c] of sm) {
          if (c > topC) { topP = p; topC = c; }
        }
        g.topPoint = topP;
        g.topPointCount = topC;
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.events - a.events || b.lastSeenIso.localeCompare(a.lastSeenIso),
    );
  }, [rows, groupBy]);

  // Stat 4 — top building (always, regardless of current groupBy).
  // Uses building_resolved so 730/750 rows tagged via point-ref inference
  // count toward their actual building rather than landing in "(unknown)".
  const topBuilding = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.is_manual_close) continue;  // manual close shouldn't pad a building's "noise" count
      const b = r.building_resolved ?? '(unknown)';
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    let topName: string | null = null;
    let topCount = 0;
    for (const [n, c] of counts) {
      if (c > topCount) { topName = n; topCount = c; }
    }
    return topName ? { name: topName, count: topCount } : null;
  }, [rows]);

  const subtitle = (
    <span className="t-small t-muted">
      <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
        {rows.length.toLocaleString()}
      </span>{' '}
      event{rows.length === 1 ? '' : 's'}{' '}
      <span className="t-muted">in last {windowDays}d</span>
      {stats.lastEventIso && (
        <span className="ml-2 t-muted">· last {fmtRelative(stats.lastEventIso)}</span>
      )}
    </span>
  );

  return (
    <Section
      collapsible
      title="§10.2 Alarm insights"
      subtitle={subtitle}
      loading={windowQ.isLoading}
    >
      {windowQ.error ? (
        <p className="t-text t-danger">Error: {(windowQ.error as Error).message}</p>
      ) : (
        <>
          {/* Window selector */}
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <span className="t-small t-muted uppercase tracking-wider">Window</span>
            {([7, 30, 90] as WindowDays[]).map((d) => (
              <FilterPill
                key={d}
                label={`${d}d`}
                active={windowDays === d}
                onClick={() => setWindowDays(d)}
              />
            ))}
          </div>

          {/* Stat cards */}
          <div
            className="grid gap-2 mb-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          >
            <StatCard
              label="Active right now"
              value={activeNow.toLocaleString()}
              tone={activeNow > 0 ? 'bad' : 'good'}
              hint="latest event per point = Active"
            />
            <StatCard
              label={`Events / ${windowDays}d`}
              value={stats.totalEvents.toLocaleString()}
              hint={`${stats.active} Active · ${stats.quiet} Quiet · ${stats.manual} manual`}
            />
            <StatCard
              label={`Manual closes / ${windowDays}d`}
              value={stats.manual.toLocaleString()}
              tone={stats.manual > 0 ? 'warn' : undefined}
              hint="rows where the BMS didn't auto-resolve"
            />
            <StatCard
              label="Noisiest building"
              value={topBuilding?.name ?? '—'}
              hint={topBuilding ? `${topBuilding.count} events` : 'no events'}
              valueStyle={{ fontSize: '1.15rem' }}
            />
          </div>

          {/* Group-by pills */}
          <div className="flex items-baseline gap-2 mb-2 flex-wrap">
            <span className="t-small t-muted uppercase tracking-wider">Group by</span>
            {(Object.keys(GROUP_KEY_LABELS) as GroupKey[]).map((g) => (
              <FilterPill
                key={g}
                label={GROUP_KEY_LABELS[g]}
                active={groupBy === g}
                onClick={() => setGroupBy(g)}
              />
            ))}
          </div>

          {/* Grouped leaderboard */}
          {grouped.length === 0 ? (
            <p className="t-text t-muted">No events in the selected window.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="t-muted">
                    <th className="text-left pb-1 pr-3">{GROUP_LABEL[groupBy]}</th>
                    <th className="text-right pb-1 px-2" title="Total events in this group">Events</th>
                    <th className="text-right pb-1 px-2" title="Active events (alarm-state Active)">Active</th>
                    <th className="text-right pb-1 px-2" title="Quiet events (auto back-to-normal)">Quiet</th>
                    <th className="text-right pb-1 px-2" title="Manual closes — clicked by manager">Manual</th>
                    <th className="text-left pb-1 pl-3">Top {groupBy === 'point' ? 'building' : 'point'}</th>
                    <th className="text-right pb-1 pl-3">Last alarm</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.slice(0, 20).map((g) => (
                    <tr key={g.key} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                      <td className="py-1 pr-3" style={{ color: 'var(--color-text)' }}>{g.label}</td>
                      <td className="text-right px-2 py-1 font-semibold">{g.events}</td>
                      <td
                        className="text-right px-2 py-1"
                        style={{ color: g.active > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}
                      >
                        {g.active}
                      </td>
                      <td className="text-right px-2 py-1 t-muted">{g.quiet}</td>
                      <td
                        className="text-right px-2 py-1"
                        style={{ color: g.manual > 0 ? '#6366f1' : 'var(--color-text-muted)' }}
                      >
                        {g.manual}
                      </td>
                      <td className="py-1 pl-3 t-muted" style={{ fontSize: '0.78rem' }}>
                        {/* For point grouping, show the building this point lives at;
                            for other groupings, show the top point in this group. */}
                        {groupBy === 'point'
                          ? topBuildingForPoint(rows, g.key) ?? '—'
                          : g.topPoint
                            ? `${g.topPoint} (${g.topPointCount})`
                            : '—'
                        }
                      </td>
                      <td className="text-right pl-3 t-muted py-1" style={{ whiteSpace: 'nowrap' }} title={fmtTime(g.lastSeenIso)}>
                        {fmtRelative(g.lastSeenIso)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {grouped.length > 20 && (
                <p className="t-small t-muted mt-2">
                  Showing top 20 of {grouped.length} {GROUP_LABEL[groupBy].toLowerCase()}s by event count.
                </p>
              )}
            </div>
          )}

          {/* Chronological log (collapsed by default) */}
          <details className="mt-5">
            <summary
              className="t-small t-muted uppercase tracking-wider"
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              ▸ Recent events (chronological log)
            </summary>
            <div className="mt-2">
              <RecentEventsLog />
            </div>
          </details>
        </>
      )}
    </Section>
  );
}

/** Find which building a given point_ref most often appears in, within the
 *  same set of rows already being aggregated. Used for the point-grouping
 *  view's "Top building" column. */
function topBuildingForPoint(rows: EmailAlarmHistoryRow[], pointRef: string): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.point_ref !== pointRef) continue;
    const b = r.building_resolved ?? '(unknown)';
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let top: string | null = null;
  let topC = 0;
  for (const [b, c] of counts) {
    if (c > topC) { top = b; topC = c; }
  }
  return top;
}

/** Compact chronological event list — the previous full §10.2 panel,
 *  now demoted to a collapsed drawer. Toggle "Manual only" still works for
 *  the audit-trail use case. */
function RecentEventsLog() {
  const [manualOnly, setManualOnly] = useState(false);
  const histQ = useEmailAlarmsHistory({ manualOnly, limit: 50 });
  const rows  = histQ.data ?? [];
  return (
    <>
      <div className="flex gap-2 mb-2">
        <FilterPill label="All events" active={!manualOnly} onClick={() => setManualOnly(false)} />
        <FilterPill label="Manual closes only" active={manualOnly} onClick={() => setManualOnly(true)} accent="indigo" />
      </div>
      {histQ.isLoading ? (
        <p className="t-small t-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="t-small t-muted">
          {manualOnly
            ? 'No manual closes yet.'
            : 'No alarm events recorded yet.'}
        </p>
      ) : (
        <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="t-muted">
              <th className="text-left pb-1 pr-3">When</th>
              <th className="text-left pb-1 pr-3">Vendor</th>
              <th className="text-left pb-1 pr-3">Point / Building</th>
              <th className="text-left pb-1 pr-3">State</th>
              <th className="text-left pb-1 pl-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.gmail_msg_id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                <td className="py-1 pr-3" style={{ whiteSpace: 'nowrap' }}>
                  <div>{fmtTime(r.received_at_utc)}</div>
                  <div className="t-muted" style={{ fontSize: '0.7rem' }}>{fmtRelative(r.received_at_utc)}</div>
                </td>
                <td className="py-1 pr-3">{vendorLabel(r.vendor)}</td>
                <td className="py-1 pr-3" style={{ maxWidth: '18rem' }}>
                  <div>{r.point_name ?? r.point_ref ?? '—'}</div>
                  <div className="t-muted" style={{ fontSize: '0.7rem' }}>
                    {r.building_resolved ?? '—'}
                    {!r.building && r.building_resolved && (
                      <span className="ml-1" style={{ fontStyle: 'italic' }}>(inferred)</span>
                    )}
                  </div>
                </td>
                <td className="py-1 pr-3">
                  <StatePill state={r.alarm_state} isManual={r.is_manual_close} />
                </td>
                <td
                  className="py-1 pl-3 t-muted"
                  style={{ maxWidth: '22rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={r.is_manual_close ? (r.manual_close_reason ?? '') : (r.event_value ?? r.subject_clean ?? '')}
                >
                  {r.is_manual_close ? (
                    <>
                      <span style={{ color: 'var(--color-text)' }}>{r.closed_by_name ?? '?'}</span>
                      {r.manual_close_reason && (
                        <span className="ml-2">— {r.manual_close_reason}</span>
                      )}
                    </>
                  ) : (
                    r.event_value ?? r.subject_clean ?? '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents

function StatCard({
  label,
  value,
  tone,
  hint,
  valueStyle,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad';
  hint?: string;
  valueStyle?: React.CSSProperties;
}) {
  const valueColor =
    tone === 'bad'  ? 'var(--color-danger)' :
    tone === 'warn' ? 'var(--color-warn, #d97706)' :
    tone === 'good' ? 'var(--color-ok, #10b981)' :
    'var(--color-text)';
  return (
    <div
      className="t-card"
      style={{
        padding: '10px 12px',
        borderLeft: tone ? `3px solid ${valueColor}` : '1px solid var(--color-border)',
      }}
    >
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.65rem' }}>
        {label}
      </div>
      <div
        className="t-mono"
        style={{ fontSize: '1.4rem', fontWeight: 700, color: valueColor, lineHeight: 1.1, ...valueStyle }}
      >
        {value}
      </div>
      {hint && (
        <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function StatePill({ state, isManual }: { state: string | null; isManual: boolean }) {
  const tone =
    isManual ? { bg: 'rgba(99, 102, 241, 0.18)', fg: '#6366f1', label: 'MANUAL CLOSE' } :
    state === 'Active' ? { bg: 'rgba(239, 68, 68, 0.18)', fg: 'var(--color-danger)', label: 'ACTIVE' } :
    state === 'Quiet'  ? { bg: 'rgba(16, 185, 129, 0.18)', fg: 'var(--color-ok, #10b981)', label: 'QUIET' } :
    { bg: 'var(--color-border-soft)', fg: 'var(--color-text-muted)', label: (state ?? '—').toUpperCase() };
  return (
    <span
      style={{
        padding: '2px 6px', borderRadius: 3,
        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
        background: tone.bg, color: tone.fg, whiteSpace: 'nowrap',
      }}
    >
      {tone.label}
    </span>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  accent,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accent?: 'indigo';
}) {
  const activeBg = accent === 'indigo' ? 'rgba(99, 102, 241, 0.18)' : 'var(--color-accent)';
  const activeFg = accent === 'indigo' ? '#6366f1' : 'white';
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-small"
      style={{
        padding: '3px 9px',
        borderRadius: 4,
        border: `1px solid ${active ? activeFg : 'var(--color-border)'}`,
        background: active ? activeBg : 'transparent',
        color: active ? activeFg : 'var(--color-text-muted)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
