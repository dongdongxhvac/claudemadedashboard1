// Overtime coverage heatmap — §11's calendar view of OT coverage on the
// UPark manager page. User 2026-10-14: "create a heat map for overtime
// coverage in managerview like PTO".
//
// Same grid as PtoPanel's CapHeatmap (weeks as rows, Mon–Sun across the
// top, 9/13/26/52-week horizon picker, two weeks of history, month
// dividers and bands, BMR-holiday outline, today ring, hover tooltip on
// desktop / tap sheet on phones), but each cell is a DAY OF OVERTIME:
//   colour  = how many slots are still open that day — green when every
//             slot is filled, amber 1 open, orange 2, red 3+; quiet grey
//             when nothing is posted;
//   label   = who is signed up (initials, like the PTO map) when the day
//             has one shift with 1–2 names, else filled/needed;
//   badge   = the shift count when more than one lands on the day;
//   teal dot = at least one shift comes from the OT viewer (Outlook).
// Sources, the same two the TV wall merges: the dashboard's own posts
// (overtime_posts, §11 — every status but cancelled) and the OT viewer's
// jobs (ot_api_jobs mirror for what is coming; ot_api_jobs_log 0141 for
// what already ran, since the mirror drops a job once its day passes).
// A shift counts on the LOCAL DATE IT STARTS — an 11 PM–3 AM post is one
// night's coverage, not two days'. Weekends are NOT dimmed (unlike the PTO
// map): off-hour work lands on them.
//
// Beside the map, "Open slots" lists the future days in view that still
// have an uncovered slot — the cells worth acting on, in words.
//
// Own file, own copies of the small date helpers (isolate-new-features
// rule): nothing here is imported by PtoPanel or the TV views.
import { Fragment, useMemo, useState } from 'react';
import {
  OVERTIME_CATEGORY_LABELS,
  OVERTIME_CATEGORY_COLOR,
  type OvertimePost,
} from '../hooks/useOvertime';
import {
  useOtApiJobs,
  useOtApiJobsLog,
  useOtApiRealtime,
  otApiJobHappened,
  type OtApiJob,
} from '../hooks/useOtApi';
import { BMR_HOLIDAYS } from '../lib/bmrHolidays';

// ───────────────────────────── helpers

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Local calendar date (YYYY-MM-DD) of a timestamp. */
function localDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

function fmtMd(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDow(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "2026-10-05" → "OCTOBER"; January carries the year. */
function monthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const name = d.toLocaleDateString(undefined, { month: 'long' }).toUpperCase();
  return d.getMonth() === 0 ? `${name} ${d.getFullYear()}` : name;
}

function MonthDivider({ label, width }: { label: string; width?: number }) {
  return (
    <div
      className="t-muted"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width, margin: '2px 0 5px',
        fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
      }}
    >
      <span style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
    </div>
  );
}

function LegendChip({ color, label, border }: { color: string; label: string; border?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 12, height: 12, background: color, borderRadius: 2, border: border ?? '1px solid rgba(0,0,0,0.1)', boxSizing: 'border-box' }} />
      <span>{label}</span>
    </span>
  );
}

/** First letter of the first and last name words ("Austin Marsh" → "AM");
 *  words without letters are skipped so digits in a cell always mean a
 *  count. Same rule as the PTO map. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return '?';
  const first = (w: string) => w.match(/[A-Za-z]/)![0].toUpperCase();
  if (words.length === 1) return first(words[0]);
  return first(words[0]) + first(words[words.length - 1]);
}

/** "Austin Marsh" → "Austin M." */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** The OT viewer's colour — teal, distinct from every post category (the
 *  same value the TV wall uses for its dot). */
const OT_API_COLOR = '#2dd4bf';

/** One shift on the map, whichever system it came from. */
type Shift = {
  key: string;
  source: 'post' | 'api';
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  color: string;      // category colour for a post, teal for an OT-viewer job
  lane: string;       // category label, or "OT viewer" / "Outlook"
  where: string;
  scope: string;
  needed: number;
  filled: number;
  names: string[];
};

