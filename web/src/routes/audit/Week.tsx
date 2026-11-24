// §05 PM Audit — how the week was spent (docs/pm-audit.md §9).
// Per person: what the labor report says they logged, where those hours went
// by kind of task, on which days, and how their closed PMs audited. Hours are
// counted on the person who did the work and the day it was done — half of
// all entries are logged on a task assigned to someone else.
import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAuditEngineers, useAuditPto, useAuditWeekRange, useAuditWeekTime } from '../../hooks/usePmAudit';
import {
  BUCKETS, LOW_WEEK_HOURS, SITE_LABEL, addDays, auditWeekLabel, bucketOf, buildWeekTime, attentionOf, dayLabel, dayMarks, easternDay, expectedEngineers, fmtH, fmtStamp, kindLabel, lowWeek, netTotal, pct, ptoHoursInWeek,
  rosterKey, shortName, weekDays, weekFirstDay, weekLabel, weekTotal,
  type Bucket, type DayMark, type LaborItem, type OtherPerson, type PtoRow, type TechWeek,
} from '../../lib/pmAudit';
import { AuditShell, Notice, Panel, Soft, StatTile } from './AuditUi';
import { A, BUCKET_COLOR, buttonStyle, cardStyle, tdStyle, thStyle, tileGrid } from './auditTheme';
import { useAuditParams } from './useAuditParams';

const num = { ...tdStyle, padding: '14px 5px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const };
const thNum = { ...thStyle, padding: '12px 5px', textAlign: 'right' as const, letterSpacing: '0.02em', verticalAlign: 'bottom' as const, lineHeight: 1.35 };
const thText = { ...thStyle, padding: '12px 12px', verticalAlign: 'bottom' as const, lineHeight: 1.35 };
/** The buttons that sit in the title line, beside the date range. */
const titleButton = { ...buttonStyle, height: 36, padding: '0 14px' };
/** The days and the three PM-result columns each read as a group: a rule on the group's left edge. */
const groupEdge = { borderLeft: `1px solid ${A.lineSoft}`, paddingLeft: 8 };

function otherLabel(o: OtherPerson): string {
  const h = Math.max(o.logged, o.placed);
  const parts = [h > 0 ? `${fmtH(h, false)} h` : '', o.closed > 0 ? `${o.closed} PM${o.closed === 1 ? '' : 's'} closed` : ''].filter(Boolean);
  return `${o.tech} (${parts.join(', ')})`;
}

function Swatch({ bucket }: { bucket: Bucket }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: BUCKET_COLOR[bucket], marginRight: 6, verticalAlign: 'baseline' }} />;
}

/** One person's hours as a bar: a segment per kind of work, then a grey
 *  remainder for hours the labor report has that are on no task we hold.
 *  `scale` = the longest bar on the page, so rows compare. */
function HoursBar({ t, scale }: { t: TechWeek; scale: number }) {
  const total = Math.max(t.logged ?? 0, t.placed);
  if (total <= 0 || scale <= 0) return null;
  const parts = BUCKETS.filter((b) => t.byBucket[b.key] > 0);
  const label = `${t.tech}: ${parts.map((b) => `${b.label} ${fmtH(t.byBucket[b.key])} h`).join(', ')}${t.unplaced > 0 ? `, unknown ${fmtH(t.unplaced)} h` : ''}`;
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', gap: 2, height: 14, width: `${(100 * total) / scale}%`, minWidth: 4 }}>
      {parts.map((b) => (
        <div key={b.key} title={`${b.label} · ${fmtH(t.byBucket[b.key])} h`}
          style={{ flex: `${t.byBucket[b.key]} 0 0`, minWidth: 2, background: BUCKET_COLOR[b.key], borderRadius: 2 }} />
      ))}
      {t.unplaced > 0 && (
        <div title={`Unknown — on no task the dashboard holds · ${fmtH(t.unplaced)} h`}
          style={{ flex: `${t.unplaced} 0 0`, minWidth: 2, background: A.track, border: `1px solid ${A.control}`, boxSizing: 'border-box', borderRadius: 2 }} />
      )}
    </div>
  );
}

/** A day cell. Plain hours, or a mark where the day was set against the PTO
 *  calendar (green: it agrees; red: it does not), and an orange underline
 *  where some of the day's hours are double-booked. */
