import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OncallRotation = {
  id: string;
  week_start: string;            // a Friday in YYYY-MM-DD
  primary_user_id: string | null;
  secondary_user_id: string | null;
  notes: string | null;
};

const KEY_CURRENT = ['oncall_current'];
const KEY_UPCOMING = ['oncall_upcoming'];
const KEY_PARTICIPANTS = ['oncall_participants'];
const KEY_SETTINGS = ['oncall_settings'];

/** On-call handover happens at 7am local on Friday. To pick the right
 *  rotation row, shift "now" back by 7 hours: that maps Friday 06:59 onto
 *  the previous calendar day (so the prior week's row still wins) and
 *  Friday 07:00 onto Friday itself (new week begins). Returns YYYY-MM-DD
 *  in LOCAL time. */
function effectiveOncallDate(now: Date): string {
  const ONCALL_CUTOVER_HOURS = 7;
  const shifted = new Date(now.getTime() - ONCALL_CUTOVER_HOURS * 60 * 60 * 1000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Current rotation (Friday 7am → next Friday 7am local) joined with engineer
 *  name. Queries oncall_rotations directly (not the current_oncall view) so
 *  the 7am cutover logic lives in one place: effectiveOncallDate(). */
export function useCurrentOncall() {
  return useQuery({
    queryKey: KEY_CURRENT,
    queryFn: async () => {
      const effective = effectiveOncallDate(new Date());
      const { data, error } = await supabase
        .from('oncall_rotations')
        .select('id, week_start, primary_user_id, secondary_user_id, notes')
        .lte('week_start', effective)
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // Only treat the anchor as current if effective date < week_start + 7d
      // (i.e. no gap in the schedule).
      const ws = new Date(data.week_start + 'T00:00:00');
      const we = new Date(ws); we.setDate(ws.getDate() + 7);
      const effD = new Date(effective + 'T00:00:00');
      if (effD >= we) return null;

      const ids = [data.primary_user_id, data.secondary_user_id].filter(Boolean) as string[];
      if (ids.length === 0) return { rotation: data as OncallRotation, primary: null, secondary: null };

      const { data: users, error: ue } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', ids);
      if (ue) throw ue;

      const byId = new Map<string, string>();
      (users ?? []).forEach((u) => byId.set((u as { id: string }).id, (u as { full_name: string }).full_name));

      return {
        rotation: data as OncallRotation,
        primary: data.primary_user_id ? byId.get(data.primary_user_id) ?? null : null,
        secondary: data.secondary_user_id ? byId.get(data.secondary_user_id) ?? null : null,
      };
    },
    staleTime: 5 * 60_000,
  });
}

/** Current rotation + the next N weeks. Returns rotations ordered by week_start
 *  ascending, starting from the current week (week_start <= today < +7d). */
export type UpcomingOncallEntry = {
  week_start: string;
  primary: string | null;
  secondary: string | null;
  is_current: boolean;
};
export function useUpcomingOncall(count: number) {
  return useQuery({
    queryKey: [...KEY_UPCOMING, count],
    queryFn: async (): Promise<UpcomingOncallEntry[]> => {
      // Anchor: the latest rotation whose Fri-to-Fri window contains today,
      // honoring a 7am-Friday handover (see effectiveOncallDate). If no such
      // row exists (gap), is_current stays false on every result.
      const effective = effectiveOncallDate(new Date());
      const { data: anchor, error: ae } = await supabase
        .from('oncall_rotations')
        .select('week_start')
        .lte('week_start', effective)
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ae) throw ae;

      // Only treat the anchor as "current" if effective date < anchor + 7d.
      const currentWeek = (() => {
        if (!anchor?.week_start) return null;
        const ws = new Date(anchor.week_start + 'T00:00:00');
        const we = new Date(ws); we.setDate(ws.getDate() + 7);
        const effD = new Date(effective + 'T00:00:00');
        return effD < we ? anchor.week_start : null;
      })();

      // Start the fetch window at the current week if one exists, otherwise
      // at the effective date (so we surface the next upcoming rotation as
      // "next", not mislabel it as current).
      const fetchFrom = currentWeek ?? effective;
      const { data: rows, error } = await supabase
        .from('oncall_rotations')
        .select('week_start, primary_user_id, secondary_user_id')
        .gte('week_start', fetchFrom)
        .order('week_start', { ascending: true })
        .limit(count);
      if (error) throw error;

      const ids = new Set<string>();
      (rows ?? []).forEach((r) => {
        if (r.primary_user_id)   ids.add(r.primary_user_id);
        if (r.secondary_user_id) ids.add(r.secondary_user_id);
      });
      let nameById = new Map<string, string>();
      if (ids.size > 0) {
        const { data: users, error: ue } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', Array.from(ids));
        if (ue) throw ue;
        nameById = new Map((users ?? []).map((u) => [
          (u as { id: string }).id,
          (u as { full_name: string }).full_name,
        ]));
      }
      return (rows ?? []).map((r) => ({
        week_start: r.week_start,
        primary:   r.primary_user_id   ? nameById.get(r.primary_user_id)   ?? null : null,
        secondary: r.secondary_user_id ? nameById.get(r.secondary_user_id) ?? null : null,
        is_current: r.week_start === currentWeek,
      }));
    },
    staleTime: 5 * 60_000,
  });
}

/** Realtime: any change to oncall_rotations / oncall_participants /
 *  oncall_schedule_settings invalidates the relevant query keys. */
export function useOncallRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: KEY_CURRENT });
      qc.invalidateQueries({ queryKey: KEY_UPCOMING });
      qc.invalidateQueries({ queryKey: KEY_PARTICIPANTS });
      qc.invalidateQueries({ queryKey: KEY_SETTINGS });
    };
    const channel = supabase
      .channel('oncall-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oncall_rotations' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oncall_participants' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oncall_schedule_settings' }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

