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

/** All currently-active alarms (latest row per point_ref where state = Active). */
export function useEmailAlarmsOpen() {
  return useQuery({
    queryKey: ['email_alarms_open'],
    queryFn: async (): Promise<EmailAlarmOpen[]> => {
      const { data, error } = await supabase
        .from('v_email_alarms_open')
        .select(
          'gmail_msg_id, vendor, building, point_name, point_ref, alarm_state, event_class, event_value, alarm_time_local, alarm_time_utc, received_at_utc, subject_clean',
        )
        .order('received_at_utc', { ascending: false });
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

/** Recent (last 24h) event stream — both Active and Quiet, newest first. */
export function useEmailAlarmsRecent(limit: number = 20) {
  return useQuery({
    queryKey: ['email_alarms_recent', limit],
    queryFn: async (): Promise<EmailAlarmRecent[]> => {
      const { data, error } = await supabase
        .from('v_email_alarms_recent')
        .select(
          'gmail_msg_id, vendor, building, point_name, point_ref, alarm_state, event_class, event_value, alarm_time_local, alarm_time_utc, received_at_utc, subject_clean, original_sender',
        )
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as EmailAlarmRecent[];
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
