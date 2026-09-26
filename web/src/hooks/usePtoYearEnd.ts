// Year-end PTO close-out + next-year allotment helpers (migration 0135).
// Shared by the UPark PtoPanel and the Binney BinneyPtoPanel — both manage
// the same pto_balances / pto_year_end_closeouts tables, so every mutation
// invalidates both sites' summary caches.
//
// Rules (set 2026-09-26):
//   Sick     — carry at most 2 days (2 × daily hours), pay out the rest.
//   Vacation — manager picks per engineer: carry as-is (+/−), lose, or a
//              custom carry with the rest forfeited.
//   Floating holiday — never carries.
// The math lives in the pto_close_year() SQL function; sickCloseoutPreview
// below mirrors it only to preview numbers before the manager commits.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type VacationAction = 'carry' | 'lose' | 'custom';

export type PtoCloseout = {
  id: string;
  user_id: string;
  from_year: number;
  to_year: number;
  daily_hours: number;
  sick_remaining: number;
  sick_carry_cap: number;
  sick_carryover_hours: number;
  sick_payout_hours: number;
  payout_paid_at: string | null;
  payout_paid_by: string | null;
  vacation_remaining: number;
  vacation_action: VacationAction;
  vacation_carryover_hours: number;
  vacation_forfeit_hours: number;
  holiday_forfeit_hours: number;
  notes: string | null;
  closed_by: string | null;
  closed_at: string;
  voided_at: string | null;
  voided_by: string | null;
};

export const SICK_CARRY_MAX_DAYS = 2;

export const VACATION_ACTION_LABELS: Record<VacationAction, string> = {
  carry:  'Carry balance',
  lose:   'Lose (forfeit)',
  custom: 'Carry custom hours',
};

/** Client-side preview of the sick split — same rule as pto_close_year(). */
export function sickCloseoutPreview(sickRemaining: number, dailyHours: number) {
  const cap = SICK_CARRY_MAX_DAYS * dailyHours;
  return {
    cap,
    carry: Math.min(sickRemaining, cap),
    payout: Math.max(sickRemaining - cap, 0),
  };
}

/** Client-side preview of the vacation split — same rule as pto_close_year(). */
export function vacationCloseoutPreview(remaining: number, action: VacationAction, custom: number | null) {
  const carry = action === 'carry' ? remaining : action === 'lose' ? 0 : (custom ?? 0);
  return { carry, forfeit: remaining - carry };
}

const KEY_CLOSEOUTS = ['pto_year_end_closeouts'];

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: KEY_CLOSEOUTS });
  qc.invalidateQueries({ queryKey: ['pto_summary'] });
  qc.invalidateQueries({ queryKey: ['binney_pto_summary'] });
}

/** Every close-out row (active + voided) for a year, newest first. Errors
 *  (e.g. migration 0135 not applied yet) surface via query.error. */
export function usePtoCloseouts(fromYear: number) {
  return useQuery({
    queryKey: [...KEY_CLOSEOUTS, fromYear],
    queryFn: async (): Promise<PtoCloseout[]> => {
      const { data, error } = await supabase
        .from('pto_year_end_closeouts')
        .select('*')
        .eq('from_year', fromYear)
        .order('closed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PtoCloseout[];
    },
    staleTime: 30_000,
  });
}

/** user_id → engineer_profiles.pto_daily_hours override (null = site default). */
export function usePtoDailyHoursMap() {
  return useQuery({
    queryKey: ['pto_daily_hours_map'],
    queryFn: async (): Promise<Map<string, number | null>> => {
      const { data, error } = await supabase
        .from('engineer_profiles')
        .select('user_id, pto_daily_hours');
      if (error) throw error;
      const m = new Map<string, number | null>();
      for (const r of (data ?? []) as { user_id: string; pto_daily_hours: number | string | null }[]) {
        m.set(r.user_id, r.pto_daily_hours == null ? null : Number(r.pto_daily_hours));
      }
      return m;
    },
    staleTime: 60_000,
  });
}

export function useClosePtoYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      from_year: number;
      vacation_action: VacationAction;
      vacation_custom?: number | null;
      notes?: string | null;
    }) => {
      const { error } = await supabase.rpc('pto_close_year', {
        p_user_id:         input.user_id,
        p_from_year:       input.from_year,
        p_vacation_action: input.vacation_action,
        p_vacation_custom: input.vacation_custom ?? null,
        p_notes:           input.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUndoPtoCloseout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; from_year: number }) => {
      const { error } = await supabase.rpc('pto_undo_close_year', {
        p_user_id: input.user_id,
        p_from_year: input.from_year,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Mark (or un-mark) a close-out's sick payout as paid through payroll. */
export function useMarkPayoutPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; paid: boolean }) => {
      let paidBy: string | null = null;
      if (input.paid) {
        const auth = await supabase.auth.getUser();
        const { data: meRow } = await supabase
          .from('users').select('id').eq('auth_user_id', auth.data.user?.id ?? '').maybeSingle();
        paidBy = meRow?.id ?? null;
      }
      const { error } = await supabase
        .from('pto_year_end_closeouts')
        .update({
          payout_paid_at: input.paid ? new Date().toISOString() : null,
          payout_paid_by: paidBy,
        })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Bulk-create next-year allotment rows by copying this year's allotments.
 *  Only touches the three *_alloted columns, so any carryover already on a
 *  next-year row is kept. */
export function useCopyAllotments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: {
      user_id: string; year: number;
      vacation_alloted: number; sick_alloted: number; holiday_alloted: number;
    }[]) => {
      if (rows.length === 0) return;
      const { error } = await supabase
        .from('pto_balances')
        .upsert(rows, { onConflict: 'user_id,year' });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}
