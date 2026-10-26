// Binney St — Workload · Performance + PMs closed · Labor.
//
// The two sub-panels of UPark's TV "Workload + Performance" tile
// (routes/tv/TvView.tsx: WorkloadSection + CrewSection), rebuilt for the
// Binney manager page in the light theme and fed by the Binney-scoped
// snapshot hooks (0152). Kept separate from the TV code on purpose — the
// isolate-new-features rule — the only shared pieces are pure helpers.
//
// Binney-specific:
//   * days-worked denominator follows the 4×10 crews (shifts.crew: Sun–Wed
//     / Wed–Sat; a null-crew shift is Mon–Fri) instead of UPark's Mon–Fri,
//     minus BMR holidays and approved full-day PTO, counted through
//     yesterday like UPark;
//   * the PM/labor roster includes everyone the Binney pollers fetch, but
//     the crew table is engineer-level only (managers Balbo / Nardone close
//     PMs too — they stay off the table, same rule as UPark's wall).
import { useMemo } from 'react';
import { useEngineers, type EngineerRow } from './hooks/useBinneyEngineers';
import { usePtoRequests, type PtoRequest } from './hooks/useBinneyPto';
import { useShifts } from '../../hooks/useShifts';
import {
  useBinneyPmRows, useBinneyWoRows, useBinneyLaborDaily, useBinneyPmCloses, useBinneySnapshotAges,
} from './hooks/useBinneySnapshots';
import { woDaysSinceUpdate, WO_STALE_DAYS, type WoRow } from '../../hooks/useCurrentSnapshots';
import { isClosed, addDays, localISODate } from '../../lib/dashboard';
import { BMR_HOLIDAYS } from '../../lib/bmrHolidays';

const WORKLOAD_AHEAD_DAYS = 4;
const CREW_WINDOW_DAYS = 8;
const HOLIDAY_ISOS = new Set(BMR_HOLIDAYS.map((h) => h.date));

type Crew = 'saturday' | 'sunday' | null;

