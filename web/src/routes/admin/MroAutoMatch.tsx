// MRO Phase 6b — scored auto-match. Runs the matching engine over
// unreviewed charges (no receipt yet) against the unattached receipt pool,
// then surfaces one-click confirms for clear matches, side-by-side picks
// for ambiguous ones, and the orphan receipts no charge claims.
import { useMemo, useState } from 'react';
import { useMe } from '../../hooks/useMe';
import {
  useMroCharges, useMroReceipts, useAttachedReceiptIds, useConfirmMatch,
  useMroReceiptSignedUrl, receiptCategoryToMep,
  type MroCharge, type MroReceiptFull, type ExceptionReason,
} from '../../hooks/useMroBilling';
import {
  tierForCharge, findOrphanReceipts,
  type MatchCharge, type MatchReceipt, type ChargeMatch,
} from '../../lib/mroMatching';

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
const round2 = (n: number) => Math.round(n * 100) / 100;

const toMatchCharge = (c: MroCharge): MatchCharge =>
  ({ id: c.id, amount: c.amount, txn_date: c.txn_date, merchant: c.merchant, card_last4: c.card_last4 });
const toMatchReceipt = (r: MroReceiptFull): MatchReceipt =>
  ({ id: r.id, extracted_total: r.extracted_total, extracted_date: r.extracted_date,
     extracted_merchant: r.extracted_merchant, extracted_last4: r.extracted_last4 });

type Row = { charge: MroCharge; match: ChargeMatch };

