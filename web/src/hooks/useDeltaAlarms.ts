// Phase 7.0 — Delta enteliWEB alarm read hooks.
//
// Backed by:
//   v_delta_alarms_current     — open alarms from the most recent 5-min snapshot
//   v_delta_alarms_by_category — counts by category from the same snapshot
//   delta_poll_state           — daemon heartbeat + cursor
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type DeltaAlarmOpen = {
  id: number;
  snapshot_id: string;
  event_ref: string;
  alarm_text: string | null;
  category: number | null;
  category_name: string | null;
  event_name: string | null;
  priority: number | null;
  to_state: string | null;            // 'normal' | 'offnormal' | 'fault' | ...
  input_ref: string | null;
  input_name: string | null;
  group_name: string | null;
  group_color: string | null;
  latest_from_state: string | null;
  latest_to_state: string | null;
  latest_acked: boolean | null;
  latest_at_utc: string | null;
  event_timestamp_utc: string | null;
};

export type DeltaCategoryRow = {
  category_name: string | null;
  open_count: number;
  active_count: number;
  unacked_count: number;
};

export type DeltaPollState = {
  id: number;
  last_notification_id: number | null;
  last_full_sync_at: string | null;
  session_status: string | null;
  last_error: string | null;
  updated_at: string;
};

/** All currently-open alarms from the latest 5-min snapshot. */
export function useDeltaAlarmsCurrent() {
  return useQuery({
    queryKey: ['delta_alarms_current'],
    queryFn: async (): Promise<DeltaAlarmOpen[]> => {
      const { data, error } = await supabase
        .from('v_delta_alarms_current')
        .select(
          'id, snapshot_id, event_ref, alarm_text, category, category_name, event_name, priority, to_state, input_ref, input_name, group_name, group_color, latest_from_state, latest_to_state, latest_acked, latest_at_utc, event_timestamp_utc',
        )
        // BACnet priority: lower number = higher urgency.
        .order('priority', { ascending: true, nullsFirst: false })
        .order('event_timestamp_utc', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as DeltaAlarmOpen[];
    },
    // Tier-2 reconciles every 5 min server-side; refetching faster than that
    // would just re-read the same snapshot.
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Per-category counts (open / active / unacked). */
export function useDeltaAlarmsByCategory() {
  return useQuery({
    queryKey: ['delta_alarms_by_category'],
    queryFn: async (): Promise<DeltaCategoryRow[]> => {
      const { data, error } = await supabase
        .from('v_delta_alarms_by_category')
        .select('*');
      if (error) throw error;
      return (data ?? []) as DeltaCategoryRow[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Daemon heartbeat — surfaces session_status and last_full_sync_at so the
 *  manager can tell whether the BMS feed is actually live. */
export function useDeltaPollState() {
  return useQuery({
    queryKey: ['delta_poll_state'],
    queryFn: async (): Promise<DeltaPollState | null> => {
      const { data, error } = await supabase
        .from('delta_poll_state')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DeltaPollState | null;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
