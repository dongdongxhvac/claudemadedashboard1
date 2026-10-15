// §11b — Overtime schedule from the University Park Overtime API (Steve's /
// "Jie's CW OT Viewer"), read-only.
//
// One row per job, keyed by the API's job id: when · title · location ·
// filled/spaces · status · volunteers. Status drives the colour (unfilled
// red · partial amber · full green), per the handoff's suggested mapping.
// Sits directly under §11 so the dashboard's own OT posts and the Outlook-
// sourced schedule read together.
//
// Volunteering happens in the OT viewer / its email invites — the API's
// write endpoints are not wired up (confirm before using them).
//
// History (user 2026-10-12): below the upcoming table, "All jobs" lists
// every job the sync has ever seen from the permanent log (0141) — done, or
// cancelled when the API stopped listing it before it started — and
// "Activity" is the change log (0144) the sync writes between polls:
// sign-ups, withdrawals, reschedules, added and cancelled jobs.
import { useEffect, useMemo, useState } from 'react';
import {
  useOtApiJobs,
  useOtApiJobsLog,
  useOtApiJobEvents,
  useOtApiLatestSync,
  useOtApiRealtime,
  isOtApiJobCurrent,
  otApiJobHappened,
  otApiFreshness,
  type OtApiJob,
  type OtApiJobLogRow,
  type OtApiJobEvent,
} from '../hooks/useOtApi';
import { Section } from './Section';

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  unfilled:  { bg: 'rgba(220, 38, 38, 0.14)',  fg: 'var(--color-danger)',        label: 'Unfilled' },
  partial:   { bg: 'rgba(217, 119, 6, 0.16)',  fg: 'var(--color-warn, #d97706)', label: 'Partial' },
  full:      { bg: 'rgba(16, 185, 129, 0.16)', fg: 'var(--color-ok, #10b981)',   label: 'Full' },
  cancelled: { bg: 'var(--color-border-soft)', fg: 'var(--color-text-muted)',    label: 'Cancelled' },
  done:      { bg: 'rgba(94, 106, 210, 0.12)', fg: 'var(--color-accent)',        label: 'Done' },
};

/** What a logged job's row should say once it is out of the upcoming list:
 *  dropped off the API before it started → cancelled (or moved: a moved
 *  Outlook event comes back under a new id); otherwise, once its time has
 *  passed → done. */
function historyStatus(j: OtApiJobLogRow, now: Date): 'cancelled' | 'done' | string {
  if (!otApiJobHappened(j)) return 'cancelled';
  const tail = j.end_at ? new Date(j.end_at) : new Date(j.start_at);
  if (tail.getTime() < now.getTime()) return 'done';
  return j.status;
}

/** How far back the "All jobs" drawer reaches. */
const HISTORY_DAYS = 365;

const EVENT_LABEL: Record<string, string> = {
  added:             'New job',
  removed:           'Cancelled',
  restored:          'Back on the board',
  rescheduled:       'Rescheduled',
  spaces_changed:    'Spaces changed',
  volunteer_added:   'Signed up',
  volunteer_removed: 'Withdrew',
  retitled:          'Renamed',
};
const EVENT_COLOR: Record<string, string> = {
  added:             'var(--color-accent)',
  removed:           'var(--color-danger)',
  restored:          'var(--color-accent)',
  rescheduled:       'var(--color-warn, #d97706)',
  spaces_changed:    'var(--color-warn, #d97706)',
  volunteer_added:   'var(--color-ok, #10b981)',
  volunteer_removed: 'var(--color-danger)',
  retitled:          'var(--color-text-muted)',
};

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** One line of detail per event kind, from the sync's detail jsonb. */
function eventDetail(e: OtApiJobEvent): string {
  const d = e.detail ?? {};
  const who = (d.name as string | null) ?? (d.email as string | null) ?? '';
  switch (e.kind) {
    case 'volunteer_added':
    case 'volunteer_removed':
      return who;
    case 'rescheduled': {
      const from = d.from_start ? fmtOtApiWhen({ start_at: d.from_start as string, end_at: (d.from_end as string | null) ?? null, all_day: false, when_text: null }) : '?';
      const to   = d.to_start   ? fmtOtApiWhen({ start_at: d.to_start as string,   end_at: (d.to_end as string | null) ?? null,   all_day: false, when_text: null }) : '?';
      return `${from} → ${to}`;
    }
    case 'spaces_changed':
      return `${d.from ?? '?'} → ${d.to ?? '?'} spaces`;
    case 'retitled':
      return `"${d.from ?? ''}" → "${d.to ?? ''}"`;
    case 'added':
      return `${d.spaces ?? '?'} space${d.spaces === 1 ? '' : 's'}`;
    case 'removed': {
      const vols = Array.isArray(d.volunteers) ? (d.volunteers as string[]).filter(Boolean) : [];
      return vols.length ? `had ${vols.join(', ')}` : '';
    }
    default:
      return '';
  }
}

