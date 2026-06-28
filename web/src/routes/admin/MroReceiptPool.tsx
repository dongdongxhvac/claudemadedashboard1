// MRO — receipt pool. Upload receipts independently of any charge (file or
// device camera), see each one's OCR'd data + status, and delete unattached
// ones. Pooled receipts feed the auto-match panel; attached ones are locked
// (delete from here only after detaching in the workbench).
import { useMemo, useRef, useState } from 'react';
import { useMe } from '../../hooks/useMe';
import {
  useMroReceipts, useAttachedReceiptIds, useUploadStandaloneReceipt,
  useDeleteMroReceipt, useTriggerMroOcr, useMroReceiptSignedUrl,
  type MroReceiptFull,
} from '../../hooks/useMroBilling';

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function MroReceiptPool() {
  const me = useMe();
  const who = me.data?.full_name ?? me.data?.email ?? null;
  const receiptsQ = useMroReceipts();
  const attachedQ = useAttachedReceiptIds();
  const upload = useUploadStandaloneReceipt();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const receipts = receiptsQ.data ?? [];
  const attached = attachedQ.data ?? new Set<string>();
  const unattachedCount = useMemo(() => receipts.filter((r) => !attached.has(r.id)).length, [receipts, attached]);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    for (const f of Array.from(files)) {
      try { await upload.mutateAsync({ file: f, uploadedBy: who }); }
      catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed.'); break; }
    }
  };

  return (
    <div className="t-card" style={{ padding: '1rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="t-small t-muted uppercase tracking-wider">
          Receipt pool · {receipts.length} total · {unattachedCount} unattached
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" disabled={upload.isPending} onClick={() => camRef.current?.click()}
            className="t-small t-accent" style={btn}>📷 Camera</button>
          <button type="button" disabled={upload.isPending} onClick={() => fileRef.current?.click()}
            className="t-small t-accent" style={btn}>⤒ Upload</button>
        </div>
      </div>

      {err && <p className="t-small t-danger mb-2">{err}</p>}
      {upload.isPending && <p className="t-small t-muted mb-2">Uploading + reading…</p>}

      {receiptsQ.isLoading ? <p className="t-small t-muted">Loading…</p>
        : receipts.length === 0 ? <p className="t-small t-muted">No receipts yet. Upload or snap one — OCR runs automatically.</p>
        : (
        <div className="flex flex-wrap gap-2">
          {receipts.map((r) => (
            <ReceiptCard key={r.id} receipt={r} attached={attached.has(r.id)} who={who} onError={setErr} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiptCard({ receipt, attached, who, onError }: {
  receipt: MroReceiptFull; attached: boolean; who: string | null; onError: (m: string | null) => void;
}) {
  void who;
  const sig = useMroReceiptSignedUrl(receipt.storage_path);
  const del = useDeleteMroReceipt();
  const rerun = useTriggerMroOcr();

  const failed = receipt.ocr_status === 'failed';
  const pending = receipt.ocr_status === 'pending';

  const onDelete = () => {
    if (!confirm('Delete this receipt? This removes the image and its OCR data.')) return;
    onError(null);
    del.mutate({ id: receipt.id, storagePath: receipt.storage_path }, { onError: (e) => onError((e as Error).message) });
  };

  return (
    <div style={{ width: 168, border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden', background: 'var(--color-card)' }}>
      <a href={sig.data ?? undefined} target="_blank" rel="noreferrer" style={{ display: 'block', height: 96, background: 'var(--color-bg)' }}>
        {sig.data
          ? <img src={sig.data} alt="receipt" style={{ width: '100%', height: 96, objectFit: 'cover' }} />
          : <div className="t-muted t-small flex items-center justify-center" style={{ height: 96 }}>img…</div>}
      </a>
      <div style={{ padding: '5px 7px', fontSize: '0.72rem', lineHeight: 1.35 }}>
        <div className="t-mono" style={{ fontWeight: 700 }}>{money(receipt.extracted_total)}</div>
        <div className="t-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={receipt.extracted_merchant ?? ''}>
          {receipt.extracted_merchant ?? '—'}
        </div>
        <div className="t-muted">{receipt.extracted_date ?? '—'}</div>
        <div className="flex items-center justify-between mt-1" style={{ gap: 4 }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3,
            background: attached ? 'rgba(16,185,129,0.15)' : pending ? 'rgba(245,158,11,0.16)' : failed ? 'rgba(248,113,113,0.16)' : 'rgba(100,116,139,0.14)',
            color: attached ? '#059669' : pending ? '#b45309' : failed ? '#b91c1c' : '#64748b' }}>
            {attached ? 'ATTACHED' : pending ? 'OCR…' : failed ? 'OCR FAILED' : 'IN POOL'}
          </span>
          <span className="flex items-center gap-1.5">
            {(failed || pending) && (
              <button type="button" disabled={rerun.isPending} title="Re-run OCR"
                onClick={() => rerun.mutate(receipt.id, { onError: (e) => onError((e as Error).message) })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: '0.7rem' }}>↻</button>
            )}
            {!attached && (
              <button type="button" disabled={del.isPending} title="Delete receipt" onClick={onDelete}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '0.75rem' }}>✕</button>
            )}
          </span>
        </div>
        {receipt.ocr_legibility === 'poor' && <div className="t-danger" style={{ fontSize: '0.62rem' }}>poor legibility — verify by eye</div>}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-card)',
};
