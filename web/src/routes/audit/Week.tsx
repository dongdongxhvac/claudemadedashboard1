// §05 PM Audit — how the week was spent (docs/pm-audit.md §9).
// Per person: what the labor report says they logged, where those hours went
// by kind of task, on which days, and how their closed PMs audited. Hours are
// counted on the person who did the work and the day it was done — half of
// all entries are logged on a task assigned to someone else.
import { Fragment, useMemo, useState } from 'react';
import { useAuditEngineers, useAuditPto, useAuditWeekRange, useAuditWeekTime } from '../../hooks/usePmAudit';
import {
  BUCKETS, KIND_LABEL, SITE_LABEL, addDays, auditWeekLabel, bucketOf, buildWeekTime, dayLabel, dayMarks, easternDay, fmtH, fmtStamp, pct, rosterKey, shortName,
  weekDays, weekFirstDay, weekLabel,
  type Bucket, type DayMark, type LaborItem, type OtherPerson, type PtoRow, type TechWeek,
} from '../../lib/pmAudit';
import { AuditShell, Notice, Panel, Soft, StatTile } from './AuditUi';
import { A, BUCKET_COLOR, buttonStyle, cardStyle, tdStyle, thStyle, tileGrid } from './auditTheme';
import { useAuditParams } from './useAuditParams';

const num = { ...tdStyle, padding: '14px 6px', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const };
const thNum = { ...thStyle, padding: '12px 6px', textAlign: 'right' as const, letterSpacing: '0.02em', verticalAlign: 'bottom' as const, lineHeight: 1.35 };
const thText = { ...thStyle, padding: '12px 12px', verticalAlign: 'bottom' as const, lineHeight: 1.35 };
/** The days and the three PM-result columns each read as a group: a rule on the group's left edge. */
const groupEdge = { borderLeft: `1px solid ${A.lineSoft}`, paddingLeft: 10 };

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
  const label = `${t.tech}: ${parts.map((b) => `${b.label} ${fmtH(t.byBucket[b.key])} h`).join(', ')}${t.unplaced > 0 ? `, not on a task ${fmtH(t.unplaced)} h` : ''}`;
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', gap: 2, height: 14, width: `${(100 * total) / scale}%`, minWidth: 4 }}>
      {parts.map((b) => (
        <div key={b.key} title={`${b.label} · ${fmtH(t.byBucket[b.key])} h`}
          style={{ flex: `${t.byBucket[b.key]} 0 0`, minWidth: 2, background: BUCKET_COLOR[b.key], borderRadius: 2 }} />
      ))}
      {t.unplaced > 0 && (
        <div title={`Not on a task we hold · ${fmtH(t.unplaced)} h`}
          style={{ flex: `${t.unplaced} 0 0`, minWidth: 2, background: A.track, border: `1px solid ${A.control}`, boxSizing: 'border-box', borderRadius: 2 }} />
      )}
    </div>
  );
}

/** A day cell. Plain hours, or a mark where the day was set against the PTO
 *  calendar (green: it agrees; red: it does not), and an orange underline
 *  where some of the day's hours are double-booked. */
function DayCell({ hours, double, mark, first }: { hours: number; double: number; mark: DayMark | null; first: boolean }) {
  const base = { ...num, padding: '14px 5px', ...(first ? groupEdge : null) };
  if (mark) {
    const tone = mark.tone === 'green' ? { background: A.greenSoft, color: A.greenDark } : { background: A.redSoft, color: A.redDark };
    return (
      <td style={base} title={mark.why}>
        <span style={{ display: 'inline-block', minWidth: 18, padding: '1px 4px', borderRadius: 4, fontSize: 12, fontWeight: 600, textAlign: 'center', ...tone }}>{mark.label}</span>
      </td>
    );
  }
  if (hours <= 0) return <td style={{ ...base, color: A.faint }}>·</td>;
  return (
    <td style={base} title={double > 0 ? `${fmtH(double, false)} h of this is double-booked` : undefined}>
      <span style={double > 0 ? { borderBottom: `2px solid ${A.orange}`, paddingBottom: 1 } : undefined}>{fmtH(hours)}</span>
    </td>
  );
}

