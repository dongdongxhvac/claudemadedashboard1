// Binney St PTO hooks — duplicated from web/src/hooks/usePto.ts (§12) per the
// isolate-new-features rule: the Binney route tree must not modify UPark's
// shared hooks. Same tables/views and identical export names (drop-in for the
// duplicated panel), but every read is scoped to users whose
// engineer_profiles.home_site_id is the Binney site (useBinneyUserIds below),
// and query keys are binney_-prefixed so the two panels never share a cache.
// Writes hit the same tables — RLS is role-based and unchanged.
//
// Backed by:
//   pto_requests           — submitted requests (pending/approved/denied/cancelled)
//   pto_balances           — per-engineer annual allotment
//   v_pto_summary          — balance + used + remaining (used computed from approved requests)
//   v_pto_requests_enriched — requests joined with user names for display
//
// Realtime channel name uses crypto.randomUUID() to avoid the duplicate-
// subscription crash we hit in Phase 11 (see memory:
// feedback_supabase_realtime_channel_names).
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useBinneySiteId } from './useBinneySiteId';

export type PtoType   = 'vacation' | 'sick' | 'personal' | 'bereavement' | 'holiday' | 'unpaid';
export type PtoStatus = 'pending'  | 'approved' | 'denied' | 'cancelled';

/** Friendly labels for PTO types. Partial because "personal" was removed
 *  from the offering — legacy rows with type='personal' fall through to
 *  the raw string via ptoTypeLabel() below. The PtoType union still
 *  includes 'personal' so the DB schema (and any historical row) stays
 *  valid; just no human-friendly label rendered. */
export const PTO_TYPE_LABELS: Partial<Record<PtoType, string>> = {
  vacation: 'Vacation',
  sick: 'Sick',
  bereavement: 'Bereavement',
  holiday: 'Floating Holiday',
  unpaid: 'Unpaid',
};

/** Look up a friendly label for a PtoType, falling back to the raw type
 *  string when there's no entry (e.g. legacy 'personal' rows). */
export function ptoTypeLabel(t: PtoType | null | undefined): string {
  if (!t) return '—';
  return PTO_TYPE_LABELS[t] ?? t;
}

export type PtoRequestSource =
  | 'self_serve' | 'verbal' | 'phone' | 'text' | 'email' | 'team'
  | 'ontheclock_csv' | 'unknown' | 'other';

export const PTO_REQUEST_SOURCE_LABELS: Record<PtoRequestSource, string> = {
  self_serve:     'Self-serve',
  verbal:         'Verbal (in person)',
  phone:          'Phone call',
  text:           'Text',
  email:          'Email',
  team:           'Team',
  ontheclock_csv: 'OnTheClock CSV',
  unknown:        'Unknown',
  other:          'Other',
};

/** Subset shown in the manager Add-PTO dropdown — the rest are system values. */
export const PTO_MANAGER_SOURCE_OPTIONS: PtoRequestSource[] = [
  'verbal', 'phone', 'text', 'email', 'team', 'other',
];

export type PtoRequest = {
  id: string;
  user_id: string;
  user_full_name: string | null;
  type: PtoType;
  starts_on: string;
  ends_on: string;
  days: number;
  hours: number;
  status: PtoStatus;
  reason: string | null;
  /** Time the engineer LEAVES (start of off-time). Null = off from start
   *  of day. When both out_from + out_until are null, this is a full day. */
  out_from: string | null;        // 'HH:MM:SS' from Postgres time column
  /** Time the engineer RETURNS (end of off-time). Null = off through end
   *  of day. */
  out_until: string | null;
  request_source: PtoRequestSource | null;
  request_source_detail: string | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  cap_override: boolean;
  cap_override_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** True when out_from OR out_until is set — engineer is only off part of
 *  the day, not the full shift. Counter logic should treat the engineer as
 *  "in" for headcount, with a "partial" annotation. */
export function isPartialDay(r: { out_from: string | null; out_until: string | null }): boolean {
  return !!r.out_from || !!r.out_until;
}

/** Convert "HH:MM:SS" or "HH:MM" to compact 12-hour form: "12p", "9a",
 *  "8:30a". For chip labels. */
function fmtTime12(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr ?? '0');
  if (!Number.isFinite(h)) return hhmm;
  const ampm = h < 12 ? 'a' : 'p';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Returns the partial-day annotation for a PTO row, or null when the row
 *  is a full day. Shown next to the type pill on chips:
 *    out_from=null, out_until='12:00' → "in 12p"   (late start)
 *    out_from='14:00', out_until=null → "out 2p"   (early leave)
 *    out_from='10:00', out_until='14:00' → "10a–2p" (mid-day window)
 */
export function partialDayLabel(
  r: { out_from: string | null; out_until: string | null },
): string | null {
  if (!r.out_from && !r.out_until) return null;
  if (!r.out_from && r.out_until)  return `in ${fmtTime12(r.out_until)}`;
  if (r.out_from && !r.out_until)  return `out ${fmtTime12(r.out_from)}`;
  return `${fmtTime12(r.out_from!)}–${fmtTime12(r.out_until!)}`;
}

export type PtoSummary = {
  id: string;
  user_id: string;
  user_full_name: string | null;
  year: number;
  vacation_alloted: number;
  vacation_used: number;
  vacation_remaining: number;
  sick_alloted: number;
  sick_used: number;
  sick_remaining: number;
  holiday_alloted: number;
  holiday_used: number;
  holiday_remaining: number;
  notes: string | null;
  updated_at: string;
};

const KEY_REQUESTS = ['binney_pto_requests'];
const KEY_SUMMARY  = ['binney_pto_summary'];
const KEY_USER_IDS = ['binney_pto_user_ids'];

/** user_ids of everyone homed at Binney St (engineer_profiles.home_site_id).
 *  Every PTO read below scopes to this set, so UPark data never appears. */
export function useBinneyUserIds() {
  const siteQ = useBinneySiteId();
  return useQuery({
    queryKey: [...KEY_USER_IDS, siteQ.data ?? null],
    enabled: !!siteQ.data,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('engineer_profiles')
        .select('user_id')
        .eq('home_site_id', siteQ.data!);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    },
    staleTime: 60_000,
  });
}

