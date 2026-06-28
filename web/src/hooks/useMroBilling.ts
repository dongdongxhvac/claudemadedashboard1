// MRO Billing data hooks. Phase 1: lightweight pipeline counts so the tab
// proves the schema + RLS are live. CRUD / matching / export hooks land in
// later phases. Tables: mro_import_batches, mro_receipts, mro_card_charges
// (migration 0085); access gated to admin + manager by RLS (mro_can_bill()).
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ParsedCharge } from '../lib/mroCsv';
import { reencodeToJpeg } from '../lib/mroImage';

export const MEP_CATEGORIES = [
  'Mechanical', 'Electrical', 'Plumbing',
  'Fire / Life Safety', 'Controls / BMS', 'General / Other',
] as const;
export type MepCategory = (typeof MEP_CATEGORIES)[number];

export const EXCEPTION_REASONS = [
  'missing-receipt', 'freight-delta', 'tax-credit-pending',
  'split-shipment', 'orphan-receipt', 'needs-research',
] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

export type MroChargeStatus = 'unreviewed' | 'verified' | 'exception';

export type MroReceiptLite = {
  id: string;
  storage_path: string;
  extracted_total: number | null;
  extracted_merchant: string | null;
  extracted_date: string | null;
  ocr_status: string | null;
  ocr_legibility: string | null;
};

export type MroCharge = {
  id: string;
  txn_date: string | null;
  post_date: string | null;
  merchant: string | null;
  amount: number;
  cardholder: string | null;
  card_last4: string | null;
  building_id: string | null;
  mep_category: MepCategory | null;
  receipt_id: string | null;
  note: string | null;
  status: MroChargeStatus;
  exception_reason: ExceptionReason | null;
  match_confidence: number | null;
  amount_delta: number | null;
  external_ref: string | null;
  verified_by: string | null;
  verified_at: string | null;
  building: { short_code: string | null; name: string } | null;
  receipt: MroReceiptLite | null;
};

const CHARGES_KEY = ['mro_charges'];

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

// ── Phase 6a: charges workbench ─────────────────────────────────────────
const CHARGE_SELECT =
  '*, building:buildings(short_code,name), ' +
  'receipt:mro_receipts(id,storage_path,extracted_total,extracted_merchant,extracted_date,ocr_status,ocr_legibility)';

export function useMroCharges(status?: MroChargeStatus) {
  return useQuery({
    queryKey: [...CHARGES_KEY, status ?? 'all'],
    queryFn: async (): Promise<MroCharge[]> => {
      let q = supabase.from('mro_card_charges').select(CHARGE_SELECT).order('txn_date', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as MroCharge[];
      return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
    },
    staleTime: 20_000,
  });
}

export function useMroChargesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel(`mro-charges-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mro_card_charges' },
        () => { qc.invalidateQueries({ queryKey: CHARGES_KEY }); qc.invalidateQueries({ queryKey: ['mro_pipeline_counts'] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mro_receipts' },
        () => qc.invalidateQueries({ queryKey: CHARGES_KEY }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
}

const invalidateCharges = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: CHARGES_KEY });
  qc.invalidateQueries({ queryKey: ['mro_pipeline_counts'] });
};

/** Reclass — building / MEP / note. */
export function useUpdateMroCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Pick<MroCharge, 'building_id' | 'mep_category' | 'note'>> }) => {
      const { error } = await supabase.from('mro_card_charges')
        .update({ ...input.patch, updated_at: new Date().toISOString() }).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateCharges(qc),
  });
}

/** Upload a receipt photo for a charge: normalize → JPEG → private bucket
 *  → receipt row → OCR → attach to the charge (recompute amount_delta). */
export function useUploadReceiptForCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { charge: MroCharge; file: File; uploadedBy: string | null }) => {
      const jpeg = await reencodeToJpeg(input.file);              // throws clean on HEIC
      const path = `charges/${input.charge.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from(MRO_RECEIPTS_BUCKET)
        .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;

      const { data: receipt, error: rErr } = await supabase.from('mro_receipts')
        .insert({ storage_path: path, image_mime: 'image/jpeg', uploaded_by: input.uploadedBy })
        .select('id').single();
      if (rErr) throw rErr;

      // OCR (best-effort — attach even if OCR is slow/fails; delta recomputed on verify).
      try {
        await supabase.functions.invoke('mro-ocr-receipt', { body: { receipt_id: receipt.id } });
      } catch { /* ocr_status stays pending/failed; surfaced in the row */ }

      const { error: aErr } = await supabase.from('mro_card_charges')
        .update({ receipt_id: receipt.id, updated_at: new Date().toISOString() }).eq('id', input.charge.id);
      if (aErr) throw aErr;
      return receipt.id as string;
    },
    onSuccess: () => invalidateCharges(qc),
  });
}

/** Detach the receipt from a charge (does not delete the receipt row). */
export function useDetachReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chargeId: string) => {
      const { error } = await supabase.from('mro_card_charges')
        .update({ receipt_id: null, status: 'unreviewed', amount_delta: null, exception_reason: null,
                  verified_by: null, verified_at: null, match_confidence: null,
                  updated_at: new Date().toISOString() })
        .eq('id', chargeId);
      if (error) throw error;
    },
    onSuccess: () => invalidateCharges(qc),
  });
}

/** Verify a charge against its attached receipt — writes the audit trail.
 *  amount_delta = charge.amount − receipt.extracted_total. A non-zero
 *  delta REQUIRES an exception_reason (DB CHECK + the freight/tax audit
 *  rule). match_confidence is the engine score when known, else null. */
export function useVerifyCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string; amountDelta: number | null; exceptionReason: ExceptionReason | null;
      matchConfidence: number | null; verifiedBy: string | null;
    }) => {
      const { error } = await supabase.from('mro_card_charges').update({
        status: 'verified',
        amount_delta: input.amountDelta,
        exception_reason: input.exceptionReason,
        match_confidence: input.matchConfidence,
        verified_by: input.verifiedBy,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateCharges(qc),
  });
}

/** Mark a charge an exception (required reason) — e.g. missing-receipt,
 *  needs-research. Eligible for export, but flagged. */
export function useMarkChargeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: ExceptionReason; verifiedBy: string | null }) => {
      const { error } = await supabase.from('mro_card_charges').update({
        status: 'exception',
        exception_reason: input.reason,
        verified_by: input.verifiedBy,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateCharges(qc),
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
