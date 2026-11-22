// §05 PM Audit — data hooks (docs/pm-audit.md §4). The database layer is
// live; this only reads the two views + three tables and writes reviews.
//
// PostgREST can't join a view to a table without a foreign key, so the queue
// is three small reads joined in lib/pmAudit.ts (joinQueue).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';
import { useMySiteAccess } from './useSiteScope';
import {
  addDays, engineerKeys, joinQueue, sumTypeHours, weekStartOf, weekStats, weeksEnding,
  type FlagRow, type HistoryEvent, type LaborItem, type QueueEntry, type QueueRow, type Review, type ScoreClose, type ScoreRow,
  type TypeEntry, type TypeHours, type WeekHours, type WeekTimeClose,
  type SiteFilter, type TaskNote, type Verdict, type WeekClose, type WeekStats,
} from '../lib/pmAudit';

const FLAG_COLS = [
  'task_no', 'site_code', 'building_code', 'equipment', 'task_name', 'assigned_to_name', 'completed_on', 'week_start', 'pm_type',
  'labor_hours', 'est_labor_hours', 'tech_week_hours', 'has_details', 'cove_task_id', 'started_at', 'completed_at', 'close_note',
  'note_count', 'note_chars', 'note_boilerplate', 'steps_total', 'steps_checked', 'photo_count', 'attachment_count',
  'min_photos', 'min_note_chars', 'note_must_match', 'closes_within_5m', 'has_photo', 'note_thick', 'note_thin', 'steps_open',
  'flags', 'flag_count', 'good',
].join(',');

const WEEK_COLS = 'task_no,site_code,assigned_to_name,has_details,min_photos,has_photo,good';
const SCORE_COLS = 'task_no,site_code,assigned_to_name,week_start,pm_type,has_details,min_photos,has_photo,steps_total,steps_checked,note_thin,flags,flag_count,good';

/** Every row of a filtered read, past PostgREST's 1000-row page. `page`
 *  must apply a stable order. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Who may do what on the audit pages — mirrors the RLS policies
 *  (paq_select / parv_write): admin, manager, director and leads read;
 *  admin, manager and leads write reviews (a director is read-only).
 *  Admin + director pick the site; everyone else is on their home site. */
export function useAuditAccess(): {
  isLoading: boolean;
  canView: boolean;
  canReview: boolean;
  canPickSite: boolean;
  homeSite: 'upark' | 'binney';
  meId: string | null;
} {
  const me = useMe();
  const access = useMySiteAccess();
  const role = me.data?.role;
  const lead = me.data?.is_lead === true;
  return {
    isLoading: me.isLoading || access.isLoading,
    canView: role === 'admin' || role === 'manager' || role === 'director' || lead,
    canReview: role === 'admin' || role === 'manager' || lead,
    canPickSite: access.canSeeAllSites,
    homeSite: access.homeSite,
    meId: me.data?.id ?? null,
  };
}

/** First and latest week_start in pm_audit_queue (null when it is empty),
 *  plus `firstClose`: the earliest week with any recurring close at all, which
 *  is how far back the week picker can go (weeks before the first queue show
 *  their totals and can have a queue built on demand). */
export function useAuditWeekRange() {
  return useQuery({
    queryKey: ['pm_audit', 'week_range'],
    queryFn: async (): Promise<{ first: string | null; latest: string | null; firstClose: string | null; current: string | null }> => {
      const pick = (ascending: boolean) =>
        supabase.from('pm_audit_queue').select('week_start').order('week_start', { ascending }).limit(1);
      const [a, b, c] = await Promise.all([
        pick(true), pick(false),
        supabase.from('pm_close_events').select('completed_on').eq('cmms_type', 'recurring')
          .not('completed_on', 'is', null).order('completed_on', { ascending: true }).limit(1),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      if (c.error) throw c.error;
      const firstCloseAt = c.data?.[0]?.completed_on as string | undefined;
      return {
        first: (a.data?.[0]?.week_start as string | undefined) ?? null,
        latest: (b.data?.[0]?.week_start as string | undefined) ?? null,
        firstClose: firstCloseAt ? weekStartOf(firstCloseAt) : null,
        // the week in progress — the Week page can show it, the queue cannot
        current: weekStartOf(new Date().toISOString()),
      };
    },
    staleTime: 5 * 60_000,
  });
}

/** Build (or top up) one week's queue with the same function the Sunday
 *  cron runs — for a week that never had one. Both sites; idempotent. */
export function useBuildQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (week: string): Promise<void> => {
      const { error } = await supabase.rpc('build_pm_audit_queue', { p_week_start: week });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pm_audit'] }),
  });
}

