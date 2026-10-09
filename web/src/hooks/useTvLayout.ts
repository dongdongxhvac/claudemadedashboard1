// Wall-screen layout switch (0138).
//
// A kiosk account's users.preferences.tv_layout decides which board the
// screen shows: 'tv' (operations), 'tv2' (coverage), 'tv3' (coverage in
// three sections, 25/40/35 — 2026-10-09) or 'rotate' (alternate tv/tv2
// every ROTATE_MINUTES). App.tsx's TvLayoutGate resolves it; the Admin
// page's Shop TV card sets it through the set_tv_layout RPC; and the kiosk
// follows its own users row over realtime, so a flip on a phone reaches
// the wall within seconds without touching the Pi.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type TvLayout = 'tv' | 'tv2' | 'tv3';
export type TvLayoutSetting = TvLayout | 'rotate';

export const ROTATE_MINUTES = 5;

export const TV_LAYOUT_OPTIONS: { value: TvLayoutSetting; label: string; hint: string }[] = [
  { value: 'tv',     label: 'TV1 · Operations', hint: 'workload, BMS, equipment, projects, PTO, on-call, overtime' },
  { value: 'tv2',    label: 'TV2 · Coverage',   hint: 'PTO heat map, 7-day coverage, overtime, on-call, LOTO' },
  { value: 'tv3',    label: 'TV3 · Coverage 25/40/35', hint: 'same panels in three sections — PTO 25%, every overtime post 40%, on-call + LOTO 35%' },
  { value: 'rotate', label: `Rotate · ${ROTATE_MINUTES} min`, hint: 'alternate between the two boards' },
];

export const TV_LAYOUT_PATHS: Record<TvLayout, string> = {
  tv:  '/upark/tv',
  tv2: '/upark/tv2',
  tv3: '/upark/tv3',
};

/** The board a setting means right now. 'rotate' alternates on fixed
 *  wall-clock slots so every screen on 'rotate' shows the same board at the
 *  same time; anything unknown is the operations board. */
export function resolveTvLayout(setting: unknown, now: Date = new Date()): TvLayout {
  if (setting === 'tv2') return 'tv2';
  if (setting === 'tv3') return 'tv3';
  if (setting === 'rotate') {
    const slot = Math.floor(now.getTime() / (ROTATE_MINUTES * 60_000));
    return slot % 2 === 0 ? 'tv' : 'tv2';
  }
  return 'tv';
}

export type TvKiosk = {
  id: string;
  full_name: string;
  email: string | null;
  active: boolean;
  layout: TvLayoutSetting;
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
        const raw = (r.preferences as Record<string, unknown> | null)?.tv_layout;
        const layout: TvLayoutSetting = raw === 'tv2' || raw === 'tv3' || raw === 'rotate' ? raw : 'tv';
        return { id: r.id, full_name: r.full_name, email: r.email, active: r.active, layout };
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

/** Ticks once a minute — enough for the rotate slots to flip on time. */
export function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