export function usePtoRequests() {
  const idsQ = useBinneyUserIds();
  const ids = idsQ.data;
  return useQuery({
    queryKey: [...KEY_REQUESTS, ids ?? null],
    enabled: !!ids,
    queryFn: async (): Promise<PtoRequest[]> => {
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('v_pto_requests_enriched')
        .select('*')
        .in('user_id', ids)
        .order('starts_on', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PtoRequest[];
    },
    staleTime: 30_000,
  });
}

export function usePtoSummary() {
  const idsQ = useBinneyUserIds();
  const ids = idsQ.data;
  return useQuery({
    queryKey: [...KEY_SUMMARY, ids ?? null],
    enabled: !!ids,
    queryFn: async (): Promise<PtoSummary[]> => {
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('v_pto_summary')
        .select('*')
        .in('user_id', ids)
        .order('year', { ascending: false })
        .order('user_full_name');
      if (error) throw error;
      return (data ?? []) as PtoSummary[];
    },
    staleTime: 30_000,
  });
}

export function usePtoRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    // Unique channel name per call so re-subscribing from a second component
    // on the same page doesn't crash (Supabase forbids .on() after .subscribe()
    // on the same channel name).
    const channel = supabase
      .channel(`binney-pto-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pto_requests' }, () => {
        qc.invalidateQueries({ queryKey: KEY_REQUESTS });
        qc.invalidateQueries({ queryKey: KEY_SUMMARY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pto_balances' }, () => {
        qc.invalidateQueries({ queryKey: KEY_SUMMARY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

// ── Cap-rule helper: find other engineers with overlapping vacation
// (status approved OR pending) for the proposed range. The UI calls this
// before submit/approve to surface conflicts and gate the cap_override.

export type CapConflict = {
  user_id: string;
  user_full_name: string | null;
  starts_on: string;
  ends_on: string;
  status: PtoStatus;
};

export function findCapConflicts(
  requests: PtoRequest[],
  excludeUserId: string | null,
  startsOn: string,
  endsOn: string,
): CapConflict[] {
  const out: CapConflict[] = [];
  const seen = new Set<string>();
  for (const r of requests) {
    if (r.type !== 'vacation') continue;
    if (r.status !== 'approved' && r.status !== 'pending') continue;
    if (excludeUserId && r.user_id === excludeUserId) continue;
    // overlap iff starts <= other.ends AND ends >= other.starts
    if (startsOn <= r.ends_on && endsOn >= r.starts_on) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      out.push({
        user_id: r.user_id,
        user_full_name: r.user_full_name,
        starts_on: r.starts_on,
        ends_on: r.ends_on,
        status: r.status,
      });
    }
  }
  return out;
}

/** True if adding the proposed vacation would exceed the 2-engineer cap.
 *  Returns the conflicting list so the UI can show names. */
export function checkVacationCap(
  requests: PtoRequest[],
  excludeUserId: string | null,
  startsOn: string,
  endsOn: string,
): { exceeded: boolean; conflicts: CapConflict[] } {
  const conflicts = findCapConflicts(requests, excludeUserId, startsOn, endsOn);
  return { exceeded: conflicts.length >= 2, conflicts };
}

// ── Mutations

export type SubmitPtoInput = {
  user_id: string;
  type: PtoType;
  starts_on: string;
  ends_on: string;
  hours: number;
  reason?: string | null;
  status?: PtoStatus;             // defaults to 'pending'; manager add-direct can pass 'approved'
  cap_override?: boolean;
  cap_override_reason?: string | null;
  request_source?: PtoRequestSource | null;   // required for manager add; auto-set for self-serve
  request_source_detail?: string | null;
  /** Partial-day time window — see PtoRequest.out_from / .out_until. */
  out_from?: string | null;
  out_until?: string | null;
};

export function useSubmitPto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitPtoInput) => {
      const auth = await supabase.auth.getUser();
      const { data: meRow } = await supabase
        .from('users').select('id').eq('auth_user_id', auth.data.user?.id ?? '').maybeSingle();
      const payload = {
        user_id:        input.user_id,
        type:           input.type,
        starts_on:      input.starts_on,
        ends_on:        input.ends_on,
        hours:          input.hours,
        status:         input.status ?? 'pending',
        reason:         input.reason ?? null,
        out_from:       input.out_from ?? null,
        out_until:      input.out_until ?? null,
        request_source: input.request_source ?? null,
        request_source_detail: input.request_source_detail ?? null,
        submitted_by:   meRow?.id ?? null,
        submitted_at:   new Date().toISOString(),
        cap_override:   input.cap_override ?? false,
        cap_override_reason: input.cap_override_reason ?? null,
        // If submitting as 'approved', set reviewer = self
        reviewed_by:    input.status === 'approved' ? (meRow?.id ?? null) : null,
        reviewed_at:    input.status === 'approved' ? new Date().toISOString() : null,
      };
      const { data, error } = await supabase
        .from('pto_requests').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_REQUESTS });
      qc.invalidateQueries({ queryKey: KEY_SUMMARY });
    },
  });
}

export function useReviewPto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      decision: 'approved' | 'denied';
      review_note?: string | null;
      cap_override?: boolean;
      cap_override_reason?: string | null;
    }) => {
      const auth = await supabase.auth.getUser();
      const { data: meRow } = await supabase
        .from('users').select('id').eq('auth_user_id', auth.data.user?.id ?? '').maybeSingle();
      const patch: Record<string, unknown> = {
        status:       input.decision,
        reviewed_by:  meRow?.id ?? null,
        reviewed_at:  new Date().toISOString(),
        review_note:  input.review_note ?? null,
      };
      if (input.cap_override !== undefined)        patch.cap_override        = input.cap_override;
      if (input.cap_override_reason !== undefined) patch.cap_override_reason = input.cap_override_reason;
      const { error } = await supabase.from('pto_requests').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_REQUESTS });
      qc.invalidateQueries({ queryKey: KEY_SUMMARY });
    },
  });
}

/** Manager edit: change any field on an existing request. RLS allows
 *  admin/manager/lead via pto_requests_elevated_write. */
export function useUpdatePto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<{
        type: PtoType;
        starts_on: string;
        ends_on: string;
        hours: number;
        status: PtoStatus;
        reason: string | null;
        out_from: string | null;
        out_until: string | null;
        request_source: PtoRequestSource | null;
        request_source_detail: string | null;
        cap_override: boolean;
        cap_override_reason: string | null;
      }>;
    }) => {
      const { error } = await supabase
        .from('pto_requests')
        .update(input.patch)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_REQUESTS });
      qc.invalidateQueries({ queryKey: KEY_SUMMARY });
    },
  });
}

/** Manager hard-delete: removes the row entirely. Use for true mistakes /
 *  duplicates only — for "engineer changed their mind", use cancel instead so
 *  the audit trail stays intact. */
export function useDeletePto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('pto_requests').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_REQUESTS });
      qc.invalidateQueries({ queryKey: KEY_SUMMARY });
    },
  });
}

export function useCancelPto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('pto_requests').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_REQUESTS });
      qc.invalidateQueries({ queryKey: KEY_SUMMARY });
    },
  });
}

export function useUpdatePtoBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      year: number;
      vacation_alloted?: number;
      sick_alloted?: number;
      holiday_alloted?: number;
      notes?: string | null;
    }) => {
      const { user_id, year, ...patch } = input;
      const { error } = await supabase
        .from('pto_balances')
        .upsert({ user_id, year, ...patch }, { onConflict: 'user_id,year' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_SUMMARY }),
  });
}

// ── Buckets the panel renders
export function usePtoBuckets() {
  const q = usePtoRequests();
  return useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA');
    const requests = q.data ?? [];
    const pending  = requests.filter((r) => r.status === 'pending');
    const upcoming = requests.filter((r) => r.status === 'approved' && r.ends_on >= today);
    const outToday = requests.filter((r) => r.status === 'approved' && r.starts_on <= today && r.ends_on >= today);
    return { all: requests, pending, upcoming, outToday, isLoading: q.isLoading, error: q.error };
  }, [q.data, q.isLoading, q.error]);
}