function postToShift(p: OvertimePost): Shift {
  const where = p.building_short_code || p.building_code || p.building_label || p.building_name || '—';
  return {
    key: `post:${p.id}`,
    source: 'post',
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    allDay: false,
    color: OVERTIME_CATEGORY_COLOR[p.category],
    lane: OVERTIME_CATEGORY_LABELS[p.category],
    where,
    scope: p.scope,
    needed: p.slots_needed,
    filled: p.slots_filled,
    names: p.signups.map((s) => s.user_name ?? '—'),
  };
}

function jobToShift(j: OtApiJob): Shift {
  return {
    key: `api:${j.id}`,
    source: 'api',
    startsAt: j.start_at,
    endsAt: j.end_at,
    allDay: j.all_day,
    color: OT_API_COLOR,
    lane: j.source === 'added' ? 'OT viewer' : 'Outlook',
    where: j.location || j.title || '—',
    // When the location already shows, the title is the scope; otherwise
    // the title IS the where, so fall back to the notes.
    scope: j.location ? j.title : (j.notes ?? ''),
    needed: j.spaces,
    filled: j.filled,
    names: j.volunteers.map((v) => v.name ?? v.email ?? '—'),
  };
}

function shiftWhen(s: Shift): string {
  if (s.allDay) return 'all day';
  return s.endsAt ? `${fmtTime(s.startsAt)} – ${fmtTime(s.endsAt)}` : fmtTime(s.startsAt);
}

function openOf(s: Shift): number {
  return Math.max(s.needed - s.filled, 0);
}

// ───────────────────────────── component

