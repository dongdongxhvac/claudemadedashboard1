// MRO Phase 6a — charge verification workbench. List charges, reclass
// (building + MEP), upload + OCR a receipt, and verify / exception each
// with the audit trail. The scored auto-match panel (Phase 6b) layers on
// top of this; here a human attaches and confirms manually.
import { useMemo, useRef, useState } from 'react';
import { useMe } from '../../hooks/useMe';
import { useBuildings } from '../../hooks/useBuildings';
import {
  useMroCharges, useMroChargesRealtime, useUpdateMroCharge,
  useUploadReceiptForCharge, useDetachReceipt, useVerifyCharge, useMarkChargeException,
  useMroReceiptSignedUrl,
  MEP_CATEGORIES, EXCEPTION_REASONS,
  type MroCharge, type MroChargeStatus, type ExceptionReason, type MepCategory,
} from '../../hooks/useMroBilling';

const STATUS_TABS: { key: MroChargeStatus | 'all'; label: string }[] = [
  { key: 'unreviewed', label: 'Unreviewed' },
  { key: 'verified', label: 'Verified' },
  { key: 'exception', label: 'Exception' },
  { key: 'all', label: 'All' },
];

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

export function MroChargesWorkbench() {
  useMroChargesRealtime();
  const [tab, setTab] = useState<MroChargeStatus | 'all'>('unreviewed');
  const chargesQ = useMroCharges(tab === 'all' ? undefined : tab);
  const buildingsQ = useBuildings();

  const buildings = useMemo(
    () => (buildingsQ.data ?? []).filter((b) => b.active)
      .map((b) => ({ id: b.id, label: `${b.short_code ?? b.code} — ${b.name}` })),
    [buildingsQ.data],
  );

  const charges = chargesQ.data ?? [];

  return (
    <div className="t-card" style={{ padding: '1rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="t-small t-muted uppercase tracking-wider">Charges · reclass + verify</div>
        <div className="flex gap-1.5">
          {STATUS_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="t-small" style={{
                padding: '2px 10px', borderRadius: 10, border: '1px solid',
                borderColor: tab === t.key ? 'var(--color-accent)' : 'var(--color-border)',
                background: tab === t.key ? 'var(--color-accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--color-text-muted)', cursor: 'pointer',
              }}>{t.label}</button>
          ))}
        </div>
      </div>

      {chargesQ.isLoading ? <p className="t-small t-muted">Loading…</p>
        : charges.length === 0 ? <p className="t-small t-muted">No charges in this view. Import a card CSV above.</p>
        : (
        <div className="overflow-x-auto">
          <table className="t-small w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="t-muted" style={{ textAlign: 'left' }}>
                <th className="pb-1 pr-2">Date</th>
                <th className="pb-1 pr-2">Merchant</th>
                <th className="pb-1 px-2 text-right">Amount</th>
                <th className="pb-1 px-2">Building</th>
                <th className="pb-1 px-2">MEP</th>
                <th className="pb-1 px-2">Receipt</th>
                <th className="pb-1 px-2">Status</th>
                <th className="pb-1 pl-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <ChargeRow key={c.id} charge={c} buildings={buildings} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChargeRow({ charge, buildings }: { charge: MroCharge; buildings: { id: string; label: string }[] }) {
  const me = useMe();
  const who = me.data?.full_name ?? me.data?.email ?? null;
  const update = useUpdateMroCharge();
  const upload = useUploadReceiptForCharge();
  const detach = useDetachReceipt();
  const verify = useVerifyCharge();
  const except = useMarkChargeException();
  const fileRef = useRef<HTMLInputElement>(null);

  const [err, setErr] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState<null | 'verify-delta' | 'exception'>(null);

  const recTotal = charge.receipt?.extracted_total ?? null;
  const liveDelta = recTotal !== null ? round2(charge.amount - recTotal) : null;
  const hasReceipt = !!charge.receipt_id;

  const onFile = async (file: File) => {
    setErr(null);
    try { await upload.mutateAsync({ charge, file, uploadedBy: who, uploadedById: me.data?.id ?? null }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const doVerify = async (reason: ExceptionReason | null) => {
    setErr(null);
    try {
      await verify.mutateAsync({
        id: charge.id,
        amountDelta: liveDelta === null ? null : liveDelta,
        exceptionReason: reason,
        matchConfidence: null,   // manual; the engine sets this in 6b
        verifiedBy: who,
      });
      setReasonOpen(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Verify failed.'); }
  };

  const onVerifyClick = () => {
    if (liveDelta !== null && Math.abs(liveDelta) >= 0.01) setReasonOpen('verify-delta'); // delta needs a reason
    else doVerify(null);
  };

  const doException = async (reason: ExceptionReason) => {
    setErr(null);
    try { await except.mutateAsync({ id: charge.id, reason, verifiedBy: who }); setReasonOpen(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed.'); }
  };

  const busy = update.isPending || upload.isPending || verify.isPending || except.isPending || detach.isPending;

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--color-border-soft)', verticalAlign: 'top' }}>
        <td className="py-1.5 pr-2 t-mono t-muted" style={{ whiteSpace: 'nowrap' }}>{charge.txn_date ?? '—'}</td>
        <td className="py-1.5 pr-2" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={charge.merchant ?? ''}>
          {charge.merchant ?? '—'}
          {charge.card_last4 && <span className="t-muted t-mono ml-1" style={{ fontSize: '0.7rem' }}>·{charge.card_last4}</span>}
        </td>
        <td className="py-1.5 px-2 text-right t-mono">{money(charge.amount)}</td>
        <td className="py-1.5 px-2">
          <select value={charge.building_id ?? ''} disabled={busy}
            onChange={(e) => update.mutate({ id: charge.id, patch: { building_id: e.target.value || null } })}
            style={selStyle}>
            <option value="">—</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </td>
        <td className="py-1.5 px-2">
          <select value={charge.mep_category ?? ''} disabled={busy}
            onChange={(e) => update.mutate({ id: charge.id, patch: { mep_category: (e.target.value || null) as MepCategory | null } })}
            style={selStyle}>
            <option value="">—</option>
            {MEP_CATEGORIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </td>
        <td className="py-1.5 px-2">
          {charge.receipt ? (
            <ReceiptCell charge={charge} liveDelta={liveDelta} onDetach={() => detach.mutate(charge.id)} busy={busy} />
          ) : (
            <>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                className="t-small t-accent" style={{ background: 'none', border: '1px dashed var(--color-border)', borderRadius: 4, padding: '3px 8px' }}>
                {upload.isPending ? 'Uploading…' : '⤒ Upload'}
              </button>
            </>
          )}
        </td>
        <td className="py-1.5 px-2"><StatusBadge charge={charge} /></td>
        <td className="py-1.5 pl-2" style={{ whiteSpace: 'nowrap' }}>
          {charge.status === 'unreviewed' ? (
            <div className="flex gap-1">
              <button type="button" disabled={busy || !hasReceipt} onClick={onVerifyClick}
                title={hasReceipt ? 'Verify against the attached receipt' : 'Attach a receipt first, or use Exception'}
                className="t-small" style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--color-ok, #10b981)',
                  background: 'var(--color-card)', color: 'var(--color-ok, #10b981)', opacity: (busy || !hasReceipt) ? 0.4 : 1 }}>
                ✓ Verify
              </button>
              <button type="button" disabled={busy} onClick={() => setReasonOpen(reasonOpen === 'exception' ? null : 'exception')}
                className="t-small" style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--color-border)',
                  background: 'var(--color-card)', color: 'var(--color-text-muted)' }}>
                Exception ▾
              </button>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => detach.mutate(charge.id)}
              className="t-small t-muted" style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>
              Reopen
            </button>
          )}
        </td>
      </tr>

      {(reasonOpen || err) && (
        <tr>
          <td colSpan={8} style={{ background: 'rgba(0,0,0,0.02)', padding: '0.4rem 0.6rem' }}>
            {err && <p className="t-small t-danger mb-1">{err}</p>}
            {reasonOpen === 'verify-delta' && (
              <div className="flex items-center gap-2 flex-wrap t-small">
                <span style={{ color: 'var(--color-warn, #d97706)' }}>
                  Δ {money(liveDelta)} (charge {money(charge.amount)} vs receipt {money(recTotal)}) — record why, then verify:
                </span>
                {(['freight-delta', 'tax-credit-pending', 'split-shipment', 'needs-research'] as ExceptionReason[]).map((r) => (
                  <ReasonChip key={r} reason={r} onClick={() => doVerify(r)} />
                ))}
                <button className="t-small t-muted" onClick={() => setReasonOpen(null)}>cancel</button>
              </div>
            )}
            {reasonOpen === 'exception' && (
              <div className="flex items-center gap-2 flex-wrap t-small">
                <span className="t-muted">Mark exception — reason:</span>
                {EXCEPTION_REASONS.map((r) => <ReasonChip key={r} reason={r} onClick={() => doException(r)} />)}
                <button className="t-small t-muted" onClick={() => setReasonOpen(null)}>cancel</button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ReceiptCell({ charge, liveDelta, onDetach, busy }: {
  charge: MroCharge; liveDelta: number | null; onDetach: () => void; busy: boolean;
}) {
  const sig = useMroReceiptSignedUrl(charge.receipt?.storage_path);
  const r = charge.receipt!;
  const ocrPending = r.ocr_status === 'pending';
  const ocrFailed = r.ocr_status === 'failed';
  return (
    <div className="flex items-center gap-2">
      {sig.data ? (
        <a href={sig.data} target="_blank" rel="noreferrer" title="Open full receipt">
          <img src={sig.data} alt="receipt" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--color-border)' }} />
        </a>
      ) : <span className="t-muted" style={{ fontSize: '0.7rem' }}>img…</span>}
      <div style={{ fontSize: '0.7rem', lineHeight: 1.3 }}>
        <div className="t-mono">{money(r.extracted_total)}</div>
        {ocrPending && <span style={{ color: 'var(--color-warn, #d97706)' }}>OCR…</span>}
        {ocrFailed && <span className="t-danger">OCR failed</span>}
        {!ocrPending && !ocrFailed && liveDelta !== null && Math.abs(liveDelta) >= 0.01 &&
          <span style={{ color: 'var(--color-warn, #d97706)' }}>Δ{money(liveDelta)}</span>}
        {r.ocr_legibility === 'poor' && <span className="t-danger ml-1">poor</span>}
      </div>
      {charge.status === 'unreviewed' && (
        <button type="button" disabled={busy} onClick={onDetach} title="Remove receipt"
          className="t-muted hover:t-danger" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
      )}
    </div>
  );
}

function StatusBadge({ charge }: { charge: MroCharge }) {
  const cfg = charge.status === 'verified' ? { t: 'VERIFIED', bg: 'rgba(16,185,129,0.15)', fg: '#059669' }
    : charge.status === 'exception' ? { t: 'EXCEPTION', bg: 'rgba(245,158,11,0.16)', fg: '#b45309' }
    : { t: 'UNREVIEWED', bg: 'rgba(100,116,139,0.14)', fg: '#64748b' };
  return (
    <span title={charge.exception_reason ?? (charge.verified_by ? `by ${charge.verified_by}` : '')}>
      <span className="t-mono" style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: cfg.bg, color: cfg.fg }}>{cfg.t}</span>
      {charge.exception_reason && <span className="t-muted ml-1" style={{ fontSize: '0.65rem' }}>{charge.exception_reason}</span>}
    </span>
  );
}

function ReasonChip({ reason, onClick }: { reason: ExceptionReason; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="t-small t-mono"
      style={{ padding: '2px 8px', borderRadius: 10, border: '1px solid var(--color-accent)', background: 'var(--color-card)', color: 'var(--color-accent)', cursor: 'pointer' }}>
      {reason}
    </button>
  );
}

const selStyle: React.CSSProperties = {
  padding: '2px 4px', borderRadius: 4, border: '1px solid var(--color-border)',
  background: 'var(--color-card)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.75rem', maxWidth: 150,
};