export function MroAutoMatch() {
  const me = useMe();
  const who = me.data?.full_name ?? me.data?.email ?? null;
  const unreviewedQ = useMroCharges('unreviewed');
  const receiptsQ = useMroReceipts();
  const attachedQ = useAttachedReceiptIds();
  const confirm = useConfirmMatch();
  const [err, setErr] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const receiptById = useMemo(() => {
    const m = new Map<string, MroReceiptFull>();
    for (const r of receiptsQ.data ?? []) m.set(r.id, r);
    return m;
  }, [receiptsQ.data]);

  // Pool = receipts not attached to any charge.
  const pool = useMemo(
    () => (receiptsQ.data ?? []).filter((r) => !(attachedQ.data?.has(r.id))),
    [receiptsQ.data, attachedQ.data],
  );

  // Score every unmatched (no receipt yet) unreviewed charge against the pool.
  const { exact, probable, ambiguous, orphans } = useMemo(() => {
    const charges = (unreviewedQ.data ?? []).filter((c) => !c.receipt_id);
    const matchReceipts = pool.map(toMatchReceipt);
    const rows: Row[] = charges.map((charge) => ({ charge, match: tierForCharge(toMatchCharge(charge), matchReceipts) }));
    const orphanReceipts = findOrphanReceipts(charges.map(toMatchCharge), matchReceipts);
    return {
      exact: rows.filter((r) => r.match.tier === 'exact'),
      probable: rows.filter((r) => r.match.tier === 'probable'),
      ambiguous: rows.filter((r) => r.match.tier === 'ambiguous'),
      orphans: orphanReceipts.map((mr) => receiptById.get(mr.id)).filter((r): r is MroReceiptFull => !!r),
    };
  }, [unreviewedQ.data, pool, receiptById]);

  const runConfirm = async (charge: MroCharge, receiptId: string, score: number) => {
    setErr(null);
    const rec = receiptById.get(receiptId);
    const delta = rec?.extracted_total != null ? round2(charge.amount - rec.extracted_total) : null;
    let reason: ExceptionReason | null = null;
    if (delta !== null && Math.abs(delta) >= 0.01) {
      // A delta needs a recorded reason (DB invariant). Default freight-delta;
      // the human can re-classify in the workbench.
      reason = 'freight-delta';
    }
    // Carry the receipt's tags onto the charge — fill empties only, never
    // overwrite a manual reclass. Receipt building/category → charge
    // building_id / MEP; item label → note.
    const buildingId = charge.building_id ?? rec?.building_id ?? null;
    const mepCategory = charge.mep_category ?? receiptCategoryToMep(rec?.category ?? null);
    const note = charge.note || rec?.item_label || null;
    setBusyIds((s) => new Set(s).add(charge.id));
    try {
      await confirm.mutateAsync({
        chargeId: charge.id, receiptId, matchConfidence: score, amountDelta: delta, exceptionReason: reason, verifiedBy: who,
        buildingId, mepCategory, note,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Confirm failed.'); }
    finally { setBusyIds((s) => { const n = new Set(s); n.delete(charge.id); return n; }); }
  };

  const confirmAllExact = async () => {
    for (const r of exact) {
      const best = r.match.ranked[0];
      if (best) await runConfirm(r.charge, best.receipt.id, best.score.total);
    }
  };

  const loading = unreviewedQ.isLoading || receiptsQ.isLoading || attachedQ.isLoading;
  const nothing = !loading && exact.length === 0 && probable.length === 0 && ambiguous.length === 0 && orphans.length === 0;

  return (
    <div className="t-card" style={{ padding: '1rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="t-small t-muted uppercase tracking-wider">
          Auto-match · {pool.length} unattached receipt{pool.length === 1 ? '' : 's'} in pool
        </div>
        {exact.length > 0 && (
          <button type="button" onClick={confirmAllExact} disabled={confirm.isPending}
            className="t-small t-accent" style={{ padding: '4px 12px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-card)' }}>
            ✓ Confirm all {exact.length} exact
          </button>
        )}
      </div>

      {err && <p className="t-small t-danger mb-2">{err}</p>}
      {loading ? <p className="t-small t-muted">Scoring…</p>
        : nothing ? <p className="t-small t-muted">Nothing to auto-match — every unreviewed charge already has a receipt, or the pool is empty.</p>
        : (
        <div className="space-y-4">
          <TierGroup title="Exact" tone="#10b981" rows={exact} receiptById={receiptById} busyIds={busyIds}
            onConfirm={(c, rid, s) => runConfirm(c, rid, s)} />
          <TierGroup title="Probable" tone="#d97706" rows={probable} receiptById={receiptById} busyIds={busyIds}
            onConfirm={(c, rid, s) => runConfirm(c, rid, s)} note="one-glance review · a delta records freight-delta (re-classify in the workbench if needed)" />
          <AmbiguousGroup rows={ambiguous} receiptById={receiptById} busyIds={busyIds}
            onPick={(c, rid, s) => runConfirm(c, rid, s)} />
          {orphans.length > 0 && <OrphanGroup orphans={orphans} />}
        </div>
      )}
    </div>
  );
}

function TierGroup({ title, tone, rows, receiptById, busyIds, onConfirm, note }: {
  title: string; tone: string; rows: Row[]; receiptById: Map<string, MroReceiptFull>;
  busyIds: Set<string>; onConfirm: (c: MroCharge, receiptId: string, score: number) => void; note?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="t-small mb-1" style={{ fontWeight: 600 }}>
        <span style={{ color: tone }}>{title}</span> <span className="t-muted">({rows.length})</span>
        {note && <span className="t-muted" style={{ fontWeight: 400 }}> · {note}</span>}
      </div>
      <div className="space-y-1">
        {rows.map(({ charge, match }) => {
          const best = match.ranked[0];
          if (!best) return null;
          const rec = receiptById.get(best.receipt.id);
          const delta = rec?.extracted_total != null ? round2(charge.amount - rec.extracted_total) : null;
          return (
            <div key={charge.id} className="flex items-center gap-3 flex-wrap t-small"
              style={{ padding: '4px 6px', borderLeft: `3px solid ${tone}`, background: 'var(--color-card)' }}>
              <span className="t-mono t-muted" style={{ width: 78 }}>{charge.txn_date}</span>
              <span style={{ minWidth: 150, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={charge.merchant ?? ''}>{charge.merchant}</span>
              <span className="t-mono">{money(charge.amount)}</span>
              <span className="t-muted">↔</span>
              <ReceiptMini receipt={rec} />
              <span className="t-mono t-muted" title="engine match confidence">{(best.score.total * 100).toFixed(0)}%</span>
              {delta !== null && Math.abs(delta) >= 0.01 && <span style={{ color: '#d97706' }}>Δ{money(delta)}</span>}
              <button type="button" disabled={busyIds.has(charge.id)} onClick={() => onConfirm(charge, best.receipt.id, best.score.total)}
                className="t-small ml-auto" style={{ padding: '2px 10px', borderRadius: 4, border: `1px solid ${tone}`, background: 'var(--color-card)', color: tone }}>
                {busyIds.has(charge.id) ? '…' : '✓ Confirm'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AmbiguousGroup({ rows, receiptById, busyIds, onPick }: {
  rows: Row[]; receiptById: Map<string, MroReceiptFull>; busyIds: Set<string>;
  onPick: (c: MroCharge, receiptId: string, score: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="t-small mb-1" style={{ fontWeight: 600 }}>
        <span style={{ color: '#a78bfa' }}>Ambiguous</span> <span className="t-muted">({rows.length}) · two close candidates — you pick</span>
      </div>
      <div className="space-y-2">
        {rows.map(({ charge, match }) => (
          <div key={charge.id} style={{ padding: '6px', borderLeft: '3px solid #a78bfa', background: 'var(--color-card)' }}>
            <div className="t-small mb-1">
              <span className="t-mono t-muted">{charge.txn_date}</span> · <b>{charge.merchant}</b> · <span className="t-mono">{money(charge.amount)}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {match.ranked.slice(0, 3).filter((r) => r.score.total > 0).map((r) => {
                const rec = receiptById.get(r.receipt.id);
                return (
                  <div key={r.receipt.id} className="flex items-center gap-2 t-small"
                    style={{ padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                    <ReceiptMini receipt={rec} />
                    <span className="t-mono t-muted">{(r.score.total * 100).toFixed(0)}%</span>
                    <button type="button" disabled={busyIds.has(charge.id)} onClick={() => onPick(charge, r.receipt.id, r.score.total)}
                      className="t-small t-accent" style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--color-accent)', background: 'var(--color-card)' }}>
                      Pick
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrphanGroup({ orphans }: { orphans: MroReceiptFull[] }) {
  return (
    <div>
      <div className="t-small mb-1" style={{ fontWeight: 600 }}>
        <span className="t-muted">Orphan receipts ({orphans.length})</span>
        <span className="t-muted" style={{ fontWeight: 400 }}> · no charge claims these — split shipment or charge not yet posted; held for the next batch</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {orphans.map((r) => (
          <div key={r.id} className="flex items-center gap-2 t-small" style={{ padding: '4px 6px', border: '1px dashed var(--color-border)', borderRadius: 4 }}>
            <ReceiptMini receipt={r} />
            <span className="t-muted" style={{ fontSize: '0.7rem' }}>{r.extracted_merchant ?? '—'} · {r.extracted_date ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptMini({ receipt }: { receipt: MroReceiptFull | undefined }) {
  const sig = useMroReceiptSignedUrl(receipt?.storage_path);
  if (!receipt) return <span className="t-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {sig.data
        ? <a href={sig.data} target="_blank" rel="noreferrer"><img src={sig.data} alt="" style={{ width: 26, height: 26, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--color-border)' }} /></a>
        : <span className="t-muted" style={{ fontSize: '0.65rem' }}>img</span>}
      <span className="t-mono" style={{ fontSize: '0.7rem' }}>{money(receipt.extracted_total)}</span>
    </span>
  );
}
