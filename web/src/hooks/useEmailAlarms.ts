// Phase 8.0 — Email-forwarded BMS alarm read hooks.
//
// Backed by:
//   v_email_alarms_open       — latest row per point_ref where state = 'Active'
//   v_email_alarms_by_building — counts grouped by building
//   v_email_alarms_recent      — last 24h, newest first
//   email_poll_state           — Task Scheduler heartbeat
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export type EmailAlarmHistoryRow = {
  gmail_msg_id: string;
  received_at_utc: string;
  alarm_time_utc: string | null;
  vendor: string | null;
  /** Original ingested building value — may be NULL when the BMS email
   *  didn't carry the building tag (Northeast Tech 730/750 in particular). */
  building: string | null;
  /** building (when set) → else short_code inferred from
   *  point_ref / point_name / event_value → else inferred from body_text. */
  building_resolved: string | null;
  point_name: string | null;
  point_ref: string | null;
  alarm_state: string | null;
  event_class: string | null;
  event_value: string | null;
  subject_clean: string | null;
  original_sender: string | null;
  is_manual_close: boolean;
  closed_by_name: string | null;
  manual_close_reason: string | null;
  sourced_from_msg: string | null;
};

/** Full event log for §10.2 — every alarm-state and back-to-normal email
 *  plus synthetic manual-close rows from 0050. Sorted newest first. */
export function useEmailAlarmsHistory(opts?: { manualOnly?: boolean; limit?: number }) {
  const manualOnly = opts?.manualOnly ?? false;
  const limit      = opts?.limit ?? 100;
  return useQuery({
    queryKey: ['email_alarms_history', manualOnly, limit],
    queryFn: async (): Promise<EmailAlarmHistoryRow[]> => {
      let q = supabase
        .from('v_email_alarms_history')
        .select('*')
        .order('received_at_utc', { ascending: false })
        .limit(limit);
      if (manualOnly) q = q.eq('is_manual_close', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EmailAlarmHistoryRow[];
    },
    staleTime: 30_000,
  });
}

/** Window-scoped fetch for §10.2 aggregations. Returns ALL events whose
 *  received_at_utc is within the window — no row cap. Volumes are small
 *  enough (~hundreds of events per 30 days) that fetching the window and
 *  aggregating client-side is simpler than parameterized SQL views. */
export function useEmailAlarmsInWindow(windowDays: number) {
  return useQuery({
    queryKey: ['email_alarms_window', windowDays],
    queryFn: async (): Promise<EmailAlarmHistoryRow[]> => {
      const since = new Date();
      since.setDate(since.getDate() - windowDays);
      const { data, error } = await supabase
        .from('v_email_alarms_history')
        .select('*')
        .gte('received_at_utc', since.toISOString())
        .order('received_at_utc', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmailAlarmHistoryRow[];
    },
    staleTime: 30_000,
  });
}

/** Manually close a BMS email alarm whose "back to normal" never arrived
 *  (common Siemens glitch). Inserts a synthetic Quiet event so the alarm
 *  drops out of v_email_alarms_open and a paper trail lands in
 *  parsed_fields. Gated to admin/manager/lead server-side. */
export function useCloseEmailAlarmManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { point_ref: string; reason?: string }) => {
      const { error } = await supabase.rpc('close_email_alarm_manual', {
        p_point_ref: input.point_ref,
        p_reason:    input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email_alarms_open'] });
      qc.invalidateQueries({ queryKey: ['email_alarms_by_building'] });
      qc.invalidateQueries({ queryKey: ['email_alarms_recent'] });
      qc.invalidateQueries({ queryKey: ['email_alarms_history'] });
      qc.invalidateQueries({ queryKey: ['email_alarms_window'] });
    },
  });
}

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

export type FlappingAlarm = {
  vendor: string;
  point_ref: string;
  point_name: string | null;
  building_resolved: string | null;
  event_count: number;
  transition_count: number;
  first_seen: string;
  last_seen: string;
  latest_state: string;
  acknowledged: boolean;
};

/** Points whose alarm state has changed 2+ times in the trailing 20 min.
 *  Excludes those whose most-recent event in the window is a manual close
 *  (manager already acknowledged). Drives the "FLAPPING — needs review"
 *  sub-section in §10. */
export function useFlappingEmailAlarms() {
  return useQuery({
    queryKey: ['email_alarms_flapping'],
    queryFn: async (): Promise<FlappingAlarm[]> => {
      const { data, error } = await supabase
        .from('v_email_alarms_flapping')
        .select('*')
        .order('last_seen', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FlappingAlarm[];
    },
    // Tighter cadence than the standard panels — flapping windows are 20
    // min so a once-a-minute refresh keeps the list current.
    staleTime: 30_000,
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