export function OvertimeHeatmap({ posts, onPickDate }: {
  posts: OvertimePost[];
  /** Fine-pointer click / sheet button on a future day: open the New-post
   *  form with that date. Absent for read-only viewers. */
  onPickDate?: (iso: string) => void;
}) {
  // Horizon — 9 / 13 / 26 / 52 FUTURE weeks, plus PAST_WEEKS of history
  // (faded) so last week's coverage stays visible. OT is posted a few
  // weeks out at most, so this map defaults to the shortest view.
  const [weeks, setWeeks] = useState<9 | 13 | 26 | 52>(9);
  const coarse = useMemo(
    () => window.matchMedia('(hover: none), (pointer: coarse)').matches,
    [],
  );
  const PAST_WEEKS = 2;
  const today = todayIso();

  // Monday of the current week, minus the history window.
  const start = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    const dow = d.getDay();
    const back = (dow + 6) % 7;
    d.setDate(d.getDate() - back - PAST_WEEKS * 7);
    return d.toLocaleDateString('en-CA');
  }, [today]);
  const totalWeeks = weeks + PAST_WEEKS;
  const totalDays = totalWeeks * 7;

  // OT-viewer jobs: the live mirror for what is coming, the permanent log
  // for what already ran (minus ghosts that dropped off before they
  // started). The log query is keyed on the grid's first day.
  useOtApiRealtime();
  const jobsQ = useOtApiJobs();
  const logSince = useMemo(() => new Date(start + 'T00:00:00').toISOString(), [start]);
  const logQ = useOtApiJobsLog(logSince);
  const jobs = jobsQ.data;
  const log = logQ.data;

  const shiftsByDay = useMemo(() => {
    const m = new Map<string, Shift[]>();
    const push = (s: Shift) => {
      const day = localDateOf(s.startsAt);
      const list = m.get(day) ?? [];
      list.push(s);
      m.set(day, list);
    };
    for (const p of posts) if (p.status !== 'cancelled') push(postToShift(p));
    const liveIds = new Set<string>();
    for (const j of jobs ?? []) { liveIds.add(j.id); push(jobToShift(j)); }
    for (const j of log ?? []) if (!liveIds.has(j.id) && otApiJobHappened(j)) push(jobToShift(j));
    for (const list of m.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return m;
  }, [posts, jobs, log]);

  // BMR-observed holiday lookup — outline + tooltip only.
  const holidayByDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of BMR_HOLIDAYS) {
      const cur = m.get(h.date);
      m.set(h.date, cur ? `${cur} / ${h.name}` : h.name);
    }
    return m;
  }, []);

  const CELL_W = 40;
  const CELL_H = 26;
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  type Cell = {
    iso: string;
    col: number;
    row: number;
    isToday: boolean;
    isPast: boolean;
    isWeekend: boolean;
    shifts: Shift[];
    needed: number;
    filled: number;
    open: number;
    holiday: string | null;
  };
  const [detailCell, setDetailCell] = useState<Cell | null>(null);

  const cells: Cell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const iso = d.toLocaleDateString('en-CA');
    const row = i % 7;
    const col = Math.floor(i / 7);
    const shifts = shiftsByDay.get(iso) ?? [];
    cells.push({
      iso, col, row,
      isToday:   iso === today,
      isPast:    iso < today,
      isWeekend: row >= 5,
      shifts,
      needed: shifts.reduce((s, x) => s + x.needed, 0),
      filled: shifts.reduce((s, x) => s + x.filled, 0),
      open:   shifts.reduce((s, x) => s + openOf(x), 0),
      holiday: holidayByDay.get(iso) ?? null,
    });
  }

  // Week rows — Monday m/d gutter label, month band + divider by the
  // week's TUESDAY (same rule as the PTO map so the two agree).
  const todayRow = cells.find((c) => c.isToday)?.col ?? -1;
  type WeekRow = { col: number; label: string; cells: Cell[]; banded: boolean; divider: string | null };
  const weekRows: WeekRow[] = [];
  for (let c = 0; c < totalWeeks; c++) {
    const wk = cells.slice(c * 7, c * 7 + 7);
    const tue = new Date(wk[1].iso + 'T00:00:00');
    const prevTue = c > 0 ? new Date(cells[(c - 1) * 7 + 1].iso + 'T00:00:00') : null;
    const startsMonth = prevTue !== null &&
      (tue.getMonth() !== prevTue.getMonth() || tue.getFullYear() !== prevTue.getFullYear());
    weekRows.push({
      col: c,
      label: fmtMd(wk[0].iso),
      cells: wk,
      banded: tue.getMonth() % 2 === 1,
      divider: startsMonth ? monthLabel(wk[1].iso) : null,
    });
  }

  // Cell colour = open slots that day. No OT = quiet grey so the coverage
  // colours stand out; past cells use the same palette, faded by opacity,
  // so history shows what went unfilled rather than just grey.
  const NO_OT_BG = 'rgba(148,163,184,0.12)';
  const COVERED_BG = 'rgba(34,197,94,0.35)';
  const OPEN1_BG = 'rgba(234,179,8,0.40)';
  const OPEN2_BG = 'rgba(234,88,12,0.50)';
  const OPEN3_BG = 'rgba(220,38,38,0.55)';
  const color = (cell: Cell): string => {
    if (cell.shifts.length === 0) return NO_OT_BG;
    if (cell.open <= 0) return COVERED_BG;
    if (cell.open === 1) return OPEN1_BG;
    if (cell.open === 2) return OPEN2_BG;
    return OPEN3_BG;
  };

  // In-cell label: one shift with 1–2 sign-ups → their initials; anything
  // else → the day's filled/needed. Digits always mean slots, never names.
  const cellLabel = (cell: Cell): string[] => {
    if (cell.shifts.length === 0) return [];
    if (cell.shifts.length === 1) {
      const s = cell.shifts[0];
      if (s.names.length >= 1 && s.names.length <= 2) return s.names.map(initialsOf);
    }
    return [`${cell.filled}/${cell.needed}`];
  };

  const shiftLine = (s: Shift): string =>
    `${shiftWhen(s)} · ${s.where}${s.scope ? ` · ${s.scope}` : ''} · ${s.filled}/${s.needed}` +
    `${s.names.length ? ` · ${s.names.join(', ')}` : ''}${openOf(s) > 0 ? ` — ${openOf(s)} open` : ''} [${s.lane}]`;

  const tooltip = (cell: Cell): string => {
    const nice = new Date(cell.iso + 'T00:00:00')
      .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const date = `${nice} · ${cell.iso}${cell.isToday ? ' (today)' : ''}${cell.isPast ? ' (past)' : ''}`;
    const holLine = cell.holiday ? `\n★ BMR holiday — ${cell.holiday}` : '';
    const hint = !cell.isPast && onPickDate ? '\n(click to post overtime)' : '';
    if (cell.shifts.length === 0) {
      return `${date}${holLine}\n${cell.isPast ? 'No overtime' : 'No overtime posted'}${hint}`;
    }
    const n = cell.shifts.length;
    const head = `\nOvertime: ${n} shift${n === 1 ? '' : 's'} · ${cell.filled}/${cell.needed} filled${cell.open > 0 ? ` · ${cell.open} open` : ' · covered'}`;
    return `${date}${holLine}${head}\n${cell.shifts.map((s) => `• ${shiftLine(s)}`).join('\n')}${hint}`;
  };

  // "Open slots" digest — future days in view with an uncovered slot.
  const DIGEST_MAX = 20;
  const openRows: { iso: string; shift: Shift }[] = [];
  let shiftsInView = 0, neededInView = 0, filledInView = 0;
  let pastShifts = 0, pastUnfilled = 0;
  for (const cell of cells) {
    shiftsInView += cell.shifts.length;
    neededInView += cell.needed;
    filledInView += cell.filled;
    if (cell.isPast) { pastShifts += cell.shifts.length; pastUnfilled += cell.open; continue; }
    for (const s of cell.shifts) if (openOf(s) > 0) openRows.push({ iso: cell.iso, shift: s });
  }

  const gridWidth = 34 + CELL_W * 7 + 21;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Pinned to the grid's width (34 gutter + 7×40 cells + 21 gaps =
          335) plus room for a scrollbar on the 52w view, like the PTO map. */}
      <div style={{ flex: '0 0 350px', width: 350, maxWidth: '100%' }}>
        <div className="t-small t-muted uppercase tracking-wider mb-2 flex items-baseline justify-between gap-2 flex-wrap">
          <span>Overtime coverage heatmap</span>
          <span style={{ textTransform: 'none', display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
            {([9, 13, 26, 52] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeeks(w)}
                className="t-small"
                style={{
                  padding: '0.05rem 0.4rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 999,
                  background: w === weeks ? 'var(--color-accent)' : 'var(--color-card)',
                  color: w === weeks ? 'white' : 'var(--color-text-muted)',
                  fontWeight: w === weeks ? 600 : 400,
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >{w}w</button>
            ))}
          </span>
        </div>

        <div className="t-small t-muted mb-2 flex items-center gap-2" style={{ fontSize: 10, flexWrap: 'wrap' }}>
          <LegendChip color={NO_OT_BG} label="no OT" />
          <LegendChip color={COVERED_BG} label="covered" />
          <LegendChip color={OPEN1_BG} label="1 open" />
          <LegendChip color={OPEN2_BG} label="2" />
          <LegendChip color={OPEN3_BG} label="3+" />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <span style={{ minWidth: 11, height: 11, borderRadius: 999, background: 'var(--color-text)', color: 'var(--color-card)', fontSize: 7, lineHeight: '11px', textAlign: 'center', fontWeight: 700, padding: '0 2px' }}>2</span>
            <span>shifts</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: OT_API_COLOR, border: '1px solid rgba(0,0,0,0.15)' }} />
            <span>OT viewer</span>
          </span>
          <LegendChip color="transparent" border="2px solid #10b981" label="BMR holiday" />
        </div>

        <div style={{ maxHeight: 860, overflowY: 'auto' }}>
          <div
            style={{
              display: 'grid', gridTemplateColumns: `34px repeat(7, ${CELL_W}px)`, gap: 3,
              position: 'sticky', top: 0, zIndex: 1,
              background: 'var(--color-card)', paddingBottom: 4,
            }}
          >
            <div />
            {dayLabels.map((d) => (
              <div key={d} className="t-muted" style={{ fontSize: 9, height: 14, lineHeight: '14px', textAlign: 'center' }}>
                {d}
              </div>
            ))}
          </div>
          {weekRows.map((wk) => (
            <Fragment key={wk.col}>
              {wk.divider && <MonthDivider label={wk.divider} width={gridWidth} />}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `34px repeat(7, ${CELL_W}px)`,
                  gap: 3, marginBottom: 3,
                  background: wk.banded ? 'rgba(99,102,241,0.05)' : 'transparent',
                  borderRadius: 4,
                }}
              >
                <div
                  className="t-mono"
                  style={{
                    fontSize: 9, height: CELL_H, lineHeight: `${CELL_H}px`, textAlign: 'right',
                    color: wk.col === todayRow ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    fontWeight: wk.col === todayRow ? 700 : 400,
                  }}
                >
                  {wk.label}
                </div>
                {wk.cells.map((cell) => {
                  const parts = cellLabel(cell);
                  const labelLen = parts.reduce((s, p) => s + p.length + 1, -1);
                  const clickable = coarse || (!cell.isPast && !!onPickDate);
                  const hasApi = cell.shifts.some((s) => s.source === 'api');
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={
                        coarse ? () => setDetailCell(cell)
                        : clickable ? () => onPickDate!(cell.iso)
                        : undefined
                      }
                      disabled={!clickable}
                      title={tooltip(cell)}
                      style={{
                        position: 'relative',
                        width: CELL_W, height: CELL_H, padding: 0,
                        borderRadius: 3,
                        background: color(cell),
                        // Weekends stay full strength — that is where
                        // off-hour work lands. Past cells fade.
                        opacity: cell.isPast ? 0.45 : 1,
                        border: cell.isToday
                          ? '2px solid var(--color-accent)'
                          : cell.holiday
                            ? '2px solid #10b981'
                            : '1px solid rgba(0,0,0,0.08)',
                        cursor: clickable ? 'pointer' : 'default',
                        fontSize: labelLen >= 4 ? 10 : 13,
                        fontWeight: 700,
                        color: cell.open >= 2 ? 'white' : 'var(--color-text)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      {parts.map((p, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span style={{ opacity: 0.6 }}>·</span>}
                          <span>{p}</span>
                        </Fragment>
                      ))}
                      {cell.shifts.length > 1 && (
                        <span
                          style={{
                            position: 'absolute', top: 1, right: 1,
                            minWidth: 9, height: 9, borderRadius: 999,
                            background: 'var(--color-text)', color: 'var(--color-card)',
                            border: '1px solid rgba(255,255,255,0.85)',
                            fontSize: 7, lineHeight: '7px', fontWeight: 700, padding: '0 1px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {cell.shifts.length}
                        </span>
                      )}
                      {hasApi && (
                        <span
                          style={{
                            position: 'absolute', bottom: 1, right: 1,
                            width: 7, height: 7, borderRadius: 999,
                            background: OT_API_COLOR,
                            border: '1px solid rgba(255,255,255,0.85)',
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
        <div className="t-muted" style={{ fontSize: 9, marginTop: 4, fontStyle: 'italic' }}>
          {coarse ? 'Tap a day for details' : onPickDate ? 'Hover a day for details · click a future day to post overtime' : 'Hover a day for details'}
        </div>
      </div>

      {/* Open-slots digest — the red/amber future cells, in words. */}
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div className="t-small t-muted uppercase tracking-wider mb-2">
          Open slots · next {weeks} weeks
          {openRows.length > 0 && (
            <span style={{ textTransform: 'none', marginLeft: 6, color: 'var(--color-danger)', fontWeight: 600 }}>
              {openRows.reduce((s, r) => s + openOf(r.shift), 0)} open
            </span>
          )}
        </div>
        {openRows.length === 0 ? (
          <p className="t-small t-muted italic">
            {shiftsInView - pastShifts === 0
              ? `No overtime posted in the next ${weeks} weeks.`
              : `Every shift in the next ${weeks} weeks is covered.`}
          </p>
        ) : (
          <ul className="space-y-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {openRows.slice(0, DIGEST_MAX).map(({ iso, shift: s }) => (
              <li key={s.key} className="t-small" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span className="t-mono" style={{ fontWeight: 700, minWidth: 64 }}>{fmtDow(iso)} {fmtMd(iso)}</span>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0, alignSelf: 'center' }} title={s.lane} />
                <span className="t-muted">{shiftWhen(s)}</span>
                <strong>{s.where}</strong>
                {s.scope && <span>{s.scope}</span>}
                <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{openOf(s)} open</span>
                <span className="t-muted">
                  {s.filled}/{s.needed}{s.names.length ? ` · ${s.names.map(shortName).join(', ')}` : ''}
                </span>
              </li>
            ))}
            {openRows.length > DIGEST_MAX && (
              <li className="t-small t-muted italic">+{openRows.length - DIGEST_MAX} more</li>
            )}
          </ul>
        )}
        <div className="t-small t-muted" style={{ marginTop: 8 }}>
          In view: {shiftsInView} shift{shiftsInView === 1 ? '' : 's'} · {filledInView}/{neededInView} slots filled
          {pastShifts > 0 && (
            <> · past {PAST_WEEKS} weeks: {pastShifts} shift{pastShifts === 1 ? '' : 's'}, {pastUnfilled === 0 ? 'all covered' : `${pastUnfilled} slot${pastUnfilled === 1 ? '' : 's'} went unfilled`}</>
          )}
        </div>
      </div>

      {/* Tap-detail bottom sheet (coarse-pointer devices). */}
      {detailCell && (
        <>
          <div
            onClick={() => setDetailCell(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60 }}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61,
              background: 'var(--color-card)',
              borderTopLeftRadius: 12, borderTopRightRadius: 12,
              boxShadow: '0 -6px 24px rgba(0,0,0,0.25)',
              padding: '0.9rem 1rem calc(0.9rem + env(safe-area-inset-bottom))',
              maxHeight: '70vh', overflowY: 'auto',
            }}
          >
            <div className="t-text" style={{ fontWeight: 700 }}>
              {new Date(detailCell.iso + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'long', month: 'long', day: 'numeric',
              })}
              {detailCell.isToday && <span style={{ color: 'var(--color-accent)' }}> · today</span>}
              {detailCell.isPast && <span className="t-muted" style={{ fontWeight: 400 }}> · past</span>}
            </div>
            {detailCell.holiday && (
              <div className="t-small" style={{ color: '#10b981', fontWeight: 600, marginTop: 2 }}>
                ★ BMR holiday — {detailCell.holiday}
              </div>
            )}
            <div className="t-small t-muted" style={{ marginTop: 2 }}>
              {detailCell.shifts.length === 0
                ? 'No overtime'
                : `${detailCell.shifts.length} shift${detailCell.shifts.length === 1 ? '' : 's'} · ${detailCell.filled}/${detailCell.needed} filled${detailCell.open > 0 ? ` · ${detailCell.open} open` : ' · covered'}`}
            </div>
            <ul className="space-y-1" style={{ margin: '0.6rem 0 0', padding: 0, listStyle: 'none' }}>
              {detailCell.shifts.map((s) => (
                <li key={s.key} className="t-small" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flexShrink: 0, marginTop: 4 }} />
                  <span>
                    <strong>{s.where}</strong>{s.scope ? ` · ${s.scope}` : ''}
                    <span className="t-muted"> · {shiftWhen(s)} · {s.lane}</span>
                    <br />
                    <span style={{ color: openOf(s) > 0 ? 'var(--color-danger)' : 'var(--color-ok, #10b981)', fontWeight: 600 }}>
                      {s.filled}/{s.needed}{openOf(s) > 0 ? ` · ${openOf(s)} open` : ' · covered'}
                    </span>
                    {s.names.length > 0 && <span className="t-muted"> · {s.names.join(', ')}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              {!detailCell.isPast && onPickDate && (
                <button
                  type="button"
                  onClick={() => { const iso = detailCell.iso; setDetailCell(null); onPickDate(iso); }}
                  className="t-small"
                  style={{ flex: 1, background: 'var(--color-accent)', color: 'white', border: 'none', borderRadius: 8, padding: '0.55rem', fontWeight: 600 }}
                >
                  + Post overtime {fmtMd(detailCell.iso)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailCell(null)}
                className="t-small"
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.55rem', fontWeight: 600, background: 'var(--color-card)', color: 'var(--color-text)' }}
              >Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
