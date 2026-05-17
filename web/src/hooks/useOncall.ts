import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OncallRotation = {
  id: string;
  week_start: string;            // a Friday in YYYY-MM-DD
  primary_user_id: string | null;
  secondary_user_id: string | null;
  notes: string | null;
};

export type OncallEngineer = {
  user_id: string;
  full_name: string;
  cmms_assignee_name: string | null;
};

const KEY_ALL = ['oncall_all'];
const KEY_CURRENT = ['oncall_current'];

/** Fetch every rotation row + the active engineers, for the Admin table. */
export function useOncallData() {
  return useQuery({
    queryKey: KEY_ALL,
    queryFn: async () => {
      const [rRes, eRes] = await Promise.all([
        supabase
          .from('oncall_rotations')
          .select('*')
          .order('week_start', { ascending: true }),
        supabase
          .from('users')
          .select('id, full_name, engineer_profiles!inner(cmms_assignee_name)')
          .eq('role', 'engineer')
          .eq('active', true)
          .order('full_name'),
      ]);
      if (rRes.error) throw rRes.error;
      if (eRes.error) throw eRes.error;

      type EngJoin = {
        id: string;
        full_name: string;
        engineer_profiles:
          | { cmms_assignee_name: string | null }
          | { cmms_assignee_name: string | null }[]
          | null;
      };
      const engineers: OncallEngineer[] = (eRes.data as unknown as EngJoin[]).map((u) => {
        const epRaw = u.engineer_profiles;
        const ep = Array.isArray(epRaw) ? epRaw[0] : epRaw;
        return {
          user_id: u.id,
          full_name: u.full_name,
          cmms_assignee_name: ep?.cmms_assignee_name ?? null,
        };
      });

      return {
        rotations: (rRes.data ?? []) as OncallRotation[],
        engineers,
      };
    },
    staleTime: 60_000,
  });
}

/** Current week's rotation (Friday → next Friday) joined with engineer name. */
export function useCurrentOncall() {
  return useQuery({
    queryKey: KEY_CURRENT,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('current_oncall')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // Resolve primary + secondary names in one extra round-trip.
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

/** Per-engineer view used by the Admin table: each engineer + their N rotations in order. */
export function useEngineerRotationGrid() {
  const q = useOncallData();
  const data = useMemo(() => {
    if (!q.data) return null;
    const rotationsByUser = new Map<string, OncallRotation[]>();
    for (const r of q.data.rotations) {
      if (!r.primary_user_id) continue;
      const arr = rotationsByUser.get(r.primary_user_id) ?? [];
      arr.push(r);
      rotationsByUser.set(r.primary_user_id, arr);
    }
    for (const arr of rotationsByUser.values()) {
      arr.sort((a, b) => a.week_start.localeCompare(b.week_start));
    }
    const maxCols = Math.max(0, ...Array.from(rotationsByUser.values()).map((a) => a.length));
    return { engineers: q.data.engineers, rotationsByUser, maxCols };
  }, [q.data]);
  return { ...q, data };
}

/** Add or update a rotation cell. Looks up by (week_start) since it's unique. */
export function useSetRotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { week_start: string; primary_user_id: string | null }) => {
      // upsert by week_start
      const { error, data } = await supabase
        .from('oncall_rotations')
        .upsert({ week_start: input.week_start, primary_user_id: input.primary_user_id }, { onConflict: 'week_start' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_ALL });
      qc.invalidateQueries({ queryKey: KEY_CURRENT });
    },
  });
}

/** Delete a rotation by id. */
export function useDeleteRotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('oncall_rotations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_ALL });
      qc.invalidateQueries({ queryKey: KEY_CURRENT });
    },
  });
}

/** Realtime: any change to oncall_rotations invalidates both query keys. */
export function useOncallRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('oncall-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oncall_rotations' }, () => {
        qc.invalidateQueries({ queryKey: KEY_ALL });
        qc.invalidateQueries({ queryKey: KEY_CURRENT });
      })
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
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Parse "MM/DD - MM/DD" → start iso (Friday). Accepts just "MM/DD" too. */
export function parseRotationCell(input: string): string | null {
  const m = input.trim().match(/^(.+?)(?:\s*-\s*.+)?$/);
  if (!m) return null;
  return parseMdy(m[1]);
}
