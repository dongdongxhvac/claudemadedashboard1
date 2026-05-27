// §12 — PTO records hook (Phase 12).
//
// Reads v_pto_records (pto_records joined with users.full_name). Realtime
// subscription on pto_records + pto_poll_state so the manager dashboard
// reflects the latest poller pass.
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PtoStatus = 'approved' | 'pending' | 'denied' | 'cancelled';

export type PtoRecord = {
  id: string;
  user_id: string | null;
  user_full_name: string | null;
  ontheclock_employee_id: string | null;
  ontheclock_request_id: string;
  starts_on: string;         // YYYY-MM-DD
  ends_on:   string;         // YYYY-MM-DD
  days: number;
  pto_type: string | null;
  hours: number | null;
  status: PtoStatus;
  reason: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PtoPollState = {
  id: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  records_seen: number | null;
  records_added: number | null;
  records_updated: number | null;
  updated_at: string;
};

const KEY_RECORDS  = ['pto_records'];
const KEY_BALANCES = ['pto_balances'];
const KEY_STATE    = ['pto_poll_state'];

export type PtoBalance = {
  id: string;
  user_id: string | null;
  user_full_name: string | null;
  ontheclock_employee_id: string;
  year: number;
  vacation_accrued:   number | null;
  vacation_used:      number | null;
  vacation_remaining: number | null;
  vacation_rule:      string | null;
  sick_accrued:       number | null;
  sick_used:          number | null;
  sick_remaining:     number | null;
  sick_rule:          string | null;
  personal_accrued:   number | null;
  personal_used:      number | null;
  personal_remaining: number | null;
  personal_rule:      string | null;
  holiday_accrued:    number | null;
  holiday_used:       number | null;
  holiday_remaining:  number | null;
  holiday_rule:       string | null;
  any_low: boolean;
  updated_at: string;
};

/** Per-engineer balance snapshot. One row per (user, year). */
export function usePtoBalances() {
  return useQuery({
    queryKey: KEY_BALANCES,
    queryFn: async (): Promise<PtoBalance[]> => {
      const { data, error } = await supabase
        .from('v_pto_balances')
        .select('*')
        .order('year', { ascending: false })
        .order('user_full_name');
      if (error) throw error;
      return (data ?? []) as PtoBalance[];
    },
    staleTime: 60_000,
  });
}

/** All PTO records visible to the dashboard. Past records are kept (no
 *  client-side time filter) so the panel can show year-end forecasts. */
export function usePtoRecords() {
  return useQuery({
    queryKey: KEY_RECORDS,
    queryFn: async (): Promise<PtoRecord[]> => {
      const { data, error } = await supabase
        .from('v_pto_records')
        .select('*')
        .order('starts_on', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PtoRecord[];
    },
    staleTime: 60_000,
  });
}

/** Poller heartbeat row — used for the "data X min old" subtitle. */
export function usePtoPollState() {
  return useQuery({
    queryKey: KEY_STATE,
    queryFn: async (): Promise<PtoPollState | null> => {
      const { data, error } = await supabase
        .from('pto_poll_state')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PtoPollState | null;
    },
    staleTime: 30_000,
  });
}

/** Realtime: any change to pto_records or pto_poll_state invalidates. */
export function usePtoRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('pto-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pto_records' },
        () => qc.invalidateQueries({ queryKey: KEY_RECORDS }),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pto_poll_state' },
        () => qc.invalidateQueries({ queryKey: KEY_STATE }),
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pto_balances' },
        () => qc.invalidateQueries({ queryKey: KEY_BALANCES }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}
