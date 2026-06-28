// MRO Billing data hooks. Phase 1: lightweight pipeline counts so the tab
// proves the schema + RLS are live. CRUD / matching / export hooks land in
// later phases. Tables: mro_import_batches, mro_receipts, mro_card_charges
// (migration 0085); access gated to admin + manager by RLS (mro_can_bill()).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type MroPipelineCounts = {
  batches: number;
  receipts: number;
  charges: number;
  unreviewed: number;
  verified: number;
  exceptions: number;
};

/** Head-count each table + the charge status split. Uses count:'exact' /
 *  head:true so no rows transit the wire — just the totals. */
export function useMroPipelineCounts() {
  return useQuery({
    queryKey: ['mro_pipeline_counts'],
    queryFn: async (): Promise<MroPipelineCounts> => {
      const count = async (
        table: string,
        filter?: (q: ReturnType<typeof headQuery>) => ReturnType<typeof headQuery>,
      ): Promise<number> => {
        let q = headQuery(table);
        if (filter) q = filter(q);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };

      const [batches, receipts, charges, unreviewed, verified, exceptions] = await Promise.all([
        count('mro_import_batches'),
        count('mro_receipts'),
        count('mro_card_charges'),
        count('mro_card_charges', (q) => q.eq('status', 'unreviewed')),
        count('mro_card_charges', (q) => q.eq('status', 'verified')),
        count('mro_card_charges', (q) => q.eq('status', 'exception')),
      ]);

      return { batches, receipts, charges, unreviewed, verified, exceptions };
    },
    staleTime: 30_000,
  });
}

function headQuery(table: string) {
  return supabase.from(table).select('*', { count: 'exact', head: true });
}
