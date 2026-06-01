// §11 — Overtime coverage hooks (Phase 11).
//
// Backed by:
//   overtime_posts                 — one row per coverage opportunity
//   overtime_signups               — one row per engineer signed up
//   v_overtime_posts_with_signups  — read view; signups + slots_filled inlined
//
// Signup flow: engineers self-serve (signUp / unSignUp use auth.uid mapping).
// Admin/manager/lead can override via adminAssign / adminUnassign — backend
// RLS allows both paths.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OvertimeCategory =
  | 'cold_weather'
  | 'major_off_hour_pm'
  | 'off_hour_repair'
  | 'vendor_escort';

export const OVERTIME_CATEGORY_LABELS: Record<OvertimeCategory, string> = {
  cold_weather:      'Cold weather',
  major_off_hour_pm: 'Major off-hour PM',
  off_hour_repair:   'Off-hour repair',
  vendor_escort:     'Vendor escort',
};

export const OVERTIME_CATEGORY_ORDER: OvertimeCategory[] = [
  'cold_weather',
  'major_off_hour_pm',
  'off_hour_repair',
  'vendor_escort',
];

export type OvertimeStatus = 'open' | 'closed' | 'cancelled' | 'completed';

export type OvertimeSignup = {
  id: string;
  user_id: string;
  user_name: string | null;
  signed_up_at: string;
  signed_up_by: string | null;
  self_signup: boolean;
};

export type OvertimePost = {
  id: string;
  category: OvertimeCategory;
  starts_at: string;
  ends_at: string | null;
  building_id: string | null;
  building_label: string | null;
  building_code: string | null;
  building_short_code: string | null;
  building_name: string | null;
  scope: string;
  slots_needed: number;
  status: OvertimeStatus;
  cancelled_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  signups: OvertimeSignup[];
  slots_filled: number;
};

const POSTS_KEY = ['overtime_posts'];

/** Fetches the last 90 days plus all future overtime posts so the panel can
 *  render three tiers off one query:
 *    • Active board     — open/closed posts within their time window
 *    • Recently cancelled — cancelled_at within the last 3 days (undo zone)
 *    • Archive           — everything older, for audit/analysis
 *  Partitioning happens client-side in OvertimePanel.tsx. */
export function useOvertimePosts() {
  return useQuery({
    queryKey: POSTS_KEY,
    queryFn: async (): Promise<OvertimePost[]> => {
      const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('v_overtime_posts_with_signups')
        .select('*')
        .gte('starts_at', cutoff)
        .order('starts_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as OvertimePost[];
    },
    staleTime: 30_000,
  });
}

/** Realtime: any change to posts or signups invalidates the posts query. */
export function useOvertimeRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`overtime-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_posts' }, () => {
        qc.invalidateQueries({ queryKey: POSTS_KEY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_signups' }, () => {
        qc.invalidateQueries({ queryKey: POSTS_KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

export type CreateOvertimePostInput = {
  category: OvertimeCategory;
  starts_at: string;        // ISO timestamp (UTC)
  ends_at?: string | null;
  building_id?: string | null;
  building_label?: string | null;
  scope: string;
  slots_needed: number;
  notes?: string | null;
};

export function useCreateOvertimePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOvertimePostInput) => {
      const { data: meRow } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', (await supabase.auth.getUser()).data.user?.id)
        .maybeSingle();
      const payload = {
        category:       input.category,
        starts_at:      input.starts_at,
        ends_at:        input.ends_at ?? null,
        building_id:    input.building_id ?? null,
        building_label: input.building_label ?? null,
        scope:          input.scope.trim(),
        slots_needed:   input.slots_needed,
        notes:          input.notes ?? null,
        created_by:     meRow?.id ?? null,
      };
      const { data, error } = await supabase
        .from('overtime_posts')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

export function useUpdateOvertimePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<CreateOvertimePostInput> & { status?: OvertimeStatus }) => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from('overtime_posts')
        .update(rest)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

export function useCancelOvertimePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('overtime_posts')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

/** Flip a cancelled post back to 'open'. The DB trigger
 *  overtime_posts_stamp_cancelled_at_trg automatically clears cancelled_at
 *  on the transition so the post drops out of the "Recently cancelled"
 *  drawer the moment it's restored. */
export function useRestoreOvertimePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('overtime_posts')
        .update({ status: 'open' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

export function useDeleteOvertimePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('overtime_posts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

/** Bulk-archive: flip every status='open' post whose ends_at (or starts_at
 *  if no ends_at) is in the past to status='completed'. Use when stale
 *  unclosed posts are cluttering the manager / TV view. Returns the number
 *  of rows updated so the UI can show "Archived N posts". */
export function useArchivePastOvertimePosts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const nowIso = new Date().toISOString();
      // PostgREST can't express "coalesce(ends_at, starts_at) < now" in a
      // single .or() clause cleanly, so we do two passes:
      //   1. ends_at is not null AND ends_at < now
      //   2. ends_at is null     AND starts_at < now
      // The DB applies them atomically per-row; total is the sum.
      const r1 = await supabase
        .from('overtime_posts')
        .update({ status: 'completed' })
        .eq('status', 'open')
        .not('ends_at', 'is', null)
        .lt('ends_at', nowIso)
        .select('id');
      if (r1.error) throw r1.error;

      const r2 = await supabase
        .from('overtime_posts')
        .update({ status: 'completed' })
        .eq('status', 'open')
        .is('ends_at', null)
        .lt('starts_at', nowIso)
        .select('id');
      if (r2.error) throw r2.error;

      return (r1.data?.length ?? 0) + (r2.data?.length ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

/** Sign up the currently authenticated engineer for a post. */
export function useSignUpForOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (post_id: string) => {
      const auth = await supabase.auth.getUser();
      if (!auth.data.user) throw new Error('Not signed in');
      const { data: meRow, error: meErr } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', auth.data.user.id)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!meRow) throw new Error('No user row linked to this auth account');
      const { error } = await supabase.from('overtime_signups').insert({
        post_id,
        user_id: meRow.id,
        signed_up_by: meRow.id,  // self-signup marker
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

/** Remove the currently authenticated engineer from a post. */
export function useUnSignUpForOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (post_id: string) => {
      const auth = await supabase.auth.getUser();
      if (!auth.data.user) throw new Error('Not signed in');
      const { data: meRow } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', auth.data.user.id)
        .maybeSingle();
      if (!meRow) throw new Error('No user row');
      const { error } = await supabase
        .from('overtime_signups')
        .delete()
        .eq('post_id', post_id)
        .eq('user_id', meRow.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

/** Admin/manager override: assign any engineer to a post. */
export function useAdminAssignToOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { post_id: string; user_id: string }) => {
      const auth = await supabase.auth.getUser();
      const { data: meRow } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', auth.data.user?.id ?? '')
        .maybeSingle();
      const { error } = await supabase.from('overtime_signups').insert({
        post_id: input.post_id,
        user_id: input.user_id,
        signed_up_by: meRow?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}

/** Admin/manager override: remove a specific signup row by id. */
export function useAdminRemoveSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (signup_id: string) => {
      const { error } = await supabase.from('overtime_signups').delete().eq('id', signup_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTS_KEY }),
  });
}
