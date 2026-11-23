// §05 PM Audit — the weekly review queue (docs/pm-audit.md §4.1).
// pm_audit_queue (built Sunday night by pg_cron) joined to v_pm_audit_flags
// and pm_audit_reviews; the manager works the Open rows on Monday.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuditAccess, useAuditQueue, useAuditWeekRange, useAuditWeekStats, useBuildQueue } from '../../hooks/usePmAudit';
import {
  FLAG_KEYS, FLAG_LABEL, SITE_LABEL, THICK_NOTE_CHARS, addDays, filterQueue, fmtClosed, fmtHours, fmtPct, rowChips, shortName, auditWeekLabel,
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

const GOOD = { color: A.greenDark, fontWeight: 600 } as const;

/** Photo count: red when the PM is flagged for having none, green when a
 *  photo is there, muted when none is expected. */
function PhotosCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f || !f.has_details) return <span style={GREY}>—</span>;
  const n = f.photo_count ?? 0;
  if (row.flags.includes('no_photos')) return <span style={RED}>0</span>;
  if (n > 0) return <span style={GOOD}>{n}</span>;
  return <span style={{ color: A.muted }} title={f.min_photos > 0 ? 'No photo, covered by a thick note' : 'No photo expected for this PM'}>0</span>;
}

function StepsCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f || !f.has_details) return <span style={GREY}>—</span>;
  if (!f.steps_total) return <span style={{ color: A.muted }}>none</span>;
  return (
    <span style={row.flags.includes('steps_unexplained') ? RED : undefined}
      title={f.steps_open && !row.flags.includes('steps_unexplained') ? 'Unchecked steps, explained in the note' : undefined}>
      {f.steps_checked ?? 0} <span style={{ color: A.muted, fontWeight: 400 }}>/ {f.steps_total}</span>
    </span>
  );
}

/** Note length in characters: green when thick (evidence on its own), muted
 *  when thin; a boilerplate note shows its word ("ok", "done"). A thin note
 *  is not a flag by itself any more. */
