// Structured equipment list for one building. Read-only for engineers /
// managers / clients; full CRUD for admin/lead via EquipmentForm.
//
// Layout: each equipment is its own card with the 4 free-form fields
// laid out top-down. Reads well on phone (the field use case). Desktop
// gets the same vertical cards — a wide table would scan worse for the
// "look up one piece of equipment in a hurry" task.
import { useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingEquipment,
  useDeleteBuildingEquipment,
  type BuildingEquipment,
} from '../../hooks/useBuildingKb';
import { EquipmentForm } from './EquipmentForm';

export function EquipmentList({ buildingId }: { buildingId: string }) {
  const canEdit = useCanAccessAdmin();
  const eqQ = useBuildingEquipment(buildingId);
  const del = useDeleteBuildingEquipment();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  if (eqQ.isLoading) {
    return <p className="t-text t-muted">Loading equipment…</p>;
  }
  if (eqQ.error) {
    return <p className="t-text t-danger">Error: {(eqQ.error as Error).message}</p>;
  }

  const rows = eqQ.data ?? [];

  return (
    <div>
      {canEdit && !addingNew && !editingId && (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          className="t-small t-accent"
          style={{
            padding: '8px 14px', border: '1px solid var(--color-accent)',
            borderRadius: 4, background: 'var(--color-card)', marginBottom: 12,
          }}
        >
          + Add equipment
        </button>
      )}

      {addingNew && (
        <EquipmentForm
          buildingId={buildingId}
          onClose={() => setAddingNew(false)}
        />
      )}

      {rows.length === 0 && !addingNew && (
        <p className="t-text t-muted">
          No equipment recorded yet.{canEdit ? ' Click "Add equipment" to start.' : ''}
        </p>
      )}

      {rows.map((eq) =>
        editingId === eq.id ? (
          <EquipmentForm
            key={eq.id}
            buildingId={buildingId}
            existing={eq}
            onClose={() => setEditingId(null)}
          />
        ) : (
          <EquipmentCard
            key={eq.id}
            eq={eq}
            canEdit={canEdit}
            onEdit={() => setEditingId(eq.id)}
            onDelete={async () => {
              if (!confirm(`Remove ${eq.name}? (Soft delete — can be restored.)`)) return;
              await del.mutateAsync({ id: eq.id, building_id: eq.building_id });
            }}
          />
        ),
      )}
    </div>
  );
}

function EquipmentCard({
  eq,
  canEdit,
  onEdit,
  onDelete,
}: {
  eq: BuildingEquipment;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="t-card"
      style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 8 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="t-section-title" style={{ fontSize: '1.05rem' }}>{eq.name}</h3>
          {eq.category && (
            <span
              className="t-small t-muted uppercase tracking-wider"
              style={{
                padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--color-border)',
                fontSize: '0.65rem',
              }}
            >
              {eq.category}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="t-small t-accent"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="t-small"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-danger)',
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {eq.photo_url && (
        <a href={eq.photo_url} target="_blank" rel="noopener noreferrer">
          <img
            src={eq.photo_url}
            alt={eq.name}
            style={{
              maxWidth: '100%',
              maxHeight: 320,
              borderRadius: 4,
              border: '1px solid var(--color-border)',
              objectFit: 'contain',
              background: 'var(--color-bg)',
            }}
            loading="lazy"
          />
        </a>
      )}
      {eq.location_note && (
        <Field label="Location" body={eq.location_note} />
      )}
      {eq.parts_notes && (
        <Field label="Parts" body={eq.parts_notes} />
      )}
      {eq.common_issues && (
        <Field label="Common issues" body={eq.common_issues} />
      )}
      {eq.troubleshooting && (
        <Field label="Troubleshooting" body={eq.troubleshooting} />
      )}
    </div>
  );
}

function Field({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: '0.65rem' }}>
        {label}
      </div>
      <div className="t-text" style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
    </div>
  );
}
