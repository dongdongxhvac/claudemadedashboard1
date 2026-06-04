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
  useDeleteEquipmentIssue,
  useRemoveLoto,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUS_LABELS,
  equipmentStatusTone,
  worstStatus,
  isLotoActive,
  type BuildingEquipment,
  type EquipmentIssue,
  type EffectiveEquipmentStatus,
} from '../../hooks/useBuildingKb';
import { useEngineers } from '../../hooks/useEngineers';
import { EquipmentForm } from './EquipmentForm';
import { IssueForm } from './IssueForm';
import { IssueCloseDialog } from './IssueCloseDialog';

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

  // Group children by parent_equipment_id so the renderer can indent them
  // under their parent card.
  const childrenByParent = new Map<string, BuildingEquipment[]>();
  for (const eq of rows) {
    if (!eq.parent_equipment_id) continue;
    const arr = childrenByParent.get(eq.parent_equipment_id) ?? [];
    arr.push(eq);
    childrenByParent.set(eq.parent_equipment_id, arr);
  }
  // Top-level rows = those whose parent isn't in the current building's
  // active equipment list (either truly top-level, or orphaned because
  // parent was soft-deleted — show them as top-level either way).
  const idSet = new Set(rows.map((r) => r.id));
  const topLevel = rows.filter(
    (eq) => !eq.parent_equipment_id || !idSet.has(eq.parent_equipment_id),
  );

  const renderCard = (eq: BuildingEquipment, depth: number) => {
    if (editingId === eq.id) {
      return (
        <div key={eq.id} style={{ marginLeft: depth * 24 }}>
          <EquipmentForm
            buildingId={buildingId}
            existing={eq}
            onClose={() => setEditingId(null)}
          />
        </div>
      );
    }
    const children = childrenByParent.get(eq.id) ?? [];
    // Roll up children's open issues into the parent's effective status —
    // own issues stay primary on the card; child issues feed the "worst-of"
    // computation only.
    const childIssues = children.flatMap((c) => issuesByEq.get(c.id) ?? []);
    return (
      <div key={eq.id} style={{ marginLeft: depth * 24 }}>
        <EquipmentCard
          eq={eq}
          issues={issuesByEq.get(eq.id) ?? []}
          childIssues={childIssues}
          childCount={children.length}
          canEdit={canEdit}
          onEdit={() => setEditingId(eq.id)}
          onDelete={async () => {
            if (!confirm(`Remove ${eq.full_name}? (Soft delete — can be restored.)`)) return;
            await del.mutateAsync({ id: eq.id, building_id: eq.building_id });
          }}
        />
        {children.map((c) => renderCard(c, depth + 1))}
      </div>
    );
  };

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

      {topLevel.map((eq) => renderCard(eq, 0))}
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
  childIssues,
  childCount,
  canEdit,
  onEdit,
  onDelete,
}: {
  eq: BuildingEquipment;
  issues: EquipmentIssue[];
  /** Open issues across all descendants — feeds the parent's rollup
   *  status only; not rendered on this card (each child card renders
   *  its own issues). */
  childIssues: EquipmentIssue[];
  /** Total descendant count, for the "N sub-components" badge. */
  childCount: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Effective headline = worst of (own open issues + descendants' open
  // issues), else the equipment's baseline status (operational /
  // standby_auto / defaulted). This way a chiller appears DEGRADED if
  // any of its compressors are degraded, even if the chiller itself has
  // no open issues on its row.
  const effective: EffectiveEquipmentStatus =
    worstStatus([...issues, ...childIssues].map((i) => i.status)) ?? eq.status;
  const tone = equipmentStatusTone(effective);
  const colors = statusColors(tone);
  const isSubComponent = !!eq.parent_equipment_id;

  const engineersQ = useEngineers();
  const [addingIssue, setAddingIssue] = useState(false);
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [closingIssue, setClosingIssue] = useState<EquipmentIssue | null>(null);
  const closingApplierName = closingIssue?.loto_applied_by
    ? engineersQ.data?.find((e) => e.user_id === closingIssue.loto_applied_by)?.full_name ?? null
    : null;

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
            title={`Last change: ${new Date(eq.last_status_change_at).toLocaleString()}${
              childIssues.length > 0 ? ` · includes ${childIssues.length} sub-component issue${childIssues.length === 1 ? '' : 's'}` : ''
            }`}
          >
            {EQUIPMENT_STATUS_LABELS[effective]}
            {issues.length > 1 && (
              <span style={{ marginLeft: 6, opacity: 0.85 }}>· {issues.length}</span>
            )}
            {childIssues.length > 0 && (
              <span style={{ marginLeft: 6, opacity: 0.85 }}>
                · {childIssues.length} sub
              </span>
            )}
          </span>
          {childCount > 0 && (
            <span
              className="t-small t-muted"
              style={{ fontSize: '0.7rem' }}
              title={`${childCount} sub-component${childCount === 1 ? '' : 's'} catalogued`}
            >
              {childCount} sub-component{childCount === 1 ? '' : 's'}
            </span>
          )}
          {isSubComponent && (
            <span
              className="t-small t-muted uppercase tracking-wider"
              style={{
                padding: '1px 6px', borderRadius: 4,
                border: '1px dashed var(--color-border)',
                fontSize: '0.6rem',
              }}
              title="This is a sub-component of another piece of equipment"
            >
              sub
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
                onClose={() => setClosingIssue(iss)}
              />
            ),
          )}
        </div>
      )}

      {closingIssue && (
        <IssueCloseDialog
          ctx={{
            id: closingIssue.id,
            equipment_id: closingIssue.equipment_id,
            status: closingIssue.status,
            detail: closingIssue.detail,
            equipment_label: eq.short_name
              ? `${eq.short_name} · ${eq.full_name}`
              : eq.full_name,
            loto_applied_at: closingIssue.loto_applied_at,
            loto_removed_at: closingIssue.loto_removed_at,
            loto_applied_by_name: closingApplierName,
          }}
          onClose={() => setClosingIssue(null)}
        />
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
  onClose,
}: {
  issue: EquipmentIssue;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const del = useDeleteEquipmentIssue();
  const removeLoto = useRemoveLoto();
  const engineersQ = useEngineers();
  const tone = equipmentStatusTone(issue.status);
  const accent =
    tone === 'bad' ? 'var(--color-danger)' : 'var(--color-warn, #d97706)';

  const lotoActive = isLotoActive(issue);
  const lotoApplierName = issue.loto_applied_by
    ? engineersQ.data?.find((e) => e.user_id === issue.loto_applied_by)?.full_name ?? null
    : null;

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
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="flex items-center gap-2 flex-wrap">
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
          {lotoActive && (
            <span
              className="t-small uppercase tracking-wider"
              style={{
                padding: '2px 8px', borderRadius: 4,
                fontSize: '0.65rem', fontWeight: 700,
                background: 'var(--color-danger)',
                color: 'white',
                letterSpacing: '0.08em',
              }}
              title={
                issue.loto_applied_at
                  ? `LOTO / ISO applied ${issue.loto_applied_at}${lotoApplierName ? ' by ' + lotoApplierName : ''}`
                  : 'LOTO / ISO active'
              }
            >
              🔒 LOTO/ISO {lotoApplierName ? `· ${lotoApplierName.split(' ')[0]}` : ''}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={onEdit}
              className="t-small t-accent"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Edit
            </button>
            {lotoActive && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('Mark LOTO / ISO removed on this issue? (Stamps you + today as the remover. The issue itself stays open — use Close to also resolve it.)')) return;
                  await removeLoto.mutateAsync({ id: issue.id, equipment_id: issue.equipment_id });
                }}
                className="t-small"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-warn, #d97706)',
                }}
                title="Lock / isolation removed but issue stays open (e.g. waiting on parts)"
              >
                Remove LOTO/ISO
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="t-small"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-ok, #10b981)',
              }}
              title="Mark this issue resolved — opens a dialog to record how it was fixed"
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
