// §11b — University Park Overtime API mirror (Steve's / "Jie's CW OT Viewer").
//
// The OT viewer publishes the crew's overtime schedule — Outlook calendar
// events in off-hours plus jobs added through its editor, each with a number
// of spaces and the engineers who volunteered. The browser never calls it
// (no CORS by design, bearer key must stay server-side): watcher/
// ot_api_poller.py mirrors it into Supabase every 5 minutes (0136) and this
// hook reads the mirror.
//
//   ot_api_jobs   — one row per job, keyed by the API's job id
//   ot_api_syncs  — one row per poll; the newest says how fresh the mirror is
//
// Read-only: volunteering happens in the OT viewer / its email invites.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OtApiJobStatus = 'unfilled' | 'partial' | 'full';

export type OtApiVolunteer = {
  name: string | null;
  email: string | null;
  signed_up: string | null;
};

export type OtApiJob = {
  id: string;
  title: string;
  location: string | null;
  /** 'calendar' = Outlook event · 'added' = created in the OT viewer / API. */
  source: string | null;
  notes: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  /** The API's own human string, e.g. "Sat Sep 19, 7 AM - 4 PM". */
  when_text: string | null;
  spaces: number;
  filled: number;
  open_spaces: number;
  status: OtApiJobStatus | string;
  volunteers: OtApiVolunteer[];
  fetched_at: string;
};

export type OtApiSync = {
  id: string;
  fetched_at: string;
  status: 'ok' | 'error';
  error_msg: string | null;
  generated_at: string | null;
  window_days: number | null;
  job_count: number;
  warnings: unknown[];
  team: { name?: string | null; email?: string | null }[];
};

const JOBS_KEY = ['ot_api_jobs'];
const SYNC_KEY = ['ot_api_sync_latest'];

/** Every mirrored job, soonest first. The poller already bounds the window
 *  (UPARK_OT_API_DAYS, default 14) and drops jobs it no longer sees, so the
 *  table IS the current schedule. */
export function useOtApiJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: async (): Promise<OtApiJob[]> => {
      const { data, error } = await supabase
        .from('ot_api_jobs')
        .select('*')
        .order('start_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...(r as OtApiJob),
        volunteers: Array.isArray((r as OtApiJob).volunteers) ? (r as OtApiJob).volunteers : [],
      }));
    },
    staleTime: 30_000,
  });
}

/** The newest poll, ok or error — drives "synced 3m ago" / "last poll
 *  failed" and tells the UI whether the poller has ever run. */
export function useOtApiLatestSync() {
  return useQuery({
    queryKey: SYNC_KEY,
    queryFn: async (): Promise<OtApiSync | null> => {
      const { data, error } = await supabase
        .from('ot_api_syncs')
        .select('id, fetched_at, status, error_msg, generated_at, window_days, job_count, warnings, team')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as OtApiSync;
      return {
        ...row,
        warnings: Array.isArray(row.warnings) ? row.warnings : [],
        team: Array.isArray(row.team) ? row.team : [],
      };
    },
    staleTime: 30_000,
  });
}

/** Realtime: a poll rewrites jobs row by row and ends with one syncs row;
 *  any of those invalidates both queries. */
export function useOtApiRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`ot-api-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ot_api_jobs' }, () => {
        qc.invalidateQueries({ queryKey: JOBS_KEY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ot_api_syncs' }, () => {
        qc.invalidateQueries({ queryKey: JOBS_KEY });
        qc.invalidateQueries({ queryKey: SYNC_KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

/** Jobs still worth showing: not yet over (end, or start when there is no
 *  end; all-day jobs run to the end of their start day). */
export function isOtApiJobCurrent(j: OtApiJob, now: Date): boolean {
  const nowMs = now.getTime();
  if (j.end_at) return new Date(j.end_at).getTime() >= nowMs;
  const s = new Date(j.start_at);
  if (j.all_day) {
    const endOfDay = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
    return endOfDay.getTime() >= nowMs;
  }
  return s.getTime() >= nowMs;
}

/** Freshness label for the mirror: the poller runs every 5 minutes, so
 *  anything past 20 minutes means it has stopped. */
export function otApiFreshness(sync: OtApiSync | null | undefined, now: Date):
  { label: string; tone: 'ok' | 'warn' | 'bad' | 'none' } {
  if (!sync) return { label: 'poller has not run yet', tone: 'none' };
  const ageMin = Math.max(0, Math.round((now.getTime() - new Date(sync.fetched_at).getTime()) / 60_000));
  const age = ageMin < 1 ? 'just now' : ageMin < 60 ? `${ageMin}m ago` : ageMin < 48 * 60 ? `${Math.floor(ageMin / 60)}h ago` : `${Math.floor(ageMin / 1440)}d ago`;
  if (sync.status === 'error') return { label: `last poll failed ${age}`, tone: 'bad' };
  if (ageMin > 20) return { label: `synced ${age} · poller stalled?`, tone: 'warn' };
  return { label: `synced ${age}`, tone: 'ok' };
}
