// /tv — Shop-floor TV view. Static 3-column grid, large fonts, no nav chrome.
// Five panels for the morning huddle / glanceable read.
//
// Layout (3 cols × 2 rows; left col spans both rows):
//   ┌── header ──────────────────────────────────────────────────────────┐
//   │ UPark Operation · On-call · Weather · ddd MMM D · data age         │
//   ├──────────────────┬──────────────────┬──────────────────────────────┤
//   │ WORKLOAD +       │ BMS HEALTH       │ §11 OVERTIME                 │
//   │ PERFORMANCE      │ §08 + §09 + §10  │  (open posts, read-only)     │
//   │  · Workload      ├──────────────────┼──────────────────────────────┤
//   │  · Crew 7d       │ BUILDINGS        │ ON-CALL SCHEDULE             │
//   │  · Recent closes │ (rounds + assign)│ (whole table)                │
//   └──────────────────┴──────────────────┴──────────────────────────────┘
//
// Focus-board announcements still surface via the header strip (top-2);
// the standalone panel got displaced when BMS health moved in.
import { useEffect, useMemo, useState } from 'react';
import { useUpcomingOncall, useOncallRealtime, useOncallParticipants, useOncallSettings, useOncallNotes, useOncallNotesRealtime, type OncallParticipant, type OncallSettings, type OncallNote } from '../../hooks/useOncall';
import { useActiveFocusItems, useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { useCurrentPmRows, useCurrentLaborRows, useLaborDaily, useRecentPmCloses, useRecentWoCloses, type PmCloseEvent, type WoCloseEvent } from '../../hooks/useCurrentSnapshots';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { useRounds, useRoundsRealtime } from '../../hooks/useRounds';
import { useShifts, useShiftsRealtime } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import { useCurrentBuildingAssignments, useBuildingAssignmentsRealtime, type BuildingAssignment } from '../../hooks/useBuildingAssignments';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useWeather, weatherDescription } from '../../hooks/useWeather';
import { useDeltaAlarmsCurrent, useDeltaPollState } from '../../hooks/useDeltaAlarms';
import { useEmailAlarmsOpen, useEmailPollState, useBmsHeartbeats } from '../../hooks/useEmailAlarms';
import {
  useOvertimePosts,
  useOvertimeRealtime,
  OVERTIME_CATEGORY_LABELS,
  OVERTIME_CATEGORY_ORDER,
  type OvertimeCategory,
  type OvertimePost,
} from '../../hooks/useOvertime';
import { isClosed, addDays, localISODate } from '../../lib/dashboard';