/** The week's queue joined to its flags rows and reviews, in spec order. */
export function useAuditQueue(week: string | null, site: SiteFilter) {
  return useQuery({
    queryKey: ['pm_audit', 'queue', week, site],
    enabled: !!week,
    queryFn: async (): Promise<QueueRow[]> => {
      const entries = await fetchAll<QueueEntry>((from, to) => {
        let q = supabase.from('pm_audit_queue').select('week_start,task_no,site_code,reason,flags').eq('week_start', week!);
        if (site !== 'both') q = q.eq('site_code', site);
        return q.order('task_no').range(from, to);
      });
      if (entries.length === 0) return [];
      const ids = entries.map((e) => e.task_no);
      const [flagLists, reviewLists] = await Promise.all([
        Promise.all(chunks(ids, 150).map(async (part) => {
          const { data, error } = await supabase.from('v_pm_audit_flags').select(FLAG_COLS).eq('week_start', week!).in('task_no', part);
          if (error) throw error;
          return (data ?? []) as unknown as FlagRow[];
        })),
        Promise.all(chunks(ids, 150).map(async (part) => {
          const { data, error } = await supabase.from('pm_audit_reviews').select('*').eq('week_start', week!).in('task_no', part);
          if (error) throw error;
          return (data ?? []) as Review[];
        })),
      ]);
      return joinQueue(entries, flagLists.flat(), reviewLists.flat());
    },
    staleTime: 30_000,
  });
}

/** Every recurring close of the week (queued or not) → the tile numbers. */
export function useAuditWeekStats(week: string | null, site: SiteFilter) {
  return useQuery({
    queryKey: ['pm_audit', 'week_stats', week, site],
    enabled: !!week,
    queryFn: async (): Promise<WeekStats> => {
      const rows = await fetchAll<WeekClose>((from, to) => {
        let q = supabase.from('v_pm_audit_flags').select(WEEK_COLS).eq('week_start', week!);
        if (site !== 'both') q = q.eq('site_code', site);
        return q.order('completed_on').order('task_no').range(from, to);
      });
      return weekStats(rows);
    },
    staleTime: 60_000,
  });
}

export type TaskAttachment = { name: string; url: string; uploadedAt: string | null; uploadedBy: string | null; internal?: boolean | null };
export type TaskStep = { description: string | null; type: string | null; value: unknown };

export type TaskDetails = {
  cove_task_id: string;
  task_no: string;
  template_name: string | null;
  equipment_id: string | null;
  equipment_name: string | null;
  building_name: string | null;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  steps: TaskStep[] | null;
  attachments: TaskAttachment[] | null;
  history: HistoryEvent[] | null;
  notes: TaskNote[] | null;
  fetched_at: string | null;
};

export type PriorNote = { task_no: string; completed_at: string | null; completed_by: string | null; assignee_name: string | null; close_note: string | null };

export type ReviewCard = { f: FlagRow | null; details: TaskDetails | null; prior: PriorNote[]; review: Review | null };

