// New-hire 8-week program — data hooks (migration 0128).
//
// The program DEFINITION is code (lib/newHireProgram.ts); these hooks move
// PROGRESS: enrollments, check-offs (presence = verified), and rep logs
// (one row per completed rep / eval). The three tables are tiny (a handful
// of enrolled people × ~40 keys), so we load them whole in one query set
// and group client-side — no per-user fetch, and the roster can show a
// progress pill for everyone without N+1.
//
// Writes are RLS-gated (current_user_can_edit_new_hire: admin anywhere,
// own-site manager/lead, or the assigned mentor). A filtered-out write
// shows up as 0 rows → we throw so the UI never reports success on a no-op.
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useMe } from './useMe';
import { NH_PROGRAM_KEY, nhProgress, type NhProgress } from '../lib/newHireProgram';

export type NhStatus = 'active' | 'completed' | 'paused' | 'withdrawn';

export type NhEnrollment = {
  user_id: string;
  program_key: string;
  start_date: string | null;
  mentor_user_id: string | null;
  status: NhStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NhCheckoff = {
  user_id: string;
  item_key: string;
  done_at: string;
  verified_by: string | null;
  note: string | null;
};

export type NhRepLog = {
  id: string;
  user_id: string;
  rep_key: string;
  occurred_on: string;
  note: string | null;
  logged_by: string | null;
  created_at: string;
};

export type NhAll = {
  enrollments: Map<string, NhEnrollment>;      // user_id → enrollment
  checkoffs: Map<string, Map<string, NhCheckoff>>; // user_id → item_key → row
  repLogs: Map<string, NhRepLog[]>;            // user_id → logs (newest first)
};

const KEY = ['new_hire', 'all'];

export function useNewHireAll(enabled = true) {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async (): Promise<NhAll> => {
      const [e, c, r] = await Promise.all([
        supabase.from('new_hire_enrollments').select('*'),
        supabase.from('new_hire_checkoffs').select('*'),
        supabase.from('new_hire_rep_logs').select('*').order('occurred_on', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      if (e.error) throw e.error;
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      const enrollments = new Map<string, NhEnrollment>();
      for (const row of (e.data ?? []) as NhEnrollment[]) enrollments.set(row.user_id, row);
      const checkoffs = new Map<string, Map<string, NhCheckoff>>();
      for (const row of (c.data ?? []) as NhCheckoff[]) {
        let m = checkoffs.get(row.user_id);
        if (!m) { m = new Map(); checkoffs.set(row.user_id, m); }
        m.set(row.item_key, row);
      }
      const repLogs = new Map<string, NhRepLog[]>();
      for (const row of (r.data ?? []) as NhRepLog[]) {
        const arr = repLogs.get(row.user_id) ?? [];
        arr.push(row);
        repLogs.set(row.user_id, arr);
      }
      return { enrollments, checkoffs, repLogs };
    },
    staleTime: 30_000,
  });
}

/** Per-user view of the program state, derived from useNewHireAll. */
export type NhUserState = {
  enrollment: NhEnrollment | null;
  checked: Set<string>;
  checkoffs: Map<string, NhCheckoff>;
  repLogs: NhRepLog[];
  repCounts: Map<string, number>;
  progress: NhProgress;
};

export function nhUserState(all: NhAll | undefined, userId: string): NhUserState {
  const enrollment = all?.enrollments.get(userId) ?? null;
  const checkoffs = all?.checkoffs.get(userId) ?? new Map<string, NhCheckoff>();
  const checked = new Set(checkoffs.keys());
  const repLogs = all?.repLogs.get(userId) ?? [];
  const repCounts = new Map<string, number>();
  for (const l of repLogs) repCounts.set(l.rep_key, (repCounts.get(l.rep_key) ?? 0) + 1);
  return { enrollment, checked, checkoffs, repLogs, repCounts, progress: nhProgress(checked, repCounts) };
}

export function useNewHireUser(userId: string) {
  const q = useNewHireAll();
  const state = useMemo(() => nhUserState(q.data, userId), [q.data, userId]);
  return { ...q, state };
}

/** Can the signed-in person edit THIS user's program? Mirrors the DB helper
 *  (admin / manager / lead / mentor) for showing vs hiding controls — the DB
 *  is still the gate; this just avoids offering buttons that would 0-row. */
export function useCanEditNewHire(mentorUserId: string | null | undefined): boolean {
  const me = useMe().data;
  if (!me || !me.active) return false;
  if (me.role === 'admin' || me.role === 'manager' || me.role === 'director') return true;
  if (me.is_manager || me.is_lead) return true;
  return !!mentorUserId && mentorUserId === me.id;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useEnrollNewHire() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { user_id: string; start_date: string | null; mentor_user_id: string | null; notes?: string | null }) => {
      const { data, error } = await supabase
        .from('new_hire_enrollments')
        .upsert({
          user_id: input.user_id,
          program_key: NH_PROGRAM_KEY,
          start_date: input.start_date,
          mentor_user_id: input.mentor_user_id,
          notes: input.notes ?? null,
          status: 'active',
          created_by: me?.id ?? null,
        }, { onConflict: 'user_id' })
        .select('user_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to enroll this user (outside your site or role scope).');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useUpdateEnrollment() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (input: { user_id: string; patch: Partial<Pick<NhEnrollment, 'start_date' | 'mentor_user_id' | 'status' | 'notes'>> }) => {
      const { data, error } = await supabase
        .from('new_hire_enrollments')
        .update(input.patch)
        .eq('user_id', input.user_id)
        .select('user_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to edit this enrollment.');
      return data[0];
    },
    onSuccess: inv,
  });
}