function shortName(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function formatAge(now: Date, ts: string | null | undefined): string {
  if (!ts) return 'never';
  const ms = now.getTime() - new Date(ts).getTime();
  if (ms < 0) return 'fresh';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return '< 1h';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Does this crew work on the given local date? Mirrors BinneyPtoPanel's
 *  crewWorksOn, except an UNASSIGNED shift counts as Mon–Fri here — a
 *  denominator needs a definite schedule, not "every day". */
function crewWorksOn(crew: Crew | undefined, d: Date): boolean {
  const dow = d.getDay();
  if (crew === 'sunday') return dow <= 3;
  if (crew === 'saturday') return dow >= 3;
  return dow >= 1 && dow <= 5;
}

/** Scheduled days in [start, end), capped at end-of-asOf, minus BMR holidays. */
function scheduledIsos(crew: Crew | undefined, win: { start: Date; end: Date }, asOf: Date): string[] {
  const cap = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + 1);
  const end = win.end < cap ? win.end : cap;
  const out: string[] = [];
  for (const d = new Date(win.start); d < end; d.setDate(d.getDate() + 1)) {
    if (!crewWorksOn(crew, d)) continue;
    const iso = localISODate(d);
    if (HOLIDAY_ISOS.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

/** Approved full-day PTO ISO dates per user_id (partial days still count as worked). */
function ptoDaysByUser(pto: PtoRequest[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of pto) {
    if (r.status !== 'approved') continue;
    if (r.out_from || r.out_until) continue;
    const set = m.get(r.user_id) ?? new Set<string>();
    for (const d = new Date(r.starts_on + 'T00:00:00'); localISODate(d) <= r.ends_on; d.setDate(d.getDate() + 1)) {
      set.add(localISODate(d));
    }
    m.set(r.user_id, set);
  }
  return m;
}

export function BinneyWorkloadPanel() {
  const pmQ = useBinneyPmRows();
  const woQ = useBinneyWoRows();
  const laborQ = useBinneyLaborDaily(CREW_WINDOW_DAYS + 2);
  const closesQ = useBinneyPmCloses(CREW_WINDOW_DAYS + 2);
  const agesQ = useBinneySnapshotAges();
  const engQ = useEngineers();
  const shiftsQ = useShifts();
  const ptoQ = usePtoRequests();

  // One clock per calendar day: the day-based math below only needs to move
  // when the date does (data refetches drive the rest).
  const todayIso = localISODate(new Date());
  const now = useMemo(() => new Date(), [todayIso]); // eslint-disable-line react-hooks/exhaustive-deps
  const engineers = useMemo(() => engQ.data ?? [], [engQ.data]);
  const neverPolled = agesQ.data && !agesQ.data.pm12 && !agesQ.data.labor;

  // CMMS spelling → display name, for every active Binney person the pollers fetch.
  const displayByCmms = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of engineers) {
      if (!e.active) continue;
      if (e.cmms_assignee_name) m.set(e.cmms_assignee_name, e.full_name);
      m.set(e.full_name, e.full_name);
    }
    return m;
  }, [engineers]);

  // ───────────── Workload: overdue + today + next 4 days, per person
  const workload = useMemo(() => {
    const rows = pmQ.data ?? [];
    const todayD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = localISODate(todayD);
    const aheadStr = localISODate(addDays(todayD, WORKLOAD_AHEAD_DAYS));
    type Acc = { count: number; overdue: number };
    const byTech = new Map<string, Acc>();
    let overdue = 0, today = 0, ahead = 0;
    for (const r of rows) {
      if (isClosed(r.status) || !r.due_date || r.due_date > aheadStr) continue;
      const raw = (r.assigned_to_name ?? '').trim() || 'Unassigned';
      const name = displayByCmms.get(raw) ?? raw;
      const acc = byTech.get(name) ?? { count: 0, overdue: 0 };
      acc.count++;
      if (r.due_date < todayStr) { overdue++; acc.overdue++; }
      else if (r.due_date === todayStr) today++;
      else ahead++;
      byTech.set(name, acc);
    }
    const cards = Array.from(byTech.entries())
      .map(([name, a]) => ({ name, ...a }))
      .sort((a, b) => b.count - a.count || b.overdue - a.overdue || a.name.localeCompare(b.name));
    return { cards, overdue, today, ahead, total: overdue + today + ahead };
  }, [pmQ.data, displayByCmms, now]);

  const staleWos = useMemo(() => {
    const rows: WoRow[] = woQ.data ?? [];
    return rows
      .filter((w) => w.is_open !== false && !isClosed(w.status))
      .map((w) => ({ id: w.wo_id ?? '?', days: woDaysSinceUpdate(w, now) }))
      .filter((w): w is { id: string; days: number } => w.days !== null && w.days >= WO_STALE_DAYS)
      .sort((a, b) => b.days - a.days);
  }, [woQ.data, now]);

  // ───────────── Crew: PMs closed + labor hours, last 8 days, hrs/days
  const crew = useMemo(() => {
    const crewByShiftId = new Map<string, Crew>((shiftsQ.data ?? []).map((s) => [s.id, s.crew]));
    const winEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const winStart = addDays(winEnd, -CREW_WINDOW_DAYS);
    const dayCountAsOf = addDays(now, -1);
    const win = { start: winStart, end: winEnd };
    const ptoByUser = ptoDaysByUser(ptoQ.data ?? []);

    // Engineer-level crew only; key every CMMS spelling to the profile.
    const byKey = new Map<string, EngineerRow>();
    for (const e of engineers) {
      if (!e.active || e.role !== 'engineer' || e.is_manager) continue;
      byKey.set(e.full_name, e);
      if (e.cmms_assignee_name) byKey.set(e.cmms_assignee_name, e);
    }
    type Acc = { eng: EngineerRow; pms: number; hours: number };
    const acc = new Map<string, Acc>();
    const get = (e: EngineerRow): Acc => {
      let cur = acc.get(e.user_id);
      if (!cur) { cur = { eng: e, pms: 0, hours: 0 }; acc.set(e.user_id, cur); }
      return cur;
    };
    for (const c of closesQ.data ?? []) {
      const e = byKey.get((c.assigned_to_name ?? '').trim());
      const d = new Date(c.completed_on);
      if (e && d >= winStart && d < winEnd) get(e).pms++;
    }
    for (const l of laborQ.data ?? []) {
      const e = byKey.get((l.assigned_to_name ?? '').trim());
      const d = new Date(l.day_et + 'T00:00:00');
      if (e && d >= winStart && d < winEnd) get(e).hours += l.hours_that_day ?? 0;
    }
    const rows = Array.from(acc.values()).map(({ eng, pms, hours }) => {
      const crewTag = eng.shift_id ? crewByShiftId.get(eng.shift_id) : undefined;
      const sched = scheduledIsos(crewTag, win, dayCountAsOf);
      const off = ptoByUser.get(eng.user_id) ?? new Set<string>();
      const days = sched.filter((iso) => !off.has(iso)).length;
      return { name: eng.full_name, pms, hours, days, fullDays: sched.length };
    });
    // Fewest hours first (UPark rule): surfaces who is light on logged labor.
    rows.sort((a, b) => a.hours - b.hours || a.pms - b.pms);
    return rows;
  }, [closesQ.data, laborQ.data, ptoQ.data, engineers, shiftsQ.data, now]);

  // Labor hours are derived from daily snapshots, and the Binney labor poller
  // only started 2026-10-26 — until the window's first day has a snapshot the
  // hrs column is incomplete. Note it next to the title; disappears on its own.
  const laborNote = useMemo(() => {
    const days = (laborQ.data ?? []).map((l) => l.day_et).filter(Boolean).sort();
    if (days.length === 0) return null;
    const first = days[0];
    const winStartIso = localISODate(addDays(now, -(CREW_WINDOW_DAYS - 1)));
    if (first <= winStartIso) return null;
    const complete = addDays(new Date(first + 'T00:00:00'), CREW_WINDOW_DAYS - 1);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `labor hrs collecting since ${fmt(new Date(first + 'T00:00:00'))} · complete ${fmt(complete)}`;
  }, [laborQ.data, now]);

  const half = Math.ceil(crew.length / 2);
  const cols = [crew.slice(0, half), crew.slice(half)];

  const loading = pmQ.isLoading || engQ.isLoading;
  const err = pmQ.error ?? woQ.error ?? laborQ.error ?? closesQ.error ?? null;

  return (
    <section className="t-card" style={{ padding: '1rem 1.25rem', borderTop: '3px solid var(--color-warn)' }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="t-section-title" style={{ letterSpacing: '0.04em' }}>Workload · Performance</h2>
          {laborNote && (
            <span className="t-small t-warn" style={{ fontWeight: 600 }} title="Per-day hours come from daily Cove labor snapshots; the Binney poller is new, so earlier days in the window have none yet.">
              ⏳ {laborNote}
            </span>
          )}
        </div>
        <span className="t-small t-muted">
          PM <b className="t-text">{formatAge(now, agesQ.data?.pm12)}</b>
          <span className="mx-1">·</span>
          WO <b className="t-text">{formatAge(now, agesQ.data?.wo)}</b>
          <span className="mx-1">·</span>
          Labor <b className="t-text">{formatAge(now, agesQ.data?.labor)}</b>
        </span>
      </div>

      {err && <p className="t-small t-danger mb-2">Couldn't load Cove snapshots: {(err as Error).message}</p>}
      {neverPolled && !err && (
        <p className="t-small t-muted mb-3">
          No Binney Cove snapshots yet — the Binney pm12 / wo12 / labor pollers haven't run.
          Once they do (hourly, 7a–7p), this fills in.
        </p>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)' }}>
        {/* ── PMs closed · labor ── */}
        <div>
          <div className="t-small t-muted uppercase tracking-wider">PMs closed · labor · last {CREW_WINDOW_DAYS} days</div>
          <div className="t-small t-muted mt-0.5">
            hrs/days · days = crew schedule through yesterday · holidays + approved PTO excluded
          </div>
          {crew.length === 0 ? (
            <p className="t-small t-muted mt-2">{loading ? 'Loading…' : 'No data.'}</p>
          ) : (
            <div className="grid gap-x-6 mt-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {cols.map((col, i) => (
                <div key={i} className="grid items-baseline" style={{ gridTemplateColumns: 'max-content auto auto', columnGap: '0.75rem', rowGap: '0.15rem' }}>
                  <span className="t-small t-muted uppercase tracking-wider"> </span>
                  <span className="t-small t-muted uppercase tracking-wider text-right">PMs</span>
                  <span className="t-small t-muted uppercase tracking-wider text-right">hrs/d</span>
                  {col.map((c) => (
                    <div key={c.name} className="contents">
                      <span className="t-text">{shortName(c.name)}</span>
                      <span className="t-mono text-right">{c.pms}</span>
                      <span className="t-mono text-right">
                        {Math.round(c.hours)}
                        <span
                          className="t-small"
                          style={{ color: c.days >= c.fullDays ? 'var(--color-ok)' : 'var(--color-warn)', fontWeight: 600 }}
                        >
                          /{c.days}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Workload ── */}
        <div>
          <div className="t-small t-muted uppercase tracking-wider">
            Due in {WORKLOAD_AHEAD_DAYS}d + today + overdue · <strong className="t-text">{workload.total}</strong>
            {workload.overdue > 0 && (
              <span className="t-warn ml-2" style={{ fontWeight: 700 }}>⚠ {workload.overdue} overdue</span>
            )}
          </div>
          <div className="t-small t-muted mt-0.5">
            {workload.overdue} overdue · {workload.today} today · {workload.ahead} next {WORKLOAD_AHEAD_DAYS}d
          </div>
          {loading ? (
            <p className="t-small t-muted mt-2">Loading…</p>
          ) : workload.cards.length === 0 ? (
            <p className="t-small t-muted mt-2">Nothing on the board.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 mt-2 list-none p-0 m-0">
              {workload.cards.map((c) => (
                <li
                  key={c.name}
                  className="flex items-baseline gap-1.5 rounded px-2 py-1"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                >
                  <span className="t-mono" style={{ fontWeight: 700, color: 'var(--color-warn)', fontSize: 16 }}>{c.count}</span>
                  <span className="t-text">{shortName(c.name)}</span>
                  {c.overdue > 0 && <span className="t-small t-danger">{c.overdue} overdue</span>}
                </li>
              ))}
            </ul>
          )}
          {staleWos.length > 0 && (
            <div className="t-small mt-3" title={`Open WOs with no Cove update in ${WO_STALE_DAYS}+ days`}>
              <span className="t-danger" style={{ fontWeight: 700 }}>WO {WO_STALE_DAYS}d+ no update: {staleWos.length}</span>
              <span className="t-mono t-muted ml-2">{staleWos.map((w) => `${w.id} ${w.days}d`).join(' · ')}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
