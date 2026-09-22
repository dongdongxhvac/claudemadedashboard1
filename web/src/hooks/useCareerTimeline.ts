// Career timeline data for the engineer profile: one fetch per source table
// (every one already RLS-scoped — an empty result from a table the viewer may
// not read is "nothing", never an error), merged by lib/careerTimeline.ts.
// Also the mutations for the stored career_events rows (migration 0133).
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';
import { useSignoffSheet } from './useSignoffSheet';
import { PROGRAMS } from '../lib/programs';
import { buildCareerTimeline, autoMilestones, type TimelineSources, type CareerEventRow } from '../lib/careerTimeline';

const KEY = ['career_timeline'];

/** pm_completions can exceed PostgREST's 1000-row page — walk it. */
async function fetchAllPms(userId: string): Promise<TimelineSources['pms']> {
  const out: TimelineSources['pms'] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pm_completions')
      .select('first_seen_at, labor_hours')
      .eq('user_id', userId)
      .order('first_seen_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as TimelineSources['pms'];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Rows or [] — tolerate a view / table the viewer's RLS hides (0 rows) and
 *  one that does not exist in this environment (throws → treated as empty,
 *  logged once). */
function rowsOf<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) {
    console.warn(`career timeline: ${what} unavailable — ${res.error.message}`);
    return [];
  }
  return (res.data ?? []) as T[];
}

export function useCareerSources(userId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<TimelineSources> => {
      const uid = userId!;
      const [u, ce, certs, enr, chk, reps, act, oncall, ot, pto, acct, pms] = await Promise.all([
        supabase.from('users').select('hiring_date').eq('id', uid).maybeSingle(),
        supabase.from('career_events').select('*').eq('user_id', uid),
        supabase.from('certifications').select('id, name, issuer, issued_on, expires_on').eq('user_id', uid),
        supabase.from('new_hire_enrollments').select('program_key, start_date, status, created_at, updated_at').eq('user_id', uid),
        supabase.from('new_hire_checkoffs').select('program_key, item_key, done_at').eq('user_id', uid),
        supabase.from('new_hire_rep_logs').select('program_key, rep_key, occurred_on').eq('user_id', uid),
        supabase.from('new_hire_doc_activity').select('program_key, doc_key, quiz_title, score, total, at').eq('user_id', uid).eq('kind', 'quiz'),
        supabase.from('oncall_rotations').select('week_start, primary_user_id, secondary_user_id').or(`primary_user_id.eq.${uid},secondary_user_id.eq.${uid}`),
        // finished posts only; this person's signups are filtered below
        supabase.from('v_overtime_posts_with_signups').select('starts_at, status, signups').in('status', ['completed', 'closed']),
        // never the reason / type — the timeline shows a count of days only
        supabase.from('v_pto_requests_enriched').select('starts_on, ends_on, days, status').eq('user_id', uid),
        supabase.from('user_account_events').select('event, created_at').eq('target_user_id', uid),
        fetchAllPms(uid).catch((e: Error) => { console.warn(`career timeline: pm_completions unavailable — ${e.message}`); return [] as TimelineSources['pms']; }),
      ]);
      if (u.error) throw u.error;
      if (ce.error) throw ce.error;
      if (certs.error) throw certs.error;
      type OtRow = { starts_at: string; status: string; signups: { user_id: string }[] | null };
      const overtime = rowsOf<OtRow>(ot, 'overtime')
        .filter((p) => (p.signups ?? []).some((s) => s.user_id === uid))
        .map((p) => ({ starts_at: p.starts_at, status: p.status }));
      return {
        hiringDate: (u.data as { hiring_date: string | null } | null)?.hiring_date ?? null,
        careerEvents: (ce.data ?? []) as CareerEventRow[],
        certifications: (certs.data ?? []) as TimelineSources['certifications'],
        enrollments: rowsOf(enr, 'enrollments'),
        checkoffs: rowsOf(chk, 'check-offs'),
        repLogs: rowsOf(reps, 'rep logs'),
        quizzes: rowsOf(act, 'quiz runs'),
        oncall: rowsOf(oncall, 'on-call'),
        overtime,
        pto: rowsOf(pto, 'PTO'),
        accountEvents: rowsOf(acct, 'account events'),
        pms,
      };
    },
  });
}

/** Merged, newest-first events + the auto-milestone chips for one person. */
export function useCareerTimeline(userId: string | undefined) {
  const q = useCareerSources(userId);
  // Week titles / rep labels come from each program's sign-off sheet.
  // (hooks can't run in a loop — add a line when a program is added to PROGRAMS)
  const s0 = useSignoffSheet(PROGRAMS[0]);
  const s1 = useSignoffSheet(PROGRAMS[1]);
  const derived = useMemo(() => {
    if (!q.data || !userId) return { events: [], milestones: [] };
    const ctx = { userId, sheets: new Map([[PROGRAMS[0].key, s0.sheet], [PROGRAMS[1].key, s1.sheet]]), today: new Date() };
    return { events: buildCareerTimeline(q.data, ctx), milestones: autoMilestones(q.data, ctx) };
  }, [q.data, userId, s0.sheet, s1.sheet]);
  return { ...q, events: derived.events, milestones: derived.milestones, pmCount: q.data?.pms.length ?? 0 };
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export type CareerEventInput = {
  user_id: string; kind: string; occurred_on: string; title: string; detail?: string | null; visibility: 'public' | 'managers';
};

export function useAddCareerEvent() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: CareerEventInput) => {
      const { data, error } = await supabase
        .from('career_events')
        .insert({ ...input, detail: input.detail || null, created_by: me?.id ?? null })
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to add events for this person.');
      return data[0] as { id: string };
    },
    onSuccess: inv,
  });
}

export function useUpdateCareerEvent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Omit<CareerEventInput, 'user_id'>> }) => {
      const { data, error } = await supabase
        .from('career_events')
        .update({ ...input.patch, ...(input.patch.detail !== undefined ? { detail: input.patch.detail || null } : {}) })
        .eq('id', input.id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to edit this event.');
    },
    onSuccess: inv,
  });
}

export function useDeleteCareerEvent() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('career_events').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to delete this event.');
    },
    onSuccess: inv,
  });
}
