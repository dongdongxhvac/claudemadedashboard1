// §05 PM Audit — the weekly review queue (docs/pm-audit.md §4.1).
// pm_audit_queue (built Sunday night by pg_cron) joined to v_pm_audit_flags
// and pm_audit_reviews; the manager works the Open rows on Monday.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuditAccess, useAuditQueue, useAuditWeekRange, useAuditWeekStats } from '../../hooks/usePmAudit';
import {
  FLAG_KEYS, FLAG_LABEL, SITE_LABEL, addDays, filterQueue, fmtClosed, fmtHours, fmtPct, rowChips, shortName, weekLabel,
  type FlagKey, type QueuePill, type QueueRow,
} from '../../lib/pmAudit';
import { AuditShell, ChipTag, Notice, Segmented, StatTile, VerdictTag } from './AuditUi';
import { A, buttonStyle, cardStyle, primaryButtonStyle, selectStyle, tdStyle, thStyle, tileGrid } from './auditTheme';
import { useAuditParams } from './useAuditParams';

const GREY = { color: A.faint } as const;
const RED = { color: A.red, fontWeight: 600 } as const;

function LaborCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f) return <span style={GREY}>—</span>;
  const low = row.flags.includes('low_labor');
  return (
    <span style={low ? RED : undefined}>
      {fmtHours(f.labor_hours)} <span style={{ color: A.muted, fontWeight: 400 }}>/ {fmtHours(f.est_labor_hours)}</span>
    </span>
  );
}

function PhotosCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f) return <span style={GREY}>—</span>;
  if (!f.has_details) return <span style={GREY}>— / {f.min_photos}</span>;
  return (
    <span style={row.flags.includes('low_photos') ? RED : undefined}>
      {f.photo_count ?? 0} <span style={{ color: A.muted, fontWeight: 400 }}>/ {f.min_photos}</span>
    </span>
  );
}

function StepsCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f || !f.has_details) return <span style={GREY}>—</span>;
  if (!f.steps_total) return <span style={{ color: A.muted }}>none</span>;
  return (
    <span style={row.flags.includes('steps_incomplete') ? RED : undefined}>
      {f.steps_checked ?? 0} <span style={{ color: A.muted, fontWeight: 400 }}>/ {f.steps_total}</span>
    </span>
  );
}

/** Note length, or the boilerplate word itself in red ("ok", "done"). */
function NoteCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f || !f.has_details) return <span style={GREY}>—</span>;
  if (f.note_boilerplate) {
    const word = (f.close_note ?? '').trim();
    return <span style={RED} title="On the boilerplate list — counts as no note">“{word.length > 14 ? `${word.slice(0, 14)}…` : word}”</span>;
  }
  const thin = row.flags.includes('thin_note');
  return (
    <span style={thin ? RED : undefined} title={`${f.note_chars ?? 0} characters across ${f.note_count ?? 0} note(s), minimum ${f.min_note_chars}`}>
      {f.note_chars ?? 0}
    </span>
  );
}

