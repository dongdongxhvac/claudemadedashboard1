// Wall-screen layout switch (0138 / 0140 / 0142).
//
// A kiosk account's users.preferences.tv_layout decides which board the
// screen shows: 'tv' (operations, shown as "TV0"), 'tv2' (coverage, "TV2"),
// 'tv3' (coverage in three sections 20/56/24, "TV212" — display names per
// user 2026-10-11) or 'rotate' (cycle the ENABLED boards every
// ROTATE_MINUTES on wall-clock slots). preferences.tv_layouts_off lists the
// boards the account may not show (0142) — rotate skips them and a fixed
// choice that is disabled falls back to the first enabled board. App.tsx's
// TvLayoutGate resolves it; the Admin page's Shop TV card sets both through
// the set_tv_layout / set_tv_layout_enabled RPCs; and the kiosk follows its
// own users row over realtime, so a flip on a phone reaches the wall within
// seconds without touching the Pi. The wall header shows the board's name
// and, when rotating, the countdown to the next flip (TvLayoutBadge).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type TvLayout = 'tv' | 'tv2' | 'tv3';
export type TvLayoutSetting = TvLayout | 'rotate';

/** Default rotate interval; each kiosk may override it with
 *  preferences.tv_rotate_minutes (2..10, migration 0143). */
export const ROTATE_MINUTES = 5;
export const ROTATE_MINUTE_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** preferences.tv_rotate_minutes → a valid interval (default when absent
 *  or out of range). */
export function parseRotateMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n >= 2 && n <= 10 ? n : ROTATE_MINUTES;
}

/** Display names (user 2026-10-11): the keys and URLs are unchanged. */
export const TV_LAYOUT_LABELS: Record<TvLayout, string> = {
  tv:  'TV0',
  tv2: 'TV2',
  tv3: 'TV212',
};

/** The order rotate cycles through (disabled boards are skipped). */
export const TV_ROTATION_ORDER: TvLayout[] = ['tv', 'tv2', 'tv3'];

export const TV_LAYOUT_OPTIONS: { value: TvLayoutSetting; label: string; hint: string }[] = [
  { value: 'tv',     label: `${TV_LAYOUT_LABELS.tv} · Operations`, hint: 'workload, BMS, equipment, projects, PTO, on-call, overtime' },
  { value: 'tv2',    label: `${TV_LAYOUT_LABELS.tv2} · Operations grid`, hint: '3×3: workload · PMs/labor · buildings (rounds + assignments) | heartbeats · winterization · equipment/LOTO | weekly water-treatment + generator tests' },
  { value: 'tv3',    label: `${TV_LAYOUT_LABELS.tv3} · Coverage 20/56/24`, hint: 'same panels in three sections — PTO 20%, every overtime post incl. yesterday 56%, on-call + LOTO 24%' },
  { value: 'rotate', label: 'Rotate', hint: 'cycle the enabled boards on the clock, at the interval chosen beside it' },
];

/** preferences.tv_layouts_off → the boards this account may not show. */
export function parseTvLayoutsOff(raw: unknown): TvLayout[] {
  if (!Array.isArray(raw)) return [];
  return TV_ROTATION_ORDER.filter((l) => raw.includes(l));
}

/** Boards the account may show, in rotation order. Never empty: with
 *  everything disabled the operations board still shows (a wall must
 *  show something). */
export function enabledTvLayouts(off: TvLayout[]): TvLayout[] {
  const on = TV_ROTATION_ORDER.filter((l) => !off.includes(l));
  return on.length > 0 ? on : ['tv'];
}

/** Milliseconds until the next rotate slot boundary. */
export function msToNextRotateFlip(now: Date = new Date(), minutes: number = ROTATE_MINUTES): number {
  const slotMs = minutes * 60_000;
  return slotMs - (now.getTime() % slotMs);
}

export const TV_LAYOUT_PATHS: Record<TvLayout, string> = {
  tv:  '/upark/tv',
  tv2: '/upark/tv2',
  tv3: '/upark/tv3',
};