// ---------- date parsing helpers ----------

/** Parse "MM/DD" (current year assumed) or "MM/DD/YY" or "MM/DD/YYYY" → YYYY-MM-DD. */
export function parseMdy(input: string, fallbackYear?: number): string | null {
  const cleaned = input.trim();
  if (!cleaned) return null;
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : (fallbackYear ?? new Date().getFullYear());
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Sanity-check by round-tripping through Date.
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return iso;
}

/** "2026-04-10" → "04/10" */
export function fmtMd(iso: string): string {
  const [, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

/** "2026-04-10" + 7 days → "2026-04-17" */
export function plus7Days(iso: string): string {
  return addDaysIso(iso, 7);
}

/** Add `days` to an ISO YYYY-MM-DD date string, returning a new ISO string. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// v1.1 rotation-builder model — new tables drive the schedule
// ============================================================================

export type OncallSettings = {
  id: 'default';
  start_friday: string | null;
  rotations_per_engineer: number;
  updated_at: string;
};

export type OncallParticipant = {
  id: string;
  user_id: string;
  sort_order: number;
  effective_from: string | null;     // YYYY-MM-DD, null = always
  full_name: string;
  cmms_assignee_name: string | null;
};

/** Fetch the single settings row (id='default'). Always exists after migration. */
export function useOncallSettings() {
  return useQuery({
    queryKey: KEY_SETTINGS,
    queryFn: async (): Promise<OncallSettings | null> => {
      const { data, error } = await supabase
        .from('oncall_schedule_settings')
        .select('id, start_friday, rotations_per_engineer, updated_at')
        .eq('id', 'default')
        .maybeSingle();
      if (error) throw error;
      return (data as OncallSettings | null) ?? null;
    },
    staleTime: 60_000,
  });
}

/** Fetch the ordered participants list with engineer name + cmms name joined in. */
export function useOncallParticipants() {
  return useQuery({
    queryKey: KEY_PARTICIPANTS,
    queryFn: async (): Promise<OncallParticipant[]> => {
      const { data, error } = await supabase
        .from('oncall_participants')
        .select(`
          id, user_id, sort_order, effective_from,
          users!inner(full_name, engineer_profiles!inner(cmms_assignee_name))
        `)
        .order('sort_order', { ascending: true });
      if (error) throw error;

      type Joined = {
        id: string; user_id: string; sort_order: number; effective_from: string | null;
        users:
          | { full_name: string; engineer_profiles: { cmms_assignee_name: string | null } | { cmms_assignee_name: string | null }[] | null }
          | { full_name: string; engineer_profiles: { cmms_assignee_name: string | null } | { cmms_assignee_name: string | null }[] | null }[]
          | null;
      };
      return (data as unknown as Joined[])
        .map((r) => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          if (!u) return null;
          const epRaw = u.engineer_profiles;
          const ep = Array.isArray(epRaw) ? epRaw[0] : epRaw;
          return {
            id: r.id,
            user_id: r.user_id,
            sort_order: r.sort_order,
            effective_from: r.effective_from,
            full_name: u.full_name,
            cmms_assignee_name: ep?.cmms_assignee_name ?? null,
          } satisfies OncallParticipant;
        })
        .filter((x): x is OncallParticipant => x !== null);
    },
    staleTime: 60_000,
  });
}

/**
 * Bulk save: replaces oncall_participants, updates settings, and regenerates
 * the oncall_rotations rows for week_start >= start_friday based on a round-
 * robin over participants (sort_order) for `rotations_per_engineer` cycles.
 * Slots whose week_start falls before a participant's effective_from are
 * filtered out (the participant's row in the UI shows "—" for those cells).
 */
export function useSaveOncallSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      start_friday: string;
      rotations_per_engineer: number;
      participants: { user_id: string; effective_from: string | null }[];
    }) => {
      const { start_friday, rotations_per_engineer, participants } = input;

      // 1) Update settings row
      const { error: se } = await supabase
        .from('oncall_schedule_settings')
        .update({
          start_friday,
          rotations_per_engineer,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'default');
      if (se) throw se;

      // 2) Replace oncall_participants: delete all, re-insert in new order.
      //    Small N (≤ team size), so full-replace is fine.
      const { error: de } = await supabase
        .from('oncall_participants')
        .delete()
        .not('id', 'is', null); // matches every row
      if (de) throw de;

      if (participants.length > 0) {
        const toInsert = participants.map((p, idx) => ({
          user_id: p.user_id,
          sort_order: idx + 1,
          effective_from: p.effective_from,
        }));
        const { error: ie } = await supabase.from('oncall_participants').insert(toInsert);
        if (ie) throw ie;
      }

      // 3) Compute the schedule rows in JS.
      const rotationsToInsert: { week_start: string; primary_user_id: string }[] = [];
      const N = participants.length;
      const R = rotations_per_engineer;
      for (let cycle = 0; cycle < R; cycle++) {
        for (let i = 0; i < N; i++) {
          const weekStart = addDaysIso(start_friday, (cycle * N + i) * 7);
          const p = participants[i];
          if (p.effective_from && p.effective_from > weekStart) continue; // pre-effective skip
          rotationsToInsert.push({ week_start: weekStart, primary_user_id: p.user_id });
        }
      }

      // 4) Delete existing rotations from start_friday onwards. Past rows stay.
      const { error: drot } = await supabase
        .from('oncall_rotations')
        .delete()
        .gte('week_start', start_friday);
      if (drot) throw drot;

      // 5) Insert the freshly computed rows.
      if (rotationsToInsert.length > 0) {
        const { error: irot } = await supabase
          .from('oncall_rotations')
          .insert(rotationsToInsert);
        if (irot) throw irot;
      }

      return { rotationsWritten: rotationsToInsert.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_CURRENT });
      qc.invalidateQueries({ queryKey: KEY_PARTICIPANTS });
      qc.invalidateQueries({ queryKey: KEY_SETTINGS });
    },
  });
}

