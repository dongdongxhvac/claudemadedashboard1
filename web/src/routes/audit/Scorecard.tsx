// §05 PM Audit — the scorecard (docs/pm-audit.md §4.3): PM quality per tech
// over the last 4 / 8 / 13 weeks, from v_pm_audit_scorecard plus the
// per-close rows of v_pm_audit_flags (so multi-week rates add up exactly).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SCORE_WEEKS_MAX, useAuditEngineers, useAuditHoursSplit, useAuditScorecard, useAuditWeekRange } from '../../hooks/usePmAudit';
import { FLAG_LABEL, SITE_LABEL, WORK_TYPES, buildHoursSplit, buildScorecard, dayLabel, weekFirstDay, fmtH, fmtPct, pct, type HoursSplit, type TechHours, type TechScore } from '../../lib/pmAudit';
import { AuditShell, BarRow, Notice, Panel, Segmented, Soft, StatTile } from './AuditUi';
import { A, WORK_TYPE_COLOR, cardStyle, tdStyle, thStyle, tileGrid } from './auditTheme';
import { useAuditParams } from './useAuditParams';

type Win = '4' | '8' | '13';
const WINDOWS: { value: Win; label: string }[] = [
  { value: '4', label: '4 wk' },
  { value: '8', label: '8 wk' },
  { value: '13', label: 'Quarter' },
];
const SPARK_WEEKS = 8;

/** Photo-rate trend, one point per week; gaps where the tech closed nothing
 *  with details that week. The 0–100 scale is fixed so rows compare. */