function EntryLine({ it, repeat }: { it: LaborItem; repeat?: boolean }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '52px 128px 1fr', gap: 10, alignItems: 'baseline' }}>
      <span style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: repeat ? A.orangeDark : undefined }}>{fmtH(Number(it.hours), false)} h</span>
      <span style={{ whiteSpace: 'nowrap' }}>{it.task_no}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Swatch bucket={bucketOf(it.bucket)} />
        {it.task_name ?? '—'}
        <span style={{ color: A.muted }}>
          {' '}· {KIND_LABEL[it.bucket] ?? it.bucket}
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
  const wt = useMemo(
    () => (dataQ.data && week ? buildWeekTime(dataQ.data.items, dataQ.data.hours, dataQ.data.closes, week, engineers, cols?.first ?? week, cols?.names.length ?? 7) : null),
    [dataQ.data, week, engineers, cols],
  );
  const scale = wt ? Math.max(0, ...wt.techs.map((t) => Math.max(t.logged ?? 0, t.placed))) : 0;
  const earliest = range.data?.firstClose ?? null;
  const atEarliest = !week || !earliest || week <= earliest;
  const atLatest = !week || !current || week >= current;
  const team = wt?.team;
  const placedPct = team ? pct(team.placed, Math.max(team.logged, team.placed)) : null;

  return (
    <AuditShell
      kicker="Section 05 · Week"
      title={week ? `How the week was spent · ${auditWeekLabel(week, p.site)}${week === current ? ' (in progress)' : ''}` : 'How the week was spent'}
      subtitle="Engineers' hours by the person who did the work, on the day it was done — from the labor entries on each Cove task, set against the labor report's weekly total."
      actions={week && (
        <>
          <button type="button" style={{ ...buttonStyle, opacity: atEarliest ? 0.45 : 1, cursor: atEarliest ? 'default' : 'pointer' }}
            disabled={atEarliest} onClick={() => p.set({ week: addDays(week, -7) })}>← Prior week</button>
          <button type="button" style={{ ...buttonStyle, opacity: atLatest ? 0.45 : 1, cursor: atLatest ? 'default' : 'pointer' }}
            disabled={atLatest} onClick={() => p.set({ week: addDays(week, 7) })}>Next week →</button>
        </>
      )}
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
              sub={`${team.people} engineer${team.people === 1 ? '' : 's'} · labor report${wt.asOf ? `, as of ${fmtStamp(wt.asOf)}` : ''}`} />
            <StatTile label="Placed on a task" value={<>{Math.round(team.placed).toLocaleString()} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>h · {placedPct === null ? '—' : `${placedPct}%`}</span></>}
              sub="hours we can name the task for" />
            <StatTile label="Not on a task we hold" value={<>{Math.round(team.unplaced).toLocaleString()} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>h</span></>}
              valueColor={team.unplaced > 0 ? A.orange : undefined}
              sub="logged on tasks not pulled yet, or on open work orders" />
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

          <div className="audit-table-box audit-table-card" style={cardStyle}>
            <table style={{ width: '100%', minWidth: 1180, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thText}>Engineer</th>
                  <th style={thNum} title="Total hours on the Cove labor report for the week">Logged</th>
                  <th style={{ ...thText, minWidth: days.length > 7 ? 96 : 120 }}>Where it went</th>
                  {BUCKETS.map((b) => (
                    <th key={b.key} style={thNum} title={b.label}>
                      {/* the bar's colour as an underline: ties the column to the bar without widening it */}
                      <span style={{ display: 'inline-block', paddingBottom: 3, borderBottom: `3px solid ${BUCKET_COLOR[b.key]}` }}>{b.short}</span>
                    </th>
                  ))}
                  <th style={thNum} title="Logged hours that are on no task we hold">Not<br />placed</th>
                  {days.map((d, i) => <th key={i} title={`${d} ${dayLabel(addDays(firstDay, i))}`} style={{ ...thNum, padding: '12px 5px', ...(i === 0 ? groupEdge : null) }}>{d}</th>)}
                  <th style={{ ...thNum, ...groupEdge }} title="Recurring PMs this engineer closed that week">PMs<br />closed</th>
                  <th style={thNum} title="Of those, how many the audit flagged">Flagged</th>
                  <th style={thNum} title="Of those, how many were good: a photo or a thick note, and no flag">Good</th>
                </tr>
              </thead>
              <tbody>
                {wt.techs.map((t) => {
                  const key = `${t.site_code}|${t.tech}`;
                  const isOpen = open === key;
                  const who = roster?.get(rosterKey(t.tech));
                  const marks = who && ptoQ.data
                    ? dayMarks(t.byDay, firstDay, { weekFirst: weekFirstDay(week, t.site_code), crew: who.crew, pto: ptoByUser.get(who.user_id) ?? [], today })
                    : null;
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}
                            style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: A.ink, cursor: 'pointer', textAlign: 'left' }}>
                            <span aria-hidden="true" style={{ display: 'inline-block', width: 14, color: A.muted }}>{isOpen ? '▾' : '▸'}</span>{t.tech}
                          </button>
                          {p.site === 'both' && <div style={{ color: A.muted, fontSize: 12, fontWeight: 400, paddingLeft: 14 }}>{SITE_LABEL[t.site_code as 'upark' | 'binney'] ?? t.site_code}</div>}
                          {t.double > 0 && <div style={{ color: A.orangeDark, fontSize: 12, fontWeight: 500, paddingLeft: 14 }}>{fmtH(t.double, false)} h double-booked</div>}
                        </td>
                        <td style={{ ...num, fontWeight: 600, color: t.logged === null ? A.faint : undefined }}>{t.logged === null ? '—' : fmtH(t.logged, false)}</td>
                        <td style={{ ...tdStyle, verticalAlign: 'middle' }}><HoursBar t={t} scale={scale} /></td>
                        {BUCKETS.map((b) => <td key={b.key} style={num}>{fmtH(t.byBucket[b.key])}</td>)}
                        <td style={{ ...num, color: t.unplaced > 0 ? A.orangeDark : A.faint, fontWeight: t.unplaced > 0 ? 600 : 400 }}>{t.unplaced > 0 ? fmtH(t.unplaced) : '—'}</td>
                        {t.byDay.map((h, i) => <DayCell key={i} hours={h} double={t.doubleByDay[i] ?? 0} mark={marks?.[i] ?? null} first={i === 0} />)}
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
                <strong>Engineers only.</strong> Left off, because they are not engineers on the roster (Admin › User Profiles):{' '}
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
              <strong>Double-booked</strong> = a second (or later) entry by the same person on the same task on the same day,{' '}
              <span style={{ borderBottom: `2px solid ${A.orange}` }}>underlined</span> in the day columns and set apart when you open a name. Those hours are still in
              every total, as Cove has them. The catch-all unscheduled-task tasks are left out: they take one entry per small job.
            </div>
            <strong>Logged</strong> is the Cove labor report's total for the week as of its last poll (UPark: that week's last; Binney: hourly, and once more after the week ends), so hours entered later are not in it.
            <strong> Placed</strong> hours come from the labor entries on PM tasks (scheduled, on-demand, rounds, BMS), counted on the person who did the
            work and the day it was done, plus work orders at the hours they closed with. <strong>Not placed</strong> is the rest: time on tasks whose
            entries have not been pulled yet, and on work orders still open. The kind of work is read from the task's name. Click a name for the entries.
          </div>
        </>
      )}
    </AuditShell>
  );
}
