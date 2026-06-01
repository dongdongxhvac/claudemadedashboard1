// Vendor access / escort log for one building.
//
// Open INSERT to all authenticated users (engineers escort vendors and need
// to log directly), UPDATE/DELETE locked to admin/lead.
//
// Vendor-name dropdown is a typeahead populated from past visits across all
// buildings — the same handful of vendors come back month after month, so
// typing once should be enough.
import { useMemo, useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingVendorVisits,
  useVendorNameSuggestions,
  useInsertVendorVisit,
  useDeleteVendorVisit,
  VISIT_TYPES,
  type VisitType,
  type BuildingVendorVisit,
} from '../../hooks/useBuildingKb';

function todayLocalISO(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
}

function fmtVisitDate(iso: string): string {
  // visit_date is a DATE; treat as local to avoid the UTC-rollback bug.
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function VendorVisitsPanel({ buildingId }: { buildingId: string }) {
  const canEditAll = useCanAccessAdmin();
  const visitsQ = useBuildingVendorVisits(buildingId, 90);
  const suggestionsQ = useVendorNameSuggestions();
  const insertVisit = useInsertVendorVisit();
  const deleteVisit = useDeleteVendorVisit();

  const [vendorName, setVendorName] = useState('');
  const [visitType, setVisitType] = useState<VisitType>('escort');
  const [visitDate, setVisitDate] = useState(todayLocalISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!vendorName.trim()) {
      setError('Vendor name is required.');
      return;
    }
    try {
      await insertVisit.mutateAsync({
        building_id: buildingId,
        vendor_name: vendorName,
        visit_type: visitType,
        visit_date: visitDate,
        note,
      });
      // Reset form for the next entry — same engineer often logs several
      // vendors in a row during a single walk.
      setVendorName('');
      setNote('');
      setVisitType('escort');
      setVisitDate(todayLocalISO());
    } catch (err) {
      // Most likely cause: unique constraint violation (already logged).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('building_vendor_visits_uniq')) {
        setError(
          `${vendorName} is already logged at this building for ${fmtVisitDate(visitDate)}.`,
        );
      } else {
        setError(msg);
      }
    }
  }

  const visits = visitsQ.data ?? [];
  const groupedByDate = useMemo(() => {
    const m = new Map<string, BuildingVendorVisit[]>();
    for (const v of visits) {
      const list = m.get(v.visit_date) ?? [];
      list.push(v);
      m.set(v.visit_date, list);
    }
    return Array.from(m.entries()); // already sorted desc by query
  }, [visits]);

  return (
    <div>
      {/* New-visit form — always visible at top */}
      <form
        onSubmit={submit}
        className="t-card"
        style={{ padding: 14, marginBottom: 16, display: 'grid', gap: 10 }}
      >
        <div className="t-small t-muted uppercase tracking-wider">Log a vendor visit</div>

        <Field label="Vendor name (required)" hint="pick from past entries or type a new name">
          <input
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            list="vendor-name-options"
            placeholder='e.g. "Albireo Energy"'
            style={inputStyle}
            autoComplete="off"
          />
          <datalist id="vendor-name-options">
            {(suggestionsQ.data ?? []).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>

        <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(120px, 1fr) minmax(140px, 1fr)' }}>
          <Field label="Type">
            <select
              value={visitType}
              onChange={(e) => setVisitType(e.target.value as VisitType)}
              style={inputStyle}
            >
              {VISIT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="what they did / who they sent"
            style={inputStyle}
          />
        </Field>

        {error && (
          <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>
        )}

        <div>
          <button
            type="submit"
            disabled={insertVisit.isPending}
            className="t-small t-accent"
            style={{
              padding: '8px 14px',
              border: '1px solid var(--color-accent)',
              borderRadius: 4,
              background: 'var(--color-card)',
            }}
          >
            {insertVisit.isPending ? 'Logging…' : 'Log visit'}
          </button>
          <span className="t-small t-muted ml-2">
            One entry per vendor per day per building.
          </span>
        </div>
      </form>

      {/* History */}
      <div className="t-small t-muted uppercase tracking-wider mb-2">
        Last 90 days{visits.length > 0 && ` — ${visits.length} visit${visits.length === 1 ? '' : 's'}`}
      </div>
      {visitsQ.isLoading ? (
        <p className="t-text t-muted">Loading…</p>
      ) : groupedByDate.length === 0 ? (
        <p className="t-text t-muted">No vendor visits in the last 90 days.</p>
      ) : (
        groupedByDate.map(([date, dayVisits]) => (
          <div key={date} className="mb-4">
            <div className="t-small" style={{ color: 'var(--color-text)', marginBottom: 4, fontWeight: 600 }}>
              {fmtVisitDate(date)}
            </div>
            <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="t-muted">
                  <th className="text-left pb-1 pr-3">Vendor</th>
                  <th className="text-left pb-1 pr-3">Type</th>
                  <th className="text-left pb-1 pr-3">Note</th>
                  {canEditAll && <th className="text-right pb-1 pl-3"> </th>}
                </tr>
              </thead>
              <tbody>
                {dayVisits.map((v) => (
                  <tr
                    key={v.id}
                    style={{ borderTop: '1px solid var(--color-border-soft)' }}
                  >
                    <td className="py-1 pr-3" style={{ color: 'var(--color-text)' }}>{v.vendor_name}</td>
                    <td className="py-1 pr-3">
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: '0.7rem',
                          color: 'var(--color-text)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        {v.visit_type}
                      </span>
                    </td>
                    <td className="py-1 pr-3 t-muted">{v.note ?? '—'}</td>
                    {canEditAll && (
                      <td className="text-right py-1 pl-3">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`Delete ${v.vendor_name}'s ${v.visit_type} on ${fmtVisitDate(v.visit_date)}?`)) return;
                            await deleteVisit.mutateAsync({ id: v.id, building_id: v.building_id });
                          }}
                          className="t-small"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-danger)',
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <div className="t-small" style={{ color: 'var(--color-text)', marginBottom: 4 }}>
        {label}
        {hint && <span className="t-muted ml-2" style={{ fontSize: '0.7rem' }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-text)',
  font: 'inherit',
};
