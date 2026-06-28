// MRO Phase 4 — card-charge CSV import. Pick a portal export → auto-detect
// columns → preview the mapping + rows → load into mro_card_charges
// (dedup on the Document/transaction id). Dashboard house style.
import { useMemo, useRef, useState } from 'react';
import { useMe } from '../../hooks/useMe';
import { useImportMroCsv, type MroImportResult } from '../../hooks/useMroBilling';
import {
  parseChargeCsv,
  type ParsedCsv,
  type MroChargeField,
} from '../../lib/mroCsv';

const FIELD_LABELS: Record<MroChargeField, string> = {
  external_ref: 'Reference (dedup)',
  txn_date: 'Purchase date',
  post_date: 'Post date',
  cardholder: 'Cardholder',
  amount: 'Amount',
  merchant: 'Merchant',
  card_last4: 'Card last-4',
};
const FIELD_ORDER: MroChargeField[] = [
  'txn_date', 'post_date', 'merchant', 'amount', 'cardholder', 'card_last4', 'external_ref',
];

function fmtMoney(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function MroCsvImport() {
  const me = useMe();
  const importMut = useImportMroCsv();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<MroImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null); setResult(null);
    try {
      const text = await file.text();
      const p = parseChargeCsv(text);
      setParsed(p);
      setFileName(file.name);
      setSource(file.name.replace(/\.csv$/i, ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    }
  };

  const noAmountCount = useMemo(
    () => (parsed?.charges ?? []).filter((c) => c.amount === null).length,
    [parsed],
  );
  const blocked = !parsed || parsed.missingFields.length > 0 || parsed.charges.length === 0;

  const doImport = async () => {
    if (!parsed) return;
    setError(null);
    try {
      const res = await importMut.mutateAsync({
        source,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        charges: parsed.charges,
        createdBy: me.data?.full_name ?? me.data?.email ?? null,
      });
      setResult(res);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  return (
    <div className="t-card" style={{ padding: '1rem', maxWidth: 940 }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="t-small t-muted uppercase tracking-wider">Import card charges (CSV)</div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          className="t-small"
        />
      </div>

      {error && <p className="t-small t-danger mb-2">{error}</p>}

      {result && (
        result.inserted === 0 && (result.skipped > 0 || result.noAmount > 0) ? (
          <div className="t-small mb-2 t-muted">
            This file was entirely already loaded — nothing new added
            ({result.skipped} duplicate{result.skipped === 1 ? '' : 's'}
            {result.noAmount > 0 && `, ${result.noAmount} no-amount`}).
          </div>
        ) : (
          <div className="t-small mb-2" style={{ color: 'var(--color-ok, #10b981)' }}>
            ✓ Imported <b>{result.inserted}</b> charge{result.inserted === 1 ? '' : 's'}
            {result.skipped > 0 && <> · <span className="t-muted">{result.skipped} already loaded (skipped)</span></>}
            {result.noAmount > 0 && <> · <span style={{ color: 'var(--color-warn, #d97706)' }}>{result.noAmount} no-amount rows dropped</span></>}
          </div>
        )
      )}

      {parsed && (
        <>
          {/* Detected mapping */}
          <div className="mb-3">
            <div className="t-small t-muted mb-1">
              {fileName} · {parsed.charges.length} rows
              {parsed.periodStart && <> · {parsed.periodStart} → {parsed.periodEnd}</>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_ORDER.map((f) => {
                const idx = parsed.mapping[f];
                const found = idx !== undefined;
                const required = f === 'amount' || f === 'merchant' || f === 'txn_date';
                return (
                  <span
                    key={f}
                    className="t-small t-mono"
                    style={{
                      padding: '2px 8px', borderRadius: 4,
                      border: '1px solid var(--color-border)',
                      background: found ? 'var(--color-card)' : 'transparent',
                      color: found ? 'var(--color-text)' : (required ? 'var(--color-danger)' : 'var(--color-text-muted)'),
                    }}
                    title={found ? `${FIELD_LABELS[f]} ← "${parsed.headers[idx!]}"` : `${FIELD_LABELS[f]} not detected`}
                  >
                    {FIELD_LABELS[f]} {found ? `← ${parsed.headers[idx!]}` : (required ? '✗ missing' : '—')}
                  </span>
                );
              })}
            </div>
          </div>

          {parsed.missingFields.length > 0 && (
            <p className="t-small t-danger mb-2">
              Can't import — required column(s) not detected: {parsed.missingFields.join(', ')}.
            </p>
          )}
          {noAmountCount > 0 && (
            <p className="t-small mb-2" style={{ color: 'var(--color-warn, #d97706)' }}>
              {noAmountCount} row(s) have no parseable amount and will be dropped.
            </p>
          )}

          {/* Preview (first 10) */}
          <div className="overflow-x-auto mb-3">
            <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="t-muted">
                  <th className="text-left pb-1 pr-3">Purchase</th>
                  <th className="text-left pb-1 pr-3">Merchant</th>
                  <th className="text-right pb-1 px-2">Amount</th>
                  <th className="text-left pb-1 px-2">Cardholder</th>
                  <th className="text-left pb-1 px-2">Card</th>
                  <th className="text-left pb-1 pl-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {parsed.charges.slice(0, 10).map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--color-border-soft)' }}>
                    <td className="py-1 pr-3 t-muted">{c.txn_date ?? '—'}</td>
                    <td className="py-1 pr-3" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.merchant ?? ''}>
                      {c.merchant ?? '—'}
                    </td>
                    <td className="text-right px-2 py-1" style={{ color: c.amount === null ? 'var(--color-danger)' : undefined }}>
                      {fmtMoney(c.amount)}
                    </td>
                    <td className="px-2 py-1 t-muted">{c.cardholder ?? '—'}</td>
                    <td className="px-2 py-1 t-muted">{c.card_last4 ?? '—'}</td>
                    <td className="pl-2 py-1 t-muted" style={{ fontSize: '0.7rem' }}>{c.external_ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.charges.length > 10 && (
              <p className="t-small t-muted mt-1">…and {parsed.charges.length - 10} more.</p>
            )}
          </div>

          {/* Source + import */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="t-small t-muted">Source</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="card portal name"
              style={{
                padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)',
                background: 'var(--color-card)', color: 'var(--color-text)', font: 'inherit', fontSize: '0.8rem', width: 240,
              }}
            />
            <button
              type="button"
              onClick={doImport}
              disabled={blocked || importMut.isPending}
              className="t-small t-accent"
              style={{
                padding: '6px 14px', border: '1px solid var(--color-accent)', borderRadius: 4,
                background: 'var(--color-card)', opacity: (blocked || importMut.isPending) ? 0.5 : 1,
              }}
            >
              {importMut.isPending ? 'Importing…' : `Import ${parsed.charges.filter((c) => c.amount !== null).length} charges`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
