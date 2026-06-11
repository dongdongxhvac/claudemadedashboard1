// §06 — Plantlog rounds activity (Phase 6.7).
//
// Two views in one section:
//   1. Per-building daily matrix (last N days)
//   2. Per-engineer daily building visits (collapsible)
//
// Data path: building_inferred is populated by plantlog_building_attribution.py
// (nearest-neighbor heuristic over the (log_name, group_name) -> building
// lookup from plantlog's /groups + /logs catalog). Some rows are "direct"
// (unambiguous) and some are "inferred" (nearest unambiguous in time). Both
// surface here as concrete building counts.
import { Fragment, useMemo, useState } from 'react';
import {
  usePlantlogBuildingDaily,
  usePlantlogUserBuildingDaily,
  usePlantlogUserDailySpan,
  usePlantlogUserBuildingDailyVisits,
  usePlantlogUserMap,
  usePlantlogTodayCompliance,
  usePlantlogDailyAmPm,
  type PlantlogComplianceWindow,
  type PlantlogUserDailySpan,
  type PlantlogUserBuildingVisit,
} from '../hooks/usePlantlog';
import { Section } from './Section';

type Period = '4d' | '7d' | '14d';
const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: '4d',  label: '4d',  days: 4  },
  { key: '7d',  label: '7d',  days: 7  },
  { key: '14d', label: '14d', days: 14 },
];

