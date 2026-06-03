// Structured equipment list for one building. Read-only for engineers /
// managers / clients; full CRUD for admin/lead via EquipmentForm + IssueForm.
//
// After 0060: each equipment card shows
//   * the equipment's headline status (operational / standby auto / defaulted)
//     OR — if any issues are open — the worst open-issue status
//   * a stacked list of open issues (one row per problem) with per-issue
//     Edit / Close / Remove + a per-card "+ Add issue" button
import { useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingEquipment,
  useDeleteBuildingEquipment,
  useBuildingOpenIssues,
  useCloseEquipmentIssue,
  useDeleteEquipmentIssue,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUS_LABELS,
  equipmentStatusTone,
  worstStatus,
  type BuildingEquipment,
  type EquipmentIssue,
  type EffectiveEquipmentStatus,
} from '../../hooks/useBuildingKb';
import { EquipmentForm } from './EquipmentForm';
import { IssueForm } from './IssueForm';

export function EquipmentList({ buildingId }: { buildingId: string }) {
  const canEdit = useCanAccessAdmin();
  const eqQ = useBuildingEquipment(buildingId);
  const issQ = useBuildingOpenIssues(buildingId);
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
  const issuesByEq = issQ.data ?? new Map<string, EquipmentIssue[]>();

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
            issues={issuesByEq.get(eq.id) ?? []}
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
  issues,
  canEdit,
  onEdit,
  onDelete,
}: {
  eq: BuildingEquipment;
  issues: EquipmentIssue[];
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Effective headline = worst of open issues, else the equipment's baseline
  // status (operational / standby_auto / defaulted).
  const effective: EffectiveEquipmentStatus =
    worstStatus(issues.map((i) => i.status)) ?? eq.status;
  const tone = equipmentStatusTone(effective);
  const colors = statusColors(tone);

  const [addingIssue, setAddingIssue] = useState(false);
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);

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
            {EQUIPMENT_STATUS_LABELS[effective]}
            {issues.length > 1 && (
              <span style={{ marginLeft: 6, opacity: 0.85 }}>· {issues.length}</span>
            )}
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

      {/* Open issues list — each row carries its own detail / date / WO / RSP. */}
      {issues.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {issues.map((iss) =>
            editingIssueId === iss.id ? (
              <IssueForm
                key={iss.id}
                equipmentId={eq.id}
                existing={iss}
                onClose={() => setEditingIssueId(null)}
              />
            ) : (
              <IssueRow
                key={iss.id}
                issue={iss}
                canEdit={canEdit}
                onEdit={() => setEditingIssueId(iss.id)}
              />
            ),
          )}
        </div>
      )}

      {canEdit && !addingIssue && (
        <button
          type="button"
          onClick={() => setAddingIssue(true)}
          className="t-small"
          style={{
            background: 'none', border: '1px dashed var(--color-border)',
            borderRadius: 4, padding: '6px 10px',
            color: 'var(--color-text-muted)',
            cursor: 'pointer', justifySelf: 'start',
          }}
        >
          + Add issue
        </button>
      )}
      {addingIssue && (
        <IssueForm
          equipmentId={eq.id}
          onClose={() => setAddingIssue(false)}
        />
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

function IssueRow({
  issue,
  canEdit,
  onEdit,
}: {
  issue: EquipmentIssue;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const close = useCloseEquipmentIssue();
  const del = useDeleteEquipmentIssue();
  const tone = equipmentStatusTone(issue.status);
  const accent =
    tone === 'bad' ? 'var(--color-danger)' : 'var(--color-warn, #d97706)';

  return (
    <div
      className="grid gap-2"
      style={{
        padding: 10, borderRadius: 4,
        background: tone === 'bad'
          ? 'rgba(239, 68, 68, 0.10)'
          : 'rgba(217, 119, 6, 0.10)',
        border: `1px solid ${accent}33`,
        gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, auto) minmax(120px, auto) minmax(140px, auto) min-content',
        alignItems: 'start',
      }}
    >
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span
          className="t-small uppercase tracking-wider"
          style={{
            padding: '2px 8px', borderRadius: 4,
            fontSize: '0.65rem', fontWeight: 700,
            background: accent, color: 'white',
          }}
        >
          {EQUIPMENT_STATUS_LABELS[issue.status]}
        </span>
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
              onClick={async () => {
                if (!confirm(`Close this issue? (${EQUIPMENT_STATUS_LABELS[issue.status]} — "${issue.detail ?? ''}")`)) return;
                await close.mutateAsync({ id: issue.id, equipment_id: issue.equipment_id });
              }}
              className="t-small"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-ok, #10b981)',
              }}
              title="Mark this issue resolved"
            >
              Close
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!confirm('Permanently remove this issue? (use Close to mark resolved instead — Remove is for issues entered by mistake.)')) return;
                await del.mutateAsync({ id: issue.id, equipment_id: issue.equipment_id });
              }}
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
      {issue.detail && (
        <div style={{ gridColumn: '1 / -1' }}>
          <PillLabel label="Detail" color={accent} />
          <div className="t-text" style={{ whiteSpace: 'pre-wrap' }}>{issue.detail}</div>
        </div>
      )}
      {issue.status_date && (
        <div>
          <PillLabel label="Date" color={accent} />
          <div className="t-text">{issue.status_date}</div>
        </div>
      )}
      {issue.wo_number && (
        <div>
          <PillLabel label="WO #" color={accent} />
          <div className="t-text t-mono">{issue.wo_number}</div>
        </div>
      )}
      {issue.rsp && (
        <div>
          <PillLabel label="RSP" color={accent} />
          <div className="t-text">{issue.rsp}</div>
        </div>
      )}
    </div>
  );
}

function PillLabel({ label, color }: { label: string; color: string }) {
  return (
    <div
      className="t-small uppercase tracking-wider"
      style={{ fontSize: '0.6rem', color }}
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
