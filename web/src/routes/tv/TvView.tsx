// /tv — Shop-floor TV view. Static 3x2 grid, large fonts, no nav chrome.
// Six panels visible at once for the morning huddle / glanceable read.
//
// Layout (3 cols × 2 rows):
//   ┌── header ──────────────────────────────────────────────────────────┐
//   │ UPark Operation · On-call · Weather · ddd MMM D · data age         │
//   ├──────────────────┬──────────────────┬──────────────────────────────┤
//   │ WORKLOAD         │ FOCUS BOARD      │ (open slot — TBD)            │
//   │  due today (top) │                  │                              │
//   │  14d PM | ◆ 46d  │                  │                              │
//   ├──────────────────┼──────────────────┼──────────────────────────────┤
//   │ CREW · LAST 7d   │ BUILDINGS        │ ON-CALL SCHEDULE             │
//   │                  │ (rounds + assign)│ (whole table)                │
//   └──────────────────┴──────────────────┴──────────────────────────────┘
import { useEffect, useMemo, useState } from 'react';
import { useUpcomingOncall, useOncallRealtime, useOncallParticipants, useOncallSettings, type OncallParticipant, type OncallSettings } from '../../hooks/useOncall';
import { useActiveFocusItems, useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { useCurrentPmRows, useCurrentLaborRows } from '../../hooks/useCurrentSnapshots';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { useRounds, useRoundsRealtime } from '../../hooks/useRounds';
import { useShifts, useShiftsRealtime } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import { useCurrentBuildingAssignments, useBuildingAssignmentsRealtime, type BuildingAssignment } from '../../hooks/useBuildingAssignments';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useWeather, weatherDescription } from '../../hooks/useWeather';
import { isClosed, isCompletedStatus, addDays, localISODate } from '../../lib/dashboard';

