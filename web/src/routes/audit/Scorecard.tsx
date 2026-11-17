// §05 PM Audit — the scorecard (docs/pm-audit.md §4.3): PM quality per tech
// over the last 4 / 8 / 13 weeks, from v_pm_audit_scorecard plus the
// per-close rows of v_pm_audit_flags (so multi-week rates add up exactly).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SCORE_WEEKS_MAX, useAuditScorecard, useAuditWeekRange } from '../../hooks/usePmAudit';
import { FLAG_LABEL, SITE_LABEL, buildScorecard, dayLabel, fmtPct, type TechScore } from '../../lib/pmAudit';
import { AuditShell, BarRow, Notice, Panel, Segmented, Soft, StatTile } from './AuditUi';
import { A, cardStyle, tdStyle, thStyle, tileGrid } from './auditTheme';
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
function Spark({ values, weeks }: { values: (number | null)[]; weeks: string[] }) {
  const pts = values.map((v, i) => (v === null ? null : { x: 4 + (i * 152) / Math.max(1, values.length - 1), y: 32 - (v / 100) * 28, v, w: weeks[i] }));
  const have = pts.filter((p): p is NonNullable<typeof p> => p !== null);
  if (have.length === 0) return <span style={{ color: A.faint }}>—</span>;
  const last = have[have.length - 1].v;
  const color = last < 60 ? A.orange : A.blue;
  const label = `Photo rate by week: ${have.map((p) => `${dayLabel(p.w)} ${p.v}%`).join(', ')}`;
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
      <td style={{ ...num, color: t.weekHours === null ? A.faint : undefined }}>{t.weekHours === null ? '—' : t.weekHours.toFixed(1)}</td>
      <td style={{ ...num, fontWeight: 600, color: t.passRate === null ? A.faint : t.passRate < 70 ? A.orangeDark : A.blueDark }}>
        {fmtPct(t.passRate)}{t.reviewed > 0 && <span style={{ color: A.muted, fontWeight: 400 }}> of {t.reviewed}</span>}
      </td>
      <td style={{ ...tdStyle, padding: '10px 12px' }}>{none ? <span style={{ color: A.faint }}>needs backfill</span> : <Spark values={t.spark} weeks={weeks} />}</td>
      <td style={{ ...tdStyle, color: A.muted, whiteSpace: 'nowrap' }}>{t.topFlag ? FLAG_LABEL[t.topFlag] : '—'}</td>
    </tr>
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
      subtitle={card ? `Weeks of ${dayLabel(card.weeks[0])} to ${dayLabel(card.weeks[card.weeks.length - 1])} · manager view · feeds the “PM quality verification” line in the monthly BMR report` : 'Manager view'}
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
              sub={trend(team.photoRate, team.firstWeekPhotoRate, true) ?? 'enough photos, of PMs that need one'} />
            <StatTile label="Checklist complete" value={fmtPct(team.stepsRate)} valueColor={team.stepsRate === null ? A.faint : undefined} sub="every step checked" />
            <StatTile label="Note rate" value={fmtPct(team.noteRate)} valueColor={team.noteRate === null ? A.faint : undefined} sub="a real note, not thin or boilerplate" />
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

          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Tech</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Closed</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Photo rate</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Steps</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Flagged</th>
                  <th style={{ ...thStyle, textAlign: 'right' }} title="Average labor hours logged per week">Hrs / wk</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Pass</th>
                  <th style={thStyle}>Photo rate · 8 wk</th>
                  <th style={thStyle}>Top flag</th>
                </tr>
              </thead>
              <tbody>
                {card.techs.length === 0
                  ? <tr><td colSpan={9} style={{ ...tdStyle, color: A.muted }}>No recurring PM was closed in this window.</td></tr>
                  : card.techs.map((t) => <TechRow key={`${t.site_code}|${t.tech}`} t={t} weeks={card.sparkWeeks} showSite={p.site === 'both'} />)}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <Panel title={<>Flags by reason <Soft>· {card.flagTotal.toLocaleString()} flag{card.flagTotal === 1 ? '' : 's'}</Soft></>} style={{ flex: '1 1 420px', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                {card.flagsByReason.map((f) => (
                  <BarRow key={f.flag} label={FLAG_LABEL[f.flag]} frac={f.count / maxFlag} value={String(f.count)} color={A.orange} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: A.muted }}>One PM can carry several flags. Photo, steps, note and desk-close flags only fire on closes with details loaded.</div>
            </Panel>
            <Panel title="Photo rate by PM type" style={{ flex: '1 1 420px', gap: 14, ...dim }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                {card.photoByType.map((t) => (
                  <BarRow key={t.pmType}
                    label={<>{t.pmType} <span style={{ color: A.muted }}>(min {t.minPhotos})</span></>}
                    frac={t.rate === null ? 0 : t.rate / 100}
                    value={t.rate === null ? 'n/a' : `${t.rate}%`}
                    color={A.blue}
                    valueColor={t.rate === null ? A.muted : undefined} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: A.muted }}>Share of closes that met their photo minimum. Types with no minimum show n/a.</div>
            </Panel>
          </div>
        </>
      )}
    </AuditShell>
  );
}
