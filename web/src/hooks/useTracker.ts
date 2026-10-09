// Tracker data — migration 0139 (tracker_entries, tracker_traits,
// tracker_skills). Read by the admin Tracker tab and the engineer's own
// /engineer/tracker page; written by leads/managers (anything) or the
// person (own unverified entries, own skill rows / SOP text).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TrackKind, Spirit, SkillStatus } from '../lib/tracker';

export type TrackerEntry = {
  id: string;
  user_id: string;
  occurred_on: string;
  kind: TrackKind;
  title: string;
  spirit: Spirit | null;
  note: string | null;
  status: 'self' | 'verified';
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackerTrait = {
  user_id: string;
  trait: string;
  score: number | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type TrackerSkill = {
  user_id: string;
  skill: string;
  status: SkillStatus;
  done_on: string | null;
  sop_text: string | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
};

const K_ENTRIES = (u: string | undefined) => ['tracker_entries', u];
const K_TRAITS  = (u: string | undefined) => ['tracker_traits', u];
const K_SKILLS  = (u: string | undefined) => ['tracker_skills', u];

async function myUsersId(): Promise<string> {
  const auth = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('users').select('id').eq('auth_user_id', auth.data.user?.id ?? '').maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('Your account is not linked to a user row.');
  return data.id as string;
}

type EntryRow = Omit<TrackerEntry, 'verified_by_name'> & { verifier: { full_name: string } | { full_name: string }[] | null };
function one<T>(v: T | T[] | null): T | null { return Array.isArray(v) ? (v[0] ?? null) : v; }

export function useTrackerEntries(userId: string | undefined) {
  return useQuery({
    queryKey: K_ENTRIES(userId),
    enabled: !!userId,
    queryFn: async (): Promise<TrackerEntry[]> => {
      const { data, error } = await supabase
        .from('tracker_entries')
        .select('*, verifier:users!tracker_entries_verified_by_fkey(full_name)')
        .eq('user_id', userId!)
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as EntryRow[]).map((r) => {
        const { verifier, ...rest } = r;
        return { ...rest, verified_by_name: one(verifier)?.full_name ?? null };
      });
    },
    staleTime: 15_000,
  });
}

export type UpsertEntryInput = {
  id?: string;
  user_id: string;
  occurred_on: string;
  kind: TrackKind;
  title: string;
  spirit: Spirit | null;
  note: string | null;
  /** Lead/manager writing for someone: stamp verified right away. */
  verifyNow?: boolean;
};

export function useUpsertTrackerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertEntryInput) => {
      const me = await myUsersId();
      const stamp = input.verifyNow
        ? { status: 'verified', verified_by: me, verified_at: new Date().toISOString() }
        : {};
      const body = {
        user_id: input.user_id,
        occurred_on: input.occurred_on,
        kind: input.kind,
        title: input.title.trim(),
        spirit: input.spirit,
        note: input.note?.trim() || null,
        ...stamp,
      };
      if (input.id) {
        const { error } = await supabase.from('tracker_entries').update(body).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('tracker_entries').insert({ ...body, created_by: me });
        if (error) throw error;
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tracker_entries'] }); },
  });
}

export function useSetEntrySpirit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: { id: string; user_id: string; spirit: Spirit | null }) => {
      const { error } = await supabase.from('tracker_entries').update({ spirit: e.spirit }).eq('id', e.id);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tracker_entries'] }); },
  });
}

export function useVerifyTrackerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: { id: string; user_id: string; verified: boolean }) => {
      const me = await myUsersId();
      const patch = e.verified
        ? { status: 'verified', verified_by: me, verified_at: new Date().toISOString() }
        : { status: 'self', verified_by: null, verified_at: null };
      const { error } = await supabase.from('tracker_entries').update(patch).eq('id', e.id);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tracker_entries'] }); },
  });
}

export function useDeleteTrackerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: { id: string; user_id: string }) => {
      const { error } = await supabase.from('tracker_entries').delete().eq('id', e.id);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tracker_entries'] }); },
  });
}