/** Everything the review card shows for one queued task. */
export function useAuditCard(week: string | null, taskNo: string | null) {
  return useQuery({
    queryKey: ['pm_audit', 'card', week, taskNo],
    enabled: !!week && !!taskNo,
    queryFn: async (): Promise<ReviewCard> => {
      const [fRes, dRes, rRes] = await Promise.all([
        supabase.from('v_pm_audit_flags').select(FLAG_COLS).eq('week_start', week!).eq('task_no', taskNo!)
          .order('completed_on', { ascending: false }).limit(1),
        supabase.from('pm_task_details')
          .select('cove_task_id,task_no,template_name,equipment_id,equipment_name,building_name,due_date,completed_at,completed_by,steps,attachments,history,notes,fetched_at')
          .eq('task_no', taskNo!).order('completed_at', { ascending: false, nullsFirst: false }).limit(1),
        supabase.from('pm_audit_reviews').select('*').eq('week_start', week!).eq('task_no', taskNo!).maybeSingle(),
      ]);
      if (fRes.error) throw fRes.error;
      if (dRes.error) throw dRes.error;
      if (rRes.error) throw rRes.error;
      const f = ((fRes.data ?? [])[0] as unknown as FlagRow | undefined) ?? null;
      const details = ((dRes.data ?? [])[0] as TaskDetails | undefined) ?? null;
      let prior: PriorNote[] = [];
      if (details?.equipment_id) {
        const { data, error } = await supabase.from('pm_task_details')
          .select('task_no,completed_at,completed_by,assignee_name,close_note')
          .eq('equipment_id', details.equipment_id).neq('task_no', taskNo!)
          .order('completed_at', { ascending: false, nullsFirst: false }).limit(3);
        if (error) throw error;
        prior = (data ?? []) as PriorNote[];
      }
      return { f, details, prior, review: (rRes.data as Review | null) ?? null };
    },
    staleTime: 60_000,
  });
}

export type ReviewInput = { week: string; taskNo: string; verdict: Verdict; reasonTags: string[]; note: string };

/** Upsert the manager's verdict (one per week × task). */
export function useSaveReview() {
  const qc = useQueryClient();
  const { meId } = useAuditAccess();
  return useMutation({
    mutationFn: async (input: ReviewInput): Promise<Review> => {
      if (!meId) throw new Error('Your user profile is not loaded yet — try again in a moment.');
      const { data, error } = await supabase.from('pm_audit_reviews').upsert({
        week_start: input.week,
        task_no: input.taskNo,
        reviewer_id: meId,
        verdict: input.verdict,
        reason_tags: input.reasonTags,
        note: input.note.trim() || null,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: 'week_start,task_no' }).select('*').single();
      if (error) throw error;
      return data as Review;
    },
    onSuccess: (saved) => {
      // Patch every cached copy of that week's queue so "next unreviewed" is
      // right the moment the card navigates; the refetch tidies the order.
      qc.setQueriesData<QueueRow[]>({ queryKey: ['pm_audit', 'queue', saved.week_start] }, (rows) =>
        rows?.map((r) => (r.task_no === saved.task_no ? { ...r, review: saved } : r)));
      qc.invalidateQueries({ queryKey: ['pm_audit', 'queue'] });
      qc.invalidateQueries({ queryKey: ['pm_audit', 'card', saved.week_start, saved.task_no] });
      qc.invalidateQueries({ queryKey: ['pm_audit', 'scorecard'] });
    },
  });
}

const LABOR_COLS = 'kind,site_code,task_no,task_name,cmms_type,building,assignee_name,task_closed,performer,hours,performed_at,day_local,week_start,bucket';

/** How the week was spent: every labor entry performed that week (PM tasks
 *  by the person who did the work, work orders at close), the labor report's
 *  weekly totals, and that week's closed PMs for the audit columns. */
export function useAuditWeekTime(week: string | null, site: SiteFilter) {
  return useQuery({
    queryKey: ['pm_audit', 'week_time', week, site],
    enabled: !!week,
    queryFn: async (): Promise<{ items: LaborItem[]; hours: WeekHours[]; closes: WeekTimeClose[] }> => {
      const [items, hours, closes] = await Promise.all([
        fetchAll<LaborItem>((from, to) => {
          let q = supabase.from('v_audit_labor_items').select(LABOR_COLS).eq('week_start', week!);
          if (site !== 'both') q = q.eq('site_code', site);
          return q.order('performed_at').order('task_no').order('performer').range(from, to);
        }),
        fetchAll<WeekHours>((from, to) => {
          let q = supabase.from('v_tech_week_site_hours').select('site_code,assigned_to_name,week_start,week_hours,as_of').eq('week_start', week!);
          if (site !== 'both') q = q.eq('site_code', site);
          return q.order('assigned_to_name').order('site_code').range(from, to);
        }),
        fetchAll<WeekTimeClose>((from, to) => {
          let q = supabase.from('v_pm_audit_flags').select('task_no,site_code,assigned_to_name,flag_count,good').eq('week_start', week!);
          if (site !== 'both') q = q.eq('site_code', site);
          return q.order('completed_on').order('task_no').range(from, to);
        }),
      ]);
      return { items, hours, closes };
    },
    staleTime: 60_000,
  });
}