function DayCell({ hours, entries, double, mark, first }: { hours: number; entries: number; double: number; mark: DayMark | null; first: boolean }) {
  const base = { ...num, padding: '14px 4px', ...(first ? groupEdge : null) };
  if (mark) {
    const tone = mark.tone === 'green' ? { background: A.greenSoft, color: A.greenDark } : { background: A.redSoft, color: A.redDark };
    return (
      <td style={base} title={mark.why}>
        <span style={{ display: 'inline-block', minWidth: 18, padding: '1px 3px', borderRadius: 4, fontSize: 12, fontWeight: 600, textAlign: 'center', ...tone }}>{mark.label}</span>
      </td>
    );
  }
  if (hours <= 0) return <td style={{ ...base, color: A.faint }}>·</td>;
  return (
    <td style={base} title={[
      double > 0 ? `${fmtH(double, false)} h of this is double-booked` : '',
      hours - entries > 0.05 ? `${fmtH(hours, false)} h on Cove's labor report, ${entries > 0 ? `${fmtH(entries, false)} h` : 'none'} of it on a task we hold` : '',
    ].filter(Boolean).join(' · ') || undefined}>
      <span style={double > 0 ? { borderBottom: `2px solid ${A.orange}`, paddingBottom: 1 } : undefined}>{fmtH(hours)}</span>
    </td>
  );
}

/** The Logged cell, as the manager asked for it (2026-11-23): the week's
 *  total bigger, then the double-booked hours to take off it, smaller —
 *  "25.8 −1.5". The small figure has its own fixed slot so the totals stay in
 *  a column. Red where the week is under the line (measured net, PTO counted). */
function LoggedCell({ t, low, ptoHours }: { t: TechWeek; low: boolean; ptoHours: number }) {
  const total = t.logged === null && !low && t.double <= 0 ? null : weekTotal(t);
  const why = [
    t.double > 0 ? `${fmtH(weekTotal(t), false)} h in Cove − ${fmtH(t.double, false)} h double-booked = ${fmtH(netTotal(t), false)} h` : '',
    low ? `Under ${LOW_WEEK_HOURS} h for the week${ptoHours > 0 ? `, even with ${fmtH(ptoHours, false)} h of approved PTO` : ''}`
      : ptoHours > 0 ? `Plus ${fmtH(ptoHours, false)} h of approved PTO this week` : '',
  ].filter(Boolean).join(' · ');
  return (
    <td style={{ ...num, fontWeight: 700, color: total === null ? A.faint : undefined }} title={why || undefined}>
      <span style={{ fontSize: 15, ...(low ? { display: 'inline-block', padding: '0 5px', borderRadius: 4, background: A.redSoft, color: A.redDark } : null) }}>
        {total === null ? '—' : fmtH(total, false)}
      </span>
      <span style={{ display: 'inline-block', minWidth: 28, paddingLeft: 3, textAlign: 'left', fontSize: 11, fontWeight: 600, color: A.orangeDark }}>
        {t.double > 0 ? `−${fmtH(t.double, false)}` : ''}
      </span>
    </td>
  );
}

function EntryLine({ it, repeat }: { it: LaborItem; repeat?: boolean }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '52px 128px 1fr', gap: 10, alignItems: 'baseline' }}>
      <span style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: repeat ? A.orangeDark : undefined }}>{fmtH(Number(it.hours), false)} h</span>
      <span style={{ whiteSpace: 'nowrap' }}>{it.task_no}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Swatch bucket={bucketOf(it.bucket, it.task_name)} />
        {it.task_name ?? '—'}
        <span style={{ color: A.muted }}>
          {' '}· {kindLabel(it)}
          {it.building ? ` · ${it.building}` : ''}
          {it.kind === 'pm' && it.assignee_name && it.assignee_name !== it.performer ? ` · on ${shortName(it.assignee_name)}'s task` : ''}
          {it.kind === 'pm' && it.task_closed === false ? ' · task still open' : ''}
          {it.kind === 'wo' ? ' · hours at close' : ''}
        </span>
      </span>
    </li>
  );
}

