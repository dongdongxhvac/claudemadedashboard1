// MRO Billing data hooks. Phase 1: lightweight pipeline counts so the tab
// proves the schema + RLS are live. CRUD / matching / export hooks land in
// later phases. Tables: mro_import_batches, mro_receipts, mro_card_charges
// (migration 0085); access gated to admin + manager by RLS (mro_can_bill()).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ParsedCharge } from '../lib/mroCsv';

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

// ── Phase 4: CSV import → card charges ──────────────────────────────────
export type MroImportResult = {
  batchId: string;
  inserted: number;   // new charges loaded
  skipped: number;    // already imported (external_ref already present)
  noAmount: number;   // rows dropped — no parseable amount, can't bill
};

/** Create an import batch + load its charges. Dedup-upserts on
 *  external_ref so re-importing an overlapping period skips charges
 *  already loaded — never deduping on amount (two identical charges with
 *  different Document ids are both kept). */
export function useImportMroCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      source: string;
      periodStart: string | null;
      periodEnd: string | null;
      charges: ParsedCharge[];
      createdBy: string | null;
    }): Promise<MroImportResult> => {
      const { data: batch, error: bErr } = await supabase
        .from('mro_import_batches')
        .insert({
          source: input.source || null,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          created_by: input.createdBy,
        })
        .select('id')
        .single();
      if (bErr) throw bErr;

      const importable = input.charges.filter((c) => c.amount !== null);
      const noAmount = input.charges.length - importable.length;

      const rows = importable.map((c) => ({
        import_batch_id: batch.id,
        external_ref: c.external_ref,
        txn_date: c.txn_date,
        post_date: c.post_date,
        merchant: c.merchant,
        amount: c.amount,
        cardholder: c.cardholder,
        card_last4: c.card_last4,
        status: 'unreviewed',
      }));

      let inserted = 0;
      if (rows.length > 0) {
        const { data, error } = await supabase
          .from('mro_card_charges')
          .upsert(rows, { onConflict: 'external_ref', ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        inserted = data?.length ?? 0;
      }

      return { batchId: batch.id, inserted, skipped: rows.length - inserted, noAmount };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mro_pipeline_counts'] }),
  });
}

// ── Phase 2: private receipt storage ────────────────────────────────────
export const MRO_RECEIPTS_BUCKET = 'mro-receipts';

/** Short-lived signed URL for a private receipt object. The bucket is
 *  private (migration 0086); only admin/manager can mint URLs (storage
 *  RLS). Refetches before expiry so a shown thumbnail never 403s. */
export function useMroReceiptSignedUrl(
  storagePath: string | null | undefined,
  expiresInSeconds = 3600,
) {
  return useQuery({
    queryKey: ['mro_receipt_signed_url', storagePath, expiresInSeconds],
    enabled: !!storagePath,
    queryFn: async (): Promise<string | null> => {
      if (!storagePath) return null;
      const { data, error } = await supabase.storage
        .from(MRO_RECEIPTS_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
    staleTime: Math.max(0, expiresInSeconds - 60) * 1000,
  });
}

// ── Phase 3: OCR extraction ─────────────────────────────────────────────
/** Invoke the mro-ocr-receipt edge function for a receipt. The function
 *  pulls the image, calls Claude vision, and writes the extracted_* /
 *  ocr_* fields. Surfaces the function's real error (not the generic
 *  "non-2xx") so a missing ANTHROPIC_API_KEY reads clearly. */
export function useTriggerMroOcr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (receiptId: string) => {
      const { data, error } = await supabase.functions.invoke('mro-ocr-receipt', {
        body: { receipt_id: receiptId },
      });
      if (error) {
        let msg = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try { const j = await ctx.json(); if (j?.error) msg = String(j.error); } catch { /* keep msg */ }
        }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(String(data.error));
      return data as { ok: boolean; ocr_status: string; extracted_total: number | null; legibility: string | null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mro_pipeline_counts'] }),
  });
}
