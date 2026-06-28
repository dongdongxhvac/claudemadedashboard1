// /field/receipt?k=<token> — login-free field receipt capture (shared link).
//
// Standalone kiosk-style page: a tech with no dashboard account opens this
// link, snaps a receipt, tags it, and submits. It posts to the
// mro-field-upload edge function (token-gated, server-side insert). Nothing
// here touches the database directly; no login. The receipt lands in the
// pool for a manager to match → verify → bill.
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { reencodeToJpeg } from '../../lib/mroImage';
import { RECEIPT_CATEGORIES } from '../../hooks/useMroBilling';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => rej(new Error('could not read image'));
    r.readAsDataURL(blob);
  });
}

export default function FieldReceipt() {
  const [params] = useSearchParams();
  const token = params.get('k') ?? '';
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [tech, setTech] = useState('');
  const [building, setBuilding] = useState('');
  const [siteWide, setSiteWide] = useState(false);
  const [category, setCategory] = useState('');
  const [isStock, setIsStock] = useState(false);
  const [item, setItem] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null); setStatus('idle');
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    setError(null);
    if (!token) { setError('This link is missing its access token — ask your manager for the correct link.'); return; }
    if (!file) { setError('Add a photo of the receipt first.'); return; }
    setStatus('sending');
    try {
      const jpeg = await reencodeToJpeg(file);          // normalizes HEIC-fail / shrinks
      const image_base64 = await blobToBase64(jpeg);
      const { data, error: fnErr } = await supabase.functions.invoke('mro-field-upload', {
        body: {
          token, image_base64, image_mime: 'image/jpeg',
          tech_name: tech.trim() || null,
          building_code: siteWide ? null : building.trim() || null,
          site_wide: siteWide,
          category: category || null,
          is_stock: isStock,
          item: item.trim() || null,
        },
      });
      if (fnErr) {
        let msg = fnErr.message;
        const ctx = (fnErr as { context?: Response }).context;
        if (ctx?.json) { try { const j = await ctx.json(); if (j?.error) msg = String(j.error); } catch { /* keep */ } }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(String(data.error));
      // Keep tech + building for the next one at the same store.
      if (preview) URL.revokeObjectURL(preview);
      setFile(null); setPreview(null); setCategory(''); setItem(''); setIsStock(false);
      setStatus('done');
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: '16px', maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '4px 0 2px' }}>📷 MRO Receipt</h1>
      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 14px' }}>
        Snap the receipt, add a couple of tags, send. No login needed.
      </p>

      {status === 'done' && (
        <div style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontWeight: 600 }}>
          ✓ Sent. Snap another if you have more.
        </div>
      )}
      {error && (
        <div style={{ background: 'rgba(248,113,113,0.15)', color: '#fca5a5', padding: '10px 12px', borderRadius: 8, marginBottom: 12 }}>{error}</div>
      )}

      {/* Image */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      {preview ? (
        <img src={preview} alt="receipt" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', background: '#020617', borderRadius: 10, marginBottom: 10 }} />
      ) : (
        <button onClick={() => camRef.current?.click()} style={{ ...bigBtn, height: 150, fontSize: '1rem' }}>📷 Tap to take a photo</button>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => camRef.current?.click()} style={smallBtn}>📷 Camera</button>
        <button onClick={() => fileRef.current?.click()} style={smallBtn}>🖼 Choose photo</button>
      </div>

      {/* Tags */}
      <Field label="Your name">
        <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="e.g. Mark D" style={inp} />
      </Field>
      <Field label="Building">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="e.g. 26" disabled={siteWide}
            style={{ ...inp, flex: 1, opacity: siteWide ? 0.5 : 1 }} />
          <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={siteWide} onChange={(e) => setSiteWide(e.target.checked)} /> UPark
          </label>
        </div>
      </Field>
      <Field label="Category">
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
          <option value="">—</option>
          {RECEIPT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="What you bought">
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. actuator, filter, fitting" style={inp} />
      </Field>
      <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 16px' }}>
        <input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} /> Restocking shop inventory
      </label>

      <button onClick={submit} disabled={status === 'sending'} style={{ ...bigBtn, background: '#22d3ee', color: '#042f2e', opacity: status === 'sending' ? 0.6 : 1 }}>
        {status === 'sending' ? 'Sending…' : 'Send receipt'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: 3 }}>{label}</div>
      {children}
    </label>
  );
}

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155',
  background: '#1e293b', color: '#e2e8f0', font: 'inherit', fontSize: '1rem', boxSizing: 'border-box',
};
const bigBtn: React.CSSProperties = {
  width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: '1.05rem', background: '#334155', color: '#e2e8f0',
};
const smallBtn: React.CSSProperties = {
  flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #334155', cursor: 'pointer',
  background: '#1e293b', color: '#cbd5e1', fontSize: '0.85rem',
};