/** Roster keys of everyone whose role is engineer (leads included, people who
 *  have left included, so past weeks keep their rows). The Week tab and the
 *  scorecard's hours table show only these people: the labor report also
 *  carries porters, managers and vendors. Two plain reads, no embed — users
 *  and engineer_profiles are related twice (manager_user_id). */
export function useAuditEngineers() {
  return useQuery({
    queryKey: ['pm_audit', 'engineers'],
    queryFn: async (): Promise<string[]> => {
      const [users, profiles] = await Promise.all([
        supabase.from('users').select('id,full_name').eq('role', 'engineer'),
        supabase.from('engineer_profiles').select('user_id,cmms_assignee_name'),
      ]);
      if (users.error) throw users.error;
      if (profiles.error) throw profiles.error;
      return engineerKeys(users.data ?? [], profiles.data ?? []);
    },
    staleTime: 10 * 60_000,
  });
}

export const SCORE_WEEKS_MAX = 13;

/** Every labor entry of the 13 weeks ending at `lastWeek`, added up per
 *  person, site and week by work type (PM / ODT / WO). Read a week at a
 *  time, four at once: a quarter is ~10,000 entries, and one week is a page
 *  or two. Kept apart from useAuditScorecard so the quality table never
 *  waits for it. */
export function useAuditHoursSplit(lastWeek: string | null, site: SiteFilter) {
  return useQuery({
    queryKey: ['pm_audit', 'hours_split', lastWeek, site],
    enabled: !!lastWeek,
    queryFn: async (): Promise<{ weeks: string[]; rows: TypeHours[] }> => {
      const weeks = weeksEnding(lastWeek!, SCORE_WEEKS_MAX);
      const out: TypeHours[] = [];
      const queue = [...weeks];
      const worker = async () => {
        for (let w = queue.shift(); w; w = queue.shift()) {
          const week = w;
          const entries = await fetchAll<TypeEntry>((from, to) => {
            let q = supabase.from('v_audit_labor_items').select('kind,site_code,performer,week_start,cmms_type,hours').eq('week_start', week);
            if (site !== 'both') q = q.eq('site_code', site);
            return q.order('performed_at').order('task_no').order('performer').range(from, to);
          });
          out.push(...sumTypeHours(entries));
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      return { weeks, rows: out };
    },
    staleTime: 10 * 60_000,
  });
}

/** 13 weeks of scorecard rows + per-close rows ending at `lastWeek`; the
 *  4 / 8 / 13 window is sliced from this on the client, so switching is free. */
export function useAuditScorecard(lastWeek: string | null, site: SiteFilter) {
  return useQuery({
    queryKey: ['pm_audit', 'scorecard', lastWeek, site],
    enabled: !!lastWeek,
    queryFn: async (): Promise<{ weeks: string[]; views: ScoreRow[]; closes: ScoreClose[] }> => {
      const weeks = weeksEnding(lastWeek!, SCORE_WEEKS_MAX);
      const from0 = weeks[0];
      const to0 = addDays(lastWeek!, 0);
      const [views, closes] = await Promise.all([
        fetchAll<ScoreRow>((from, to) => {
          let q = supabase.from('v_pm_audit_scorecard').select('*').gte('week_start', from0).lte('week_start', to0);
          if (site !== 'both') q = q.eq('site_code', site);
          return q.order('week_start').order('site_code').order('tech').range(from, to);
        }),
        fetchAll<ScoreClose>((from, to) => {
          let q = supabase.from('v_pm_audit_flags').select(SCORE_COLS).gte('week_start', from0).lte('week_start', to0);
          if (site !== 'both') q = q.eq('site_code', site);
          return q.order('completed_on').order('task_no').range(from, to);
        }),
      ]);
      return { weeks, views, closes };
    },
    staleTime: 5 * 60_000,
  });
}