/** The board a setting means right now. 'rotate' cycles the enabled boards
 *  on fixed wall-clock slots so every screen on 'rotate' shows the same
 *  board at the same time; a fixed choice that is disabled falls back to
 *  the first enabled board; anything unknown is the operations board. */
export function resolveTvLayout(
  setting: unknown,
  now: Date = new Date(),
  off: TvLayout[] = [],
  minutes: number = ROTATE_MINUTES,
): TvLayout {
  const enabled = enabledTvLayouts(off);
  if (setting === 'rotate') {
    const slot = Math.floor(now.getTime() / (minutes * 60_000));
    return enabled[slot % enabled.length];
  }
  const fixed: TvLayout = setting === 'tv2' ? 'tv2' : setting === 'tv3' ? 'tv3' : 'tv';
  return enabled.includes(fixed) ? fixed : enabled[0];
}

/** The board rotate shows after `current` (for the header's "next … in
 *  m:ss"): the next enabled board in rotation order, wrapping. Relative to
 *  the board on screen rather than the clock, so it can never name the
 *  board already showing while two or more are on. */
export function nextRotateLayout(current: TvLayout, off: TvLayout[] = []): TvLayout {
  const enabled = enabledTvLayouts(off);
  const idx = enabled.indexOf(current);
  return enabled[(idx + 1) % enabled.length];
}

export type TvKiosk = {
  id: string;
  full_name: string;
  email: string | null;
  active: boolean;
  layout: TvLayoutSetting;
  /** Boards this account may not show (0142). */
  off: TvLayout[];
  /** Rotate interval in minutes, 2..10 (0143). */
  rotateMinutes: number;
};

const KIOSKS_KEY = ['tv_kiosks'];

/** Every tv-role account and its current layout setting. */
export function useTvKiosks() {
  return useQuery({
    queryKey: KIOSKS_KEY,
    queryFn: async (): Promise<TvKiosk[]> => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, active, preferences')
        .eq('role', 'tv')
        .order('full_name');
      if (error) throw error;
      return (data ?? []).map((r) => {
        const prefs = r.preferences as Record<string, unknown> | null;
        const raw = prefs?.tv_layout;
        const layout: TvLayoutSetting = raw === 'tv2' || raw === 'tv3' || raw === 'rotate' ? raw : 'tv';
        return {
          id: r.id, full_name: r.full_name, email: r.email, active: r.active, layout,
          off: parseTvLayoutsOff(prefs?.tv_layouts_off),
          rotateMinutes: parseRotateMinutes(prefs?.tv_rotate_minutes),
        };
      });
    },
    staleTime: 30_000,
  });
}

export function useSetTvLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; layout: TvLayoutSetting }) => {
      const { error } = await supabase.rpc('set_tv_layout', {
        p_user_id: input.user_id,
        p_layout:  input.layout,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KIOSKS_KEY }),
  });
}

/** Enable / disable one board for a kiosk account (0142). */
export function useSetTvLayoutEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; layout: TvLayout; enabled: boolean }) => {
      const { error } = await supabase.rpc('set_tv_layout_enabled', {
        p_user_id: input.user_id,
        p_layout:  input.layout,
        p_enabled: input.enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KIOSKS_KEY }),
  });
}

/** Set a kiosk account's rotate interval, 2..10 minutes (0143). */
export function useSetTvRotateMinutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; minutes: number }) => {
      const { error } = await supabase.rpc('set_tv_rotate_minutes', {
        p_user_id: input.user_id,
        p_minutes: input.minutes,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KIOSKS_KEY }),
  });
}

/** Kiosk side: re-read `me` when this account's users row changes, so a
 *  layout flip from the admin page lands on the wall without a reload. */
export function useTvLayoutLive(userId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`tv-layout-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
        () => { qc.invalidateQueries({ queryKey: ['me'] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, userId]);
}

/** Ticks once a minute — enough for the rotate slots to flip on time (every
 *  interval is a whole number of minutes, so slot boundaries fall on minute
 *  boundaries). */
export function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