// ============================================================================
// Oncall sticky notes (3 fixed slots, header scratch area)
// ============================================================================

export type OncallNote = {
  slot: 1 | 2 | 3;
  body: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
};

const KEY_NOTES = ['oncall_notes'];

export function useOncallNotes() {
  return useQuery({
    queryKey: KEY_NOTES,
    queryFn: async (): Promise<OncallNote[]> => {
      const { data, error } = await supabase
        .from('oncall_notes')
        .select(`slot, body, updated_at, updated_by_user_id,
                 users:updated_by_user_id(full_name)`)
        .order('slot', { ascending: true });
      if (error) throw error;
      type Joined = {
        slot: 1 | 2 | 3; body: string; updated_at: string;
        updated_by_user_id: string | null;
        users: { full_name: string } | { full_name: string }[] | null;
      };
      return (data as unknown as Joined[]).map((r) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return {
          slot: r.slot, body: r.body, updated_at: r.updated_at,
          updated_by_user_id: r.updated_by_user_id,
          updated_by_name: u?.full_name ?? null,
        };
      });
    },
    staleTime: 60_000,
  });
}

export function useUpdateOncallNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slot: 1 | 2 | 3; body: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Not signed in');
      const { data: me } = await supabase
        .from('users').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
      const { error } = await supabase
        .from('oncall_notes')
        .update({
          body: input.body,
          updated_at: new Date().toISOString(),
          updated_by_user_id: (me as { id: string } | null)?.id ?? null,
        })
        .eq('slot', input.slot);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY_NOTES }),
  });
}

export function useOncallNotesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('oncall-notes-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oncall_notes' },
        () => qc.invalidateQueries({ queryKey: KEY_NOTES }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

/** Parse "MM/DD - MM/DD" → start iso (Friday). Accepts just "MM/DD" too. */
export function parseRotationCell(input: string): string | null {
  const m = input.trim().match(/^(.+?)(?:\s*-\s*.+)?$/);
  if (!m) return null;
  return parseMdy(m[1]);
}