export default function AuditQueue() {
  const access = useAuditAccess();
  const p = useAuditParams();
  const navigate = useNavigate();
  const range = useAuditWeekRange();
  const latest = range.data?.latest ?? null;
  const week = p.week ?? latest;
  const queueQ = useAuditQueue(week, p.site);
  const statsQ = useAuditWeekStats(week, p.site);

  const all = useMemo(() => queueQ.data ?? [], [queueQ.data]);
  const rows = useMemo(() => filterQueue(all, p.filter), [all, p.filter]);
  const counts = useMemo(() => ({
    all: all.length,
    flagged: all.filter((r) => r.reason === 'flagged').length,
    random: all.filter((r) => r.reason === 'random').length,
    open: all.filter((r) => !r.review).length,
  }), [all]);
  const techs = useMemo(
    () => [...new Set(all.map((r) => r.f?.assigned_to_name).filter((t): t is string => !!t))].sort(),
    [all],
  );
  const firstOpen = rows.find((r) => !r.review) ?? null;
  const cardHref = (r: QueueRow) => `/audit/${r.week_start}/${encodeURIComponent(r.task_no)}${p.carry}`;

  const stats = statsQ.data;
  const sites = stats ? Object.entries(stats.bySite).sort((a, b) => b[1] - a[1]) : [];
  const reviewed = counts.all - counts.open;
  const missingDetails = stats ? stats.closed - stats.withDetails : 0;

  const pills: { value: QueuePill; label: string }[] = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'flagged', label: `Flagged ${counts.flagged}` },
    { value: 'random', label: `Random ${counts.random}` },
    { value: 'open', label: `Open ${counts.open}` },
  ];

  const goWeek = (w: string) => p.set({ week: w === latest ? null : w, tech: null });

  return (
    <AuditShell
      kicker="Section 05"
      title={week ? `PM Audit · Week of ${weekLabel(week)}` : 'PM Audit'}
      subtitle="Last week's closed recurring PMs: every flagged one plus 5 random per site. Pass / Coach / Fail each; the scorecard adds them up per tech."
      actions={week && (
        <>
          <button type="button" style={buttonStyle} onClick={() => goWeek(addDays(week, -7))}
            disabled={!!range.data?.first && week <= range.data.first}>← Prior week</button>
          <button type="button" style={{ ...buttonStyle, opacity: latest && week >= latest ? 0.45 : 1 }} onClick={() => goWeek(addDays(week, 7))}
            disabled={!latest || week >= latest}>Next week →</button>
          {firstOpen && (
            <button type="button" style={primaryButtonStyle} onClick={() => navigate(cardHref(firstOpen))}>
              {access.canReview ? 'Start review' : 'Open first'} ({rows.filter((r) => !r.review).length})
            </button>
          )}
        </>
      )}
    >
      <div style={tileGrid}>
        <StatTile label="Closed this week" value={stats ? stats.closed.toLocaleString() : '—'}
          sub={stats ? `${sites.length > 1 ? `${sites.map(([s, n]) => `${SITE_LABEL[s as 'upark' | 'binney'] ?? s} ${n}`).join(' · ')} · ` : ''}${stats.techs} tech${stats.techs === 1 ? '' : 's'}` : 'recurring PMs'} />
        <StatTile label="Flagged" value={counts.flagged} valueColor={counts.flagged ? A.orange : undefined}
          sub={missingDetails > 0 && stats
            ? `${missingDetails} of ${stats.closed} closes have no task details yet — only the labor rule can fire on those`
            : 'photo, steps, note, timing and labor rules'} />
        <StatTile label="Random sample" value={counts.random} sub="unflagged, drawn Sunday night" />
        <StatTile label="Reviewed" value={<>{reviewed} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>/ {counts.all}</span></>}>
          <div style={{ height: 6, borderRadius: 3, background: A.line, overflow: 'hidden' }}>
            <div style={{ width: `${counts.all ? (100 * reviewed) / counts.all : 0}%`, height: '100%', background: A.blue }} />
          </div>
        </StatTile>
        <StatTile label="Photo rate" value={fmtPct(stats?.photoRate)} valueColor={stats?.photoRate === null || !stats ? A.faint : undefined}
          sub={!stats ? 'of closes that need a photo' : stats.withDetails === 0 ? 'needs backfill' : `enough photos, of ${stats.withDetails} closes with details`} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <Segmented label="Show" value={p.filter.pill} options={pills} onChange={(v) => p.set({ f: v === 'all' ? null : v })} />
        <label htmlFor="q-tech" style={{ fontSize: 13, color: A.muted, marginLeft: 8 }}>Tech</label>
        <select id="q-tech" style={selectStyle} value={p.filter.tech} onChange={(e) => p.set({ tech: e.target.value || null })}>
          <option value="">All techs</option>
          {p.filter.tech && !techs.includes(p.filter.tech) && <option value={p.filter.tech}>{p.filter.tech}</option>}
          {techs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label htmlFor="q-flag" style={{ fontSize: 13, color: A.muted, marginLeft: 8 }}>Flag</label>
        <select id="q-flag" style={selectStyle} value={p.filter.flag} onChange={(e) => p.set({ flag: (e.target.value as FlagKey) || null })}>
          <option value="">Any flag</option>
          {FLAG_KEYS.map((k) => <option key={k} value={k}>{FLAG_LABEL[k]}</option>)}
        </select>
      </div>

      {range.isLoading || queueQ.isLoading ? (
        <Notice>Loading the queue…</Notice>
      ) : queueQ.isError ? (
        <Notice tone="error">Could not load the queue: {(queueQ.error as Error).message}</Notice>
      ) : !week ? (
        <Notice>No audit queue yet. The first one is built Sunday at 23:05 ET from that week's closed recurring PMs.</Notice>
      ) : all.length === 0 ? (
        <Notice>Nothing was queued for the week of {weekLabel(week)}{p.site !== 'both' ? ` at ${SITE_LABEL[p.site]}` : ''}.</Notice>
      ) : rows.length === 0 ? (
        <Notice>No queued task matches these filters.</Notice>
      ) : (
        <div style={{ ...cardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1080, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Task</th>
                <th style={thStyle}>PM · Equipment</th>
                <th style={thStyle}>Tech</th>
                <th style={thStyle}>Closed</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Labor</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Photos</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Steps</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Note</th>
                <th style={thStyle}>Flags</th>
                <th style={thStyle}>Verdict</th>
                <th style={thStyle}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const f = r.f;
                const right = { ...tdStyle, textAlign: 'right' as const, whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as const };
                return (
                  <tr key={r.task_no} className="t-row-hover">
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {r.task_no}
                      {p.site === 'both' && <div style={{ color: A.muted, fontSize: 12, fontWeight: 400 }}>{SITE_LABEL[r.site_code as 'upark' | 'binney'] ?? r.site_code}</div>}
                    </td>
                    <td style={{ ...tdStyle, minWidth: 200 }}>
                      <div style={{ fontWeight: 500 }}>{f?.task_name ?? 'Close event not found'}</div>
                      <div style={{ color: A.muted, fontSize: 12 }}>{[f?.equipment, f?.building_code].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} title={f?.assigned_to_name ?? undefined}>{shortName(f?.assigned_to_name)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtClosed(f?.completed_on)}</td>
                    <td style={right}><LaborCell row={r} /></td>
                    <td style={right}><PhotosCell row={r} /></td>
                    <td style={right}><StepsCell row={r} /></td>
                    <td style={right}><NoteCell row={r} /></td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 230 }}>
                        {rowChips(r).map((c) => <ChipTag key={c.key} chip={c} />)}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {r.review ? <VerdictTag verdict={r.review.verdict} /> : <span style={GREY}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <Link to={cardHref(r)}
                        style={r.review || !access.canReview
                          ? { display: 'inline-block', padding: '8px 13px', borderRadius: 8, border: `1px solid ${A.control}`, color: A.ink, fontWeight: 600, textDecoration: 'none' }
                          : { display: 'inline-block', padding: '9px 14px', borderRadius: 8, background: A.blue, color: '#FFFFFF', fontWeight: 600, textDecoration: 'none' }}>
                        {r.review || !access.canReview ? 'Open' : 'Review'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
        <strong>Photos</strong> = count / minimum from the audit rules (by template, else PM type). <strong>Note</strong> = characters across
        every note on the task; a word in quotes is boilerplate and counts as no note. Grey “—” means the task's details have not been
        pulled from Cove yet. Flags are live from the current data; the queue itself is frozen Sunday 23:05 ET.
      </div>
    </AuditShell>
  );
}