// Local-midnight Date for a YYYY-MM-DD day string (avoid UTC shift).
function dayDate(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

function fmtShortDay(ymd: string): string {
  const d = dayDate(ymd);
  return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
}

function fmtDow(ymd: string): string {
  return dayDate(ymd).toLocaleDateString(undefined, { weekday: 'short' });
}

/** UTC ISO timestamp -> HH:MM in America/New_York (matches plantlog's wall-clock). */
function fmtTime(utcIso: string): string {
  return new Date(utcIso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Seconds -> "Xh Ym" (or "Ym" if under an hour). */
function fmtSpan(seconds: number): string {
  if (!seconds) return '0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PlantlogRoundsPanel() {
  const [period, setPeriod] = useState<Period>('4d');
  const days = PERIODS.find((p) => p.key === period)!.days;
  const bdQ = usePlantlogBuildingDaily(days);
  const ubdQ = usePlantlogUserBuildingDaily(days);
  const spanQ = usePlantlogUserDailySpan(days);
  const visitsQ = usePlantlogUserBuildingDailyVisits(days);
  const userMapQ = usePlantlogUserMap();
  const ampmQ = usePlantlogDailyAmPm(days);

  // et_day -> {am, pm} building counts for the matrix date headers.
  const ampmByDay = useMemo(() => {
    const m = new Map<string, { am: number; pm: number }>();
    for (const r of ampmQ.data ?? []) {
      m.set(r.et_day, { am: r.am_buildings, pm: r.pm_buildings });
    }
    return m;
  }, [ampmQ.data]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  // Expand state for the per-building breakdown inside Daily round efficiency.
  // Key shape: `${day}|${user_name}` — one engineer-day row at a time.
  const [expandedSpan, setExpandedSpan] = useState<string | null>(null);

  const matrix = useMemo(() => {
    const rows = bdQ.data ?? [];
    const daysSet = new Set<string>();
    const bldgSet = new Set<string>();
    const byKey = new Map<string, number>();
    for (const r of rows) {
      daysSet.add(r.et_day);
      bldgSet.add(r.building);
      byKey.set(`${r.building}|${r.et_day}`, r.entries);
    }
    // Limit to the requested window (the view doesn't strictly enforce it).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const sortedDays = [...daysSet].filter((d) => d >= cutoffStr).sort();
    const buildingTotals: { building: string; total: number; perDay: number[] }[] = [];
    for (const b of bldgSet) {
      const perDay = sortedDays.map((d) => byKey.get(`${b}|${d}`) ?? 0);
      const total = perDay.reduce((a, c) => a + c, 0);
      if (total > 0) buildingTotals.push({ building: b, total, perDay });
    }
    buildingTotals.sort((a, b) => b.total - a.total);
    const dayTotals = sortedDays.map((_d, i) =>
      buildingTotals.reduce((a, r) => a + r.perDay[i], 0)
    );
    return { sortedDays, buildingTotals, dayTotals, grandTotal: dayTotals.reduce((a, c) => a + c, 0) };
  }, [bdQ.data, days]);

  const perUser = useMemo(() => {
    const rows = ubdQ.data ?? [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    // user -> day -> [{building, entries}]
    const byUserDay = new Map<string, Map<string, { building: string; entries: number }[]>>();
    for (const r of rows) {
      if (r.et_day < cutoffStr) continue;
      let dm = byUserDay.get(r.user_name);
      if (!dm) {
        dm = new Map();
        byUserDay.set(r.user_name, dm);
      }
      const list = dm.get(r.et_day) ?? [];
      list.push({ building: r.building, entries: r.entries });
      dm.set(r.et_day, list);
    }
    // Build per-user summary: total entries, days active
    const users: { user: string; total: number; daysActive: number; perDay: { day: string; entries: number; buildings: { building: string; entries: number }[] }[] }[] = [];
    for (const [user, dm] of byUserDay) {
      const perDay: { day: string; entries: number; buildings: { building: string; entries: number }[] }[] = [];
      for (const [day, blist] of dm) {
        blist.sort((a, b) => b.entries - a.entries);
        const e = blist.reduce((a, c) => a + c.entries, 0);
        perDay.push({ day, entries: e, buildings: blist });
      }
      perDay.sort((a, b) => (a.day < b.day ? 1 : -1));
      const total = perDay.reduce((a, c) => a + c.entries, 0);
      users.push({ user, total, daysActive: perDay.length, perDay });
    }
    users.sort((a, b) => b.total - a.total);
    return users;
  }, [ubdQ.data, days]);

  // Lookup: `${user_name}|${day}` -> per-building visit rows, sorted by FIRST
  // entry time ascending so the rows read in route order — the order the
  // engineer actually walked the buildings that day.
  const visitsByEngineerDay = useMemo(() => {
    const m = new Map<string, PlantlogUserBuildingVisit[]>();
    for (const r of visitsQ.data ?? []) {
      const key = `${r.user_name}|${r.et_day}`;
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.first_entry_utc.localeCompare(b.first_entry_utc));
    }
    return m;
  }, [visitsQ.data]);

  // Daily round efficiency: group by day, list engineers with first/last/span.
  const dailySpan = useMemo(() => {
    const rows = spanQ.data ?? [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const byDay = new Map<string, PlantlogUserDailySpan[]>();
    for (const r of rows) {
      if (r.et_day < cutoffStr) continue;
      const list = byDay.get(r.et_day) ?? [];
      list.push(r);
      byDay.set(r.et_day, list);
    }
    // Sort each day's engineers by entries desc, then days desc
    const sortedDays = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));
    return sortedDays.map((day) => ({
      day,
      engineers: (byDay.get(day) ?? []).sort((a, b) => b.entries - a.entries),
    }));
  }, [spanQ.data, days]);

  const loading = bdQ.isLoading || ubdQ.isLoading || spanQ.isLoading || visitsQ.isLoading;
  const err = bdQ.error || ubdQ.error || spanQ.error || visitsQ.error;

  const subtitle = (
    <div className="flex items-center gap-2 flex-wrap">
      <ComplianceChips />
      <span className="t-small t-muted">
        {matrix.grandTotal.toLocaleString()} entries · {matrix.buildingTotals.length} bldgs · {perUser.length} engineers
      </span>
      <div className="flex border rounded" style={{ borderColor: 'var(--color-border)' }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-2 py-0.5 t-small ${period === p.key ? 't-accent font-semibold' : 't-muted'}`}
            style={{
              background:
                period === p.key ? 'var(--color-card-elev)' : 'transparent',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Section collapsible title="§06 Plantlog rounds" subtitle={subtitle} loading={loading}>
      {err ? (
        <p className="t-text t-danger">Error loading plantlog data: {(err as Error).message}</p>
      ) : matrix.grandTotal === 0 ? (
        <p className="t-text t-muted">
          No attributed plantlog entries in this window. Run{' '}
          <code>python plantlog_building_attribution.py 30 --persist</code> to backfill.
        </p>
      ) : (
        <>
          {/* Building x Day matrix */}
          <div className="overflow-x-auto mb-6">
            <table className="t-mono t-small" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th className="text-left pb-2 pr-3" style={{ position: 'sticky', left: 0, background: 'var(--color-card)' }}>Building</th>
                  {matrix.sortedDays.map((d) => {
                    const c = ampmByDay.get(d);
                    return (
                      <th key={d} className="text-right pb-2 px-2">
                        <div>{fmtShortDay(d)}</div>
                        <div className="t-muted" style={{ fontSize: '0.7rem' }}>{fmtDow(d)}</div>
                        <div
                          style={{ fontSize: '0.62rem', fontWeight: 400, whiteSpace: 'nowrap' }}
                          title="Buildings counted by round START time: AM = first entry of the day before 11:30a · PM = first afternoon entry (noon+) at/after 3:00p"
                        >
                          <span style={{ color: 'var(--color-accent)' }}>AM {c?.am ?? 0}</span>
                          <span className="t-muted"> · </span>
                          <span style={{ color: 'var(--color-warn, #d97706)' }}>PM {c?.pm ?? 0}</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="text-right pb-2 pl-3 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.buildingTotals.map((row) => (
                  <tr key={row.building} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                    <td className="py-1 pr-3" style={{ position: 'sticky', left: 0, background: 'var(--color-card)' }}>
                      {row.building}
                    </td>
                    {row.perDay.map((n, i) => (
                      <td key={i} className="text-right px-2 py-1" style={{ color: n === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
                        {n === 0 ? '·' : n}
                      </td>
                    ))}
                    <td className="text-right pl-3 py-1 font-semibold">{row.total}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--color-border)' }}>
                  <td className="py-1 pr-3 font-semibold" style={{ position: 'sticky', left: 0, background: 'var(--color-card)' }}>
                    Total
                  </td>
                  {matrix.dayTotals.map((n, i) => (
                    <td key={i} className="text-right px-2 py-1 font-semibold">{n}</td>
                  ))}
                  <td className="text-right pl-3 py-1 font-semibold">{matrix.grandTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Daily round efficiency — start / end / entries / span per engineer.
              Each engineer row is click-to-expand for a per-building breakdown
              of how long they spent at each building. */}
          <div className="mb-6">
            <div className="t-small t-muted uppercase tracking-wider mb-2">
              Daily round efficiency · daily rounds only (excl. water treatment, weekly &amp; monthly) · <span title="Active = sum of per-building visit durations. Span = wall-clock first→last entry. When Active &lt;&lt; Span the engineer was off-round (weekly test, paperwork, travel, break)" style={{ borderBottom: '1px dotted var(--color-text-muted)', cursor: 'help' }}>Active vs Span</span> · click an engineer for per-building time
            </div>
            <div className="space-y-3">
              {dailySpan.map(({ day, engineers }) => (
                <div key={day}>
                  <div className="t-small font-semibold mb-1">
                    {dayDate(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                  <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr className="t-muted">
                        <th className="text-left pb-1" style={{ width: 14 }}></th>
                        <th className="text-left pb-1">Engineer</th>
                        <th className="text-right pb-1 px-2">Start</th>
                        <th className="text-right pb-1 px-2">End</th>
                        <th className="text-right pb-1 px-2">Entries</th>
                        <th className="text-right pb-1 px-2" title="Sum of per-building visit durations">Active</th>
                        <th className="text-right pb-1 px-2" title="Wall-clock first→last entry">Span</th>
                      </tr>
                    </thead>
                    <tbody>
                      {engineers.map((e) => {
                        const mapped = userMapQ.data?.get(e.user_name);
                        const display = mapped?.full_name ?? e.user_name;
                        const rowKey = `${day}|${e.user_name}`;
                        const isOpen = expandedSpan === rowKey;
                        const visits = visitsByEngineerDay.get(`${e.user_name}|${day}`) ?? [];
                        const hasVisits = visits.length > 0;
                        return (
                          <Fragment key={e.user_name}>
                            <tr
                              style={{ borderTop: '1px solid var(--color-border-soft)', cursor: hasVisits ? 'pointer' : 'default' }}
                              onClick={() => hasVisits && setExpandedSpan(isOpen ? null : rowKey)}
                              title={hasVisits ? (isOpen ? 'Hide per-building breakdown' : 'Show per-building breakdown') : 'No attributed buildings on this day'}
                            >
                              <td className="py-1 t-muted" style={{ fontSize: 10, paddingLeft: 2 }}>
                                {hasVisits ? (isOpen ? '▾' : '▸') : ''}
                              </td>
                              <td className="py-1 pr-2">
                                <span>{display}</span>
                                {mapped && (
                                  <span className="t-muted ml-2" style={{ fontSize: '0.7rem' }}>@{e.user_name}</span>
                                )}
                              </td>
                              <td className="text-right px-2 py-1">{fmtTime(e.first_entry_utc)}</td>
                              <td className="text-right px-2 py-1">{fmtTime(e.last_entry_utc)}</td>
                              <td className="text-right px-2 py-1">{e.entries}</td>
                              <td className="text-right px-2 py-1">{fmtSpan(e.active_seconds)}</td>
                              <td className="text-right px-2 py-1">
                                {fmtSpan(e.span_seconds)}
                                {e.span_seconds > 0 && e.active_seconds > 0 &&
                                 (e.span_seconds - e.active_seconds) > 30 * 60 && (
                                  <span
                                    className="t-muted ml-1"
                                    style={{ fontSize: '0.7rem' }}
                                    title="Span − Active = off-round time (weekly/monthly task, paperwork, travel, break)"
                                  >
                                    (+{fmtSpan(e.span_seconds - e.active_seconds)} off)
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isOpen && hasVisits && (
                              <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                                <td></td>
                                <td colSpan={6} className="pt-1 pb-2">
                                  <BuildingVisitsBreakdown rows={visits} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>

          {/* Per-engineer daily breakdown */}
          <div className="space-y-2">
            <div className="t-small t-muted uppercase tracking-wider mb-1">
              Per-engineer building breakdown · click to expand
            </div>
            {perUser.map((u) => {
              const open = expandedUser === u.user;
              return (
                <div key={u.user} className="border rounded" style={{ borderColor: 'var(--color-border-soft)' }}>
                  <button
                    onClick={() => setExpandedUser(open ? null : u.user)}
                    className="w-full text-left flex justify-between items-baseline px-3 py-2"
                  >
                    <span className="t-text">
                      {(() => {
                        const mapped = userMapQ.data?.get(u.user);
                        return mapped ? (
                          <>
                            <span className="font-semibold">{mapped.full_name}</span>
                            <span className="t-small t-muted ml-2 t-mono">@{u.user}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold t-mono">{u.user}</span>
                            <span className="t-small t-muted ml-2" title="Set this plantlog username on a User Profile to show the real name">
                              (unmapped)
                            </span>
                          </>
                        );
                      })()}
                      <span className="t-small t-muted ml-2">· {u.daysActive}d active</span>
                    </span>
                    <span className="t-mono">{u.total.toLocaleString()}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-2 border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
                      {u.perDay.map((d) => (
                        <div key={d.day} className="py-1 t-small" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                          <span className="t-mono t-muted">{fmtShortDay(d.day)}</span>{' '}
                          <span className="t-mono">[{String(d.entries).padStart(3, ' ')}]</span>
                          {' '}
                          {d.buildings.map((b, i) => (
                            <span key={b.building}>
                              {i > 0 && <span className="t-muted">, </span>}
                              {b.building}
                              <span className="t-muted">({b.entries})</span>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-building breakdown shown inside the Daily round efficiency table when
// an engineer row is expanded. Rows are pre-sorted by first_entry_utc
// ascending so they read in route order — the order the engineer actually
// walked the buildings that day.
function BuildingVisitsBreakdown({ rows }: { rows: PlantlogUserBuildingVisit[] }) {
  return (
    <div style={{ padding: '0 0 0 18px' }}>
      <table className="t-mono t-small" style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr className="t-muted" style={{ fontSize: 10 }}>
            <th className="text-left pb-1">Building</th>
            <th className="text-right pb-1 px-2">First</th>
            <th className="text-right pb-1 px-2">Last</th>
            <th className="text-right pb-1 px-2">Entries</th>
            <th className="text-right pb-1 px-2">Visits</th>
            <th className="text-right pb-1 px-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.building}>
              <td className="py-0.5 pr-2">{r.building}</td>
              <td className="text-right px-2 py-0.5">{fmtTime(r.first_entry_utc)}</td>
              <td className="text-right px-2 py-0.5">{fmtTime(r.last_entry_utc)}</td>
              <td className="text-right px-2 py-0.5">{r.entries}</td>
              <td className="text-right px-2 py-0.5">
                {r.visits}
                {r.visits > 1 && (
                  <span className="t-muted ml-1" style={{ fontSize: 9 }} title="Engineer returned to this building during the day">
                    ↺
                  </span>
                )}
              </td>
              <td className="text-right px-2 py-0.5">{fmtSpan(r.total_visit_seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComplianceChips — AM/PM heartbeat shown in the §06 subtitle.
// Hidden on weekends. Pre-deadline = amber pending; post-deadline = green
// when fully synced, red when any building is missing. Tooltip lists the
// missing buildings so a manager can chase them down without scrolling.
// ---------------------------------------------------------------------------

function ComplianceChips() {
  const q = usePlantlogTodayCompliance();
  if (q.isLoading || !q.data) return null;
  if (q.data.isWeekend) return null;
  return (
    <div className="flex gap-1" style={{ flexShrink: 0 }}>
      <ComplianceChip w={q.data.am} label="AM" />
      <ComplianceChip w={q.data.pm} label="PM" />
    </div>
  );
}

function ComplianceChip({ w, label }: { w: PlantlogComplianceWindow; label: string }) {
  let bg: string;
  let fg: string;
  let txt: string;
  let title: string;
  const total = w.expected.length;
  const ok = w.synced.length;

  if (!w.deadlinePassed) {
    // Pre-deadline — pending; show progress (X/N) in amber.
    bg = 'rgba(217,119,6,0.15)';
    fg = 'var(--color-warn, #d97706)';
    txt = `${label} ${ok}/${total}`;
    title = `${label} window — deadline ${w.deadlineLabel} ET. ${ok}/${total} buildings synced so far. ${w.missing.length} pending: ${w.missing.join(', ') || 'none'}`;
  } else if (w.missing.length === 0) {
    // Post-deadline, fully synced — green.
    bg = 'rgba(16,185,129,0.15)';
    fg = 'var(--color-ok, #10b981)';
    txt = `${label} ✓ ${total}/${total}`;
    title = `${label} window — all ${total} buildings synced by ${w.deadlineLabel} ET. Email alert NOT triggered.`;
  } else {
    // Post-deadline, missing — red.
    bg = 'rgba(239,68,68,0.15)';
    fg = 'var(--color-danger)';
    txt = `${label} ✗ ${ok}/${total}`;
    title = `${label} window — deadline ${w.deadlineLabel} ET PASSED. ${w.missing.length} building(s) missing: ${w.missing.join(', ')}. Email alert sent to jie.lao@cwservices.com.`;
  }
  return (
    <span
      title={title}
      style={{
        padding: '2px 8px',
        borderRadius: 10,
        background: bg,
        color: fg,
        fontWeight: 700,
        fontSize: '0.7rem',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {txt}
    </span>
  );
}
