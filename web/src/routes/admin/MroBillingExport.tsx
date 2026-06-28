// MRO Phase 7 — billing output. Group verified charges by building → MEP,
// apply the cost-plus markup, show grand totals, render receipt thumbnails
// (flag missing), and export a billable CSV + a printable statement. Only
// verified charges are billed; exceptions are surfaced separately.
import { useMemo, useState } from 'react';
import {
  useMroCharges, useMroReceiptSignedUrl, type MroCharge,
} from '../../hooks/useMroBilling';
import { buildBillingModel, billingCsv, type BillingModel } from '../../lib/mroBilling';

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function MroBillingExport() {
  const chargesQ = useMroCharges(); // all statuses; model filters to verified
  const [markup, setMarkup] = useState(5);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const charges = useMemo(() => {
    const all = chargesQ.data ?? [];
    return all.filter((c) => {
      if (start && (c.txn_date ?? '') < start) return false;
      if (end && (c.txn_date ?? '') > end) return false;
      return true;
    });
  }, [chargesQ.data, start, end]);

  const model = useMemo(() => buildBillingModel(charges, markup), [charges, markup]);

  const exportCsv = () => {
    const csv = billingCsv(model);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mro-billing${start ? `_${start}` : ''}${end ? `_${end}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="t-card" style={{ padding: '1rem' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div className="t-small t-muted uppercase tracking-wider">Billing export · verified charges only</div>
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: '0.8rem' }}>
          <label className="t-muted">Markup</label>
          <input type="number" min={0} step={0.5} value={markup}
            onChange={(e) => setMarkup(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 56, ...inp }} />
          <span className="t-muted">%</span>
          <span style={{ width: 6 }} />
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inp} />
          <span className="t-muted">→</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inp} />
          <button type="button" onClick={exportCsv} disabled={model.grand.count === 0}
            className="t-small t-accent" style={{ padding: '5px 12px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-card)' }}>⤓ CSV</button>
          <button type="button" onClick={() => printStatement(model, start, end)} disabled={model.grand.count === 0}
            className="t-small t-accent" style={{ padding: '5px 12px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-card)' }}>⎙ Print</button>
        </div>
      </div>

      {/* Grand total */}
      <div className="flex gap-3 flex-wrap mb-3">
        <Total label="Cost" value={model.grand.cost} />
        <Total label={`Markup (${markup}%)`} value={model.grand.markup} tone="accent" />
        <Total label="Billable" value={model.grand.billable} tone="ok" big />
        <Total label="Lines" value={model.grand.count} plain />
      </div>

      {model.missingReceiptCount > 0 && (
        <p className="t-small t-danger mb-2">⚠ {model.missingReceiptCount} verified line(s) have no receipt attached — review before billing.</p>
      )}

      {chargesQ.isLoading ? <p className="t-small t-muted">Loading…</p>
        : model.grand.count === 0 ? <p className="t-small t-muted">No verified charges in range. Verify charges in the workbench above.</p>
        : model.buildings.map((b) => (
          <div key={b.buildingKey} className="mb-3">
            <div className="t-small mb-1" style={{ fontWeight: 700, borderBottom: '1px solid var(--color-border)', paddingBottom: 2 }}>
              {b.buildingLabel}
              <span className="t-muted ml-2" style={{ fontWeight: 400 }}>
                {b.count} line{b.count === 1 ? '' : 's'} · cost {money(b.cost)} · billable <b>{money(b.billable)}</b>
              </span>
            </div>
            {b.meps.map((m) => (
              <div key={m.mep} className="mb-1">
                <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.62rem', marginLeft: 4 }}>
                  {m.mep} · {money(m.cost)} → {money(m.billable)}
                </div>
                <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    {m.lines.map((l) => (
                      <tr key={l.charge.id} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                        <td className="py-0.5 pr-2 t-muted" style={{ width: 78 }}>{l.charge.txn_date}</td>
                        <td className="py-0.5 pr-2" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.charge.merchant ?? ''}>{l.charge.merchant}</td>
                        <td className="py-0.5 px-2"><ReceiptDot charge={l.charge} /></td>
                        <td className="py-0.5 px-2 text-right t-muted">{money(l.cost)}</td>
                        <td className="py-0.5 pl-2 text-right" style={{ fontWeight: 600 }}>{money(l.billable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}

      {model.flagged.length > 0 && (
        <div className="mt-4" style={{ borderTop: '1px dashed var(--color-border)', paddingTop: '0.6rem' }}>
          <div className="t-small mb-1" style={{ fontWeight: 600, color: 'var(--color-warn, #d97706)' }}>
            Flagged — not billed ({model.flagged.length})
          </div>
          {model.flagged.map((c) => (
            <div key={c.id} className="t-small flex items-center gap-2" style={{ padding: '1px 0' }}>
              <span className="t-mono t-muted" style={{ width: 78 }}>{c.txn_date}</span>
              <span style={{ minWidth: 160 }}>{c.merchant}</span>
              <span className="t-mono t-muted">{money(c.amount)}</span>
              <span className="t-mono" style={{ color: 'var(--color-warn, #d97706)' }}>{c.exception_reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiptDot({ charge }: { charge: MroCharge }) {
  const sig = useMroReceiptSignedUrl(charge.receipt?.storage_path);
  if (!charge.receipt_id) return <span className="t-danger" style={{ fontSize: '0.65rem' }}>⚠ MISSING</span>;
  return sig.data
    ? <a href={sig.data} target="_blank" rel="noreferrer"><img src={sig.data} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--color-border)' }} /></a>
    : <span className="t-muted" style={{ fontSize: '0.65rem' }}>✓</span>;
}

function Total({ label, value, tone, big, plain }: { label: string; value: number; tone?: 'ok' | 'accent'; big?: boolean; plain?: boolean }) {
  const color = tone === 'ok' ? 'var(--color-ok, #10b981)' : tone === 'accent' ? 'var(--color-accent)' : 'var(--color-text)';
  return (
    <div className="t-card" style={{ padding: '0.5rem 0.9rem', minWidth: 120 }}>
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.6rem' }}>{label}</div>
      <div className="t-mono" style={{ fontSize: big ? '1.5rem' : '1.1rem', fontWeight: 700, color }}>
        {plain ? value : money(value)}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)',
  background: 'var(--color-card)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.8rem',
};

// ── printable statement (isolated window) ──
function printStatement(model: BillingModel, start: string, end: string) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const period = start || end ? `${start || '…'} → ${end || '…'}` : 'all verified charges';

  const buildingsHtml = model.buildings.map((b) => `
    <h3>${esc(b.buildingLabel)} <span class="muted">— billable ${fmt(b.billable)}</span></h3>
    ${b.meps.map((m) => `
      <div class="mep">${esc(m.mep)} — cost ${fmt(m.cost)} → billable ${fmt(m.billable)}</div>
      <table>
        <thead><tr><th>Date</th><th>Vendor</th><th>Cardholder</th><th>Receipt</th><th class="r">Cost</th><th class="r">Billable</th></tr></thead>
        <tbody>
        ${m.lines.map((l) => `<tr>
          <td>${esc(l.charge.txn_date ?? '')}</td>
          <td>${esc(l.charge.merchant ?? '')}</td>
          <td>${esc(l.charge.cardholder ?? '')}</td>
          <td>${l.hasReceipt ? 'attached' : '<b style="color:#b91c1c">MISSING</b>'}</td>
          <td class="r">${fmt(l.cost)}</td>
          <td class="r">${fmt(l.billable)}</td>
        </tr>`).join('')}
        </tbody>
      </table>`).join('')}
  `).join('');

  const flaggedHtml = model.flagged.length ? `
    <h3 class="flag">Flagged — not billed (${model.flagged.length})</h3>
    <table><tbody>${model.flagged.map((c) => `<tr><td>${esc(c.txn_date ?? '')}</td><td>${esc(c.merchant ?? '')}</td><td class="r">${fmt(c.amount)}</td><td>${esc(c.exception_reason ?? '')}</td></tr>`).join('')}</tbody></table>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>MRO Billing Statement</title>
    <style>
      body{font:13px -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;}
      h1{font-size:18px;margin:0 0 2px;} h3{font-size:14px;margin:18px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px;}
      h3.flag{color:#b45309;} .mep{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:6px 0 2px;}
      .muted{color:#777;font-weight:400;} table{width:100%;border-collapse:collapse;margin-bottom:6px;}
      th,td{text-align:left;padding:2px 6px;border-bottom:1px solid #eee;font-size:12px;} th{color:#666;font-weight:600;}
      .r{text-align:right;font-variant-numeric:tabular-nums;}
      .grand{margin-top:10px;padding:8px 12px;background:#f4f4f5;border-radius:6px;display:inline-block;}
      .grand b{font-size:16px;}
    </style></head><body>
    <h1>MRO Reimbursable Billing Statement</h1>
    <div class="muted">Period: ${esc(period)} · Markup ${model.markupPct}% · Generated ${new Date().toLocaleString('en-US')}</div>
    <div class="grand">Cost ${fmt(model.grand.cost)} &nbsp;+&nbsp; Markup ${fmt(model.grand.markup)} &nbsp;=&nbsp; <b>Billable ${fmt(model.grand.billable)}</b> &nbsp;(${model.grand.count} lines)</div>
    ${buildingsHtml}
    ${flaggedHtml}
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print the statement.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