/** "data 3h old" / "fresh" / "—" — hours for fresh data, days for stale. */
function formatDataAge(now: Date, ts: string | null | undefined): string {
  if (!ts) return '—';
  const ms = now.getTime() - new Date(ts).getTime();
  if (ms < 0) return 'fresh';
  const totalHours = Math.floor(ms / 3_600_000);
  if (totalHours < 1) return '< 1h';
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

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
  useOncallNotesRealtime();
  useFocusBoardRealtime();
  useRoundsRealtime();
  useShiftsRealtime();
  useBuildingsRealtime();
  useBuildingAssignmentsRealtime();

  const oncallQ      = useUpcomingOncall(12);
  const participantsQ = useOncallParticipants();
  const oncallSettingsQ = useOncallSettings();
  const oncallNotesQ = useOncallNotes();
  const focusQ       = useActiveFocusItems();
  const pmQ          = useCurrentPmRows();
  const laborQ       = useCurrentLaborRows();      // kept only for labor-data freshness display
  const closesQ     = useRecentPmCloses(14);       // 7d window + 7d prior for delta arrows
  const woClosesQ   = useRecentWoCloses(14);       // for the "recent closes" list (mixed w/ PMs)
  const laborDailyQ = useLaborDaily(14);
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
        oncall={oncallQ.data ?? []}
        weather={weatherQ.data ?? null}
        focusItems={focusQ.data ?? []}
      />
      <main className="tv-grid">
        {/* Left column: one tall panel spanning both rows */}
        <WorkloadPerformancePanel
          pmRows={pmQ.data ?? []}
          laborRows={laborQ.data ?? []}
          engineers={engineersQ.data ?? []}
          shifts={shiftsQ.data ?? []}
          closes={closesQ.data ?? []}
          woCloses={woClosesQ.data ?? []}
          laborDaily={laborDailyQ.data ?? []}
          now={now}
        />
        {/* Middle column — top: consolidated BMS health (§08 + §09 + §10) */}
        <BmsHealthPanel />
        {/* Right column top — §11 Upcoming overtime (read-only) */}
        <OvertimeTvPanel />
        {/* Middle column bottom */}
        <BuildingsPanel
          engineers={engineersQ.data ?? []}
          buildings={buildingsQ.data ?? []}
          assignments={assignmentsQ.data ?? []}
          rounds={roundsQ.data ?? []}
          shifts={shiftsQ.data ?? []}
        />
        {/* Right column bottom */}
        <OncallPanel
          participants={participantsQ.data ?? []}
          settings={oncallSettingsQ.data ?? null}
          notes={oncallNotesQ.data ?? []}
          now={now}
        />
      </main>
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

function Header({ now, oncall, weather, focusItems }: {
  now: Date;
  oncall: ReturnType<typeof useUpcomingOncall>['data'] extends infer T ? T : never;
  weather: ReturnType<typeof useWeather>['data'];
  focusItems: ReturnType<typeof useActiveFocusItems>['data'];
}) {
  // "Tue, May 20, 8:42 AM"
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateTimeStr = `${dateStr}, ${timeStr}`;

  // On-call from the same data the panel uses.
  const list = oncall ?? [];
  const current = list[0]?.is_current ? list[0] : null;
  const next = current ? list[1] : list[0];

  // Weather summary + hot-day highlight.
  const wx = weather ? weatherDescription(weather.weathercode, weather.is_day) : null;
  const isHot = weather?.high != null && weather.high >= 90;

  // Top-2 announcements from the focus board, shown in the header center.
  const announcements = (focusItems ?? []).slice(0, 2);
  const annColor: Record<string, string> = {
    info: '#0ea5e9', warn: '#f59e0b', urgent: '#dc2626', critical: '#7f1d1d',
  };

  return (
    <header className="tv-header">
      <div className="tv-h-left">
        <div className="tv-h-title">UPark</div>
        <div className="tv-h-oncall">
          <div className="tv-h-oncall-block">
            <span className="tv-h-oncall-label">On-call</span>
            <span className="tv-h-oncall-name tv-h-oncall-current">
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
      </div>

      <div className="tv-h-center">
        {announcements.length > 0 && (
          <ul className="tv-h-announcements">
            {announcements.map((a) => (
              <li key={a.id}>
                <span className="tv-h-ann-dot" style={{ background: annColor[a.level] ?? '#94a3b8' }} />
                {a.title && <strong>{a.title}: </strong>}
                <span className="tv-h-ann-body">{a.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tv-h-right-cluster">
        {weather && wx && (
          <div className={`tv-h-weather ${isHot ? 'tv-h-weather-hot' : ''}`} title={`${wx.label}${weather.high != null ? ` · high ${Math.round(weather.high)}°F` : ''}`}>
            <span className="tv-h-wx-icon">{isHot ? '🔥' : wx.icon}</span>
            <span className="tv-h-wx-range">
              {weather.high != null && (
                <>
                  <span className={`tv-h-wx-high ${isHot ? 'tv-h-wx-hot' : ''}`}>{Math.round(weather.high)}°</span>
                  <span className="tv-h-wx-slash">/</span>
                </>
              )}
              <span className="tv-h-wx-now">{Math.round(weather.temperature)}°</span>
              {weather.low != null && (
                <>
                  <span className="tv-h-wx-slash">/</span>
                  <span className="tv-h-wx-low">{Math.round(weather.low)}°</span>
                </>
              )}
            </span>
            <span className="tv-h-wx-label">{wx.label}</span>
          </div>
        )}
        <div className="tv-h-datetime">{dateTimeStr}</div>
      </div>
    </header>
  );
}

// ============================================================================
// Panels
// ============================================================================

function Panel({ title, children, accent, meta }: { title: string; children: React.ReactNode; accent?: string; meta?: React.ReactNode }) {
  return (
    <section className="tv-panel" style={accent ? { borderTopColor: accent } : undefined}>
      <div className="tv-panel-titlerow">
        <h2 className="tv-panel-title">{title}</h2>
        {meta && <div className="tv-panel-meta">{meta}</div>}
      </div>
      <div className="tv-panel-body">{children}</div>
    </section>
  );
}

/** Combined Workload + Performance panel — spans both rows in the left column.
 *  Contains three sub-sections: Workload (top), Crew last 7d (middle),
 *  and Top 5 recent closes (bottom). Mirrors the §00 + Workload combo from
 *  the manager dashboard, tailored for TV-wall legibility. */
function WorkloadPerformancePanel({
  pmRows, laborRows, engineers, shifts, closes, woCloses, laborDaily, now,
}: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  laborRows: NonNullable<ReturnType<typeof useCurrentLaborRows>['data']>;
  engineers: EngineerRow[];
  shifts: NonNullable<ReturnType<typeof useShifts>['data']>;
  closes: NonNullable<ReturnType<typeof useRecentPmCloses>['data']>;
  woCloses: NonNullable<ReturnType<typeof useRecentWoCloses>['data']>;
  laborDaily: NonNullable<ReturnType<typeof useLaborDaily>['data']>;
  now: Date;
}) {
  const pmAge = formatDataAge(now, pmRows[0]?.snapshot_taken_at ?? null);
  const laborLatest = laborRows.reduce<string | null>((acc, r) => {
    const ts = r.snapshot_taken_at;
    if (!ts) return acc;
    return acc && acc >= ts ? acc : ts;
  }, null);
  const laborAge = formatDataAge(now, laborLatest);

  // Top 5 most recent closes, interleaving PMs and WOs by completed_on desc.
  const recentCloses = useMemo(() => {
    type Row =
      | { kind: 'PM'; ev: PmCloseEvent }
      | { kind: 'WO'; ev: WoCloseEvent };
    const all: Row[] = [
      ...closes.map((ev) => ({ kind: 'PM' as const, ev })),
      ...woCloses.map((ev) => ({ kind: 'WO' as const, ev })),
    ];
    all.sort((a, b) => b.ev.completed_on.localeCompare(a.ev.completed_on));
    return all.slice(0, 5);
  }, [closes, woCloses]);

  return (
    <section className="tv-panel tv-panel-tall" style={{ borderTopColor: '#f59e0b' }}>
      <div className="tv-panel-titlerow">
        <h2 className="tv-panel-title">Workload + Performance</h2>
        <div className="tv-panel-meta">
          <span className="tv-crew-meta">
            <span>PM <b>{pmAge}</b></span>
            <span className="tv-crew-meta-sep">·</span>
            <span>Labor <b>{laborAge}</b></span>
          </span>
        </div>
      </div>
      <div className="tv-panel-body tv-wp-body">
        <WorkloadSection pmRows={pmRows} engineers={engineers} shifts={shifts} now={now} />
        <div className="tv-wp-divider" />
        <CrewSection closes={closes} laborDaily={laborDaily} now={now} />
        <div className="tv-wp-divider" />
        <RecentClosesSection rows={recentCloses} now={now} />
      </div>
    </section>
  );
}

/** Top 5 most recent closes — PM/WO chip, task #, short description, tech, hours, when. */
function RecentClosesSection({ rows, now }: {
  rows: Array<
    | { kind: 'PM'; ev: PmCloseEvent }
    | { kind: 'WO'; ev: WoCloseEvent }
  >;
  now: Date;
}) {
  return (
    <div className="tv-wp-closes">
      <div className="tv-workload-section-label">Recent closes · top 5</div>
      {rows.length === 0 ? (
        <p className="tv-muted" style={{ fontSize: '1.0vw' }}>No closes yet.</p>
      ) : (
        <ul className="tv-closes-list">
          {rows.map((r, i) => {
            const id   = r.kind === 'PM' ? r.ev.task_no : r.ev.wo_id;
            const desc = r.kind === 'PM' ? r.ev.task_name : r.ev.description;
            const tech = r.ev.assigned_to_name;
            const bld  = r.ev.building_code;
            const hrs  = r.ev.labor_hours;
            return (
              <li key={`${r.kind}-${id ?? i}-${r.ev.completed_on}`}>
                <span className={`tv-closes-chip tv-closes-chip-${r.kind.toLowerCase()}`}>{r.kind}</span>
                <span className="tv-closes-id" title={id ?? ''}>{shortTaskId(id)}</span>
                <span className="tv-closes-desc" title={desc ?? ''}>{shortDesc(desc, 60)}</span>
                <span className="tv-closes-tech">{shortName(tech)}</span>
                <span className="tv-closes-bld" title={bld ?? ''}>{buildingShortCode(bld)}</span>
                <span className="tv-closes-hrs">{hrs == null ? '—' : `${hrs.toFixed(1)}h`}</span>
                <span className="tv-closes-when">{relTime(r.ev.completed_on, now)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function shortDesc(s: string | null | undefined, n: number): string {
  if (!s) return '—';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

/** "40 Landsdowne Street" → "40", "G-80 Bldg" → "G-80". Take first whitespace-delimited token. */
function buildingShortCode(s: string | null | undefined): string {
  if (!s) return '—';
  const tok = s.trim().split(/\s+/)[0];
  return tok || '—';
}

/** "PM-UNP-19043" → "19043", "W-UNP-3820" → "3820". Strip the leading prefix segments. */
function shortTaskId(s: string | null | undefined): string {
  if (!s) return '—';
  const parts = s.trim().split('-');
  return parts[parts.length - 1] || s;
}

function relTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
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

function OncallPanel({ participants, settings, notes, now }: {
  participants: OncallParticipant[];
  settings: OncallSettings | null;
  notes: OncallNote[];
  now: Date;
}) {
  // Skip empty slots so the area collapses when nobody's written anything.
  const visibleNotes = notes.filter((n) => n.body.trim().length > 0);
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
        {visibleNotes.length > 0 && <OncallNotesStrip notes={visibleNotes} />}
        <p className="tv-muted">No rotation set.</p>
      </Panel>
    );
  }

  return (
    <Panel title="On-call schedule" accent="#dc2626">
      <div className="tv-oncall-sub">
        {grid.N} engineers · {grid.cycles} cycles + 1 preview
      </div>
      {visibleNotes.length > 0 && <OncallNotesStrip notes={visibleNotes} />}
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

/** Read-only display of the sticky-notes set on the Admin → On-call tab.
 *  Renders one line per non-empty slot, with subtle "note 1:" / "note 2:"
 *  prefixes that won't compete with the table data for the eye. */
function OncallNotesStrip({ notes }: { notes: OncallNote[] }) {
  return (
    <div className="tv-oncall-notes">
      {notes.map((n) => (
        <div key={n.slot} className="tv-oncall-note">
          <span className="tv-oncall-note-tag">{n.slot}</span>
          <span className="tv-oncall-note-body">{n.body}</span>
        </div>
      ))}
    </div>
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

// ============================================================================
// BMS health panel — tri-stripe stack consolidating §08 + §09 + §10
// ============================================================================
//
// Three horizontal bands inside one TV cell:
//   §08 Delta direct  — active count · unacked · feed live/STALE
//   §09 Heartbeats    — per-vendor dot row (Siemens · Delta · 730/750 · PA …)
//   §10 Email alarms  — active count · per-vendor breakdown
//
// All three feeds also drive the manager dashboard panels with the same names.
// Heartbeat staleness rule (weekday-aware) is copied from EmailAlarmsPanel —
// keep them in sync if the rule changes.

/** Returns true when the given vendor's last heartbeat is older than its
 *  vendor-specific tolerance. Copy of the rule in EmailAlarmsPanel.tsx —
 *  duplicated rather than imported to keep the TV view standalone. */
function isHeartbeatStale(vendor: string, hoursSince: number): boolean {
  if (vendor === 'power_automate') return hoursSince > 2.5;
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = etNow.getDay();
  const hour = etNow.getHours();
  if (dow === 0) return hoursSince > 76;
  if (dow === 6) return hoursSince > 52;
  if (dow === 1 && hour < 12) return hoursSince > 80;
  return hoursSince > 28;
}

/** Compact vendor labels for the tight stripe row.
 *  Pretty names ("Delta @ Takeda") are too long when 5 fit on one line. */
const BMS_VENDOR_SHORT: Record<string, string> = {
  siemens:               'Siemens',
  delta_takeda:          'Delta·Tkd',
  delta_10green:         'Delta·10G',
  delta:                 'Delta',
  northeasttech_730_750: '730/750',
  northeast:             'NE Tech',
  power_automate:        'PA',
};
function shortVendor(slug: string | null | undefined): string {
  if (!slug) return '—';
  return BMS_VENDOR_SHORT[slug] ?? slug;
}

/** Hours-since float → "0.4h" / "12h" / "1.2d" — compact, tabular-nums-friendly. */
function fmtAge(hours: number): string {
  if (hours < 1) return `${(Math.round(hours * 10) / 10).toFixed(1)}h`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function tvMinutesAgo(utcIso: string | null): number | null {
  if (!utcIso) return null;
  return Math.floor((Date.now() - new Date(utcIso).getTime()) / 60_000);
}

function BmsHealthPanel() {
  const deltaCurrentQ = useDeltaAlarmsCurrent();
  const deltaStateQ   = useDeltaPollState();
  const hbQ           = useBmsHeartbeats();
  const emailOpenQ    = useEmailAlarmsOpen();
  const emailStateQ   = useEmailPollState();

  // §08 — Delta direct
  const delta = useMemo(() => {
    const all = deltaCurrentQ.data ?? [];
    const active = all.filter((r) => r.to_state && r.to_state.toLowerCase() !== 'normal');
    const unacked = all.filter((r) => r.latest_acked === false).length;
    return { active: active.length, total: all.length, unacked };
  }, [deltaCurrentQ.data]);
  const deltaSyncMin = tvMinutesAgo(deltaStateQ.data?.last_full_sync_at ?? null);
  const deltaFeedStale =
    !deltaStateQ.data ||
    deltaStateQ.data.session_status !== 'ok' ||
    (deltaSyncMin !== null && deltaSyncMin > 15);

  // §09 — Heartbeats
  const hbRows = hbQ.data ?? [];
  const hbAggr = useMemo(() => {
    const total = hbRows.length;
    const stale = hbRows.filter((r) => isHeartbeatStale(r.vendor, r.hours_since)).length;
    return { total, stale, live: total - stale };
  }, [hbRows]);

  // §10 — Email alarms
  const emailRows = emailOpenQ.data ?? [];
  const emailByVendor = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of emailRows) {
      const v = r.vendor ?? 'unknown';
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [emailRows]);
  const emailSyncMin = tvMinutesAgo(emailStateQ.data?.last_run_at ?? null);
  const emailFeedStale =
    !emailStateQ.data ||
    emailStateQ.data.last_run_status !== 'ok' ||
    (emailSyncMin !== null && emailSyncMin > 15);

  return (
    <section className="tv-panel tv-bms-panel" style={{ borderTopColor: '#dc2626' }}>
      <div className="tv-panel-titlerow">
        <h2 className="tv-panel-title">BMS · alarms + heartbeats</h2>
        <div className="tv-panel-meta">
          <span className={deltaFeedStale ? 'tv-bms-feed-stale' : 'tv-bms-feed-live'}>
            Delta {deltaFeedStale ? 'STALE' : 'live'}
          </span>
          <span className="tv-crew-meta-sep" style={{ margin: '0 0.3vw' }}>·</span>
          <span className={emailFeedStale ? 'tv-bms-feed-stale' : 'tv-bms-feed-live'}>
            Email {emailFeedStale ? 'STALE' : 'live'}
          </span>
        </div>
      </div>
      <div className="tv-panel-body tv-bms-body">
        {/* Stripe 1: §08 Delta direct */}
        <div className="tv-bms-stripe">
          <div className="tv-bms-stripe-head">
            <span className="tv-bms-stripe-tag">§08</span>
            <span className="tv-bms-stripe-label">Delta direct</span>
          </div>
          <div className="tv-bms-stripe-row">
            <span
              className="tv-bms-bignum"
              style={{ color: delta.active > 0 ? '#fca5a5' : '#94a3b8' }}
            >
              {delta.active}
            </span>
            <span className="tv-bms-bignum-label">active</span>
            {delta.unacked > 0 && (
              <span className="tv-bms-secondary">
                <span className="tv-bms-num" style={{ color: '#fbbf24' }}>{delta.unacked}</span>
                {' '}unacked
              </span>
            )}
            <span className="tv-bms-secondary tv-bms-secondary-end">
              {delta.total} open total
            </span>
          </div>
        </div>

        <div className="tv-bms-divider" />

        {/* Stripe 2: §09 Heartbeats */}
        <div className="tv-bms-stripe">
          <div className="tv-bms-stripe-head">
            <span className="tv-bms-stripe-tag">§09</span>
            <span className="tv-bms-stripe-label">Heartbeats</span>
            <span className="tv-bms-stripe-meta">
              {hbAggr.total > 0 ? (
                <>
                  <span style={{ color: hbAggr.stale === 0 ? '#34d399' : '#f8fafc', fontWeight: 700 }}>
                    {hbAggr.live}/{hbAggr.total}
                  </span> live
                  {hbAggr.stale > 0 && (
                    <span style={{ color: '#fca5a5', marginLeft: '0.4vw' }}>· {hbAggr.stale} stale</span>
                  )}
                </>
              ) : '—'}
            </span>
          </div>
          {hbRows.length === 0 ? (
            <p className="tv-muted" style={{ fontSize: '0.78vw' }}>No heartbeats yet.</p>
          ) : (
            <ul className="tv-bms-hb-list">
              {hbRows.map((r) => {
                const stale = isHeartbeatStale(r.vendor, r.hours_since);
                return (
                  <li key={r.vendor}>
                    <span className={`tv-bms-hb-dot ${stale ? 'stale' : 'live'}`} />
                    <span className="tv-bms-hb-name">{shortVendor(r.vendor)}</span>
                    <span
                      className="tv-bms-hb-age"
                      style={{ color: stale ? '#fca5a5' : '#94a3b8' }}
                    >
                      {fmtAge(r.hours_since)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="tv-bms-divider" />

        {/* Stripe 3: §10 Email alarms */}
        <div className="tv-bms-stripe">
          <div className="tv-bms-stripe-head">
            <span className="tv-bms-stripe-tag">§10</span>
            <span className="tv-bms-stripe-label">Email alarms</span>
            <span className="tv-bms-stripe-meta">
              {emailByVendor.length} vendor{emailByVendor.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="tv-bms-stripe-row">
            <span
              className="tv-bms-bignum"
              style={{ color: emailRows.length > 0 ? '#fca5a5' : '#94a3b8' }}
            >
              {emailRows.length}
            </span>
            <span className="tv-bms-bignum-label">active</span>
          </div>
          {emailByVendor.length > 0 && (
            <div className="tv-bms-vendor-line">
              {emailByVendor.map(([v, n], i) => (
                <span key={v} className="tv-bms-vendor-item">
                  {i > 0 && <span className="tv-bms-vendor-sep">·</span>}
                  <span className="tv-bms-vendor-name">{shortVendor(v)}</span>
                  <span className="tv-bms-vendor-count">{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One crew column with a tiny header row, used twice side-by-side. */
function CrewColumn({ rows, renderRow }: {
  rows: { name: string; pms: number; hours: number; pmsDelta: number; hoursDelta: number }[];
  renderRow: (c: { name: string; pms: number; hours: number; pmsDelta: number; hoursDelta: number }) => React.ReactNode;
}) {
  if (rows.length === 0) return <div />;
  return (
    <div className="tv-crew-col">
      <div className="tv-crew-headerrow">
        <span />
        <span className="tv-crew-colhead">PMs</span>
        <span />
        <span className="tv-crew-colhead">Hrs</span>
        <span />
      </div>
      <ul className="tv-crew-list">{rows.map(renderRow)}</ul>
    </div>
  );
}

function CrewSection({ closes, laborDaily, now }: {
  closes: NonNullable<ReturnType<typeof useRecentPmCloses>['data']>;
  laborDaily: NonNullable<ReturnType<typeof useLaborDaily>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const winEnd    = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const winStart  = addDays(winEnd, -7);
    const priorEnd  = winStart;
    const priorStart = addDays(priorEnd, -7);

    type Acc = { pms: number; hours: number; pmsPrev: number; hoursPrev: number };
    const byTech = new Map<string, Acc>();
    const get = (a: string): Acc => {
      let cur = byTech.get(a);
      if (!cur) { cur = { pms: 0, hours: 0, pmsPrev: 0, hoursPrev: 0 }; byTech.set(a, cur); }
      return cur;
    };

    // PM closes (Phase 5.5): from explicit pm_close_events log.
    for (const c of closes) {
      const d = new Date(c.completed_on);
      const a = (c.assigned_to_name ?? '').trim() || 'Unassigned';
      if (d >= winStart && d < winEnd)          get(a).pms++;
      else if (d >= priorStart && d < priorEnd) get(a).pmsPrev++;
    }
    // Labor hours (Phase 5.5): per-tech per-day from labor_daily view.
    for (const l of laborDaily) {
      const d = new Date(l.day_et + 'T00:00:00');
      const a = (l.assigned_to_name ?? '').trim() || 'Unassigned';
      const hrs = l.hours_that_day ?? 0;
      if (d >= winStart && d < winEnd)          get(a).hours += hrs;
      else if (d >= priorStart && d < priorEnd) get(a).hoursPrev += hrs;
    }
    return Array.from(byTech.entries())
      .map(([name, v]) => ({
        name,
        pms: v.pms,
        hours: v.hours,
        pmsDelta: v.pms - v.pmsPrev,
        hoursDelta: v.hours - v.hoursPrev,
      }))
      .sort((a, b) => b.hours - a.hours || b.pms - a.pms)
      .slice(0, 10);
  }, [closes, laborDaily, now]);

  const leftCol  = data.slice(0, 5);
  const rightCol = data.slice(5);

  const renderRow = (c: typeof data[number]) => (
    <li key={c.name}>
      <span className="tv-crew-name">{shortName(c.name)}</span>
      <span className="tv-crew-num">{c.pms}</span>
      <span className="tv-crew-deltacell"><Delta v={c.pmsDelta} /></span>
      <span className="tv-crew-num">{Math.round(c.hours)}</span>
      <span className="tv-crew-deltacell"><Delta v={c.hoursDelta} decimals={0} /></span>
    </li>
  );

  return (
    <div className="tv-wp-crew">
      <div className="tv-workload-section-label">PMs closed · labor · last 7 days</div>
      {data.length === 0 ? (
        <p className="tv-muted" style={{ fontSize: '1.0vw' }}>No data.</p>
      ) : (
        <div className="tv-crew-2col">
          <CrewColumn rows={leftCol} renderRow={renderRow} />
          <CrewColumn rows={rightCol} renderRow={renderRow} />
        </div>
      )}
    </div>
  );
}

/** "+7" / "−14" — small color-coded text delta vs prior period. Null when below threshold. */
function Delta({ v, decimals = 0 }: { v: number; decimals?: number }) {
  const abs = Math.abs(v);
  const threshold = decimals > 0 ? 0.05 : 0.5;
  if (abs < threshold) return null;
  const up = v > 0;
  return (
    <span className={`tv-crew-delta ${up ? 'up' : 'down'}`}>
      {up ? '+' : '−'}{abs.toFixed(decimals)}
    </span>
  );
}

function WorkloadSection({ pmRows, engineers, shifts, now }: {
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
    <div className="tv-wp-workload">
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
    </div>
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
          <div className="tv-bldgs-colhead tv-bldgs-col-rounds">Rounds</div>
          <div className="tv-bldgs-colhead tv-bldgs-col-name">Engineer</div>
          <div className="tv-bldgs-colhead tv-bldgs-col-assign">Assignments</div>
        </div>
        {data.shiftGroups.length === 0 ? (
          <p className="tv-muted">No assignments.</p>
        ) : (
          data.shiftGroups.map((g) => (
            <div key={g.shift.id} className="tv-bldgs-band">
              <div className="tv-bldgs-band-label">{g.bandLabel} shift</div>
              <ul className="tv-bldgs-rows">
                {g.engineers.map((e) => (
                  <li key={e.user_id} className="tv-bldgs-row">
                    <span className="tv-bldgs-codes tv-bldgs-col-rounds">
                      {e.round ? e.round.stops.map((s) => s.short_code ?? s.code).join(' · ') : '—'}
                    </span>
                    <span className="tv-bldgs-eng tv-bldgs-col-name">{shortName(e.name)}</span>
                    <span className="tv-bldgs-codes tv-bldgs-col-assign">
                      {e.primary.length > 0 ? fmtCodes(e.primary) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
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
// §11 Overtime — read-only TV variant
// ============================================================================
//
// Compact list of OPEN overtime posts. One line per post: when · building ·
// short scope · category dot · X/Y filled with name chips. Up to 8 visible —
// the rest fold into a "+N more" line so the panel never scrolls.

const TV_CATEGORY_DOT: Record<OvertimeCategory, string> = {
  cold_weather:      '#60a5fa',
  major_off_hour_pm: '#a78bfa',
  off_hour_repair:   '#fb923c',
  vendor_escort:     '#f472b6',
};

function fmtOvertimeWhen(starts: string, ends: string | null): string {
  const s = new Date(starts);
  const dStr = s.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  const sT = s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
              .replace(/\s/g, '').toLowerCase();
  if (!ends) return `${dStr} ${sT}`;
  const e = new Date(ends);
  const eT = e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
              .replace(/\s/g, '').toLowerCase();
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  return sameDay ? `${dStr} ${sT}–${eT}` : `${dStr} ${sT}+`;
}

function tvBuildingLabel(p: OvertimePost): string {
  return p.building_short_code ?? p.building_code ?? p.building_label ?? '—';
}

function OvertimeTvPanel() {
  useOvertimeRealtime();
  const postsQ = useOvertimePosts();
  const open = (postsQ.data ?? []).filter((p) => p.status === 'open');
  const visible = open.slice(0, 8);
  const overflow = open.length - visible.length;

  // Count open slots per category, used in the title-row meta.
  const catTotals = useMemo(() => {
    const map: Record<OvertimeCategory, number> = {
      cold_weather: 0, major_off_hour_pm: 0, off_hour_repair: 0, vendor_escort: 0,
    };
    for (const p of open) {
      map[p.category] += Math.max(0, p.slots_needed - p.slots_filled);
    }
    return map;
  }, [open]);

  const totalOpenSlots = Object.values(catTotals).reduce((s, n) => s + n, 0);

  return (
    <section className="tv-panel" style={{ borderTopColor: '#fbbf24' }}>
      <div className="tv-panel-titlerow">
        <h2 className="tv-panel-title">§11 Upcoming overtime</h2>
        <div className="tv-panel-meta">
          {open.length === 0 ? 'no posts' : (
            <>
              <span style={{ color: '#f8fafc', fontWeight: 700 }}>{totalOpenSlots}</span> open slot{totalOpenSlots === 1 ? '' : 's'}
            </>
          )}
        </div>
      </div>
      <div className="tv-panel-body tv-ot-body">
        {open.length === 0 ? (
          <p className="tv-muted" style={{ fontSize: '1.0vw' }}>Nothing posted.</p>
        ) : (
          <>
            <div className="tv-ot-catbar">
              {OVERTIME_CATEGORY_ORDER.map((c) => (
                <span key={c} className="tv-ot-catbar-item">
                  <span className="tv-ot-dot" style={{ background: TV_CATEGORY_DOT[c] }} />
                  <span className="tv-ot-catbar-label">{OVERTIME_CATEGORY_LABELS[c]}</span>
                  <span className="tv-ot-catbar-count">{catTotals[c]}</span>
                </span>
              ))}
            </div>
            <ul className="tv-ot-list">
              {visible.map((p) => {
                const isFull = p.slots_filled >= p.slots_needed;
                return (
                  <li key={p.id} className={isFull ? 'tv-ot-row tv-ot-row-full' : 'tv-ot-row'}>
                    <span className="tv-ot-dot" style={{ background: TV_CATEGORY_DOT[p.category] }} />
                    <span className="tv-ot-when">{fmtOvertimeWhen(p.starts_at, p.ends_at)}</span>
                    <span className="tv-ot-bld">{tvBuildingLabel(p)}</span>
                    <span className="tv-ot-scope" title={p.scope}>{p.scope}</span>
                    <span className="tv-ot-slots">
                      {p.signups.length > 0 ? (
                        p.signups.map((s, i) => (
                          <span key={s.id}>
                            {i > 0 && <span className="tv-ot-sep">·</span>}
                            <span className="tv-ot-name">{shortName(s.user_name ?? '—')}</span>
                          </span>
                        ))
                      ) : (
                        <span className="tv-ot-empty">—</span>
                      )}
                    </span>
                    <span className="tv-ot-filled">
                      <span style={{ color: isFull ? '#34d399' : '#fbbf24', fontWeight: 700 }}>
                        {p.slots_filled}/{p.slots_needed}
                      </span>
                    </span>
                  </li>
                );
              })}
              {overflow > 0 && (
                <li className="tv-ot-overflow">+{overflow} more on the manager dashboard</li>
              )}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}


// ============================================================================
// Styles
// ============================================================================

function TvStyles() {
  return (
    <style>{`
      .tv-root {
        height: 100vh;
        background: #0b1220;
        color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        padding: 0.7vw;
        display: flex;
        flex-direction: column;
        gap: 0.6vw;
        overflow: hidden;
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
      .tv-h-left {
        display: flex; align-items: baseline; gap: 1.0vw;
        flex: 0 0 auto;
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
      .tv-h-oncall-current {
        text-decoration: underline;
        text-decoration-color: rgba(252, 165, 165, 0.6);
        text-underline-offset: 0.2vw;
        text-decoration-thickness: 0.12vw;
      }
      .tv-h-oncall-next .tv-h-oncall-name { color: #94a3b8; font-size: 0.95vw; font-weight: 600; }

      /* Center: top-2 announcements pulled from the focus board */
      .tv-h-center {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding: 0 0.5vw;
      }
      .tv-h-announcements {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: column; align-items: center;
        gap: 0.05vw;
        max-width: 100%;
        font-size: 0.72vw;
        line-height: 1.15;
        color: #cbd5e1;
      }
      .tv-h-announcements li {
        display: inline-flex; align-items: baseline; gap: 0.3vw;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        min-width: 0;
        max-width: 100%;
      }
      .tv-h-announcements strong { color: #f1f5f9; font-weight: 700; }
      .tv-h-announcements .tv-h-ann-body { overflow: hidden; text-overflow: ellipsis; }
      .tv-h-ann-dot {
        width: 0.4vw; height: 0.4vw; border-radius: 50%;
        flex: 0 0 auto; display: inline-block;
        align-self: center;
      }

      /* Right-side cluster: weather → date/time */
      .tv-h-right-cluster {
        display: flex; align-items: center; gap: 0.7vw;
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
        font-size: 0.95vw; font-weight: 600; color: #fbbf24;
        font-variant-numeric: tabular-nums;
      }
      .tv-h-wx-hot { color: #f87171; }
      .tv-h-wx-slash { color: #475569; font-size: 0.9vw; }
      .tv-h-wx-low {
        font-size: 0.95vw; font-weight: 500; color: #93c5fd;
        font-variant-numeric: tabular-nums;
      }
      /* Current temp — the dominant value in the middle of the weather chip */
      .tv-h-wx-now {
        font-size: 1.35vw; font-weight: 700; color: #f8fafc;
        font-variant-numeric: tabular-nums;
        padding: 0 0.05vw;
      }
      .tv-h-wx-label { font-size: 0.72vw; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }

      /* Date/time */
      .tv-h-datetime {
        font-size: 0.95vw; color: #cbd5e1; font-variant-numeric: tabular-nums;
        flex: 0 0 auto;
      }

      /* LOCKED LAYOUT — do not change column/row ratios or panel spans.
         User signed off on this space distribution: ~30% tall left panel,
         four ~15% single-cell panels, ~4% header. Content must adapt to
         the grid, not the other way around. See memory:
         feedback_tv_layout_locked.md for the full rule. */
      .tv-grid {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;  /* LOCKED */
        grid-template-rows: 1fr 1fr;          /* LOCKED */
        gap: 0.6vw;
        min-height: 0;
      }
      /* LOCKED — Workload+Performance is the only row-spanning panel */
      .tv-panel-tall { grid-row: 1 / span 2; }

      /* Combined Workload + Performance panel body */
      .tv-wp-body { display: flex; flex-direction: column; gap: 0.35vw; min-height: 0; overflow: hidden; }
      .tv-wp-divider { height: 1px; background: #1e293b; margin: 0.15vw 0; flex: 0 0 auto; }
      .tv-wp-workload, .tv-wp-crew, .tv-wp-closes { display: flex; flex-direction: column; gap: 0.2vw; min-height: 0; }

      /* Recent closes list (top 5) — every cell forced to a single line */
      .tv-closes-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2vw; }
      .tv-closes-list li {
        display: grid;
        grid-template-columns: 1.4vw 2.8vw 1fr 4.4vw 2vw 1.9vw 1.6vw;
        gap: 0.35vw;
        align-items: baseline;
        font-size: 0.78vw;
        line-height: 1.2;
      }
      .tv-closes-list li > span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .tv-closes-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 0.25vw;
        border-radius: 3px;
        font-size: 0.6vw;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-align: center;
      }
      .tv-closes-chip-pm { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.45); }
      .tv-closes-chip-wo { background: rgba(14, 165, 233, 0.18); color: #7dd3fc; border: 1px solid rgba(14, 165, 233, 0.45); }
      .tv-closes-id   { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; font-size: 0.78vw; font-variant-numeric: tabular-nums; }
      .tv-closes-desc { color: #e2e8f0; }
      .tv-closes-tech { color: #f1f5f9; font-weight: 600; }
      .tv-closes-bld  { color: #94a3b8; font-variant-numeric: tabular-nums; }
      .tv-closes-hrs  { color: #cbd5e1; text-align: right; font-variant-numeric: tabular-nums; }
      .tv-closes-when { color: #64748b; text-align: right; font-variant-numeric: tabular-nums; font-size: 0.72vw; }

      .tv-panel {
        background: #111827;
        border: 1px solid #1e293b;
        border-top: 3px solid #334155;
        border-radius: 6px;
        padding: 0.55vw 0.8vw;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .tv-panel-titlerow {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.8vw;
        margin: 0 0 0.35vw;
      }
      .tv-panel-title {
        font-size: 1.0vw;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin: 0;
      }
      .tv-panel-meta {
        font-size: 0.7vw;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #64748b;
        white-space: nowrap;
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
      /* Sticky notes from Admin → On-call tab (full-width strip above table) */
      .tv-oncall-notes {
        margin-bottom: 0.4vw;
        padding: 0.25vw 0.4vw;
        background: rgba(217, 119, 6, 0.10);
        border-left: 2px solid #d97706;
        border-radius: 2px;
        display: flex;
        flex-direction: column;
        gap: 0.15vw;
      }
      .tv-oncall-note {
        display: flex;
        align-items: baseline;
        gap: 0.4vw;
        font-size: 0.72vw;
        line-height: 1.25;
        color: #fde68a;
      }
      .tv-oncall-note-tag {
        font-size: 0.55vw;
        font-weight: 700;
        color: #d97706;
        background: rgba(217, 119, 6, 0.25);
        padding: 0 0.25vw;
        border-radius: 2px;
        flex-shrink: 0;
      }
      .tv-oncall-note-body {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        padding: 0.12vw 0.25vw;
        border-bottom: 1px solid rgba(30, 41, 59, 0.5);
        color: #e2e8f0;
        white-space: nowrap;
      }
      .tv-oncall-grid tbody tr:last-child td { border-bottom: none; }
      .tv-oncall-eng-td {
        color: #f8fafc;
        font-weight: 600;
        font-size: 0.78vw;
        position: relative;
      }
      .tv-oncall-grid tbody td.tv-oncall-cell-side { color: #64748b; font-style: italic; }
      .tv-oncall-grid tbody td.tv-oncall-cell-holiday { color: #fca5a5; }
      .tv-oncall-grid tbody td.tv-oncall-cell-active {
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

      /* BMS health panel — tri-stripe stack (§08 + §09 + §10).
         Each stripe has a head row (tag · label · meta) followed by content.
         Sizes tuned to fit a single TV cell without scrolling. */
      .tv-bms-panel .tv-panel-meta {
        font-size: 0.62vw;
        letter-spacing: 0.10em;
      }
      .tv-bms-feed-live  { color: #34d399; font-weight: 700; }
      .tv-bms-feed-stale { color: #f87171; font-weight: 700; }
      .tv-bms-body {
        display: flex; flex-direction: column;
        gap: 0.25vw;
        min-height: 0; overflow: hidden;
      }
      .tv-bms-divider { height: 1px; background: #1e293b; margin: 0.15vw 0; flex: 0 0 auto; }
      .tv-bms-stripe {
        display: flex; flex-direction: column; gap: 0.18vw;
        min-width: 0;
      }
      .tv-bms-stripe-head {
        display: flex; align-items: baseline; gap: 0.45vw;
        min-width: 0;
      }
      .tv-bms-stripe-tag {
        font-size: 0.6vw;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: #64748b;
        font-variant-numeric: tabular-nums;
        flex: 0 0 auto;
      }
      .tv-bms-stripe-label {
        font-size: 0.78vw;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #cbd5e1;
        font-weight: 600;
        flex: 0 0 auto;
      }
      .tv-bms-stripe-meta {
        font-size: 0.68vw;
        color: #94a3b8;
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .tv-bms-stripe-row {
        display: flex; align-items: baseline; gap: 0.55vw;
        min-width: 0;
      }
      .tv-bms-bignum {
        font-size: 1.6vw;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
      .tv-bms-bignum-label {
        font-size: 0.7vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
      }
      .tv-bms-secondary {
        font-size: 0.78vw;
        color: #cbd5e1;
        font-variant-numeric: tabular-nums;
      }
      .tv-bms-secondary-end { margin-left: auto; color: #64748b; }
      .tv-bms-num {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      /* Heartbeat dot row — 5 vendors fit comfortably on one line; wraps if tight. */
      .tv-bms-hb-list {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-wrap: wrap;
        gap: 0.2vw 0.7vw;
      }
      .tv-bms-hb-list li {
        display: inline-flex; align-items: center;
        gap: 0.3vw;
        font-size: 0.78vw;
        line-height: 1.15;
      }
      .tv-bms-hb-dot {
        width: 0.55vw; height: 0.55vw;
        border-radius: 50%;
        display: inline-block;
        flex: 0 0 auto;
      }
      .tv-bms-hb-dot.live  { background: #10b981; box-shadow: 0 0 0.3vw rgba(16, 185, 129, 0.5); }
      .tv-bms-hb-dot.stale { background: #ef4444; box-shadow: 0 0 0.3vw rgba(239, 68, 68, 0.6); }
      .tv-bms-hb-name {
        color: #e2e8f0;
        font-weight: 500;
      }
      .tv-bms-hb-age {
        font-size: 0.7vw;
        font-variant-numeric: tabular-nums;
      }

      /* §10 vendor breakdown — single-line "Siemens 14 · Delta 9 · 730 3" */
      .tv-bms-vendor-line {
        display: flex; flex-wrap: wrap;
        gap: 0.1vw 0.45vw;
        font-size: 0.78vw;
        line-height: 1.2;
      }
      .tv-bms-vendor-item { display: inline-flex; align-items: baseline; gap: 0.25vw; }
      .tv-bms-vendor-sep  { color: #334155; }
      .tv-bms-vendor-name { color: #cbd5e1; }
      .tv-bms-vendor-count {
        color: #f1f5f9;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      /* Crew stats — 2 columns of 5; each row is 5 cells with deltas in their own column.
         Right column gets a left border so the two halves read as distinct cards. */
      .tv-crew-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.2vw 0; }
      .tv-crew-col { display: flex; flex-direction: column; gap: 0.15vw; min-width: 0; padding: 0 0.9vw; }
      .tv-crew-col:first-child  { padding-left: 0; border-right: 1px solid #1e293b; }
      .tv-crew-col:last-child   { padding-right: 0; }
      .tv-crew-headerrow,
      .tv-crew-list li {
        display: grid;
        grid-template-columns: 1fr 1.8vw 1.4vw 2.0vw 1.4vw;
        gap: 0.3vw;
        align-items: baseline;
        min-width: 0;
      }
      .tv-crew-headerrow {
        font-size: 0.6vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #475569;
        padding-bottom: 0.1vw;
        border-bottom: 1px solid rgba(30, 41, 59, 0.6);
        margin-bottom: 0.15vw;
      }
      .tv-crew-colhead { text-align: right; }
      .tv-crew-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2vw; }
      .tv-crew-list li { font-size: 0.92vw; line-height: 1.2; }
      .tv-crew-list li > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
      .tv-crew-name { font-weight: 600; color: #f1f5f9; }
      .tv-crew-num {
        color: #f1f5f9;
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .tv-crew-deltacell { text-align: left; font-size: 0.6vw; }
      .tv-crew-delta { font-size: 0.6vw; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; opacity: 0.85; }
      .tv-crew-delta.up   { color: #34d399; }
      .tv-crew-delta.down { color: #f87171; }
      .tv-crew-meta { display: inline-flex; gap: 0.45vw; align-items: baseline; }
      .tv-crew-meta b { color: #cbd5e1; font-weight: 600; }
      .tv-crew-meta-sep { color: #334155; }

      /* Due-today list — horizontal chip row (one line if it fits, wraps otherwise) */
      .tv-today-list {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: row; flex-wrap: wrap;
        gap: 0.35vw;
        align-items: center;
      }
      .tv-today-list li {
        display: inline-flex; align-items: baseline; gap: 0.3vw;
        padding: 0.1vw 0.5vw;
        border: 1px solid #334155;
        border-radius: 4px;
        background: #1e293b;
        font-size: 0.85vw;
        white-space: nowrap;
      }
      .tv-today-count {
        font-weight: 700; color: #f59e0b;
        font-size: 1.0vw;
        font-variant-numeric: tabular-nums;
      }
      .tv-today-name { color: #e2e8f0; }

      /* Combined Buildings panel: rounds | engineer | assignments per row */
      .tv-bldgs { display: flex; flex-direction: column; gap: 0.25vw; }
      .tv-bldgs-headerrow {
        display: grid;
        grid-template-columns: 1fr 6vw 1fr;
        gap: 0.4vw;
        font-size: 0.65vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
        padding-bottom: 0.15vw;
        border-bottom: 1px solid #1e293b;
      }
      .tv-bldgs-col-rounds { text-align: right; }
      .tv-bldgs-col-name   { text-align: center; }
      .tv-bldgs-col-assign { text-align: left; }
      .tv-bldgs-band-label {
        font-size: 0.68vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #94a3b8;
        margin: 0.15vw 0 0.1vw;
      }
      .tv-bldgs-rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.12vw; }
      .tv-bldgs-row {
        display: grid;
        grid-template-columns: 1fr 6vw 1fr;
        gap: 0.4vw;
        align-items: baseline;
        font-size: 0.78vw;
        line-height: 1.2;
      }
      .tv-bldgs-eng { font-weight: 600; color: #f8fafc; }
      .tv-bldgs-codes { color: #e2e8f0; font-variant-numeric: tabular-nums; }
      .tv-bldgs-leads {
        margin-top: 0.2vw;
        padding-top: 0.25vw;
        border-top: 1px dashed #334155;
        display: flex;
        flex-direction: column;
        gap: 0.12vw;
      }
      .tv-bldgs-lead-row { display: flex; gap: 0.5vw; align-items: baseline; font-size: 0.65vw; }
      .tv-bldgs-lead-name { color: #d4a017; font-weight: 600; flex: 0 0 auto; min-width: 5.5vw; }
      .tv-bldgs-lead-codes { color: #94a3b8; font-variant-numeric: tabular-nums; flex: 1; }

      /* Workload panel (Due today on top, Upcoming 9d on bottom) */
      .tv-workload-top { display: flex; flex-direction: column; gap: 0.15vw; }
      .tv-workload-bottom { display: flex; flex-direction: column; gap: 0.15vw; }
      .tv-workload-divider {
        height: 1px;
        background: #1e293b;
        margin: 0.25vw 0;
      }
      .tv-workload-section-label {
        font-size: 0.72vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
      }
      /* (no .tv-workload-top overrides needed — base .tv-today-list is already chip-shaped) */

      /* Workload bottom: per-tech chip list (§03-style chips), split by shift */
      .tv-wkl-shift-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.35vw 0.6vw;
      }
      .tv-wkl-shift-col { min-width: 0; }
      .tv-wkl-shift-other { grid-column: 1 / -1; }
      .tv-wkl-shift-label {
        font-size: 0.68vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
        margin-bottom: 0.15vw;
      }
      .tv-wkl-chip-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.15vw; }
      .tv-wkl-chip-list li {
        display: flex;
        align-items: center;
        gap: 0.35vw;
        font-size: 0.82vw;
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
        gap: 0.2vw;
        padding: 0 0.4vw;
        border: 1px solid #334155;
        border-radius: 4px;
        font-size: 0.72vw;
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

      /* §11 Overtime — TV variant. Compact one-line rows with a small
         category bar at the top showing open-slot counts. */
      .tv-ot-body { display: flex; flex-direction: column; gap: 0.35vw; min-height: 0; }
      .tv-ot-catbar {
        display: flex; flex-wrap: wrap;
        gap: 0.1vw 0.6vw;
        padding-bottom: 0.25vw;
        border-bottom: 1px solid #1e293b;
        font-size: 0.68vw;
        line-height: 1.2;
      }
      .tv-ot-catbar-item { display: inline-flex; align-items: center; gap: 0.25vw; }
      .tv-ot-catbar-label { color: #94a3b8; }
      .tv-ot-catbar-count {
        color: #f1f5f9; font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .tv-ot-dot {
        width: 0.5vw; height: 0.5vw; border-radius: 50%;
        display: inline-block; flex: 0 0 auto;
      }

      .tv-ot-list {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: column; gap: 0.18vw;
        min-height: 0; overflow: hidden;
      }
      .tv-ot-row {
        display: grid;
        grid-template-columns: 0.6vw 5.2vw 2vw 1fr 6vw 1.5vw;
        gap: 0.35vw;
        align-items: baseline;
        font-size: 0.78vw;
        line-height: 1.2;
      }
      .tv-ot-row > span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .tv-ot-row-full { opacity: 0.55; }
      .tv-ot-when {
        color: #cbd5e1;
        font-variant-numeric: tabular-nums;
      }
      .tv-ot-bld {
        color: #94a3b8;
        font-variant-numeric: tabular-nums;
      }
      .tv-ot-scope { color: #f1f5f9; }
      .tv-ot-slots {
        color: #cbd5e1;
        font-size: 0.72vw;
        text-align: right;
      }
      .tv-ot-name { color: #e2e8f0; }
      .tv-ot-empty { color: #475569; font-style: italic; }
      .tv-ot-sep { color: #334155; margin: 0 0.18vw; }
      .tv-ot-filled {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .tv-ot-overflow {
        margin-top: 0.2vw;
        color: #64748b;
        font-size: 0.68vw;
        font-style: italic;
        text-align: center;
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