/** "Edwin Sepulveda" → "Edwin S." — TV-wide compact engineer name. */
function shortName(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return fullName;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export default function TvView() {
  // Live data
  useSnapshotRealtime();
  useOncallRealtime();
  useFocusBoardRealtime();
  useRoundsRealtime();
  useShiftsRealtime();
  useBuildingsRealtime();
  useBuildingAssignmentsRealtime();

  const oncallQ      = useUpcomingOncall(12);
  const participantsQ = useOncallParticipants();
  const oncallSettingsQ = useOncallSettings();
  const focusQ       = useActiveFocusItems();
  const pmQ          = useCurrentPmRows();
  const laborQ       = useCurrentLaborRows();
  const roundsQ      = useRounds();
  const shiftsQ      = useShifts();
  const buildingsQ   = useBuildings();
  const assignmentsQ = useCurrentBuildingAssignments();
  const engineersQ   = useEngineers();
  const weatherQ     = useWeather();

  // Tick once a minute so the header clock + freshness stay live.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="tv-root">
      <TvStyles />
      <Header
        now={now}
        snapshotTakenAt={pmQ.data?.[0]?.snapshot_taken_at ?? null}
        oncall={oncallQ.data ?? []}
        weather={weatherQ.data ?? null}
      />
      <main className="tv-grid">
        {/* Top row */}
        <WorkloadPanel
          pmRows={pmQ.data ?? []}
          engineers={engineersQ.data ?? []}
          shifts={shiftsQ.data ?? []}
          now={now}
        />
        <FocusBoardPanel items={focusQ.data ?? []} />
        <EmptyPanel />
        {/* Bottom row */}
        <CrewPanel pmRows={pmQ.data ?? []} laborRows={laborQ.data ?? []} now={now} />
        <BuildingsPanel
          engineers={engineersQ.data ?? []}
          buildings={buildingsQ.data ?? []}
          assignments={assignmentsQ.data ?? []}
          rounds={roundsQ.data ?? []}
          shifts={shiftsQ.data ?? []}
        />
        <OncallPanel
          participants={participantsQ.data ?? []}
          settings={oncallSettingsQ.data ?? null}
          now={now}
        />
      </main>
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

function Header({ now, snapshotTakenAt, oncall, weather }: {
  now: Date;
  snapshotTakenAt: string | null;
  oncall: ReturnType<typeof useUpcomingOncall>['data'] extends infer T ? T : never;
  weather: ReturnType<typeof useWeather>['data'];
}) {
  // "Tue, May 20, 8:42 AM"
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateTimeStr = `${dateStr}, ${timeStr}`;

  // Data age — hours for fresh data, days for stale.
  const ageStr = (() => {
    if (!snapshotTakenAt) return '—';
    const ms = now.getTime() - new Date(snapshotTakenAt).getTime();
    if (ms < 0) return 'fresh';
    const totalHours = Math.floor(ms / 3_600_000);
    if (totalHours < 1) return '< 1h old';
    if (totalHours < 24) return `${totalHours}h old`;
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours > 0 ? `${days}d ${hours}h old` : `${days}d old`;
  })();

  // On-call from the same data the panel uses.
  const list = oncall ?? [];
  const current = list[0]?.is_current ? list[0] : null;
  const next = current ? list[1] : list[0];

  // Weather summary + hot-day highlight.
  const wx = weather ? weatherDescription(weather.weathercode, weather.is_day) : null;
  const isHot = weather?.high != null && weather.high >= 90;

  return (
    <header className="tv-header">
      <div className="tv-h-title">UPark Operation</div>

      <div className="tv-h-oncall">
        <div className="tv-h-oncall-block">
          <span className="tv-h-oncall-label">On-call</span>
          <span className="tv-h-oncall-name">
            {current?.primary ? shortName(current.primary) : '—'}
          </span>
        </div>
        <div className="tv-h-oncall-block tv-h-oncall-next">
          <span className="tv-h-oncall-label">Next</span>
          <span className="tv-h-oncall-name">
            {next?.primary ? shortName(next.primary) : '—'}
          </span>
        </div>
      </div>

      <div className="tv-h-right-cluster">
        {weather && wx && (
          <div className={`tv-h-weather ${isHot ? 'tv-h-weather-hot' : ''}`} title={`${wx.label}${weather.high != null ? ` · high ${Math.round(weather.high)}°F` : ''}`}>
            <span className="tv-h-wx-icon">{isHot ? '🔥' : wx.icon}</span>
            {weather.high != null && weather.low != null ? (
              <span className="tv-h-wx-range">
                <span className={`tv-h-wx-high ${isHot ? 'tv-h-wx-hot' : ''}`}>{Math.round(weather.high)}°</span>
                <span className="tv-h-wx-slash">/</span>
                <span className="tv-h-wx-low">{Math.round(weather.low)}°</span>
              </span>
            ) : (
              <span className="tv-h-wx-temp">{Math.round(weather.temperature)}°F</span>
            )}
            <span className="tv-h-wx-label">{wx.label}</span>
          </div>
        )}
        <div className="tv-h-datetime">{dateTimeStr}</div>
        <div className="tv-h-age">data {ageStr}</div>
      </div>
    </header>
  );
}

// ============================================================================
// Panels
// ============================================================================

function Panel({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <section className="tv-panel" style={accent ? { borderTopColor: accent } : undefined}>
      <h2 className="tv-panel-title">{title}</h2>
      <div className="tv-panel-body">{children}</div>
    </section>
  );
}

function EmptyPanel() {
  return (
    <section className="tv-panel tv-panel-empty">
      <p className="tv-muted" style={{ fontSize: '1.0vw' }}>—</p>
    </section>
  );
}

function WklRow({ row }: { row: { name: string; pm14: number; major46: number } }) {
  return (
    <li>
      <span className="tv-wkl-chip-eng">{shortName(row.name)}</span>
      <span className="tv-wkl-chips">
        {row.pm14 > 0 && (
          <span className="tv-wkl-chip" title="Open PMs (non-Major) due within 14 days">
            PM <span className="tv-wkl-chip-count">{row.pm14}</span>
          </span>
        )}
        {row.major46 > 0 && (
          <span className="tv-wkl-chip tv-wkl-chip-major" title="Major PMs due within 46 days">
            Major <span className="tv-wkl-chip-count">{row.major46}</span>
          </span>
        )}
      </span>
    </li>
  );
}

function OncallPanel({ participants, settings, now }: {
  participants: OncallParticipant[];
  settings: OncallSettings | null;
  now: Date;
}) {
  const grid = useMemo(() => {
    if (!settings?.start_friday || participants.length === 0) return null;

    const N = participants.length;
    const cycles = settings.rotations_per_engineer ?? 4;
    const startIso = settings.start_friday;
    const startD = new Date(startIso + 'T00:00:00');

    // Effective on-call date (7am Friday cutover) → which week is "now".
    const eff = (() => {
      const ms = now.getTime() - 7 * 60 * 60 * 1000;
      const d = new Date(ms);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();

    const isoOf = (offsetDays: number): string => {
      const d = new Date(startD);
      d.setDate(d.getDate() + offsetDays);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const fmtRange = (weekStart: string): string => {
      const d1 = new Date(weekStart + 'T00:00:00');
      const d2 = new Date(d1); d2.setDate(d1.getDate() + 7);
      const m1 = d1.getMonth() + 1, day1 = d1.getDate();
      const m2 = d2.getMonth() + 1, day2 = d2.getDate();
      return `${m1}/${day1}-${m2}/${day2}`;
    };

    // Holiday detection over the relevant year span.
    const yearsNeeded = new Set<number>();
    const earliestDate = new Date(startD); earliestDate.setDate(earliestDate.getDate() - N * 7);
    const latestDate   = new Date(startD); latestDate.setDate(latestDate.getDate() + (cycles + 1) * N * 7);
    yearsNeeded.add(earliestDate.getFullYear());
    yearsNeeded.add(latestDate.getFullYear());
    const holidaySet = new Set<string>();
    for (const y of yearsNeeded) for (const h of usFederalHolidays(y)) holidaySet.add(h);

    const weekHasHoliday = (weekStart: string): boolean => {
      const d = new Date(weekStart + 'T00:00:00');
      for (let i = 0; i < 7; i++) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        if (holidaySet.has(`${y}-${m}-${day}`)) return true;
        d.setDate(d.getDate() + 1);
      }
      return false;
    };

    // Column labels: PREV, CYCLE 1..N, +1 PREVIEW
    const columns: { key: string; label: string; cycleIndex: number }[] = [
      { key: 'prev', label: 'CYCLE 0', cycleIndex: -1 },
    ];
    for (let c = 0; c < cycles; c++) columns.push({ key: `c${c + 1}`, label: `CYCLE ${c + 1}`, cycleIndex: c });
    columns.push({ key: 'preview', label: '+1', cycleIndex: cycles });

    // Build rows
    const rows = participants.map((p) => {
      const cells = columns.map((col) => {
        const offsetDays = (col.cycleIndex * N + p.sort_order - 1) * 7;
        const weekStart = isoOf(offsetDays);
        const beforeEffective = p.effective_from && weekStart < p.effective_from;
        const isCurrent = weekStart === eff || (
          // window check: eff falls inside [weekStart, weekStart+7)
          weekStart <= eff && (() => {
            const d = new Date(weekStart + 'T00:00:00');
            d.setDate(d.getDate() + 7);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return eff < `${y}-${m}-${day}`;
          })()
        );
        return {
          key: col.key,
          weekStart,
          range: beforeEffective ? '—' : fmtRange(weekStart),
          isCurrent: !beforeEffective && isCurrent,
          isHoliday: !beforeEffective && weekHasHoliday(weekStart),
          isPrev: col.cycleIndex === -1,
          isPreview: col.cycleIndex === cycles,
          beforeEffective,
        };
      });
      const rowIsCurrent = cells.some((c) => c.isCurrent);
      return { participant: p, cells, rowIsCurrent };
    });

    return { columns, rows, cycles, N, startIso };
  }, [participants, settings, now]);

  if (!grid) {
    return (
      <Panel title="On-call schedule" accent="#dc2626">
        <p className="tv-muted">No rotation set.</p>
      </Panel>
    );
  }

  return (
    <Panel title="On-call schedule" accent="#dc2626">
      <div className="tv-oncall-sub">
        {grid.N} engineers · {grid.cycles} cycles + 1 preview
      </div>
      <div className="tv-oncall-scroll">
        <table className="tv-oncall-grid">
          <thead>
            <tr>
              <th className="tv-oncall-eng-th">Engineer</th>
              {grid.columns.map((c) => (
                <th key={c.key} className={c.key === 'preview' ? 'tv-oncall-preview-th' : c.key === 'prev' ? 'tv-oncall-prev-th' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.participant.id} className={r.rowIsCurrent ? 'tv-oncall-row-active' : undefined}>
                <td className="tv-oncall-eng-td">
                  {shortName(r.participant.full_name)}
                  {r.rowIsCurrent && <span className="tv-oncall-onbadge">ON</span>}
                </td>
                {r.cells.map((c) => (
                  <td
                    key={c.key}
                    className={[
                      'tv-oncall-cell',
                      c.isPrev || c.isPreview ? 'tv-oncall-cell-side' : '',
                      c.isHoliday ? 'tv-oncall-cell-holiday' : '',
                      c.isCurrent ? 'tv-oncall-cell-active' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {c.range}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** US federal holidays for a given year, returned as YYYY-MM-DD strings. */
function usFederalHolidays(year: number): string[] {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const nthWeekday = (month: number, weekday: number, n: number) => {
    const first = new Date(year, month - 1, 1);
    const offset = ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7;
    return fmt(month, 1 + offset);
  };
  const lastWeekday = (month: number, weekday: number) => {
    const last = new Date(year, month, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return fmt(month, last.getDate() - offset);
  };
  return [
    fmt(1, 1),               // New Year's Day
    nthWeekday(1, 1, 3),     // MLK Day — 3rd Monday of January
    nthWeekday(2, 1, 3),     // Presidents Day — 3rd Monday of February
    lastWeekday(5, 1),       // Memorial Day — last Monday of May
    fmt(6, 19),              // Juneteenth
    fmt(7, 4),               // Independence Day
    nthWeekday(9, 1, 1),     // Labor Day — 1st Monday of September
    nthWeekday(10, 1, 2),    // Columbus Day — 2nd Monday of October
    fmt(11, 11),             // Veterans Day
    nthWeekday(11, 4, 4),    // Thanksgiving — 4th Thursday of November
    fmt(12, 25),             // Christmas
  ];
}

function FocusBoardPanel({ items }: { items: ReturnType<typeof useActiveFocusItems>['data'] }) {
  const list = (items ?? []).slice(0, 5);
  const levelColor: Record<string, string> = {
    info: '#0ea5e9', warn: '#f59e0b', urgent: '#dc2626', critical: '#7f1d1d',
  };
  return (
    <Panel title="Focus board" accent="#0ea5e9">
      {list.length === 0 ? (
        <p className="tv-muted">No announcements.</p>
      ) : (
        <ul className="tv-focus-list">
          {list.map((it) => (
            <li key={it.id}>
              <span className="tv-focus-dot" style={{ background: levelColor[it.level] ?? '#94a3b8' }} />
              {it.title && <strong>{it.title} · </strong>}
              {it.body}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CrewPanel({ pmRows, laborRows, now }: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  laborRows: NonNullable<ReturnType<typeof useCurrentLaborRows>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const winEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const winStart = addDays(winEnd, -7);

    const byTech = new Map<string, { pms: number; hours: number }>();
    for (const r of pmRows) {
      if (!isCompletedStatus(r.status)) continue;
      const ts = r.updated_at_cmms;
      if (!ts) continue;
      const d = new Date(ts);
      if (d < winStart || d >= winEnd) continue;
      const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
      const cur = byTech.get(a) ?? { pms: 0, hours: 0 };
      cur.pms++;
      byTech.set(a, cur);
    }
    for (const l of laborRows) {
      if (!l.week_start) continue;
      const ws = new Date(l.week_start + 'T00:00:00');
      const we = addDays(ws, 7);
      if (ws >= winEnd || we <= winStart) continue;
      const a = (l.assigned_to_name ?? '').trim() || 'Unassigned';
      const cur = byTech.get(a) ?? { pms: 0, hours: 0 };
      cur.hours += l.labor_hours ?? 0;
      byTech.set(a, cur);
    }
    return Array.from(byTech.entries())
      .map(([name, v]) => ({ name, pms: v.pms, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours || b.pms - a.pms)
      .slice(0, 6);
  }, [pmRows, laborRows, now]);

  const maxHours = data.reduce((m, d) => Math.max(m, d.hours), 0) || 1;

  return (
    <Panel title="Crew · last 7 days" accent="#8b5cf6">
      {data.length === 0 ? (
        <p className="tv-muted">No data.</p>
      ) : (
        <ul className="tv-crew-list">
          {data.map((c) => (
            <li key={c.name}>
              <div className="tv-bar-bg">
                <div className="tv-bar-fill" style={{ width: `${(c.hours / maxHours) * 100}%` }} />
              </div>
              <span className="tv-crew-name">{shortName(c.name)}</span>
              <span className="tv-crew-stat">{c.pms} PM</span>
              <span className="tv-crew-stat">{c.hours.toFixed(1)}h</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WorkloadPanel({ pmRows, engineers, shifts, now }: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  engineers: EngineerRow[];
  shifts: NonNullable<ReturnType<typeof useShifts>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const todayD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = localISODate(todayD);
    const cutoff14 = new Date(todayD); cutoff14.setDate(todayD.getDate() + 14);
    const cutoff46 = new Date(todayD); cutoff46.setDate(todayD.getDate() + 46);
    const cutoff14Str = localISODate(cutoff14);
    const cutoff46Str = localISODate(cutoff46);

    // CMMS-name → display-name (Eduin → Edwin, etc.) and display-name → shift.
    const displayByCmms = new Map<string, string>();
    const shiftByDisplay = new Map<string, string | null>();
    for (const e of engineers) {
      if (!e.active || e.role !== 'engineer') continue;
      if (e.cmms_assignee_name) displayByCmms.set(e.cmms_assignee_name, e.full_name);
      shiftByDisplay.set(e.full_name, e.shift_id);
    }
    const displayOf = (raw: string | null): string => {
      const n = (raw ?? '').trim() || 'Unassigned';
      return displayByCmms.get(n) ?? n;
    };

    const byTechToday = new Map<string, number>();
    const pm14 = new Map<string, number>();      // non-Major, due within 14d (incl. today)
    const major46 = new Map<string, number>();   // Major, due within 46d (incl. today)
    let overdue = 0;

    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      const name = displayOf(r.assigned_to_name);
      const isMajor = r.pm_type === 'Major';

      // Top section: overdue + due today, per-tech count.
      if (r.due_date < todayStr) {
        overdue++;
        byTechToday.set(name, (byTechToday.get(name) ?? 0) + 1);
      } else if (r.due_date === todayStr) {
        byTechToday.set(name, (byTechToday.get(name) ?? 0) + 1);
      }

      // Bottom section: forward-looking windows.
      if (r.due_date >= todayStr && r.due_date <= cutoff14Str && !isMajor) {
        pm14.set(name, (pm14.get(name) ?? 0) + 1);
      }
      if (r.due_date >= todayStr && r.due_date <= cutoff46Str && isMajor) {
        major46.set(name, (major46.get(name) ?? 0) + 1);
      }
    }

    const todayCards = Array.from(byTechToday.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5);

    const techs = new Set<string>([...pm14.keys(), ...major46.keys()]);
    const upcomingRows = Array.from(techs)
      .map((name) => ({
        name,
        pm14:    pm14.get(name) ?? 0,
        major46: major46.get(name) ?? 0,
        shift_id: shiftByDisplay.get(name) ?? null,
      }))
      .sort((a, b) =>
        (b.pm14 + b.major46) - (a.pm14 + a.major46)
        || b.pm14 - a.pm14
        || a.name.localeCompare(b.name),
      );

    // Split by shift: AM = first shift (sort_order 1), PM = second shift.
    const orderedShifts = shifts.slice().sort((a, b) => a.sort_order - b.sort_order);
    const amShiftId = orderedShifts[0]?.id ?? null;
    const pmShiftId = orderedShifts[1]?.id ?? null;
    const amLabel   = orderedShifts[0]?.name ?? 'AM';
    const pmLabel   = orderedShifts[1]?.name ?? 'PM';

    const am = upcomingRows.filter((r) => r.shift_id === amShiftId);
    const pm = upcomingRows.filter((r) => r.shift_id === pmShiftId);
    const other = upcomingRows.filter((r) => r.shift_id !== amShiftId && r.shift_id !== pmShiftId);

    const pm14Total    = Array.from(pm14.values()).reduce((s, v) => s + v, 0);
    const major46Total = Array.from(major46.values()).reduce((s, v) => s + v, 0);

    return { todayCards, overdue, am, pm, other, amLabel, pmLabel, pm14Total, major46Total };
  }, [pmRows, engineers, shifts, now]);

  const todayCount = data.todayCards.reduce((s, c) => s + c.count, 0);

  return (
    <Panel title="Workload" accent="#f59e0b">
      <div className="tv-workload-top">
        <div className="tv-workload-section-label">
          Due today + overdue · <strong style={{ color: '#f8fafc' }}>{todayCount}</strong>
          {data.overdue > 0 && (
            <span className="tv-warn" style={{ marginLeft: '0.6vw' }}>⚠ {data.overdue} overdue</span>
          )}
        </div>
        {data.todayCards.length === 0 ? (
          <p className="tv-muted" style={{ fontSize: '1.0vw' }}>Nothing on the board.</p>
        ) : (
          <ul className="tv-today-list">
            {data.todayCards.map((c) => (
              <li key={c.name}>
                <span className="tv-today-count">{c.count}</span>
                <span className="tv-today-name">{shortName(c.name)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="tv-workload-divider" />
      <div className="tv-workload-bottom">
        <div className="tv-workload-section-label">
          Next 14d · <strong style={{ color: '#f8fafc' }}>{data.pm14Total}</strong>
          <span style={{ margin: '0 0.4vw', color: '#475569' }}>|</span>
          <span style={{ color: '#a78bfa' }}>◆ Major 46d · <strong>{data.major46Total}</strong></span>
        </div>
        {data.am.length === 0 && data.pm.length === 0 && data.other.length === 0 ? (
          <p className="tv-muted" style={{ fontSize: '1.0vw' }}>Nothing scheduled.</p>
        ) : (
          <div className="tv-wkl-shift-grid">
            <div className="tv-wkl-shift-col">
              <div className="tv-wkl-shift-label">{data.amLabel} shift</div>
              <ul className="tv-wkl-chip-list">
                {data.am.map((r) => <WklRow key={r.name} row={r} />)}
              </ul>
            </div>
            <div className="tv-wkl-shift-col">
              <div className="tv-wkl-shift-label">{data.pmLabel} shift</div>
              <ul className="tv-wkl-chip-list">
                {data.pm.map((r) => <WklRow key={r.name} row={r} />)}
              </ul>
            </div>
            {data.other.length > 0 && (
              <div className="tv-wkl-shift-col tv-wkl-shift-other">
                <div className="tv-wkl-shift-label">No shift</div>
                <ul className="tv-wkl-chip-list">
                  {data.other.map((r) => <WklRow key={r.name} row={r} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}


function BuildingsPanel({ engineers, buildings, assignments, rounds, shifts }: {
  engineers: EngineerRow[];
  buildings: Building[];
  assignments: BuildingAssignment[];
  rounds: NonNullable<ReturnType<typeof useRounds>['data']>;
  shifts: NonNullable<ReturnType<typeof useShifts>['data']>;
}) {
  const data = useMemo(() => {
    const bldById = new Map(buildings.map((b) => [b.id, b]));

    // Per-user primary/coverage assignments
    const primaryByUser  = new Map<string, Building[]>();
    const coverageByUser = new Map<string, Building[]>();
    for (const a of assignments) {
      const b = bldById.get(a.building_id);
      if (!b) continue;
      const map = a.role_in_building === 'primary' ? primaryByUser
                : a.role_in_building === 'backup'  ? coverageByUser
                : null;
      if (!map) continue;
      const list = map.get(a.user_id) ?? [];
      list.push(b);
      map.set(a.user_id, list);
    }
    const sortBld = (list: Building[]) =>
      list.sort((x, y) =>
        (x.short_code ?? x.code).localeCompare(y.short_code ?? y.code, undefined, { numeric: true }),
      );

    // Round currently assigned to each user (latest single open assignment).
    const roundByUser = new Map<string, NonNullable<ReturnType<typeof useRounds>['data']>[number]>();
    for (const r of rounds) {
      if (r.current) roundByUser.set(r.current.user_id, r);
    }

    // Group engineers (non-lead) by shift in shift sort_order.
    const orderedShifts = shifts.slice().sort((a, b) => a.sort_order - b.sort_order);
    const shiftGroups = orderedShifts.map((s, idx) => ({
      shift: s,
      bandLabel: idx === 0 ? 'AM' : idx === 1 ? 'PM' : s.name,
      engineers: engineers
        .filter((e) => e.active && e.role === 'engineer' && !e.is_lead && e.shift_id === s.id)
        .map((e) => ({
          user_id: e.user_id,
          name: e.full_name,
          primary: sortBld(primaryByUser.get(e.user_id) ?? []),
          round:   roundByUser.get(e.user_id) ?? null,
        }))
        .filter((e) => e.primary.length > 0 || e.round)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.engineers.length > 0);

    // Leads: full-coverage row at the bottom.
    const leads = engineers
      .filter((e) => e.active && e.role === 'engineer' && e.is_lead)
      .map((e) => ({
        user_id: e.user_id,
        name: e.full_name,
        coverage: sortBld(coverageByUser.get(e.user_id) ?? []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { shiftGroups, leads };
  }, [engineers, buildings, assignments, rounds, shifts]);

  const fmtCodes = (list: Building[]) =>
    list.map((b) => b.short_code ?? b.code).join(' · ');

  return (
    <Panel title="Buildings · rounds + assignments" accent="#3b82f6">
      <div className="tv-bldgs">
        <div className="tv-bldgs-headerrow">
          <div className="tv-bldgs-colhead">Rounds</div>
          <div className="tv-bldgs-colhead">Assignments</div>
        </div>
        {data.shiftGroups.length === 0 ? (
          <p className="tv-muted">No assignments.</p>
        ) : (
          data.shiftGroups.map((g) => (
            <div key={g.shift.id} className="tv-bldgs-band">
              <div className="tv-bldgs-band-label">{g.bandLabel} shift</div>
              <div className="tv-bldgs-cols">
                {/* Rounds (left) */}
                <ul className="tv-bldgs-col">
                  {g.engineers.map((e) => (
                    <li key={`r-${e.user_id}`}>
                      <span className="tv-bldgs-eng">{shortName(e.name)}</span>
                      <span className="tv-bldgs-codes">
                        {e.round ? e.round.stops.map((s) => s.short_code ?? s.code).join(' · ') : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                {/* Assignments (right) */}
                <ul className="tv-bldgs-col">
                  {g.engineers.map((e) => (
                    <li key={`a-${e.user_id}`}>
                      <span className="tv-bldgs-eng">{shortName(e.name)}</span>
                      <span className="tv-bldgs-codes">
                        {e.primary.length > 0 ? fmtCodes(e.primary) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))
        )}
        {data.leads.length > 0 && (
          <div className="tv-bldgs-leads">
            {data.leads.map((l) => (
              <div key={l.user_id} className="tv-bldgs-lead-row">
                <span className="tv-bldgs-lead-name">★ {shortName(l.name)}</span>
                <span className="tv-bldgs-lead-codes">
                  {l.coverage.length > 0 ? fmtCodes(l.coverage) : 'no coverage set'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}



// ============================================================================
// Styles
// ============================================================================

function TvStyles() {
  return (
    <style>{`
      .tv-root {
        min-height: 100vh;
        background: #0b1220;
        color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        padding: 1.2vw;
        display: flex;
        flex-direction: column;
        gap: 1vw;
      }
      .tv-header {
        display: flex;
        align-items: center;
        padding: 0.3vw 0.8vw;
        border-bottom: 2px solid #1e293b;
        gap: 1.0vw;
        flex-wrap: nowrap;
        white-space: nowrap;
      }
      .tv-h-title {
        font-size: 1.4vw;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #f8fafc;
        flex: 0 0 auto;
      }

      /* On-call: two side-by-side blocks within the same row */
      .tv-h-oncall {
        display: flex; align-items: baseline; gap: 0.85vw;
        flex: 0 0 auto;
      }
      .tv-h-oncall-block { display: inline-flex; align-items: baseline; gap: 0.4vw; }
      .tv-h-oncall-label {
        font-size: 0.65vw; text-transform: uppercase; letter-spacing: 0.14em;
        color: #64748b;
      }
      .tv-h-oncall-name { font-size: 1.1vw; font-weight: 700; color: #fca5a5; }
      .tv-h-oncall-next .tv-h-oncall-name { color: #94a3b8; font-size: 0.95vw; font-weight: 600; }

      /* Right-side cluster: weather → date/time → data age */
      .tv-h-right-cluster {
        display: flex; align-items: center; gap: 0.7vw;
        margin-left: auto;
        flex: 0 0 auto;
      }

      /* Weather chip (smaller than before, sits beside the date) */
      .tv-h-weather {
        display: flex; align-items: baseline; gap: 0.35vw;
        padding: 0.15vw 0.55vw;
        border: 1px solid #1e293b;
        border-radius: 5px;
        background: rgba(14, 165, 233, 0.08);
        flex: 0 0 auto;
      }
      .tv-h-weather-hot {
        background: rgba(239, 68, 68, 0.12);
        border-color: rgba(239, 68, 68, 0.5);
        animation: tv-hot-pulse 2.5s ease-in-out infinite;
      }
      @keyframes tv-hot-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        50%      { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18); }
      }
      .tv-h-wx-icon { font-size: 1.25vw; line-height: 1; }
      .tv-h-wx-range { display: inline-flex; align-items: baseline; gap: 0.12vw; }
      .tv-h-wx-high {
        font-size: 1.25vw; font-weight: 700; color: #fbbf24;
        font-variant-numeric: tabular-nums;
      }
      .tv-h-wx-hot { color: #f87171; }
      .tv-h-wx-slash { color: #475569; font-size: 0.95vw; }
      .tv-h-wx-low {
        font-size: 0.95vw; font-weight: 500; color: #93c5fd;
        font-variant-numeric: tabular-nums;
      }
      .tv-h-wx-temp { font-size: 1.25vw; font-weight: 700; color: #f8fafc; font-variant-numeric: tabular-nums; }
      .tv-h-wx-label { font-size: 0.72vw; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }

      /* Date/time + age */
      .tv-h-datetime {
        font-size: 0.95vw; color: #cbd5e1; font-variant-numeric: tabular-nums;
        flex: 0 0 auto;
      }
      .tv-h-age {
        font-size: 0.8vw; color: #64748b; font-variant-numeric: tabular-nums;
        flex: 0 0 auto;
      }

      .tv-grid {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: 1vw;
        min-height: 0;
      }
      .tv-panel {
        background: #111827;
        border: 1px solid #1e293b;
        border-top: 4px solid #334155;
        border-radius: 8px;
        padding: 1vw 1.2vw;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .tv-panel-title {
        font-size: 1.0vw;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin: 0 0 0.6vw;
      }
      .tv-panel-body { flex: 1; min-height: 0; overflow: hidden; }
      .tv-muted { color: #64748b; font-size: 1.3vw; font-style: italic; }

      .tv-bigname { font-size: 3.2vw; font-weight: 700; line-height: 1.1; color: #f8fafc; }
      .tv-bignum  { font-size: 4.0vw; font-weight: 700; color: #f8fafc; line-height: 1; }
      .tv-sub     { color: #94a3b8; font-size: 1.2vw; margin-left: 0.4em; }
      .tv-warn    { color: #f59e0b; font-size: 1.2vw; font-weight: 600; margin-bottom: 0.4em; }

      /* On-call schedule — rotation grid (engineer rows × cycle columns) */
      .tv-oncall-sub {
        font-size: 0.7vw;
        color: #94a3b8;
        margin-bottom: 0.3vw;
      }
      .tv-oncall-scroll { overflow: hidden; }
      .tv-oncall-grid {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.72vw;
        font-variant-numeric: tabular-nums;
        table-layout: fixed;
      }
      .tv-oncall-grid thead th {
        font-size: 0.6vw;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #64748b;
        text-align: left;
        padding: 0 0.25vw 0.25vw;
        border-bottom: 1px solid #1e293b;
        white-space: nowrap;
      }
      .tv-oncall-grid .tv-oncall-eng-th { width: 5.5vw; color: #94a3b8; }
      .tv-oncall-grid .tv-oncall-prev-th,
      .tv-oncall-grid .tv-oncall-preview-th { color: #475569; font-style: italic; }
      .tv-oncall-grid tbody td {
        padding: 0.2vw 0.25vw;
        border-bottom: 1px solid rgba(30, 41, 59, 0.5);
        color: #e2e8f0;
        white-space: nowrap;
      }
      .tv-oncall-grid tbody tr:last-child td { border-bottom: none; }
      .tv-oncall-eng-td {
        color: #f8fafc;
        font-weight: 600;
        font-size: 0.85vw;
        position: relative;
      }
      .tv-oncall-cell-side { color: #64748b; font-style: italic; }
      .tv-oncall-cell-holiday { color: #fca5a5; }
      .tv-oncall-cell-active {
        background: rgba(34, 197, 94, 0.18);
        border: 1px solid #22c55e;
        border-radius: 3px;
        color: #4ade80;
        font-weight: 700;
      }
      .tv-oncall-row-active { background: rgba(34, 197, 94, 0.06); }
      .tv-oncall-row-active .tv-oncall-eng-td { color: #4ade80; }
      .tv-oncall-onbadge {
        display: inline-block;
        font-size: 0.55vw;
        font-weight: 700;
        background: #16a34a;
        color: #fff;
        padding: 0.05vw 0.3vw;
        border-radius: 3px;
        margin-left: 0.3vw;
        letter-spacing: 0.1em;
        vertical-align: 0.1em;
      }

      .tv-focus-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.6vw; }
      .tv-focus-list li { font-size: 1.25vw; line-height: 1.35; display: flex; align-items: baseline; gap: 0.5vw; }
      .tv-focus-dot { width: 0.7vw; height: 0.7vw; border-radius: 50%; flex: 0 0 auto; display: inline-block; }

      .tv-crew-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4vw; }
      .tv-crew-list li { display: grid; grid-template-columns: 1fr 7.5vw 3.2vw 3.6vw; align-items: center; gap: 0.5vw; font-size: 1.0vw; }
      .tv-bar-bg { background: #1e293b; height: 1.3vw; border-radius: 4px; overflow: hidden; }
      .tv-bar-fill { background: linear-gradient(90deg, #8b5cf6, #a78bfa); height: 100%; }
      .tv-crew-name { font-weight: 500; }
      .tv-crew-stat { color: #94a3b8; text-align: right; font-variant-numeric: tabular-nums; }

      .tv-today-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4vw; }
      .tv-today-list li { display: flex; align-items: baseline; gap: 0.6vw; font-size: 1.3vw; }
      .tv-today-count { font-weight: 700; color: #f59e0b; font-size: 1.7vw; min-width: 2.4vw; text-align: right; font-variant-numeric: tabular-nums; }
      .tv-today-name { color: #e2e8f0; }

      /* Combined Buildings panel */
      .tv-bldgs { display: flex; flex-direction: column; gap: 0.5vw; }
      .tv-bldgs-headerrow {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6vw;
        font-size: 0.75vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
        padding-bottom: 0.2vw;
        border-bottom: 1px solid #1e293b;
      }
      .tv-bldgs-colhead { padding: 0 0.2vw; }
      .tv-bldgs-band { }
      .tv-bldgs-band-label {
        font-size: 0.8vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #94a3b8;
        margin: 0.3vw 0 0.2vw;
      }
      .tv-bldgs-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6vw; }
      .tv-bldgs-col { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2vw; }
      .tv-bldgs-col li {
        display: flex;
        flex-direction: column;
        font-size: 0.85vw;
        line-height: 1.25;
      }
      .tv-bldgs-eng { font-weight: 600; color: #f8fafc; }
      .tv-bldgs-codes { color: #e2e8f0; font-variant-numeric: tabular-nums; }
      .tv-bldgs-leads {
        margin-top: 0.3vw;
        padding-top: 0.4vw;
        border-top: 1px dashed #334155;
        display: flex;
        flex-direction: column;
        gap: 0.2vw;
      }
      .tv-bldgs-lead-row { display: flex; gap: 0.6vw; align-items: baseline; font-size: 0.7vw; }
      .tv-bldgs-lead-name { color: #d4a017; font-weight: 600; flex: 0 0 auto; min-width: 5.5vw; }
      .tv-bldgs-lead-codes { color: #94a3b8; font-variant-numeric: tabular-nums; flex: 1; }

      /* Workload panel (Due today on top, Upcoming 9d on bottom) */
      .tv-workload-top { display: flex; flex-direction: column; gap: 0.25vw; }
      .tv-workload-bottom { display: flex; flex-direction: column; gap: 0.25vw; }
      .tv-workload-divider {
        height: 1px;
        background: #1e293b;
        margin: 0.4vw 0;
      }
      .tv-workload-section-label {
        font-size: 0.78vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
      }
      /* Compact override for the top per-tech list living inside Workload */
      .tv-workload-top .tv-today-list { gap: 0.25vw; }
      .tv-workload-top .tv-today-list li { font-size: 1.1vw; }
      .tv-workload-top .tv-today-count { font-size: 1.4vw; min-width: 2.2vw; }

      /* Workload bottom: per-tech chip list (§03-style chips), split by shift */
      .tv-wkl-shift-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6vw 0.8vw;
      }
      .tv-wkl-shift-col { min-width: 0; }
      .tv-wkl-shift-other { grid-column: 1 / -1; }
      .tv-wkl-shift-label {
        font-size: 0.75vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
        margin-bottom: 0.25vw;
      }
      .tv-wkl-chip-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25vw; }
      .tv-wkl-chip-list li {
        display: flex;
        align-items: center;
        gap: 0.4vw;
        font-size: 0.95vw;
      }
      .tv-wkl-chip-eng {
        color: #e2e8f0;
        font-weight: 500;
        min-width: 5vw;
        flex: 0 0 auto;
      }
      .tv-wkl-chips { display: inline-flex; flex-wrap: wrap; gap: 0.25vw; }
      .tv-wkl-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25vw;
        padding: 0.05vw 0.5vw;
        border: 1px solid #334155;
        border-radius: 4px;
        font-size: 0.85vw;
        background: #1e293b;
        color: #e2e8f0;
        white-space: nowrap;
      }
      .tv-wkl-chip-count {
        color: #94a3b8;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .tv-wkl-chip-major {
        border-color: rgba(124, 58, 237, 0.5);
        background: rgba(124, 58, 237, 0.15);
        color: #c4b5fd;
      }
      .tv-wkl-chip-major .tv-wkl-chip-count { color: #a78bfa; }

      /* Empty placeholder panel */
      .tv-panel-empty {
        background: #0e1626;
        border-style: dashed;
        opacity: 0.4;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Upcoming PMs (used inside Workload) */
      .tv-upcoming-head { display: flex; align-items: baseline; gap: 0.6vw; margin-bottom: 0.4vw; }
      .tv-upcoming-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3vw; }
      .tv-upcoming-list li {
        display: grid;
        grid-template-columns: 6vw 1fr 2vw;
        gap: 0.5vw;
        align-items: center;
        font-size: 1.0vw;
      }
      .tv-upcoming-day { color: #94a3b8; }
      .tv-upcoming-bar-bg { background: #1e293b; height: 1.1vw; border-radius: 4px; overflow: hidden; }
      .tv-upcoming-bar-fill { background: linear-gradient(90deg, #10b981, #34d399); height: 100%; }
      .tv-upcoming-count { color: #e2e8f0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
    `}</style>
  );
}