function NoteCell({ row }: { row: QueueRow }) {
  const f = row.f;
  if (!f || !f.has_details) return <span style={GREY}>—</span>;
  const tip = `${f.note_chars ?? 0} characters across ${f.note_count ?? 0} note(s); ${THICK_NOTE_CHARS}+ counts as a thick note`;
  if (f.note_boilerplate) {
    const word = (f.close_note ?? '').trim();
    return <span style={{ color: A.muted }} title="Boilerplate — counts as no note">“{word.length > 14 ? `${word.slice(0, 14)}…` : word}”</span>;
  }
  if (f.note_thick) return <span style={GOOD} title={tip}>{f.note_chars}</span>;
  return <span style={f.note_thin ? { color: A.muted } : undefined} title={tip}>{f.note_chars ?? 0}</span>;
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
  const build = useBuildQueue();
  // The picker goes back as far as there are closes, not just queued weeks.
  const earliest = range.data?.firstClose ?? range.data?.first ?? null;
  const atEarliest = !week || !earliest || week <= earliest;
  const atLatest = !week || !latest || week >= latest;

  const all = useMemo(() => queueQ.data ?? [], [queueQ.data]);
  const rows = useMemo(() => filterQueue(all, p.filter), [all, p.filter]);
  const counts = useMemo(() => ({
    all: all.length,
    flagged: all.filter((r) => r.reason === 'flagged').length,
    good: all.filter((r) => r.reason === 'good').length,
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
    { value: 'good', label: `Good ${counts.good}` },
    { value: 'random', label: `Random ${counts.random}` },
    { value: 'open', label: `Open ${counts.open}` },
  ];

  const goWeek = (w: string) => p.set({ week: w === latest ? null : w, tech: null });

  return (
    <AuditShell
      kicker="Section 05"
      title={week ? `PM Audit · Week of ${auditWeekLabel(week, p.site)}` : 'PM Audit'}
      subtitle="Last week's closed recurring PMs: each tech's worst flagged ones, the best good ones and 5 random per site. Pass / Coach / Fail each; the scorecard adds them up per tech."
      actions={week && (
        <>
          <button type="button" style={{ ...buttonStyle, opacity: atEarliest ? 0.45 : 1, cursor: atEarliest ? 'default' : 'pointer' }}
            onClick={() => goWeek(addDays(week, -7))} disabled={atEarliest}
            title={atEarliest ? 'No recurring PM was closed before this week' : undefined}>← Prior week</button>
          <button type="button" style={{ ...buttonStyle, opacity: atLatest ? 0.45 : 1, cursor: atLatest ? 'default' : 'pointer' }}
            onClick={() => goWeek(addDays(week, 7))} disabled={atLatest}
            title={atLatest ? 'This is the latest week with a queue' : undefined}>Next week →</button>
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
            : 'no photos, unexplained steps, low labor, batch close'} />
        <StatTile label="Good PMs" value={counts.good} valueColor={counts.good ? A.green : undefined}
          sub={stats ? `queued, of ${stats.good} good that week (a photo or a ${THICK_NOTE_CHARS}+ character note, no flag)` : 'a photo or a thick note, no flag'} />
        <StatTile label="Random sample" value={counts.random} sub="unflagged, drawn Sunday night" />
        <StatTile label="Reviewed" value={<>{reviewed} <span style={{ fontSize: 18, fontWeight: 500, color: A.muted }}>/ {counts.all}</span></>}>
          <div style={{ height: 6, borderRadius: 3, background: A.line, overflow: 'hidden' }}>
            <div style={{ width: `${counts.all ? (100 * reviewed) / counts.all : 0}%`, height: '100%', background: A.blue }} />
          </div>
        </StatTile>
        <StatTile label="Photo rate" value={fmtPct(stats?.photoRate)} valueColor={stats?.photoRate === null || !stats ? A.faint : undefined}
          sub={!stats ? 'of PMs that expect a photo' : stats.withDetails === 0 ? 'needs backfill' : 'at least one photo, of PMs that expect one'} />
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
      ) : all.length === 0 && range.data?.first && week < range.data.first ? (
        <Notice>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>
              No review queue was built for the week of {auditWeekLabel(week, p.site)} — weekly queues start with the week of {auditWeekLabel(range.data.first, p.site)}.
              {stats ? ` ${stats.closed.toLocaleString()} recurring PMs were closed that week; the tiles above are for them.` : ''}
            </span>
            {access.canReview && (
              <button type="button" style={{ ...primaryButtonStyle, opacity: build.isPending ? 0.5 : 1 }} disabled={build.isPending} onClick={() => build.mutate(week)}>
                {build.isPending ? 'Building…' : "Build this week's queue"}
              </button>
            )}
          </div>
          {build.isError && <div role="alert" style={{ marginTop: 8, color: A.redDark }}>Could not build it: {(build.error as Error).message}</div>}
        </Notice>
      ) : all.length === 0 ? (
        <Notice>Nothing was queued for the week of {auditWeekLabel(week, p.site)}{p.site !== 'both' ? ` at ${SITE_LABEL[p.site]}` : ''}.</Notice>
      ) : rows.length === 0 ? (
        <Notice>No queued task matches these filters.</Notice>
      ) : (
        <div className="audit-table-box audit-table-card" style={cardStyle}>
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
        <strong>Flagged</strong> = no photo and no thick note, unchecked steps the note doesn't explain, very low labor, or a batch of closes with no
        evidence. <strong>Good</strong> = a photo or a note of {THICK_NOTE_CHARS}+ characters, and no flag. <strong>Note</strong> = characters across every
        note on the task (green = thick; a word in quotes is boilerplate). Grey “—” means the task's details have not been pulled from Cove yet.
        Flags are live from the current data; the queue itself is frozen Sunday 23:05 ET.
      </div>
    </AuditShell>
  );
}
