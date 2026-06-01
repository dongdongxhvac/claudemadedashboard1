// Structured parts catalog for one building. Replaces the free-text
// Inventory section with a queryable list of filters, belts, oils, etc.
//
// Parts can be linked to a specific piece of equipment (equipment_id) or
// be building-level (equipment_id = null). The form lets you pick from
// the building's equipment list or leave it general.
import { useMemo, useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingParts,
  useBuildingEquipment,
  useUpsertBuildingPart,
  useDeleteBuildingPart,
  PART_TYPES,
  type BuildingPart,
  type PartType,
} from '../../hooks/useBuildingKb';

export function PartsPanel({ buildingId }: { buildingId: string }) {
  const canEdit = useCanAccessAdmin();
  const partsQ = useBuildingParts(buildingId);
  const eqQ = useBuildingEquipment(buildingId);
  const del = useDeleteBuildingPart();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  // Sectional grouping: parts by linked equipment, plus a "Building-level"
  // catch-all for the unlinked ones. Engineers usually look up parts in
  // the context of an equipment they're standing in front of.
  const grouped = useMemo(() => {
    const parts = partsQ.data ?? [];
    const eqById = new Map((eqQ.data ?? []).map((e) => [e.id, e]));
    const groups = new Map<string, { label: string; rows: BuildingPart[] }>();
    const generalKey = '__general__';
    groups.set(generalKey, { label: 'Building-level (no equipment)', rows: [] });
    for (const p of parts) {
      if (p.equipment_id && eqById.has(p.equipment_id)) {
        const eq = eqById.get(p.equipment_id)!;
        const k = p.equipment_id;
        const g = groups.get(k) ?? { label: eq.full_name, rows: [] as BuildingPart[] };
        g.rows.push(p);
        groups.set(k, g);
      } else {
        groups.get(generalKey)!.rows.push(p);
      }
    }
    // Order: equipment groups (alphabetical), then general at the end.
    return Array.from(groups.entries())
      .filter(([, g]) => g.rows.length > 0)
      .sort(([keyA, gA], [keyB, gB]) => {
        if (keyA === generalKey) return 1;
        if (keyB === generalKey) return -1;
        return gA.label.localeCompare(gB.label);
      });
  }, [partsQ.data, eqQ.data]);

  if (partsQ.isLoading) {
    return <p className="t-text t-muted">Loading parts…</p>;
  }
  if (partsQ.error) {
    return <p className="t-text t-danger">Error: {(partsQ.error as Error).message}</p>;
  }

  return (
    <div>
      {canEdit && !addingNew && !editingId && (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          className="t-small t-accent"
          style={{
            padding: '8px 14px',
            border: '1px solid var(--color-accent)',
            borderRadius: 4,
            background: 'var(--color-card)',
            marginBottom: 12,
          }}
        >
          + Add part
        </button>
      )}

      {addingNew && (
        <PartForm
          buildingId={buildingId}
          equipmentOptions={eqQ.data ?? []}
          onClose={() => setAddingNew(false)}
        />
      )}

      {(partsQ.data ?? []).length === 0 && !addingNew && (
        <p className="t-text t-muted">
          No parts recorded yet.{canEdit ? ' Click "Add part" to start.' : ''}
        </p>
      )}

      {grouped.map(([key, group]) => (
        <div key={key} className="mb-5">
          <div className="t-small t-muted uppercase tracking-wider mb-2">
            {group.label} <span className="t-text">— {group.rows.length}</span>
          </div>
          <table className="t-mono t-small w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="t-muted">
                <th className="text-left pb-1 pr-3">Name</th>
                <th className="text-left pb-1 pr-3">Type</th>
                <th className="text-left pb-1 pr-3">Spec</th>
                <th className="text-right pb-1 px-2">Qty</th>
                <th className="text-left pb-1 pl-3">Location</th>
                {canEdit && <th className="text-right pb-1 pl-3"> </th>}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((p) =>
                editingId === p.id ? (
                  <tr key={p.id}>
                    <td colSpan={canEdit ? 6 : 5}>
                      <PartForm
                        buildingId={buildingId}
                        equipmentOptions={eqQ.data ?? []}
                        existing={p}
                        onClose={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={p.id}
                    style={{ borderTop: '1px solid var(--color-border-soft)' }}
                  >
                    <td className="py-1 pr-3" style={{ color: 'var(--color-text)' }}>{p.name}</td>
                    <td className="py-1 pr-3 t-muted">{p.part_type ?? '—'}</td>
                    <td className="py-1 pr-3">{p.spec ?? '—'}</td>
                    <td className="text-right px-2 py-1">{p.quantity ?? '—'}</td>
                    <td className="py-1 pl-3 t-muted">{p.location_note ?? '—'}</td>
                    {canEdit && (
                      <td className="text-right py-1 pl-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(p.id)}
                          className="t-small t-accent"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: 8 }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`Remove ${p.name}? (Soft delete.)`)) return;
                            await del.mutateAsync({ id: p.id, building_id: p.building_id });
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
                ),
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function PartForm({
  buildingId,
  equipmentOptions,
  existing,
  onClose,
}: {
  buildingId: string;
  equipmentOptions: { id: string; full_name: string }[];
  existing?: BuildingPart;
  onClose: () => void;
}) {
  const upsert = useUpsertBuildingPart();
  const [name, setName] = useState(existing?.name ?? '');
  const [partType, setPartType] = useState<PartType>(existing?.part_type ?? 'filter');
  const [spec, setSpec] = useState(existing?.spec ?? '');
  const [quantity, setQuantity] = useState<string>(
    existing?.quantity != null ? String(existing.quantity) : '',
  );
  const [locationNote, setLocationNote] = useState(existing?.location_note ?? '');
  const [equipmentId, setEquipmentId] = useState<string>(existing?.equipment_id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    try {
      const qty = quantity.trim() ? Number(quantity) : null;
      if (qty !== null && Number.isNaN(qty)) {
        setError('Quantity must be a number.');
        return;
      }
      await upsert.mutateAsync({
        id: existing?.id,
        building_id: buildingId,
        equipment_id: equipmentId || null,
        name: name.trim(),
        part_type: partType,
        spec: spec.trim() || null,
        quantity: qty,
        location_note: locationNote.trim() || null,
        sort_order: existing?.sort_order ?? 0,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      onSubmit={submit}
      className="t-card"
      style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 10 }}
    >
      <div className="t-small t-muted uppercase tracking-wider">
        {existing ? 'Edit part' : 'Add part'}
      </div>

      <Field label="Name (required)" hint='e.g. "MERV 13 filter", "Drive belt"'>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus required style={inputStyle} />
      </Field>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(120px, 1fr) minmax(140px, 1fr)' }}>
        <Field label="Type">
          <select value={partType} onChange={(e) => setPartType(e.target.value as PartType)} style={inputStyle}>
            {PART_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Quantity on hand" hint="leave blank if unknown">
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min={0} style={inputStyle} />
        </Field>
      </div>

      <Field label="Spec" hint='e.g. "20x25x4", "B-67", "SAE 30"'>
        <input type="text" value={spec} onChange={(e) => setSpec(e.target.value)} style={inputStyle} />
      </Field>

      <Field label="Linked equipment (optional)" hint="leave blank for building-level inventory">
        <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} style={inputStyle}>
          <option value="">(none — building-level)</option>
          {equipmentOptions.map((eq) => (
            <option key={eq.id} value={eq.id}>{eq.full_name}</option>
          ))}
        </select>
      </Field>

      <Field label="Location" hint='e.g. "shelf B, mech room"'>
        <input type="text" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} style={inputStyle} />
      </Field>

      {error && <div className="t-small" style={{ color: 'var(--color-danger)' }}>{error}</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={upsert.isPending}
          className="t-small t-accent"
          style={{
            padding: '8px 14px',
            border: '1px solid var(--color-accent)',
            borderRadius: 4,
            background: 'var(--color-card)',
          }}
        >
          {upsert.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add part'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="t-small t-muted"
          style={{
            padding: '8px 14px',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            background: 'transparent',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
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
