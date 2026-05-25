// Phase 8.0 — Email-forwarded BMS alarm read hooks.
//
// Backed by:
//   v_email_alarms_open       — latest row per point_ref where state = 'Active'
//   v_email_alarms_by_building — counts grouped by building
//   v_email_alarms_recent      — last 24h, newest first
//   email_poll_state           — Task Scheduler heartbeat
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type EmailAlarmOpen = {
  gmail_msg_id: string;
  vendor: string | null;
  building: string | null;
  point_name: string | null;
  point_ref: string | null;
  alarm_state: string | null;
  event_class: string | null;
  event_value: string | null;
  alarm_time_local: string | null;
  alarm_time_utc: string | null;
  received_at_utc: string;
  subject_clean: string | null;
};

export type EmailAlarmRecent = EmailAlarmOpen & {
  original_sender: string | null;
};

export type EmailBuildingRow = {
  building: string;
  open_count: number;
  off_normal_count: number;
  limit_count: number;
  fault_count: number;
};

export type EmailPollState = {
  id: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_seen: number | null;
  last_run_added: number | null;
  last_error: string | null;
  updated_at: string;
};

/** All currently-active alarms (latest row per point_ref where state = Active).
 *  Pass {vendor: 'siemens'} (or any vendor slug) to scope §09 to one BMS;
 *  omit for the §10 multi-vendor view. */
export function useEmailAlarmsOpen(opts?: { vendor?: string }) {
  const vendor = opts?.vendor;
  return useQuery({
    queryKey: ['email_alarms_open', vendor ?? '_all_'],
    queryFn: async (): Promise<EmailAlarmOpen[]> => {
      let q = supabase
        .from('v_email_alarms_open')
        .select(
          'gmail_msg_id, vendor, building, point_name, point_ref, alarm_state, event_class, event_value, alarm_time_local, alarm_time_utc, received_at_utc, subject_clean',
        );
      if (vendor) q = q.eq('vendor', vendor);
      const { data, error } = await q.order('received_at_utc', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmailAlarmOpen[];
    },
    // Poller runs every 5min; faster refetch would just re-read the same rows.
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Per-building counts for the panel header. */
export function useEmailAlarmsByBuilding() {
  return useQuery({
    queryKey: ['email_alarms_by_building'],
    queryFn: async (): Promise<EmailBuildingRow[]> => {
      const { data, error } = await supabase
        .from('v_email_alarms_by_building')
        .select('*');
      if (error) throw error;
      return (data ?? []) as EmailBuildingRow[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Recent (last 24h) event stream — both Active and Quiet, newest first.
 *  Pass {vendor: 'siemens'} to scope the flip-count to one BMS. */
export function useEmailAlarmsRecent(limit: number = 20, opts?: { vendor?: string }) {
  const vendor = opts?.vendor;
  return useQuery({
    queryKey: ['email_alarms_recent', limit, vendor ?? '_all_'],
    queryFn: async (): Promise<EmailAlarmRecent[]> => {
      let q = supabase
        .from('v_email_alarms_recent')
        .select(
          'gmail_msg_id, vendor, building, point_name, point_ref, alarm_state, event_class, event_value, alarm_time_local, alarm_time_utc, received_at_utc, subject_clean, original_sender',
        );
      if (vendor) q = q.eq('vendor', vendor);
      const { data, error } = await q.limit(limit);
      if (error) throw error;
      return (data ?? []) as EmailAlarmRecent[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export type BmsHeartbeat = {
  vendor: string;
  vendor_label: string | null;
  building: string | null;
  point_name: string | null;
  state: string | null;
  last_seen_utc: string;
  received_at_utc: string;
  hours_since: number;
};

/** Latest heartbeat per BMS vendor — drives the per-vendor pipeline health
 *  strip in §09. Vendor list and weekday-aware staleness rules are computed
 *  client-side. */
export function useBmsHeartbeats() {
  return useQuery({
    queryKey: ['bms_heartbeat_latest'],
    queryFn: async (): Promise<BmsHeartbeat[]> => {
      const { data, error } = await supabase
        .from('v_bms_heartbeat_latest')
        .select('*')
        .order('vendor');
      if (error) throw error;
      return (data ?? []) as BmsHeartbeat[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Poller heartbeat — feeds the panel's "feed live/stale" indicator. */
export function useEmailPollState() {
  return useQuery({
    queryKey: ['email_poll_state'],
    queryFn: async (): Promise<EmailPollState | null> => {
      const { data, error } = await supabase
        .from('email_poll_state')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as EmailPollState | null;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
