// MRO — receipt pool. Capture receipts (camera or file) and tag each with
// building (or UPark site-wide), category, stock Y/N, and a short item
// label, then upload + OCR. Tags overlay each card and are editable.
// Pooled receipts feed the auto-match panel; attached ones are locked.
//   * Camera → blank tags, set by dropdown.
//   * Upload → tags prefilled from the file name (building/category/item).
import { useMemo, useRef, useState } from 'react';
import { useMe } from '../../hooks/useMe';
import { useBuildings } from '../../hooks/useBuildings';
import {
  useMroReceipts, useAttachedReceiptIds, useUploadStandaloneReceipt,
  useDeleteMroReceipt, useUpdateReceiptMeta, useTriggerMroOcr, useMroReceiptSignedUrl,
  RECEIPT_CATEGORIES,
  type MroReceiptFull, type ReceiptCategory, type ReceiptMeta,
} from '../../hooks/useMroBilling';
import { parseReceiptFilename } from '../../lib/mroReceiptFilename';

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const SITE_WIDE = 'UPARK';   // sentinel for the building <select> value

type BuildingOpt = { id: string; code: string; label: string };
type Staged = { file: File; url: string; building: string; category: ReceiptCategory | ''; isStock: boolean; item: string };

export function MroReceiptPool() {
  const me = useMe();
  const who = me.data?.full_name ?? me.data?.email ?? null;
  const receiptsQ = useMroReceipts();
  const attachedQ = useAttachedReceiptIds();
  const buildingsQ = useBuildings();
  const upload = useUploadStandaloneReceipt();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const buildings: BuildingOpt[] = useMemo(
    () => (buildingsQ.data ?? []).filter((b) => b.active)
      .map((b) => ({ id: b.id, code: (b.short_code ?? b.code) ?? '', label: `${b.short_code ?? b.code} — ${b.name}` })),
    [buildingsQ.data],
  );
  const buildingIdByCode = useMemo(() => new Map(buildings.map((b) => [b.code, b.id])), [buildings]);

  const receipts = receiptsQ.data ?? [];
  const attached = attachedQ.data ?? new Set<string>();
  const unattachedCount = useMemo(() => receipts.filter((r) => !attached.has(r.id)).length, [receipts, attached]);

  const stage = (files: FileList | null, fromCamera: boolean) => {
    if (!files) return;
    setErr(null);
    const codes = buildings.map((b) => b.code);
    const next: Staged[] = Array.from(files).map((file) => {
      const p = fromCamera ? null : parseReceiptFilename(file.name, codes);
      const building = p?.siteWide ? SITE_WIDE : (p?.buildingCode && buildingIdByCode.has(p.buildingCode) ? p.buildingCode : '');
      return { file, url: URL.createObjectURL(file), building, category: p?.category ?? '', isStock: false, item: p?.item ?? '' };
    });
    setStaged((s) => [...s, ...next]);
  };

  const setStagedField = (i: number, patch: Partial<Staged>) =>
    setStaged((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeStaged = (i: number) =>
    setStaged((s) => { URL.revokeObjectURL(s[i].url); return s.filter((_, j) => j !== i); });

  const uploadAll = async () => {
    setErr(null);
    for (const st of staged) {
      const meta: Partial<ReceiptMeta> = {
        building_id: st.building && st.building !== SITE_WIDE ? buildingIdByCode.get(st.building) ?? null : null,
        site_wide: st.building === SITE_WIDE,
        category: st.category || null,
        is_stock: st.isStock,
        item_label: st.item || null,
      };
      try { await upload.mutateAsync({ file: st.file, uploadedBy: who, meta }); }
      catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed.'); return; }
    }
    staged.forEach((s) => URL.revokeObjectURL(s.url));
    setStaged([]);
  };

  return (
    <div className="t-card" style={{ padding: '1rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="t-small t-muted uppercase tracking-wider">
          Receipt pool · {receipts.length} total · {unattachedCount} unattached
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={(e) => { stage(e.target.files, false); e.target.value = ''; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { stage(e.target.files, true); e.target.value = ''; }} />
          <button type="button" onClick={() => camRef.current?.click()} className="t-small t-accent" style={btn}>📷 Camera</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="t-small t-accent" style={btn}>⤒ Upload</button>
        </div>
      </div>

      {err && <p className="t-small t-danger mb-2">{err}</p>}

      {/* Staging — tag each before uploading */}
      {staged.length > 0 && (
        <div className="mb-3" style={{ border: '1px solid var(--color-accent)', borderRadius: 6, padding: '0.6rem' }}>
          <div className="t-small t-muted mb-2">Tag {staged.length} receipt{staged.length === 1 ? '' : 's'}, then upload · upload names prefill building/category/item</div>
          <div className="space-y-2">
            {staged.map((st, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap t-small" style={{ borderTop: i ? '1px solid var(--color-border-soft)' : 'none', paddingTop: i ? 6 : 0 }}>
                <img src={st.url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--color-border)' }} />
                <select value={st.building} onChange={(e) => setStagedField(i, { building: e.target.value })} style={sel}>
                  <option value="">building…</option>
                  <option value={SITE_WIDE}>UPark (site-wide)</option>
                  {buildings.map((b) => <option key={b.id} value={b.code}>{b.label}</option>)}
                </select>
                <select value={st.category} onChange={(e) => setStagedField(i, { category: e.target.value as ReceiptCategory | '' })} style={sel}>
                  <option value="">category…</option>
                  {RECEIPT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="flex items-center gap-1 t-muted" title="Part stock?">
                  <input type="checkbox" checked={st.isStock} onChange={(e) => setStagedField(i, { isStock: e.target.checked })} /> stock
                </label>
                <input type="text" value={st.item} onChange={(e) => setStagedField(i, { item: e.target.value })}
                  placeholder="item (e.g. actuator)" style={{ ...sel, width: 170 }} />
                <button type="button" onClick={() => removeStaged(i)} className="t-muted hover:t-danger" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" disabled={upload.isPending} onClick={uploadAll} className="t-small t-accent" style={btn}>
              {upload.isPending ? 'Uploading + reading…' : `Upload ${staged.length}`}
            </button>
            <button type="button" disabled={upload.isPending} onClick={() => { staged.forEach((s) => URL.revokeObjectURL(s.url)); setStaged([]); }}
              className="t-small t-muted" style={{ ...btn, borderColor: 'var(--color-border)' }}>Cancel</button>
          </div>
        </div>
      )}

      {receiptsQ.isLoading ? <p className="t-small t-muted">Loading…</p>
        : receipts.length === 0 ? <p className="t-small t-muted">No receipts yet. Upload or snap one — OCR runs automatically.</p>
        : (
        <div className="flex flex-wrap gap-2">
          {receipts.map((r) => (
            <ReceiptCard key={r.id} receipt={r} attached={attached.has(r.id)} buildings={buildings} onError={setErr} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiptCard({ receipt, attached, buildings, onError }: {
  receipt: MroReceiptFull; attached: boolean; buildings: BuildingOpt[]; onError: (m: string | null) => void;
}) {
  const sig = useMroReceiptSignedUrl(receipt.storage_path);
  const del = useDeleteMroReceipt();
  const rerun = useTriggerMroOcr();
  const meta = useUpdateReceiptMeta();
  const [editing, setEditing] = useState(false);

  const failed = receipt.ocr_status === 'failed';
  const pending = receipt.ocr_status === 'pending';
  const buildingLabel = receipt.site_wide ? 'UPark' : (receipt.building?.short_code ?? null);
  const buildingCode = receipt.building?.short_code ?? '';

  const onDelete = () => {
    if (!confirm('Delete this receipt? This removes the image and its OCR data.')) return;
    onError(null);
    del.mutate({ id: receipt.id, storagePath: receipt.storage_path }, { onError: (e) => onError((e as Error).message) });
  };

  const patch = (p: Partial<ReceiptMeta>) => meta.mutate({ id: receipt.id, patch: p }, { onError: (e) => onError((e as Error).message) });

  return (
    <div style={{ width: 178, border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden', background: 'var(--color-card)' }}>
      <a href={sig.data ?? undefined} target="_blank" rel="noreferrer" style={{ display: 'block', height: 96, background: 'var(--color-bg)', position: 'relative' }}>
        {sig.data
          ? <img src={sig.data} alt="receipt" style={{ width: '100%', height: 96, objectFit: 'cover' }} />
          : <div className="t-muted t-small flex items-center justify-center" style={{ height: 96 }}>img…</div>}
        {/* tag overlay */}
        {(buildingLabel || receipt.category || receipt.item_label) && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.62rem', padding: '2px 5px', lineHeight: 1.3 }}>
            <span style={{ fontWeight: 700 }}>{buildingLabel ?? '—'}</span>
            {receipt.category && <span> · {receipt.category}</span>}
            {receipt.is_stock != null && <span> · {receipt.is_stock ? 'stock' : 'non-stock'}</span>}
            {receipt.item_label && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{receipt.item_label}</div>}
          </div>
        )}
      </a>
      <div style={{ padding: '5px 7px', fontSize: '0.72rem', lineHeight: 1.35 }}>
        <div className="flex items-baseline justify-between">
          <span className="t-mono" style={{ fontWeight: 700 }}>{money(receipt.extracted_total)}</span>
          <button type="button" onClick={() => setEditing((v) => !v)} className="t-accent" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.62rem' }}>
            {editing ? 'done' : 'tag'}
          </button>
        </div>
        <div className="t-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={receipt.extracted_merchant ?? ''}>{receipt.extracted_merchant ?? '—'}</div>

        {editing && (
          <div className="space-y-1 mt-1">
            <select value={receipt.site_wide ? SITE_WIDE : buildingCode} onChange={(e) => {
              const v = e.target.value;
              if (v === SITE_WIDE) patch({ site_wide: true, building_id: null });
              else patch({ site_wide: false, building_id: buildings.find((b) => b.code === v)?.id ?? null });
            }} style={{ ...sel, width: '100%' }}>
              <option value="">building…</option>
              <option value={SITE_WIDE}>UPark (site-wide)</option>
              {buildings.map((b) => <option key={b.id} value={b.code}>{b.label}</option>)}
            </select>
            <select value={receipt.category ?? ''} onChange={(e) => patch({ category: (e.target.value || null) as ReceiptCategory | null })} style={{ ...sel, width: '100%' }}>
              <option value="">category…</option>
              {RECEIPT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1 t-muted"><input type="checkbox" checked={!!receipt.is_stock} onChange={(e) => patch({ is_stock: e.target.checked })} /> part stock</label>
            <input type="text" defaultValue={receipt.item_label ?? ''} placeholder="item" style={{ ...sel, width: '100%' }}
              onBlur={(e) => { if ((e.target.value.trim() || null) !== receipt.item_label) patch({ item_label: e.target.value }); }} />
          </div>
        )}

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
const sel: React.CSSProperties = {
  padding: '2px 5px', borderRadius: 4, border: '1px solid var(--color-border)',
  background: 'var(--color-card)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.72rem', maxWidth: 150,
};