/** Remove the enrollment AND all its progress (cascade). Two-step in the UI. */
export function useUnenrollNewHire() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (user_id: string) => {
      const { data, error } = await supabase
        .from('new_hire_enrollments')
        .delete()
        .eq('user_id', user_id)
        .select('user_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to remove this enrollment.');
      return data[0];
    },
    onSuccess: inv,
  });
}

/** Toggle a check-off. on=true inserts (verified_by = me), on=false deletes. */
export function useSetCheckoff() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { user_id: string; item_key: string; on: boolean; note?: string | null }) => {
      if (input.on) {
        const { data, error } = await supabase
          .from('new_hire_checkoffs')
          .upsert({
            user_id: input.user_id,
            item_key: input.item_key,
            verified_by: me?.id ?? null,
            note: input.note ?? null,
            done_at: new Date().toISOString(),
          }, { onConflict: 'user_id,item_key' })
          .select('item_key');
        if (error) throw error;
        if (!data?.length) throw new Error('Not permitted to check this off.');
        return data[0];
      }
      const { data, error } = await supabase
        .from('new_hire_checkoffs')
        .delete()
        .eq('user_id', input.user_id)
        .eq('item_key', input.item_key)
        .select('item_key');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to un-check this.');
      return data[0];
    },
    onSuccess: inv,
  });
}

/** Update just the note on an existing check-off. */
export function useSetCheckoffNote() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (input: { user_id: string; item_key: string; note: string | null }) => {
      const { data, error } = await supabase
        .from('new_hire_checkoffs')
        .update({ note: input.note })
        .eq('user_id', input.user_id)
        .eq('item_key', input.item_key)
        .select('item_key');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to edit this note.');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useAddRepLog() {
  const inv = useInvalidate();
  const me = useMe().data;
  return useMutation({
    mutationFn: async (input: { user_id: string; rep_key: string; occurred_on: string; note?: string | null }) => {
      const { data, error } = await supabase
        .from('new_hire_rep_logs')
        .insert({
          user_id: input.user_id,
          rep_key: input.rep_key,
          occurred_on: input.occurred_on,
          note: input.note ?? null,
          logged_by: me?.id ?? null,
        })
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to log this rep.');
      return data[0];
    },
    onSuccess: inv,
  });
}

export function useDeleteRepLog() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('new_hire_rep_logs')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Not permitted to remove this rep.');
      return data[0];
    },
    onSuccess: inv,
  });
}