function Spark({ values, weeks, site }: { values: (number | null)[]; weeks: string[]; site: string }) {
  const pts = values.map((v, i) => (v === null ? null : { x: 4 + (i * 152) / Math.max(1, values.length - 1), y: 32 - (v / 100) * 28, v, w: weeks[i] }));
  const have = pts.filter((p): p is NonNullable<typeof p> => p !== null);
  if (have.length === 0) return <span style={{ color: A.faint }}>—</span>;
  const last = have[have.length - 1].v;
  const color = last < 60 ? A.orange : A.blue;
  const label = `Photo rate by week: ${have.map((p) => `${dayLabel(weekFirstDay(p.w, site))} ${p.v}%`).join(', ')}`;
  return (
    <svg viewBox="0 0 160 36" width="160" height="36" role="img" aria-label={label}>
      <title>{label}</title>
      {have.length > 1 && <polyline points={have.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />}
      <circle cx={have[have.length - 1].x} cy={have[have.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

function rateStyle(p: number | null, lowBelow: number) {
  if (p === null) return { color: A.faint };
  return p < lowBelow ? { color: A.red, fontWeight: 600 } : undefined;
}

function TechRow({ t, weeks, showSite }: { t: TechScore; weeks: string[]; showSite: boolean }) {
  const num = { ...tdStyle, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const };
  const none = t.withDetails === 0;
  return (
    <tr>
      <td style={{ ...tdStyle, fontWeight: 600 }}>
        {t.tech}
        {showSite && <div style={{ color: A.muted, fontSize: 12, fontWeight: 400 }}>{SITE_LABEL[t.site_code as 'upark' | 'binney'] ?? t.site_code}</div>}
      </td>
      <td style={num}>{t.closed}</td>
      <td style={{ ...num, fontWeight: 600, ...rateStyle(t.photoRate, 60) }}>{fmtPct(t.photoRate)}</td>
      <td style={{ ...num, ...rateStyle(t.stepsRate, 80) }}>{fmtPct(t.stepsRate)}</td>
      <td style={{ ...num, ...(t.flagRate !== null && t.flagRate >= 25 ? { color: A.red, fontWeight: 600 } : undefined) }}>{fmtPct(t.flagRate)}</td>
      <td style={{ ...num, ...(t.good > 0 ? { color: A.greenDark, fontWeight: 600 } : { color: A.faint }) }}>{t.good}</td>
      <td style={{ ...num, color: t.weekHours === null ? A.faint : undefined }}>{t.weekHours === null ? '—' : t.weekHours.toFixed(1)}</td>
      <td style={{ ...num, fontWeight: 600, color: t.passRate === null ? A.faint : t.passRate < 70 ? A.orangeDark : A.blueDark }}>
        {fmtPct(t.passRate)}{t.reviewed > 0 && <span style={{ color: A.muted, fontWeight: 400 }}> of {t.reviewed}</span>}
      </td>
      <td style={{ ...tdStyle, padding: '10px 12px' }}>{none ? <span style={{ color: A.faint }}>needs backfill</span> : <Spark values={t.spark} weeks={weeks} site={t.site_code} />}</td>
      <td style={{ ...tdStyle, color: A.muted, whiteSpace: 'nowrap' }}>{t.topFlag ? FLAG_LABEL[t.topFlag] : '—'}</td>
    </tr>
  );
}

/** One engineer's hours as a bar: PM, ODT, WO. Length is their total against
 *  the biggest total on the page, so rows compare. */
function SplitBar({ t, scale }: { t: TechHours; scale: number }) {
  if (t.total <= 0 || scale <= 0) return null;
  const parts = WORK_TYPES.filter((w) => t[w.key] > 0);
  return (
    <div role="img" aria-label={`${t.tech}: ${parts.map((w) => `${w.label} ${fmtH(t[w.key])} h`).join(', ')}`}
      style={{ display: 'flex', gap: 2, height: 14, width: `${(100 * t.total) / scale}%`, minWidth: 4 }}>
      {parts.map((w) => (
        <div key={w.key} title={`${w.long} · ${fmtH(t[w.key])} h · ${pct(t[w.key], t.total)}%`}
          style={{ flex: `${t[w.key]} 0 0`, minWidth: 2, background: WORK_TYPE_COLOR[w.key], borderRadius: 2 }} />
      ))}
    </div>
  );
}

function HoursPanel({ split, loading, error, label, showSite }: { split: HoursSplit | null; loading: boolean; error: string | null; label: string; showSite: boolean }) {
  const num = { ...tdStyle, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const };
  const scale = split ? Math.max(0, ...split.techs.map((t) => t.total)) : 0;
  const swatch = (k: 'pm' | 'odt' | 'wo') => <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: WORK_TYPE_COLOR[k], marginRight: 6 }} />;
  return (
    <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 24px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px 24px' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Hours by engineer · PM / ODT / WO <Soft>· {label}</Soft></h2>
        {split && split.team.total > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 13 }}>
            {WORK_TYPES.map((w) => (
              <span key={w.key} style={{ whiteSpace: 'nowrap' }}>
                {swatch(w.key)}{w.long} <strong>{Math.round(split.team[w.key]).toLocaleString()} h</strong>
                <span style={{ color: A.muted }}> · {pct(split.team[w.key], split.team.total)}%</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {loading ? (
        <div style={{ padding: '0 24px 20px', fontSize: 14, color: A.muted }}>Adding up the labor entries…</div>
      ) : error ? (
        <div role="alert" style={{ padding: '0 24px 20px', fontSize: 14, color: A.redDark }}>Could not load the hours: {error}</div>
      ) : !split || split.techs.length === 0 ? (
        <div style={{ padding: '0 24px 20px', fontSize: 14, color: A.muted }}>No labor entries in this window.</div>
      ) : (
        <div className="audit-table-box" style={{ borderTop: `1px solid ${A.line}` }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Engineer</th>
                <th style={{ ...thStyle, textAlign: 'right' }} title="Hours on labor entries in the window">Hours</th>
                <th style={{ ...thStyle, textAlign: 'right' }} title="Average over the weeks that have any hours">Per week</th>
                {WORK_TYPES.map((w) => <th key={w.key} style={{ ...thStyle, textAlign: 'right' }} title={w.long}>{swatch(w.key)}{w.label}</th>)}
                <th style={{ ...thStyle, minWidth: 220 }}>Split</th>
              </tr>
            </thead>
            <tbody>
              {split.techs.map((t) => (
                <tr key={`${t.site_code}|${t.tech}`}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {t.tech}
                    {showSite && <div style={{ color: A.muted, fontSize: 12, fontWeight: 400 }}>{SITE_LABEL[t.site_code as 'upark' | 'binney'] ?? t.site_code}</div>}
                  </td>
                  <td style={{ ...num, fontWeight: 600 }}>{fmtH(t.total, false)}</td>
                  <td style={num}>{fmtH(t.perWeek, false)}<span style={{ color: A.muted }}> × {t.weeks}</span></td>
                  {WORK_TYPES.map((w) => (
                    <td key={w.key} style={{ ...num, color: t[w.key] > 0 ? undefined : A.faint }}>
                      {t[w.key] > 0 ? <>{fmtH(t[w.key])}<span style={{ color: A.muted }}> · {pct(t[w.key], t.total)}%</span></> : '—'}
                    </td>
                  ))}
                  <td style={{ ...tdStyle, verticalAlign: 'middle' }}><SplitBar t={t} scale={scale} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: '12px 24px 16px', fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
        <strong>PM</strong> = scheduled PM tasks, the monthly building-rounds tasks included. <strong>ODT</strong> = on-demand tasks, the non-scheduled PMs (NPM).
        <strong> WO</strong> = work orders. PM and ODT hours are counted on the person who did the work, the week it was done; Cove gives work-order hours
        only as a total at close, so those land on the assignee in the week the order closed, and time on open work orders is not here.
        {split && split.others.people > 0 && (
          <> Engineers only: {split.others.people} other {split.others.people === 1 ? 'person' : 'people'} with {fmtH(split.others.hours, false)} h
            {split.others.people === 1 ? ' is' : ' are'} left off (not engineers on the roster).</>
        )}
      </div>
    </section>
  );
}

function trend(now: number | null, first: number | null, betterWhenHigher: boolean) {
  if (now === null || first === null || now === first) return null;
  const up = now > first;
  const good = up === betterWhenHigher;
  return <span style={{ color: good ? A.blueDark : A.orangeDark, fontWeight: 500 }}>{up ? '▲' : '▼'} from {first}% in the first week</span>;
}

export default function AuditScorecard() {
  const p = useAuditParams();
  const [sp, setSp] = useSearchParams();
  const win: Win = sp.get('win') === '4' ? '4' : sp.get('win') === '13' ? '13' : '8';
  const range = useAuditWeekRange();
  const lastWeek = range.data?.latest ?? null;
  const dataQ = useAuditScorecard(lastWeek, p.site);
  const hoursQ = useAuditHoursSplit(lastWeek, p.site);
  const rosterQ = useAuditEngineers();
  const engineers = useMemo(() => (rosterQ.data && rosterQ.data.length > 0 ? new Set(rosterQ.data.map((x) => x.key)) : null), [rosterQ.data]);
  const split = useMemo(
    () => (hoursQ.data ? buildHoursSplit(hoursQ.data.rows, hoursQ.data.weeks.slice(-Number(win)), engineers) : null),
    [hoursQ.data, win, engineers],
  );

  const card = useMemo(() => {
    if (!dataQ.data) return null;
    const all = dataQ.data.weeks;
    return {
      sparkWeeks: all.slice(-SPARK_WEEKS),
      ...buildScorecard(dataQ.data.views, dataQ.data.closes, all.slice(-Number(win)), all.slice(-SPARK_WEEKS)),
    };
  }, [dataQ.data, win]);

  const setWin = (v: Win) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (v === '8') next.delete('win'); else next.set('win', v);
    return next;
  }, { replace: true });

  const team = card?.team;
  const grey = !!team && team.withDetails === 0;
  const dim = grey ? { opacity: 0.55 } : undefined;
  const label = win === '13' ? `last ${SCORE_WEEKS_MAX} weeks` : `last ${win} weeks`;
  const maxFlag = card ? Math.max(1, ...card.flagsByReason.map((f) => f.count)) : 1;

  return (
    <AuditShell
      kicker="Section 05 · Scorecard"
      title={`PM quality · ${label}`}
      subtitle={card ? `Weeks of ${dayLabel(weekFirstDay(card.weeks[0], p.site))} to ${dayLabel(weekFirstDay(card.weeks[card.weeks.length - 1], p.site))}${p.site === 'upark' ? '' : ' · Binney’s weeks run Sunday to Saturday'} · manager view · feeds the “PM quality verification” line in the monthly BMR report` : 'Manager view'}
      actions={<Segmented label="Window" value={win} options={WINDOWS} onChange={setWin} />}
    >
      {range.isLoading || dataQ.isLoading ? (
        <Notice>Loading the scorecard…</Notice>
      ) : dataQ.isError ? (
        <Notice tone="error">Could not load the scorecard: {(dataQ.error as Error).message}</Notice>
      ) : !card || !team ? (
        <Notice>No audit week yet. The scorecard starts once the first queue is built (Sunday 23:05 ET).</Notice>
      ) : (
        <>
          {grey && <Notice>Needs backfill — no closed PM in this window has its task details loaded yet, so photo, steps and note rates are blank.</Notice>}
          <div style={{ ...tileGrid, ...dim }}>
            <StatTile label="Photo rate (team)" value={fmtPct(team.photoRate)} valueColor={team.photoRate === null ? A.faint : undefined}
              sub={trend(team.photoRate, team.firstWeekPhotoRate, true) ?? 'at least one photo, of PMs that expect one'} />
            <StatTile label="Checklist complete" value={fmtPct(team.stepsRate)} valueColor={team.stepsRate === null ? A.faint : undefined} sub="every step checked" />
            <StatTile label="Note rate" value={fmtPct(team.noteRate)} valueColor={team.noteRate === null ? A.faint : undefined} sub="a real note, not thin or boilerplate" />
            <StatTile label="Good PMs" value={<>{team.good} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>· {fmtPct(team.goodRate)}</span></>}
              valueColor={team.good ? A.green : undefined} sub="a photo or a thick note, and no flag" />
            <StatTile label="Flag rate" value={fmtPct(team.flagRate)}
              sub={trend(team.flagRate, team.firstWeekFlagRate, false) ?? `${team.flagged} of ${team.closed} closes`} />
            <StatTile label="Reviewed · pass"
              value={<>{team.reviewed} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>· {fmtPct(team.passRate)}</span></>}
              sub={team.reviewed > 0 ? `coach ${fmtPct(Math.round((100 * team.coach) / team.reviewed))} · fail ${fmtPct(Math.round((100 * team.fail) / team.reviewed))}` : 'no reviews in this window yet'} />
          </div>
          {team.withDetails > 0 && team.withDetails < team.closed && (
            <div style={{ fontSize: 12, color: A.muted, marginTop: -12 }}>
              Photo, steps and note rates cover the {team.withDetails.toLocaleString()} of {team.closed.toLocaleString()} closes whose task details are loaded.
            </div>
          )}

          <div className="audit-table-box audit-table-card" style={cardStyle}>
            <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Tech</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Closed</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Photo rate</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Steps</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Flagged</th>
                  <th style={{ ...thStyle, textAlign: 'right' }} title="Closes with a photo or a thick note, and no flag">Good</th>
                  <th style={{ ...thStyle, textAlign: 'right' }} title="Average labor hours logged per week">Hrs / wk</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Pass</th>
                  <th style={thStyle}>Photo rate · 8 wk</th>
                  <th style={thStyle}>Top flag</th>
                </tr>
              </thead>
              <tbody>
                {card.techs.length === 0
                  ? <tr><td colSpan={10} style={{ ...tdStyle, color: A.muted }}>No recurring PM was closed in this window.</td></tr>
                  : card.techs.map((t) => <TechRow key={`${t.site_code}|${t.tech}`} t={t} weeks={card.sparkWeeks} showSite={p.site === 'both'} />)}
              </tbody>
            </table>
          </div>

          <HoursPanel split={split} loading={hoursQ.isLoading || rosterQ.isLoading} error={hoursQ.isError ? (hoursQ.error as Error).message : null} label={label} showSite={p.site === 'both'} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <Panel title={<>Flags by reason <Soft>· {card.flagTotal.toLocaleString()} flag{card.flagTotal === 1 ? '' : 's'}</Soft></>} style={{ flex: '1 1 420px', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                {card.flagsByReason.map((f) => (
                  <BarRow key={f.flag} label={FLAG_LABEL[f.flag]} frac={f.count / maxFlag} value={String(f.count)} color={A.orange} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: A.muted }}>One PM can carry several flags. A thick note clears No photos; a note that says why clears unchecked steps.</div>
            </Panel>
            <Panel title="Photo rate by PM type" style={{ flex: '1 1 420px', gap: 14, ...dim }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                {card.photoByType.map((t) => (
                  <BarRow key={t.pmType}
                    label={<>{t.pmType}{!t.expects && <span style={{ color: A.muted }}> (none expected)</span>}</>}
                    frac={t.rate === null ? 0 : t.rate / 100}
                    value={t.rate === null ? 'n/a' : `${t.rate}%`}
                    color={A.blue}
                    valueColor={t.rate === null ? A.muted : undefined} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: A.muted }}>Share of closes with at least one photo. Types that expect none show n/a.</div>
            </Panel>
          </div>
        </>
      )}
    </AuditShell>
  );
}
