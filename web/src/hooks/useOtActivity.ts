// Overtime activity feed (0145): who did what, when, on BOTH boards — the
// dashboard's own OT posts (§11; overtime_activity, written by triggers)
// and the OT viewer (§11b; ot_api_job_events, written by the sync). One
// view, one shape, newest first. §11c on the manager page lists it; the TV
// overtime strip shows the last few lines.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OtActivityKind =
  | 'signed_up' | 'withdrew' | 'post_added' | 'post_cancelled'
  | 'post_restored' | 'post_rescheduled' | 'spaces_changed' | 'retitled';

export type OtActivity = {
  source: 'dashboard' | 'ot_viewer';
  key: string;
  at: string;
  kind: OtActivityKind | string;
  person_name: string | null;
  job_title: string | null;
  job_start: string | null;
  detail: Record<string, unknown>;
};

const KEY = ['ot_activity'];

export function useOtActivity(limit = 200) {
  return useQuery({
    queryKey: [...KEY, limit],
    queryFn: async (): Promise<OtActivity[]> => {
      const { data, error } = await supabase
        .from('v_ot_activity')
        .select('*')
        .order('at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as OtActivity;
        return { ...row, detail: row.detail && typeof row.detail === 'object' ? row.detail : {} };
      });
    },
    staleTime: 30_000,
  });
}

/** Both sources are in the realtime publication. */
export function useOtActivityRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`ot-activity-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_activity' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ot_api_job_events' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

/** "Edwin Sepulveda" → "Edwin S." */
export function shortPersonName(full: string | null | undefined): string {
  if (!full) return '';
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export const OT_ACTIVITY_LABEL: Record<string, string> = {
  signed_up:        'signed up',
  withdrew:         'withdrew',
  post_added:       'new post',
  post_cancelled:   'cancelled',
  post_restored:    'restored',
  post_rescheduled: 'rescheduled',
  spaces_changed:   'spaces changed',
  retitled:         'renamed',
};

/** Tone for the activity word: green = someone stepped up, red = a gap
 *  opened, amber = the job moved, muted = bookkeeping. */
export function otActivityTone(kind: string): 'good' | 'bad' | 'warn' | 'muted' {
  if (kind === 'signed_up' || kind === 'post_restored') return 'good';
  if (kind === 'withdrew' || kind === 'post_cancelled') return 'bad';
  if (kind === 'post_rescheduled' || kind === 'spaces_changed' || kind === 'post_added') return 'warn';
  return 'muted';
}

/** One readable sentence per row, shared by the manager table and the TV.
 *    "Austin Myette withdrew · 75 AHU Major PMs · Sat Oct 17"
 *    "Cancelled · 88 Switchgear Maintenance · Sat Nov 15"
 *    "Jie Lao new post · 26 · Fire pump test · Mon Oct 20"
 *  `who` is empty when the change has no person (a cancelled Outlook event). */
export function describeOtActivity(e: OtActivity, opts: { short?: boolean } = {}): { who: string; action: string; job: string; when: string; extra: string } {
  const who = opts.short ? shortPersonName(e.person_name) : (e.person_name ?? '');
  const base = OT_ACTIVITY_LABEL[e.kind] ?? e.kind.replace(/_/g, ' ');
  let action = base;
  let extra = '';
  const d = e.detail ?? {};
  if (e.kind === 'withdrew' && d.by_self === false && d.actor_name) {
    action = 'removed';
    extra = `by ${opts.short ? shortPersonName(String(d.actor_name)) : String(d.actor_name)}`;
  }
  if (e.kind === 'signed_up' && d.by_self === false && d.actor_name) {
    action = 'assigned';
    extra = `by ${opts.short ? shortPersonName(String(d.actor_name)) : String(d.actor_name)}`;
  }
  if (e.kind === 'spaces_changed') extra = `${d.from ?? '?'} → ${d.to ?? '?'}`;
  if (e.kind === 'post_added' && d.slots !== undefined && d.slots !== null) extra = `${d.slots} slot${d.slots === 1 ? '' : 's'}`;
  const when = e.job_start
    ? new Date(e.job_start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,\s*/g, ' ')
    : '';
  return { who, action, job: e.job_title ?? '—', when, extra };
}
