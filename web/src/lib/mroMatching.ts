// MRO receipt ↔ card-charge matching engine (spec Phase 5).
//
// A correct attachment is two independent records agreeing — the card
// charge (bank's record) and the receipt (vendor's record) — across
// amount, date, merchant, and card. Score every candidate pair; NEVER
// match on amount alone (two $86.97 Home Depot charges collide; freight/
// tax/split-shipment create legitimate non-zero deltas).
//
// Pure + deterministic so the verify UI (Phase 6) and any test harness
// share one source of truth.

export interface MatchCharge {
  id: string;
  amount: number;            // settled, incl tax
  txn_date: string | null;   // YYYY-MM-DD
  merchant: string | null;   // statement descriptor (often abbreviated)
  card_last4: string | null;
}

export interface MatchReceipt {
  id: string;
  extracted_total: number | null;   // grand total incl tax (OCR)
  extracted_date: string | null;    // YYYY-MM-DD
  extracted_merchant: string | null;
  extracted_last4: string | null;
}

export interface ScoreBreakdown {
  total: number;             // 0..1 weighted
  amountScore: number;
  dateScore: number;
  vendorSim: number;
  cardScore: number;
  amountDelta: number | null;  // charge.amount − receipt.extracted_total
  rejected: boolean;           // hard reject — card last-4 present & differ
}

export type MatchTier = 'exact' | 'ambiguous' | 'probable' | 'none';

// Score thresholds (single source for tiering + orphan detection).
export const PROBABLE_THRESHOLD = 0.65;   // lowest "plausible candidate"
export const EXACT_THRESHOLD = 0.90;
export const AMBIGUOUS_SECOND = 0.70;
export const EXACT_GAP = 0.25;
export const AMBIGUOUS_GAP = 0.15;

// ── component scores ──

/** amountScore + the signed delta. |Δ|<0.01→1.0; ≤20→0.55; <10% of the
 *  charge→0.40; else 0. Null receipt total → 0 (can't corroborate). */
export function amountScore(chargeAmount: number, receiptTotal: number | null): { score: number; delta: number | null } {
  if (receiptTotal === null || receiptTotal === undefined) return { score: 0, delta: null };
  const delta = chargeAmount - receiptTotal;
  const ad = Math.abs(delta);
  let score: number;
  if (ad < 0.01) score = 1.0;
  else if (ad <= 20) score = 0.55;
  else if (chargeAmount !== 0 && ad / Math.abs(chargeAmount) < 0.10) score = 0.40;
  else score = 0;
  return { score, delta };
}

function dayDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/** dateScore — receipt purchase date vs charge txn_date (post_date lags).
 *  ≤1d→1.0; ≤3d→0.75; ≤7d→0.45; else / unknown → 0.1 floor. */
export function dateScore(chargeTxnDate: string | null, receiptDate: string | null): number {
  const d = dayDiff(chargeTxnDate, receiptDate);
  if (d === null) return 0.1;
  if (d <= 1) return 1.0;
  if (d <= 3) return 0.75;
  if (d <= 7) return 0.45;
  return 0.1;
}

const VENDOR_STOPWORDS = new Set(['INC', 'LLC', 'ORDER']);

function vendorTokens(name: string | null): Set<string> {
  if (!name) return new Set();
  const toks = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length >= 3 && !VENDOR_STOPWORDS.has(t));
  return new Set(toks);
}

/** vendorSim — normalized token overlap (overlap coefficient =
 *  |A∩B| / min(|A|,|B|)). Robust to the bank descriptor being an
 *  abbreviation/superset of the receipt vendor. 0..1. */
export function vendorSim(merchant: string | null, receiptMerchant: string | null): number {
  const a = vendorTokens(merchant);
  const b = vendorTokens(receiptMerchant);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

/** cardScore — both present & equal → 1.0; both present & differ → hard
 *  reject (handled in scorePair); else (unknown) → 0.5. */
function cardScoreAndReject(a: string | null, b: string | null): { score: number; reject: boolean } {
  if (a && b) return a === b ? { score: 1.0, reject: false } : { score: 0, reject: true };
  return { score: 0.5, reject: false };
}

// ── pair score ──
export function scorePair(charge: MatchCharge, receipt: MatchReceipt): ScoreBreakdown {
  const { score: aScore, delta } = amountScore(charge.amount, receipt.extracted_total);
  const dScore = dateScore(charge.txn_date, receipt.extracted_date);
  const vSim = vendorSim(charge.merchant, receipt.extracted_merchant);
  const { score: cScore, reject } = cardScoreAndReject(charge.card_last4, receipt.extracted_last4);

  const total = reject ? 0 : (0.45 * aScore + 0.20 * dScore + 0.20 * vSim + 0.15 * cScore);
  return {
    total: Number(total.toFixed(4)),
    amountScore: aScore, dateScore: dScore, vendorSim: Number(vSim.toFixed(4)), cardScore: cScore,
    amountDelta: delta, rejected: reject,
  };
}

export interface RankedReceipt {
  receipt: MatchReceipt;
  score: ScoreBreakdown;
}

/** Score a charge against every receipt, sorted best-first. Hard-rejected
 *  pairs (total 0) sink to the bottom. */
export function rankReceipts(charge: MatchCharge, receipts: MatchReceipt[]): RankedReceipt[] {
  return receipts
    .map((receipt) => ({ receipt, score: scorePair(charge, receipt) }))
    .sort((x, y) => y.score.total - x.score.total);
}

export interface ChargeMatch {
  tier: MatchTier;
  ranked: RankedReceipt[];   // best-first
  best: number;              // best total (0 if no candidates)
  second: number | null;     // runner-up total
}

/** Tier a charge over its ranked candidates:
 *   exact      — best ≥ 0.90 AND (no second OR best−second > 0.25)
 *   ambiguous  — second ≥ 0.70 AND best−second < 0.15  (refuse to auto-pick)
 *   probable   — best ≥ 0.65
 *   none       — else  → exception queue */
export function tierForCharge(charge: MatchCharge, receipts: MatchReceipt[]): ChargeMatch {
  const ranked = rankReceipts(charge, receipts);
  const best = ranked[0]?.score.total ?? 0;
  const second = ranked.length > 1 ? ranked[1].score.total : null;

  let tier: MatchTier;
  if (best >= EXACT_THRESHOLD && (second === null || best - second > EXACT_GAP)) tier = 'exact';
  else if (second !== null && second >= AMBIGUOUS_SECOND && best - second < AMBIGUOUS_GAP) tier = 'ambiguous';
  else if (best >= PROBABLE_THRESHOLD) tier = 'probable';
  else tier = 'none';

  return { tier, ranked, best, second };
}

/** Orphan receipts — not a PLAUSIBLE top-2 candidate of any charge (score
 *  must clear the probable floor, so junk pairings that only rank "top-2"
 *  because the pool is small don't count as a claim). Usually a split
 *  shipment or a charge not yet posted; hold for the next batch. Caller
 *  passes the UNATTACHED receipt pool. */
export function findOrphanReceipts(charges: MatchCharge[], receipts: MatchReceipt[]): MatchReceipt[] {
  const claimed = new Set<string>();
  for (const charge of charges) {
    rankReceipts(charge, receipts)
      .slice(0, 2)
      .filter((r) => r.score.total >= PROBABLE_THRESHOLD)
      .forEach((r) => claimed.add(r.receipt.id));
  }
  return receipts.filter((r) => !claimed.has(r.id));
}
