// MRO Billing — reimbursable maintenance/repair/operations purchases on a
// cost-plus contract. Company-card charges + receipt photos → reclass to a
// contracted building + MEP category → markup → bill the client (BMR).
//
// Phased build (see the module spec). This is the Phase-1 shell: schema +
// RLS exist (migration 0085, mro_* tables, admin/manager-gated); the
// pipeline UI fills in over the following phases. Built in the dashboard's
// own house style (CSS theme variables), not a separate palette.
import { useMroPipelineCounts } from '../../hooks/useMroBilling';
import { MroCsvImport } from './MroCsvImport';
import { MroChargesWorkbench } from './MroChargesWorkbench';

const PHASES: { n: number; title: string; done: boolean }[] = [
  { n: 1, title: 'Schema + RLS (mro_import_batches · mro_receipts · mro_card_charges)', done: true },
  { n: 2, title: 'Receipt storage bucket + signed-URL reads', done: true },
  { n: 3, title: 'OCR Edge Function (Claude vision extraction) — deployed; needs ANTHROPIC_API_KEY secret', done: true },
  { n: 4, title: 'CSV import → card charges (auto-detect columns)', done: true },
  { n: 5, title: 'Matching / verification engine (scored, tiered, 13 checks pass)', done: true },
  { n: 6, title: 'Reclass + verification UI — 6a charge list/upload/verify (6b: scored match panel)', done: true },
  { n: 7, title: 'Billing export (grouped + CSV / print)', done: false },
];

export function MroBillingTab() {
  const counts = useMroPipelineCounts();

  return (
    <div>
      <div className="mb-1">
        <h2 className="t-section-title">MRO Billing</h2>
        <p className="t-small t-muted">
          reimbursable MRO purchases on a cost-plus contract · capture → reclass → verify → bill ·
          admin + manager only
        </p>
      </div>

      {/* Live pipeline counts — proves the schema + RLS are wired. */}
      <div className="flex gap-3 flex-wrap my-4">
        <CountTile label="Import batches" value={counts.data?.batches} loading={counts.isLoading} />
        <CountTile label="Receipts" value={counts.data?.receipts} loading={counts.isLoading} />
        <CountTile label="Card charges" value={counts.data?.charges} loading={counts.isLoading} />
        <CountTile label="Unreviewed" value={counts.data?.unreviewed} loading={counts.isLoading} tone="warn" />
        <CountTile label="Verified" value={counts.data?.verified} loading={counts.isLoading} tone="ok" />
        <CountTile label="Exceptions" value={counts.data?.exceptions} loading={counts.isLoading} tone="bad" />
      </div>

      {counts.error && (
        <p className="t-small t-danger mb-3">
          Error reading MRO tables: {(counts.error as Error).message}
        </p>
      )}

      <div className="mb-4">
        <MroCsvImport />
      </div>

      <div className="mb-4">
        <MroChargesWorkbench />
      </div>

      {/* Build roadmap — so the tab reads as intentionally in-progress. */}
      <div className="t-card" style={{ padding: '1rem', maxWidth: 720 }}>
        <div className="t-small t-muted uppercase tracking-wider mb-2">Build status</div>
        <ul className="space-y-1">
          {PHASES.map((p) => (
            <li key={p.n} className="flex items-baseline gap-2 t-small">
              <span style={{ color: p.done ? 'var(--color-ok, #10b981)' : 'var(--color-text-muted)', width: 16 }}>
                {p.done ? '✓' : '○'}
              </span>
              <span style={{ color: p.done ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                Phase {p.n} — {p.title}
              </span>
            </li>
          ))}
        </ul>
        <p className="t-small t-muted mt-3" style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: '0.6rem' }}>
          Cost-plus markup, the 1:1 receipt↔charge invariant, the verified-only billing gate,
          and the full audit trail are enforced as the pipeline phases land. Nothing reaches a
          client export until it is verified or a recorded exception.
        </p>
      </div>
    </div>
  );
}

function CountTile({
  label, value, loading, tone,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'ok' ? 'var(--color-ok, #10b981)' :
    tone === 'warn' ? 'var(--color-warn, #d97706)' :
    tone === 'bad' ? 'var(--color-danger)' :
    'var(--color-text)';
  return (
    <div
      className="t-card"
      style={{ padding: '0.6rem 0.9rem', minWidth: 110 }}
    >
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.62rem' }}>{label}</div>
      <div className="t-mono" style={{ fontSize: '1.4rem', fontWeight: 700, color }}>
        {loading ? '…' : (value ?? 0)}
      </div>
    </div>
  );
}