const entryList = { listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column' as const, gap: 3, fontSize: 13 };

/** The expanded row: that person's entries, day by day — the double-booked
 *  ones set apart under each day. */
function Entries({ t, firstDay, days }: { t: TechWeek; firstDay: string; days: string[] }) {
  const byDay = useMemo(() => {
    const m = new Map<string, LaborItem[]>();
    for (const it of t.items) {
      const list = m.get(it.day_local);
      if (list) list.push(it); else m.set(it.day_local, [it]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [t.items]);
  if (t.items.length === 0) {
    return <div style={{ fontSize: 13, color: A.muted }}>No labor entry on a task we hold for this week{t.logged ? ` — the ${fmtH(t.logged)} h the labor report shows are on tasks whose details have not been pulled yet` : ''}.</div>;
  }
  const repeats = new Set(t.doubleItems);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {byDay.map(([day, list]) => {
        const i = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000);
        const once = list.filter((it) => !repeats.has(it));
        const again = list.filter((it) => repeats.has(it));
        const sum = (l: LaborItem[]) => l.reduce((a, it) => a + Number(it.hours), 0);
        return (
          <div key={day}>
            <div style={{ fontSize: 12, fontWeight: 600, color: A.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {days[i] ?? ''} {dayLabel(day)} · {fmtH(sum(once), false)} h
              {again.length > 0 && <span style={{ color: A.orangeDark }}> + {fmtH(sum(again), false)} h double-booked</span>}
            </div>
            <ul style={entryList}>
              {once.map((it, k) => <EntryLine key={`${it.task_no}-${k}`} it={it} />)}
            </ul>
            {again.length > 0 && (
              <div style={{ marginTop: 6, padding: '6px 10px 8px', borderLeft: `3px solid ${A.orange}`, background: A.orangeSoft, borderRadius: '0 6px 6px 0' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: A.orangeDark }}>
                  Double-booked · {fmtH(sum(again), false)} h <span style={{ fontWeight: 400 }}>— a second entry on the same task that day</span>
                </div>
                <ul style={entryList}>
                  {again.map((it, k) => <EntryLine key={`${it.task_no}-${k}`} it={it} repeat />)}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What prints: the sheet the manager posts in the shop each Wednesday for the
 *  week before. Just the table — the engineer, the hours per day and the
 *  total — with no title block and no footnote, thin margins, and type as
 *  large as the page allows (manager 2026-11-23). The site and the week sit in
 *  the first column's heading so the sheet still says what it is. It lives
 *  outside #root, hidden on screen; in print #root is hidden instead, so the
 *  page is this sheet alone, landscape. Names run A–Z so people can find
 *  themselves. A day the PTO calendar covers prints "PTO" without the kind of
 *  leave — the sheet hangs on a wall. Sizes are in em so everything follows
 *  the one font size `printFont` works out. */
const PRINT_CSS = `
.audit-print-sheet { display: none; }
@media print {
  @page { size: landscape; margin: 0.25in; }
  #root { display: none !important; }
  html, body { background: #fff !important; margin: 0 !important; }
  .audit-print-sheet { display: block; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; font-size: var(--aps-font, 12pt);
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .audit-print-sheet table { width: 100%; border-collapse: collapse; }
  .audit-print-sheet thead { display: table-header-group; }
  .audit-print-sheet tr { break-inside: avoid; }
  .audit-print-sheet th { font-size: 0.68em; line-height: 1.2; font-weight: 700; text-align: right; padding: 0.1em 0.5em 0.2em; border-bottom: 1.5pt solid #000; white-space: nowrap; vertical-align: bottom; }
  .audit-print-sheet th small { display: block; font-size: 0.74em; font-weight: 400; color: #333; }
  .audit-print-sheet th:first-child, .audit-print-sheet td:first-child { text-align: left; padding-left: 0.15em; }
  .audit-print-sheet td { line-height: 1.25; padding: 0.12em 0.34em; text-align: right; border-bottom: 0.5pt solid #999; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .audit-print-sheet td:first-child { font-weight: 600; }
  .audit-print-sheet td small { font-size: 0.6em; font-weight: 400; color: #333; }
  .audit-print-sheet .aps-pto { font-size: 0.72em; font-weight: 700; letter-spacing: 0.04em; color: ${A.greenDark}; }
  .audit-print-sheet .aps-zero { display: inline-block; min-width: 0.9em; padding: 0 0.22em; line-height: 1.05; border: 1pt solid ${A.red}; color: ${A.red}; font-weight: 700; text-align: center; }
  .audit-print-sheet .aps-red { color: ${A.red}; font-weight: 700; }
  .audit-print-sheet .aps-total { font-weight: 700; border-left: 1pt solid #000; }
  .audit-print-sheet .aps-minus { display: inline-block; min-width: 2.7em; padding-left: 0.2em; text-align: left; font-size: 0.62em; font-weight: 700; color: ${A.orange}; }
  .audit-print-sheet .aps-flag { background: ${A.yellow}; padding: 0 0.2em; margin-left: -0.2em; border-radius: 0.12em; }
  .audit-print-sheet .aps-flag-light { background: ${A.yellowLight}; }
  .audit-print-sheet .aps-low { display: inline-block; padding: 0 0.25em; line-height: 1.15; border-radius: 0.12em; background: ${A.redSoft}; color: ${A.red}; }
}
`;

/** The largest type, in points, that keeps the sheet on one landscape Letter
 *  page inside 0.25 in margins (756 × 576 pt of paper to fill). Height: a body
 *  row is about 1.5 em tall and the heading row about 1.8 em. Width: the
 *  longest name, then about 2.9 em per day and 5.2 em for the total (2.6 em
 *  when nobody has double-booked hours to show after it). */
function printFont(n: number, nDays: number, longestName: number, anyDouble: boolean): number {
  const byHeight = (576 * 0.96) / (1.5 * Math.max(1, n) + 1.8);
  const byWidth = (756 * 0.97) / (0.58 * longestName + 1 + 2.9 * nDays + (anyDouble ? 5.2 : 3.0));
  return Math.max(7, Math.floor(Math.min(byHeight, byWidth) * 10) / 10);
}

/** A table row: the person's week, their days against the PTO calendar, and their approved PTO hours that week. */
type PrintRow = { t: TechWeek; marks: (DayMark | null)[] | null; ptoHours: number };

function PrintSheet({ rows, days, firstDay, rangeLabel, siteLabel, showSite, inProgress }: {
  rows: PrintRow[]; days: string[]; firstDay: string; rangeLabel: string; siteLabel: string; showSite: boolean; inProgress: boolean;
}) {
  const sorted = [...rows].sort((a, b) => a.t.tech.localeCompare(b.t.tech) || a.t.site_code.localeCompare(b.t.site_code));
  const anyDouble = sorted.some(({ t }) => t.double > 0);
  const longest = Math.max(8, ...sorted.map(({ t }) => t.tech.length + (showSite ? 5 : 0)));
  const fontPt = printFont(sorted.length, days.length, longest, anyDouble);
  return createPortal(
    <div className="audit-print-sheet" style={{ '--aps-font': `${fontPt}pt` } as CSSProperties}>
      <style>{PRINT_CSS}</style>
      <table>
        <thead>
          <tr>
            <th>{siteLabel ? `${siteLabel} · ` : ''}{rangeLabel}{inProgress ? ' (in progress)' : ''}</th>
            {days.map((d, i) => <th key={i}>{d}<small>{dayLabel(addDays(firstDay, i))}</small></th>)}
            <th className="aps-total">Total<small>hours</small></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ t, marks, ptoHours }) => {
            const level = attentionOf(t, marks, inProgress, ptoHours);
            return (
            <tr key={`${t.site_code}|${t.tech}`}>
              <td>
                {level ? <span className={level === 'light' ? 'aps-flag aps-flag-light' : 'aps-flag'}>{t.tech}</span> : t.tech}
                {showSite && <small> · {SITE_LABEL[t.site_code as 'upark' | 'binney'] ?? t.site_code}</small>}
              </td>
              {t.byDay.map((h, i) => {
                const m = marks?.[i] ?? null;
                return (
                  <td key={i}>
                    {h > 0 ? (m?.tone === 'red' ? <span className="aps-red">{fmtH(h)}</span> : fmtH(h))
                      : m?.tone === 'green' ? <span className="aps-pto">PTO</span> : m?.tone === 'red' ? <span className="aps-zero">0</span> : ''}
                  </td>
                );
              })}
              <td className="aps-total">
                {lowWeek(t, inProgress, ptoHours) ? <span className="aps-low">{fmtH(weekTotal(t), false)}</span> : fmtH(weekTotal(t), false)}
                {anyDouble && <span className="aps-minus">{t.double > 0 ? `−${fmtH(t.double, false)}` : ''}</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

export default function AuditWeek() {
  const p = useAuditParams();
  const range = useAuditWeekRange();
  // Binney's week turns over on Sunday, a day before UPark's
  const current = (p.site === 'upark' ? range.data?.current : range.data?.currentSun ?? range.data?.current) ?? null;
  const week = p.week ?? range.data?.latest ?? current;
  const dataQ = useAuditWeekTime(week, p.site);
  const rosterQ = useAuditEngineers();
  const [open, setOpen] = useState<string | null>(null);
  const cols = useMemo(() => (week ? weekDays(week, p.site) : null), [week, p.site]);
  const firstDay = cols?.first ?? null;
  const days = cols?.names ?? [];

  // Engineers only. If the roster cannot be read, show everyone and say so
  // rather than an empty page.
  const roster = useMemo(() => (rosterQ.data && rosterQ.data.length > 0 ? new Map(rosterQ.data.map((x) => [x.key, x] as const)) : null), [rosterQ.data]);
  const engineers = useMemo(() => (roster ? new Set(roster.keys()) : null), [roster]);
  // The PTO calendar for the days on the page, per person
  const ptoQ = useAuditPto(firstDay, firstDay ? addDays(firstDay, days.length - 1) : null);
  const ptoByUser = useMemo(() => {
    const m = new Map<string, PtoRow[]>();
    for (const r of ptoQ.data ?? []) { const l = m.get(r.user_id); if (l) l.push(r); else m.set(r.user_id, [r]); }
    return m;
  }, [ptoQ.data]);
  const today = easternDay(new Date().toISOString()) ?? '9999-12-31';
  // Every active engineer of the site(s) on the page gets a row, hours or not
  const expected = useMemo(
    () => (rosterQ.data && cols ? expectedEngineers(rosterQ.data, p.site, addDays(cols.first, cols.names.length - 1)) : []),
    [rosterQ.data, cols, p.site],
  );
  const wt = useMemo(
    () => (dataQ.data && week ? buildWeekTime(dataQ.data.items, dataQ.data.hours, dataQ.data.closes, week, engineers, cols?.first ?? week, cols?.names.length ?? 7, expected, dataQ.data.dayHours ?? []) : null),
    [dataQ.data, week, engineers, cols, expected],
  );
  // Each row's days set against the PTO calendar — for the table and the printed sheet
  const rows = useMemo<PrintRow[]>(() => (wt && week && firstDay ? wt.techs.map((t) => {
    const who = roster?.get(rosterKey(t.tech));
    const pto = who && ptoQ.data ? ptoByUser.get(who.user_id) ?? [] : null;
    const weekFirst = weekFirstDay(week, t.site_code);
    return {
      t,
      marks: who && pto ? dayMarks(t.byDay, firstDay, { weekFirst, crew: who.crew, pto, today }) : null,
      ptoHours: who && pto ? ptoHoursInWeek(pto, weekFirst, who.crew) : 0,
    };
  }) : []), [wt, week, firstDay, roster, ptoQ.data, ptoByUser, today]);
  const scale = wt ? Math.max(0, ...wt.techs.map((t) => Math.max(t.logged ?? 0, t.placed))) : 0;
  const earliest = range.data?.firstClose ?? null;
  const atEarliest = !week || !earliest || week <= earliest;
  const atLatest = !week || !current || week >= current;
  const team = wt?.team;
  const placedPct = team ? pct(team.placed, Math.max(team.logged, team.placed)) : null;

  return (
    <AuditShell
      kicker="Section 05 · Week"
      title={week ? (
        // the date range, then the two week steps, then Print (manager 2026-11-23)
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px' }}>
          <span style={{ marginRight: 4 }}>How the week was spent · {auditWeekLabel(week, p.site)}{week === current ? ' (in progress)' : ''}</span>
          <button type="button" style={{ ...titleButton, opacity: atEarliest ? 0.45 : 1, cursor: atEarliest ? 'default' : 'pointer' }}
            disabled={atEarliest} onClick={() => p.set({ week: addDays(week, -7) })}>← Prior week</button>
          <button type="button" style={{ ...titleButton, opacity: atLatest ? 0.45 : 1, cursor: atLatest ? 'default' : 'pointer' }}
            disabled={atLatest} onClick={() => p.set({ week: addDays(week, 7) })}>Next week →</button>
          <button type="button" onClick={() => window.print()} disabled={rows.length === 0}
            title="Prints the engineers and their hours per day, landscape — the sheet for the shop wall"
            style={{ ...titleButton, opacity: rows.length === 0 ? 0.45 : 1, cursor: rows.length === 0 ? 'default' : 'pointer' }}>
            Print
          </button>
        </span>
      ) : 'How the week was spent'}
      subtitle="Engineers' hours by the person who did the work, on the day it was done — from the labor entries on each Cove task, set against the labor report's weekly total."
    >
      {range.isLoading || dataQ.isLoading || rosterQ.isLoading ? (
        <Notice>Loading the week…</Notice>
      ) : dataQ.isError ? (
        <Notice tone="error">Could not load the week: {(dataQ.error as Error).message}</Notice>
      ) : !wt || !team || !week || !firstDay ? (
        <Notice>No week to show yet.</Notice>
      ) : wt.techs.length === 0 ? (
        <Notice>No engineer logged labor for the week of {auditWeekLabel(week, p.site)}{p.site !== 'both' ? ` at ${SITE_LABEL[p.site]}` : ''}.</Notice>
      ) : (
        <>
          <div style={tileGrid}>
            <StatTile label="Logged in Cove" value={<>{Math.round(team.logged).toLocaleString()} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>h</span></>}
              sub={`${team.people} engineer${team.people === 1 ? '' : 's'}${team.noHours > 0 ? ` · ${team.noHours} more with no hours` : ''} · labor report${wt.asOf ? `, as of ${fmtStamp(wt.asOf)}` : ''}`} />
            <StatTile label="Placed on a task" value={<>{Math.round(team.placed).toLocaleString()} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>h · {placedPct === null ? '—' : `${placedPct}%`}</span></>}
              sub="hours we can name the task for" />
            <StatTile label="Unknown" value={<>{Math.round(team.unplaced).toLocaleString()} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>h</span></>}
              valueColor={team.unplaced > 0 ? A.orange : undefined}
              sub="hours Cove counts that are on no task the dashboard holds" />
            <StatTile label="On someone else's task" value={`${pct(team.onOthers, team.pmTaskHours) ?? 0}%`}
              sub={`${Math.round(team.onOthers).toLocaleString()} of ${Math.round(team.pmTaskHours).toLocaleString()} PM-task hours`} />
            <StatTile label="Double-booked" value={<>{fmtH(team.double, false)} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>h</span></>}
              valueColor={team.double > 0 ? A.orange : undefined}
              sub={team.double > 0 ? `a second entry on the same task the same day · ${team.doublePeople} engineer${team.doublePeople === 1 ? '' : 's'}` : 'no task has two entries by one person on one day'} />
          </div>

          <Panel title={<>Where the hours went <Soft>· all engineers</Soft></>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '8px 24px', fontSize: 13 }}>
              {BUCKETS.map((b) => (
                <div key={b.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span><Swatch bucket={b.key} />{b.label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    <strong>{fmtH(team.byBucket[b.key], false)} h</strong>
                    <span style={{ color: A.muted }}> · {pct(team.byBucket[b.key], team.placed) ?? 0}%</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <PrintSheet rows={rows} days={days} firstDay={firstDay} rangeLabel={auditWeekLabel(week, p.site)}
            siteLabel={p.site === 'both' ? '' : SITE_LABEL[p.site]} showSite={p.site === 'both'} inProgress={week === current} />

          <div className="audit-table-box audit-table-card" style={cardStyle}>
            <table style={{ width: '100%', minWidth: 1180, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thText}>Engineer</th>
                  <th style={thNum} title={`The week's hours on the Cove labor report, less double-booked hours — highlighted under ${LOW_WEEK_HOURS} h once the week is over`}>Logged</th>
                  <th style={{ ...thText, minWidth: days.length > 7 ? 92 : 110 }}>Where<br />it went</th>
                  {BUCKETS.map((b) => (
                    <th key={b.key} style={thNum} title={b.label}>
                      {/* the bar's colour as an underline: ties the column to the bar without widening it */}
                      <span style={{ display: 'inline-block', paddingBottom: 3, borderBottom: `3px solid ${BUCKET_COLOR[b.key]}` }}>{b.short}</span>
                    </th>
                  ))}
                  <th style={thNum} title="Hours Cove counts for the week that are on no task the dashboard holds, so their kind of work is unknown">Unk</th>
                  {days.map((d, i) => <th key={i} title={`${d} ${dayLabel(addDays(firstDay, i))}`} style={{ ...thNum, padding: '12px 4px', ...(i === 0 ? groupEdge : null) }}>{d}</th>)}
                  <th style={{ ...thNum, ...groupEdge }} title="Recurring PMs this engineer closed that week">PMs<br />closed</th>
                  <th style={thNum} title="Of those, how many the audit flagged">Flagged</th>
                  <th style={thNum} title="Of those, how many were good: a photo or a thick note, and no flag">Good</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t, marks, ptoHours }) => {
                  const key = `${t.site_code}|${t.tech}`;
                  const isOpen = open === key;
                  const attention = attentionOf(t, marks, week === current, ptoHours);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}
                            style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: A.ink, cursor: 'pointer', textAlign: 'left' }}>
                            <span aria-hidden="true" style={{ display: 'inline-block', width: 14, color: A.muted }}>{isOpen ? '▾' : '▸'}</span>
                            <span title={attention === 'strong' ? 'The week\'s total is flagged' : attention === 'light' ? 'The total is fine, but a scheduled day has no hours logged' : undefined}
                              style={attention ? { background: attention === 'strong' ? A.yellow : A.yellowLight, padding: '1px 4px', margin: '0 -4px', borderRadius: 3 } : undefined}>{t.tech}</span>
                          </button>
                          {p.site === 'both' && <div style={{ color: A.muted, fontSize: 12, fontWeight: 400, paddingLeft: 14 }}>{SITE_LABEL[t.site_code as 'upark' | 'binney'] ?? t.site_code}</div>}
                        </td>
                        <LoggedCell t={t} low={lowWeek(t, week === current, ptoHours)} ptoHours={ptoHours} />
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }}><HoursBar t={t} scale={scale} /></td>
                        {BUCKETS.map((b) => <td key={b.key} style={num}>{fmtH(t.byBucket[b.key])}</td>)}
                        <td style={{ ...num, color: t.unplaced > 0 ? A.orangeDark : A.faint, fontWeight: t.unplaced > 0 ? 600 : 400 }}>{t.unplaced > 0 ? fmtH(t.unplaced) : '—'}</td>
                        {t.byDay.map((h, i) => <DayCell key={i} hours={h} entries={t.entryByDay[i] ?? 0} double={t.doubleByDay[i] ?? 0} mark={marks?.[i] ?? null} first={i === 0} />)}
                        <td style={{ ...num, ...groupEdge, color: t.closed > 0 ? undefined : A.faint }}>{t.closed > 0 ? t.closed : '—'}</td>
                        <td style={{ ...num, color: t.flagged > 0 ? A.red : A.faint, fontWeight: t.flagged > 0 ? 600 : 400 }}>{t.closed > 0 ? t.flagged : ''}</td>
                        <td style={{ ...num, color: t.good > 0 ? A.greenDark : A.faint, fontWeight: t.good > 0 ? 600 : 400 }}>{t.closed > 0 ? t.good : ''}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7 + days.length + BUCKETS.length} style={{ ...tdStyle, background: A.bg, padding: '14px 26px 18px' }}>
                            <Entries t={t} firstDay={firstDay} days={days} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
            {!engineers ? (
              <div style={{ color: A.orangeDark, marginBottom: 6 }}>
                The engineer roster could not be read, so this page shows everyone on the labor report.
              </div>
            ) : wt.others.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <strong>Engineers only.</strong> Every active engineer of the site has a row, hours or not. Left off, because they are not engineers on the roster (Admin › User Profiles):{' '}
                {wt.others.map(otherLabel).join(' · ')}. Their hours are not in the totals above.
              </div>
            )}
            {p.site === 'binney' && (
              <div style={{ marginBottom: 6 }}>
                <strong>Sunday to Saturday.</strong> Binney's week starts on Sunday {dayLabel(firstDay)} and ends on Saturday {dayLabel(addDays(firstDay, 6))}.
                The review queue and the scorecard count the same seven days.
              </div>
            )}
            {p.site === 'both' && (
              <div style={{ marginBottom: 6 }}>
                <strong>Two weeks side by side.</strong> Binney's runs Sunday to Saturday ({weekLabel(firstDay)}), UPark's Monday to Sunday ({weekLabel(week)}).
                The first Sun column is Binney's, the last is UPark's.
              </div>
            )}
            <div style={{ marginBottom: 6 }}>
              <strong>Days against the PTO calendar.</strong>{' '}
              <span style={{ background: A.greenSoft, color: A.greenDark, fontWeight: 600, borderRadius: 4, padding: '0 4px' }}>Vac</span> green: no hours that day and a
              whole-day approved request on the calendar (the label is its type).{' '}
              <span style={{ background: A.redSoft, color: A.redDark, fontWeight: 600, borderRadius: 4, padding: '0 4px' }}>0</span> red: a scheduled day with no hours and
              nothing approved to cover it, or hours logged on a whole-day PTO day. Scheduled days come from the shift on each profile (Sun–Wed crew,
              Wed–Sat crew, otherwise Monday to Friday); days off stay blank, and today is not judged yet. Hover a mark for the reason.
              {ptoQ.isError && <span style={{ color: A.orangeDark }}> The PTO calendar could not be read, so no day is marked.</span>}
            </div>
            <div style={{ marginBottom: 6 }}>
              <strong>Double-booked</strong> = more than one entry by the same person on the same task on the same day (the largest stands).
              They show in <strong>Logged</strong> as a small <span style={{ color: A.orangeDark, fontWeight: 600 }}>−1.5</span> after the total (hover for the sum),{' '}
              <span style={{ borderBottom: `2px solid ${A.orange}` }}>underlined</span> where they sit in the day columns, and set apart when you open a name.
              The catch-all unscheduled-task tasks are left out: they take one entry per small job.
              A <span style={{ background: A.redSoft, color: A.redDark, fontWeight: 600, borderRadius: 4, padding: '0 4px' }}>Logged</span> total
              under {LOW_WEEK_HOURS} h is highlighted once the week is over; approved PTO hours that week count toward the {LOW_WEEK_HOURS}.
              A <span style={{ background: A.yellow, borderRadius: 3, padding: '0 4px', color: A.ink, fontWeight: 600 }}>name</span> is highlighted when its total is flagged, and{' '}
              <span style={{ background: A.yellowLight, borderRadius: 3, padding: '0 4px', color: A.ink, fontWeight: 600 }}>lightly</span> when the total is fine but a scheduled day has no hours logged.
            </div>
            The <strong>day columns</strong> are Cove's labor report for each day — every hour by the day it was worked, including time on work orders still open;
            the columns by kind of work, and the entries under a name, come from the tasks we hold, so they can add up to less.{' '}
            <strong>Logged</strong> is the Cove labor report's total for the week as of its last poll (UPark: that week's last; Binney: hourly, and once more after the week ends), so hours entered later are not in it.
            <strong> Placed</strong> hours come from the labor entries on PM tasks (scheduled, on-demand, rounds, BMS), counted on the person who did the
            work and the day it was done, plus work orders at the hours they closed with. <strong>Unknown</strong> is the rest: hours Cove counts
            that are on no task the dashboard holds — work orders still open, tasks assigned to someone off the roster or older than its window, and entries
            edited in Cove after they were typed. The kind of work is read from the task's name. On-demand tasks are sorted by their title: a boiler or chiller opening or closing, tube punching, any
            maintenance, cleaning or inspection, and any title with "PM" in it count with <strong>PMs</strong>; <strong>ODT-E</strong> is escort; <strong>ODT-R</strong> is repair — the title names a piece of equipment or says on-call;
            <strong>ODT-A</strong> is all other: training, meetings, van service and the unscheduled-task tasks. <strong>Unk</strong> = Unknown.{' '}
            Click a name for the entries.
          </div>
        </>
      )}
    </AuditShell>
  );
}