export function useTrackerTraits(userId: string | undefined) {
  return useQuery({
    queryKey: K_TRAITS(userId),
    enabled: !!userId,
    queryFn: async (): Promise<Map<string, TrackerTrait>> => {
      const { data, error } = await supabase.from('tracker_traits').select('*').eq('user_id', userId!);
      if (error) throw error;
      return new Map(((data ?? []) as TrackerTrait[]).map((t) => [t.trait, t]));
    },
    staleTime: 15_000,
  });
}

export function useUpsertTrackerTrait() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: { user_id: string; trait: string; score: number | null; note: string | null }) => {
      const me = await myUsersId();
      const { error } = await supabase
        .from('tracker_traits')
        .upsert({ user_id: t.user_id, trait: t.trait, score: t.score, note: t.note?.trim() || null, updated_by: me }, { onConflict: 'user_id,trait' });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tracker_traits'] }); },
  });
}

export function useTrackerSkills(userId: string | undefined) {
  return useQuery({
    queryKey: K_SKILLS(userId),
    enabled: !!userId,
    queryFn: async (): Promise<Map<string, TrackerSkill>> => {
      const { data, error } = await supabase.from('tracker_skills').select('*').eq('user_id', userId!);
      if (error) throw error;
      return new Map(((data ?? []) as TrackerSkill[]).map((s) => [s.skill, s]));
    },
    staleTime: 15_000,
  });
}

export function useUpsertTrackerSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: { user_id: string; skill: string; status: SkillStatus; done_on: string | null; sop_text: string | null; note: string | null }) => {
      const me = await myUsersId();
      const { error } = await supabase
        .from('tracker_skills')
        .upsert({
          user_id: s.user_id, skill: s.skill, status: s.status, done_on: s.done_on,
          sop_text: s.sop_text?.trim() || null, note: s.note?.trim() || null, updated_by: me,
        }, { onConflict: 'user_id,skill' });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tracker_skills'] }); },
  });
}

// ── Roster-wide reads for the admin matrix (every engineer × every item).
// RLS trims the rows to what the viewer may see; one fetch per table.

export type EntryCounts = { total: number; byKind: Record<string, number>; straight: number; help: number };

export function useAllTrackerEntryCounts() {
  return useQuery({
    queryKey: ['tracker_entries', 'all_counts'],
    queryFn: async (): Promise<Map<string, EntryCounts>> => {
      const { data, error } = await supabase.from('tracker_entries').select('user_id, kind, spirit');
      if (error) throw error;
      const m = new Map<string, EntryCounts>();
      for (const r of (data ?? []) as { user_id: string; kind: string; spirit: string | null }[]) {
        const c = m.get(r.user_id) ?? { total: 0, byKind: {}, straight: 0, help: 0 };
        c.total++;
        c.byKind[r.kind] = (c.byKind[r.kind] ?? 0) + 1;
        if (r.spirit === 'straight') c.straight++;
        if (r.spirit === 'help_team') c.help++;
        m.set(r.user_id, c);
      }
      return m;
    },
    staleTime: 15_000,
  });
}

/** user_id → trait → row */
export function useAllTrackerTraits() {
  return useQuery({
    queryKey: ['tracker_traits', 'all'],
    queryFn: async (): Promise<Map<string, Map<string, TrackerTrait>>> => {
      const { data, error } = await supabase.from('tracker_traits').select('*');
      if (error) throw error;
      const m = new Map<string, Map<string, TrackerTrait>>();
      for (const t of (data ?? []) as TrackerTrait[]) {
        if (!m.has(t.user_id)) m.set(t.user_id, new Map());
        m.get(t.user_id)!.set(t.trait, t);
      }
      return m;
    },
    staleTime: 15_000,
  });
}

/** user_id → skill → row */
export function useAllTrackerSkills() {
  return useQuery({
    queryKey: ['tracker_skills', 'all'],
    queryFn: async (): Promise<Map<string, Map<string, TrackerSkill>>> => {
      const { data, error } = await supabase.from('tracker_skills').select('*');
      if (error) throw error;
      const m = new Map<string, Map<string, TrackerSkill>>();
      for (const r of (data ?? []) as TrackerSkill[]) {
        if (!m.has(r.user_id)) m.set(r.user_id, new Map());
        m.get(r.user_id)!.set(r.skill, r);
      }
      return m;
    },
    staleTime: 15_000,
  });
}
