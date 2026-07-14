import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type Shift = {
  id: string;
  name: string;
  start_time: string;   // "07:00:00"
  lunch_out: string | null;
  lunch_in: string | null;
  end_time: string;
  sort_order: number;
  active: boolean;
  /** Binney weekend-crew tag: 'saturday' (Wed–Sat), 'sunday' (Sun–Wed),
   *  NULL for Mon–Fri shifts (incl. all UPark shifts). Single source of
   *  truth for every crew filter/split. */
  crew: 'saturday' | 'sunday' | null;
};

const KEY = ['shifts'];

export function useShifts() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Shift[]> => {
      const { data, error } = await supabase
        .from('shifts')
        .select('id, name, start_time, lunch_out, lunch_in, end_time, sort_order, active, crew')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useShiftsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`shifts-changes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        qc.invalidateQueries({ queryKey: KEY });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function useUpdateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Pick<Shift, 'name' | 'start_time' | 'lunch_out' | 'lunch_in' | 'end_time' | 'sort_order' | 'active'>>;
    }) => {
      const { error, data } = await supabase
        .from('shifts')
        .update({ ...input.patch, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** "07:00:00" -> "7:00am" */
export function fmtShiftTime(t: string | null): string {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
