// Structured equipment list for one building. Read-only for engineers /
// managers / clients; full CRUD for admin/lead via EquipmentForm.
//
// Layout: each equipment is its own card with the 4 free-form fields
// laid out top-down. Card border + status pill color reflect the current
// status — green/standby = good, defaulted = amber, off-PM/down-CM = red.
// The down-status cards also surface status detail / WO# / RSP so an
// engineer in the field sees the gap at a glance without expanding.
import { useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingEquipment,
  useDeleteBuildingEquipment,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUS_LABELS,
  equipmentStatusTone,
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
              if (!confirm(`Remove ${eq.full_name}? (Soft delete — can be restored.)`)) return;
              await del.mutateAsync({ id: eq.id, building_id: eq.building_id });
            }}
          />
        ),
      )}
    </div>
  );
}

function statusColors(tone: 'good' | 'warn' | 'bad'): {
  border: string; bg: string; pillBg: string; pillFg: string;
} {
  if (tone === 'bad') {
    return {
      border: 'var(--color-danger)',
      bg:     'rgba(239, 68, 68, 0.06)',
      pillBg: 'var(--color-danger)',
      pillFg: 'white',
    };
  }
  if (tone === 'warn') {
    return {
      border: 'var(--color-warn, #d97706)',
      bg:     'rgba(217, 119, 6, 0.06)',
      pillBg: 'var(--color-warn, #d97706)',
      pillFg: 'white',
    };
  }
  return {
    border: 'var(--color-ok, #10b981)',
    bg:     'rgba(16, 185, 129, 0.05)',
    pillBg: 'var(--color-ok, #10b981)',
    pillFg: 'white',
  };
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
  const tone   = equipmentStatusTone(eq.status);
  const colors = statusColors(tone);
  const isDown = tone === 'bad';

  return (
    <div
      className="t-card"
      style={{
        padding: 14, marginBottom: 12, display: 'grid', gap: 8,
        borderLeft: `4px solid ${colors.border}`,
        background: colors.bg,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="t-section-title" style={{ fontSize: '1.05rem' }}>
            {eq.full_name}
          </h3>
          {eq.short_name && (
            <span className="t-muted t-mono" style={{ fontSize: '0.85rem' }}>
              {eq.short_name}
            </span>
          )}
          {eq.category && (
            <span
              className="t-small t-muted uppercase tracking-wider"
              style={{
                padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--color-border)',
                fontSize: '0.65rem',
              }}
            >
              {EQUIPMENT_CATEGORY_LABELS[eq.category]}
            </span>
          )}
          <span
            className="t-small uppercase tracking-wider"
            style={{
              padding: '2px 8px', borderRadius: 4,
              fontSize: '0.65rem', fontWeight: 700,
              background: colors.pillBg, color: colors.pillFg,
            }}
            title={`Last change: ${new Date(eq.last_status_change_at).toLocaleString()}`}
          >
            {EQUIPMENT_STATUS_LABELS[eq.status]}
          </span>
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

      {/* Down-state surfaces status_detail / date / WO# / RSP up top so the
          engineer doesn't have to expand a hidden section. */}
      {isDown && (eq.status_detail || eq.status_date || eq.wo_number || eq.rsp) && (
        <div
          className="grid gap-2"
          style={{
            padding: 10, borderRadius: 4,
            background: 'rgba(239, 68, 68, 0.10)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, auto) minmax(120px, auto) minmax(140px, auto)',
          }}
        >
          {eq.status_detail && (
            <div style={{ gridColumn: '1 / -1' }}>
              <PillLabel label="Detail" />
              <div className="t-text" style={{ whiteSpace: 'pre-wrap' }}>{eq.status_detail}</div>
            </div>
          )}
          {eq.status_date && (
            <div>
              <PillLabel label="Date" />
              <div className="t-text">{eq.status_date}</div>
            </div>
          )}
          {eq.wo_number && (
            <div>
              <PillLabel label="WO #" />
              <div className="t-text t-mono">{eq.wo_number}</div>
            </div>
          )}
          {eq.rsp && (
            <div>
              <PillLabel label="RSP" />
              <div className="t-text">{eq.rsp}</div>
            </div>
          )}
        </div>
      )}

      {eq.photo_url && (
        <a href={eq.photo_url} target="_blank" rel="noopener noreferrer">
          <img
            src={eq.photo_url}
            alt={eq.full_name}
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

function PillLabel({ label }: { label: string }) {
  return (
    <div
      className="t-small uppercase tracking-wider"
      style={{ fontSize: '0.6rem', color: 'var(--color-danger)' }}
    >
      {label}
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
