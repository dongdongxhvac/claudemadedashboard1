// /binney/exp — EXPERIMENTAL Binney escort schedule.
//
// Reads binney_escort_wos, the live mirror kept by binney_escort_poller.py
// (VM Task Scheduler → Cove GQL → Supabase). Every open Escort-category WO on
// the Binney network appears here, with the escort date/time the poller parsed
// out of the free-text description. Unlinked from all navigation on purpose.
//
// "Add to Google Calendar" builds a calendar.google.com template link — the
// event lands on whichever Google account the BROWSER is signed into, so on
// the kiosk / a bmrbinney301 session it goes to the Binney calendar.
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

interface EscortWo {
  wo_id: string;
  status: string | null;
  building: string | null;
  floor: string | null;
  suite: string | null;
  assigned_to_name: string | null;
  submitted_by: string | null;
  tenant: string | null;
  description: string | null;
  last_note: string | null;
  submitted_at: string | null;
  escort_date: string | null;   // YYYY-MM-DD
  escort_time: string | null;   // HH:MM:SS
  parse_snippet: string | null;
  parse_ok: boolean;
  fetched_at: string;
}

function useEscorts() {
  return useQuery({
    queryKey: ['binneyEscortWos'],
    queryFn: async (): Promise<EscortWo[]> => {
      const { data, error } = await supabase
        .from('binney_escort_wos')
        .select('*')
        .order('escort_date', { ascending: true, nullsFirst: false })
        .order('escort_time', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as EscortWo[];
    },
    refetchInterval: 5 * 60_000,
  });
}

interface RunRequest {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  requested_at: string;
  finished_at: string | null;
  detail: string | null;
}

/** Latest manual-run request. The "Refresh now" button inserts one; the VM's
 *  escort_run_watcher (per-minute systemd timer) claims it, runs the poller,
 *  and stamps done/error. While a request is in flight we poll every 4s. */
function useLatestRunRequest() {
  return useQuery({
    queryKey: ['binneyEscortRunReq'],
    queryFn: async (): Promise<RunRequest | null> => {
      const { data, error } = await supabase
        .from('binney_escort_run_requests')
        .select('id, status, requested_at, finished_at, detail')
        .order('requested_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as RunRequest) ?? null;
    },
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'pending' || s === 'running' ? 4000 : false;
    },
  });
}

/** Local YYYY-MM-DD for "today" — escort_date is a plain date. */
function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fmtTime(t: string | null): string {
  if (!t) return 'all day';
  const [hh, mm] = t.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** calendar.google.com pre-filled event template. Timed escorts get a 1-hour
 *  block; date-only escorts become all-day events. */
function gcalUrl(wo: EscortWo): string {
  const title = `Escort ${wo.wo_id}${wo.building ? ` — ${wo.building}` : ''}`;
  let dates: string;
  if (wo.escort_date && wo.escort_time) {
    const d = wo.escort_date.replace(/-/g, '');
    const [hh, mm] = wo.escort_time.split(':').map(Number);
    const start = `${d}T${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00`;
    const endH = (hh + 1) % 24;
    const end = `${d}T${String(endH).padStart(2, '0')}${String(mm).padStart(2, '0')}00`;
    dates = `${start}/${end}`;
  } else if (wo.escort_date) {
    const d = wo.escort_date.replace(/-/g, '');
    const next = new Date(wo.escort_date + 'T12:00:00');
    next.setDate(next.getDate() + 1);
    dates = `${d}/${next.toLocaleDateString('en-CA').replace(/-/g, '')}`;
  } else {
    dates = '';
  }
  const details =
    `COVE WO ${wo.wo_id} — Status: ${wo.status ?? '?'} — Assigned: ${wo.assigned_to_name ?? 'Unassigned'}` +
    `\n\n${wo.description ?? ''}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details,
    ctz: 'America/New_York',
    ...(wo.building ? { location: wo.building } : {}),
    ...(dates ? { dates } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function StatusChip({ status }: { status: string | null }) {
  const s = (status ?? '').toLowerCase();
  const color =
    s === 'scheduled' ? 'var(--color-accent)'
    : s === 'in progress' ? 'var(--color-warn)'
    : 'var(--color-text-muted)';
  return (
    <span
      className="t-small"
      style={{ border: `1px solid ${color}`, color, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}
    >
      {status ?? '—'}
    </span>
  );
}

function EscortRow({ wo, past }: { wo: EscortWo; past?: boolean }) {
  return (
    <div className="t-row-divider t-row-hover px-2 py-2 flex gap-4 items-start">
      <div className="w-32 shrink-0">
        {wo.escort_date ? (
          <>
            <div className={`t-text t-mono ${past ? 't-danger' : ''}`}>{fmtDate(wo.escort_date)}</div>
            <div className="t-small t-muted t-mono">{fmtTime(wo.escort_time)}</div>
          </>
        ) : (
          <div className="t-text t-warn">no date found</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-text t-mono">{wo.wo_id}</span>
          <StatusChip status={wo.status} />
          <span className="t-small t-muted">{wo.building ?? '—'}{wo.floor ? ` · ${wo.floor}` : ''}</span>
          <span className="t-small t-muted">→ {wo.assigned_to_name ?? 'Unassigned'}</span>
        </div>
        <p className="t-small t-muted mt-1" style={{ whiteSpace: 'pre-wrap' }}>{wo.description}</p>
        {wo.parse_snippet && (
          <p className="t-small t-muted mt-1" style={{ opacity: 0.7 }}>parsed from: “{wo.parse_snippet}”</p>
        )}
      </div>
      <div className="shrink-0">
        <a
          href={gcalUrl(wo)}
          target="_blank"
          rel="noreferrer"
          className="t-small t-accent hover:underline whitespace-nowrap"
        >
          + Google Calendar
        </a>
      </div>
    </div>
  );
}

function Section({ title, note, rows, past }: { title: string; note?: string; rows: EscortWo[]; past?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section className="t-card">
      <div className="flex items-baseline gap-3 mb-2">
        <h2 className="t-section-title">{title}</h2>
        <span className="t-small t-muted">{rows.length}{note ? ` · ${note}` : ''}</span>
      </div>
      {rows.map((wo) => <EscortRow key={wo.wo_id} wo={wo} past={past} />)}
    </section>
  );
}

export default function BinneyEscortExp() {
  const q = useEscorts();
  const { session } = useAuth();
  const qc = useQueryClient();
  const reqQ = useLatestRunRequest();
  const requestRun = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('binney_escort_run_requests')
        .insert({ requested_by: session?.user.email ?? null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['binneyEscortRunReq'] }),
  });

  const runActive = reqQ.data?.status === 'pending' || reqQ.data?.status === 'running';
  // When the in-flight request completes, pull the fresh escort rows.
  const prevActive = useRef(false);
  useEffect(() => {
    if (prevActive.current && !runActive) {
      qc.invalidateQueries({ queryKey: ['binneyEscortWos'] });
    }
    prevActive.current = runActive;
  }, [runActive, qc]);

  const today = todayIso();

  const rows = q.data ?? [];
  const upcoming = rows.filter((r) => r.escort_date && r.escort_date >= today);
  const pastDated = rows.filter((r) => r.escort_date && r.escort_date < today);
  const undated = rows.filter((r) => !r.escort_date);
  const freshest = rows.reduce<string | null>(
    (acc, r) => (acc === null || r.fetched_at > acc ? r.fetched_at : acc), null);

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="t-section-title">Binney · Escort Schedule</h1>
              <span className="t-small t-warn">experiment</span>
            </div>
            <p className="t-small t-muted">
              open Escort WOs from Cove, dates parsed from descriptions
              {freshest ? ` · data as of ${new Date(freshest).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => requestRun.mutate()}
              disabled={runActive || requestRun.isPending}
              className="t-small t-accent hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {reqQ.data?.status === 'running' ? 'Polling COVE…'
                : reqQ.data?.status === 'pending' ? 'Queued — starts within a minute…'
                : 'Refresh from COVE now'}
            </button>
            <Link to="/binney/manager" className="t-small t-accent hover:underline">Dashboard</Link>
          </div>
        </div>
        {reqQ.data?.status === 'error' && (
          <div className="max-w-5xl mx-auto px-6 pb-2">
            <p className="t-small t-danger">Last manual run failed: {reqQ.data.detail ?? 'unknown error'}</p>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {q.isLoading && <p className="t-text t-muted">Loading…</p>}
        {q.isError && <p className="t-text t-danger">Failed to load: {String(q.error)}</p>}
        {q.isSuccess && rows.length === 0 && (
          <div className="t-card">
            <p className="t-text t-muted">
              No escort rows yet — the VM poller (binney_escort_poller.py) hasn't pushed data.
              Install it with install_binney_escort_poller_task.ps1 and run it once.
            </p>
          </div>
        )}
        <Section title="Upcoming escorts" rows={upcoming} />
        <Section title="No date parsed" note="check description manually" rows={undated} />
        <Section title="Escort date passed, WO still open" note="close or reschedule in Cove" rows={pastDated} past />
      </main>
    </div>
  );
}