function statusStyle(s: string) {
  return STATUS_STYLE[s] ?? { bg: 'var(--color-border-soft)', fg: 'var(--color-text-muted)', label: s || '—' };
}

/** "Sat Sep 19 · 7:00 AM – 4:00 PM" from the ISO timestamps; falls back to
 *  the API's own when-string. All-day jobs show the date only. */
function fmtOtApiWhen(j: Pick<OtApiJob, 'start_at' | 'end_at' | 'all_day' | 'when_text'>): string {
  const s = new Date(j.start_at);
  if (Number.isNaN(s.getTime())) return j.when_text ?? '—';
  const dateStr = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,\s*/g, ' ');
  const timeStr = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (j.all_day) return `${dateStr(s)} · all day`;
  const e = j.end_at ? new Date(j.end_at) : null;
  if (!e || Number.isNaN(e.getTime())) return `${dateStr(s)} · ${timeStr(s)}`;
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${dateStr(s)} · ${timeStr(s)} – ${timeStr(e)}`
    : `${dateStr(s)} ${timeStr(s)} → ${dateStr(e)} ${timeStr(e)}`;
}

function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function JobRow({ job, past, status }: { job: OtApiJob; past: boolean; status?: string }) {
  const st = statusStyle(status ?? job.status);
  const names = job.volunteers.map((v) => v.name ?? v.email ?? '—');
  return (
    <tr className="t-row-divider t-row-hover align-top" style={{ opacity: past ? 0.55 : 1 }}>
      <td className="py-1.5 pr-3 whitespace-nowrap" title={job.when_text ?? ''}>{fmtOtApiWhen(job)}</td>
      <td className="py-1.5 pr-3" style={{ fontFamily: 'var(--font-body)' }}>
        <span style={{ color: 'var(--color-text)' }}>{job.title || '—'}</span>
        {job.notes && <div className="t-muted" style={{ fontSize: '0.75rem' }}>{job.notes}</div>}
      </td>
      <td className="py-1.5 pr-3" style={{ fontFamily: 'var(--font-body)' }}>{job.location || <span className="t-muted">—</span>}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap text-right">
        <span style={{ fontWeight: 700, color: job.open_spaces === 0 ? 'var(--color-ok, #10b981)' : 'var(--color-warn, #d97706)' }}>
          {job.filled}/{job.spaces}
        </span>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap">
        <span
          className="inline-block px-2 rounded"
          style={{ background: st.bg, color: st.fg, fontWeight: 600, fontSize: '0.72rem', lineHeight: '1.4rem' }}
        >
          {st.label}
        </span>
      </td>
      <td className="py-1.5 pr-3" style={{ fontFamily: 'var(--font-body)' }}>
        {names.length === 0 ? <span className="t-muted">nobody yet</span> : names.join(', ')}
        {job.open_spaces > 0 && (
          <span className="t-muted"> · {job.open_spaces} open</span>
        )}
      </td>
      <td className="py-1.5 whitespace-nowrap t-muted" style={{ fontSize: '0.72rem' }}>
        {job.source === 'added' ? 'OT viewer' : job.source === 'calendar' ? 'Outlook' : job.source ?? ''}
      </td>
    </tr>
  );
}

export function OtApiJobsPanel() {
  useOtApiRealtime();
  const jobsQ = useOtApiJobs();
  const syncQ = useOtApiLatestSync();
  const eventsQ = useOtApiJobEvents();
  const now = useMinuteNow();
  const [showPast, setShowPast] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const historySince = useMemo(
    () => new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString(),
    [now],
  );
  const logQ = useOtApiJobsLog(historySince);

  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  // upcoming — on the mirror and not yet over (the live board)
  // past     — every logged job that is not upcoming: done or cancelled,
  //            most recent first
  const upcoming = useMemo(() => jobs.filter((j) => isOtApiJobCurrent(j, now)), [jobs, now]);
  const past = useMemo(() => {
    const live = new Set(upcoming.map((j) => j.id));
    return (logQ.data ?? []).filter((j) => !live.has(j.id)).sort((a, b) => b.start_at.localeCompare(a.start_at));
  }, [logQ.data, upcoming]);
  const cancelledCount = past.filter((j) => !otApiJobHappened(j)).length;
  const events = eventsQ.data ?? [];

  const openSpaces = upcoming.reduce((s, j) => s + j.open_spaces, 0);
  const unfilled   = upcoming.filter((j) => j.status === 'unfilled').length;
  const sync = syncQ.data ?? null;
  const fresh = otApiFreshness(sync, now);
  const freshColor =
    fresh.tone === 'bad' ? 'var(--color-danger)' :
    fresh.tone === 'warn' ? 'var(--color-warn, #d97706)' : undefined;

  const subtitle = (
    <span className="t-small t-muted text-right block">
      {upcoming.length === 0 ? (
        <span>no upcoming OT jobs</span>
      ) : (
        <>
          <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>{upcoming.length}</span> job{upcoming.length === 1 ? '' : 's'}
          <span> · </span>
          <span style={{ color: openSpaces > 0 ? 'var(--color-warn, #d97706)' : 'var(--color-ok, #10b981)', fontWeight: 700 }}>
            {openSpaces}
          </span> open space{openSpaces === 1 ? '' : 's'}
          {unfilled > 0 && (
            <>
              <span> · </span>
              <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>{unfilled} unfilled</span>
            </>
          )}
        </>
      )}
      <br />
      <span style={{ fontSize: '0.7rem', opacity: 0.85, color: freshColor }}>
        {fresh.label}
        {sync?.window_days ? ` · next ${sync.window_days} days` : ''}
        {' · read-only mirror of the OT viewer (Outlook off-hours + added jobs)'}
      </span>
    </span>
  );

  return (
    <Section
      collapsible
      title="§11b Overtime schedule · OT viewer"
      subtitle={subtitle}
      loading={jobsQ.isLoading || syncQ.isLoading}
    >
      {jobsQ.error || syncQ.error ? (
        <p className="t-text t-danger">
          Error reading the OT viewer mirror: {((jobsQ.error ?? syncQ.error) as Error).message}
        </p>
      ) : !sync ? (
        <div className="t-text t-muted space-y-1">
          <p>No data yet — the OT viewer sync has not run.</p>
          <p style={{ fontSize: '0.8rem' }}>
            The <code>ot-api-sync</code> edge function runs every 15 minutes (cron job <code>ot-api-sync</code>)
            with the key from the Vault (<code>UPARK_OT_API_KEY</code>). Check <code>ot_api_syncs</code> for an
            error row; the watcher poller (<code>ot_api_poller.py</code>) is the fallback if the API is only
            reachable on the tailnet.
          </p>
        </div>
      ) : (
        <>
          {sync.status === 'error' && (
            <p className="t-small t-danger mb-2">
              Last poll failed: {sync.error_msg ?? 'unknown error'} — showing the previous mirror.
            </p>
          )}
          {sync.warnings.length > 0 && (
            <p className="t-small t-warn mb-2">
              OT viewer warnings: {sync.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join(' · ')}
            </p>
          )}
          {upcoming.length === 0 ? (
            <p className="t-text t-muted">No upcoming overtime jobs in the OT viewer.</p>
          ) : (
            <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="t-muted">
                  <th className="text-left pb-1 pr-3">When</th>
                  <th className="text-left pb-1 pr-3">Job</th>
                  <th className="text-left pb-1 pr-3">Location</th>
                  <th className="text-right pb-1 pr-3">Filled</th>
                  <th className="text-left pb-1 pr-3">Status</th>
                  <th className="text-left pb-1 pr-3">Volunteers</th>
                  <th className="text-left pb-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((j) => <JobRow key={j.id} job={j} past={false} />)}
              </tbody>
            </table>
          )}
          {past.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="t-small t-accent hover:underline"
              >
                {showPast ? '▾' : '▸'} All jobs · {past.length} done or cancelled in the last {HISTORY_DAYS} days
                {cancelledCount > 0 && <span className="t-muted"> · {cancelledCount} cancelled</span>}
              </button>
              {showPast && (
                <table className="t-mono t-small w-full mt-2" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="t-muted">
                      <th className="text-left pb-1 pr-3">When</th>
                      <th className="text-left pb-1 pr-3">Job</th>
                      <th className="text-left pb-1 pr-3">Location</th>
                      <th className="text-right pb-1 pr-3">Filled</th>
                      <th className="text-left pb-1 pr-3">Outcome</th>
                      <th className="text-left pb-1 pr-3">Volunteers</th>
                      <th className="text-left pb-1">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {past.map((j) => <JobRow key={j.id} job={j} past status={historyStatus(j, now)} />)}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              className="t-small t-accent hover:underline"
            >
              {showLog ? '▾' : '▸'} Activity · {events.length} change{events.length === 1 ? '' : 's'} logged
            </button>
            {showLog && (
              events.length === 0 ? (
                <p className="t-small t-muted mt-2">Nothing logged yet — changes are recorded from the next sync on.</p>
              ) : (
                <table className="t-mono t-small w-full mt-2" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="t-muted">
                      <th className="text-left pb-1 pr-3">Noticed</th>
                      <th className="text-left pb-1 pr-3">What</th>
                      <th className="text-left pb-1 pr-3">Job</th>
                      <th className="text-left pb-1">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="t-row-divider align-top">
                        <td className="py-1 pr-3 whitespace-nowrap t-muted">{fmtStamp(e.at)}</td>
                        <td className="py-1 pr-3 whitespace-nowrap" style={{ color: EVENT_COLOR[e.kind] ?? 'inherit', fontWeight: 600 }}>
                          {EVENT_LABEL[e.kind] ?? e.kind}
                        </td>
                        <td className="py-1 pr-3" style={{ fontFamily: 'var(--font-body)' }}>
                          {e.title || '—'}
                          {e.start_at && (
                            <span className="t-muted"> · {new Date(e.start_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                          )}
                        </td>
                        <td className="py-1" style={{ fontFamily: 'var(--font-body)' }}>{eventDetail(e)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
          <p className="t-small t-muted mt-3" style={{ fontSize: '0.72rem' }}>
            Engineers volunteer through the OT viewer's calendar invites and editor — this panel
            only mirrors it. Every job is kept in the log: one the OT viewer stops listing before
            it starts reads as cancelled, and every sign-up, withdrawal, reschedule, add and
            cancel the sync notices between polls goes in the activity log.
          </p>
        </>
      )}
    </Section>
  );
}
