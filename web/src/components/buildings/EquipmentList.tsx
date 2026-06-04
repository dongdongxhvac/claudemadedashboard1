// Structured equipment list for one building — layout C+A:
//   * Category sections (Chiller Plant, Boiler Plant, AHU, …) auto-expand
//     when they contain open issues; otherwise collapsed.
//   * Inside each section: A-style dense rows (~36px each), click to expand
//     inline. Expanded view shows photo, location, parts, common issues,
//     troubleshooting, full open-issues list, and edit/add affordances.
//   * Sub-components indent under their parent inside the parent's
//     category section, so the family stays together visually.
//
// Photos / SOPs / parts notes are HIDDEN by default per user direction —
// they're a backup affordance for new hires + infrequent visitors
// (feedback_equipment_photo_is_backup.md).
import { useMemo, useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingEquipment,
  useDeleteBuildingEquipment,
  useBuildingOpenIssues,
  useDeleteEquipmentIssue,
  useRemoveLoto,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUS_LABELS,
  equipmentStatusTone,
  worstStatus,
  isLotoActive,
  type BuildingEquipment,
  type EquipmentCategory,
  type EquipmentIssue,
  type EffectiveEquipmentStatus,
} from '../../hooks/useBuildingKb';
import { useEngineers } from '../../hooks/useEngineers';
import { EquipmentForm } from './EquipmentForm';
import { IssueForm } from './IssueForm';
import { IssueCloseDialog } from './IssueCloseDialog';

type CategoryKey = EquipmentCategory | '_uncat';

const UNCAT_LABEL = 'Uncategorized';

function categoryLabel(k: CategoryKey): string {
  if (k === '_uncat') return UNCAT_LABEL;
  return EQUIPMENT_CATEGORY_LABELS[k];
}

export function EquipmentList({
  buildingId,
  buildingShortCode,
  buildingName,
}: {
  buildingId: string;
  /** Short_code badge for safety labels ("Add equipment to [75]"). */
  buildingShortCode?: string;
  /** Full building name, used in form headers. */
  buildingName?: string;
}) {
  const canEdit = useCanAccessAdmin();
  const eqQ = useBuildingEquipment(buildingId);
  const issQ = useBuildingOpenIssues(buildingId);
  const del = useDeleteBuildingEquipment();
  const engineersQ = useEngineers();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingIssueFor, setAddingIssueFor] = useState<string | null>(null);
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [closingIssue, setClosingIssue] = useState<{
    issue: EquipmentIssue;
    equipment: BuildingEquipment;
  } | null>(null);

  // Section collapse/expand state — initialized below from auto-expand rule.
  const [collapsedCats, setCollapsedCats] = useState<Set<CategoryKey> | null>(null);

  const rows = eqQ.data ?? [];
  const issuesByEq = issQ.data ?? new Map<string, EquipmentIssue[]>();

  // Build the tree: top-level equipment grouped by category; children
  // indexed by parent id so the renderer can stitch them in beneath.
  const tree = useMemo(() => {
    const childrenByParent = new Map<string, BuildingEquipment[]>();
    for (const eq of rows) {
      if (!eq.parent_equipment_id) continue;
      const arr = childrenByParent.get(eq.parent_equipment_id) ?? [];
      arr.push(eq);
      childrenByParent.set(eq.parent_equipment_id, arr);
    }
    for (const [, arr] of childrenByParent) {
      arr.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.full_name.localeCompare(b.full_name),
      );
    }

    const idSet = new Set(rows.map((r) => r.id));
    const topLevel = rows.filter(
      (eq) => !eq.parent_equipment_id || !idSet.has(eq.parent_equipment_id),
    );

    // Bucket top-level rows by category (categories without any top-level
    // equipment are simply not rendered).
    const buckets = new Map<CategoryKey, BuildingEquipment[]>();
    for (const eq of topLevel) {
      const k: CategoryKey = eq.category ?? '_uncat';
      const arr = buckets.get(k) ?? [];
      arr.push(eq);
      buckets.set(k, arr);
    }
    for (const [, arr] of buckets) {
      arr.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.full_name.localeCompare(b.full_name),
      );
    }

    // Ordered list of categories actually present, following the canonical
    // EQUIPMENT_CATEGORIES enumeration with Uncategorized last.
    const orderedKeys: CategoryKey[] = [
      ...EQUIPMENT_CATEGORIES.filter((c) => buckets.has(c)),
      ...(buckets.has('_uncat') ? (['_uncat'] as CategoryKey[]) : []),
    ];

    // Count totals per category (including descendants) for the header.
    const collectDescendants = (parentId: string): BuildingEquipment[] => {
      const out: BuildingEquipment[] = [];
      const stack = [...(childrenByParent.get(parentId) ?? [])];
      while (stack.length) {
        const cur = stack.pop()!;
        out.push(cur);
        for (const c of childrenByParent.get(cur.id) ?? []) stack.push(c);
      }
      return out;
    };

    const sectionStats = new Map<
      CategoryKey,
      { equipmentCount: number; openIssueCount: number }
    >();
    for (const [k, tops] of buckets) {
      let eqCount = 0;
      let issueCount = 0;
      for (const top of tops) {
        eqCount += 1 + collectDescendants(top.id).length;
        const ownIssues = (issuesByEq.get(top.id) ?? []).length;
        const childIssues = collectDescendants(top.id).reduce(
          (acc, d) => acc + (issuesByEq.get(d.id) ?? []).length,
          0,
        );
        issueCount += ownIssues + childIssues;
      }
      sectionStats.set(k, { equipmentCount: eqCount, openIssueCount: issueCount });
    }

    return { childrenByParent, buckets, orderedKeys, sectionStats, collectDescendants };
  }, [rows, issuesByEq]);

  // Initialize collapse state ONCE after the first data load. Categories
  // with an open issue auto-expand; clean ones start collapsed. The user
  // can flip individual sections after that without it getting clobbered.
  if (collapsedCats === null && tree.orderedKeys.length > 0) {
    const initial = new Set<CategoryKey>();
    for (const k of tree.orderedKeys) {
      const stats = tree.sectionStats.get(k);
      if (!stats) continue;
      if (stats.openIssueCount === 0 && stats.equipmentCount > 3) {
        initial.add(k);
      }
    }
    setCollapsedCats(initial);
  }

  if (eqQ.isLoading) {
    return <p className="t-text t-muted">Loading equipment…</p>;
  }
  if (eqQ.error) {
    return <p className="t-text t-danger">Error: {(eqQ.error as Error).message}</p>;
  }

  const toggleCat = (k: CategoryKey) => {
    setCollapsedCats((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const closingApplierName = closingIssue?.issue.loto_applied_by
    ? engineersQ.data?.find(
        (e) => e.user_id === closingIssue.issue.loto_applied_by,
      )?.full_name ?? null
    : null;

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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          + Add equipment
          {buildingShortCode && (
            <span
              className="t-mono"
              style={{
                padding: '1px 6px',
                borderRadius: 3,
                background: 'var(--color-accent)',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.7rem',
              }}
            >
              to {buildingShortCode}
            </span>
          )}
        </button>
      )}

      {addingNew && (
        <EquipmentForm
          buildingId={buildingId}
          buildingShortCode={buildingShortCode}
          buildingName={buildingName}
          onClose={() => setAddingNew(false)}
        />
      )}

      {rows.length === 0 && !addingNew && (
        <p className="t-text t-muted">
          No equipment recorded yet.
          {canEdit ? ' Click "Add equipment" to start.' : ''}
        </p>
      )}

      {tree.orderedKeys.map((catKey) => {
        const tops = tree.buckets.get(catKey) ?? [];
        const stats = tree.sectionStats.get(catKey) ?? { equipmentCount: 0, openIssueCount: 0 };
        const collapsed = collapsedCats?.has(catKey) ?? false;

        return (
          <section key={catKey} style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => toggleCat(catKey)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                background: 'var(--color-card)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                color: 'var(--color-text)',
                marginBottom: 0,
                font: 'inherit',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 14, textAlign: 'center', fontSize: '0.7rem' }}>
                {collapsed ? '▶' : '▼'}
              </span>
              <span className="uppercase tracking-wider" style={{ fontWeight: 600, letterSpacing: '0.08em', fontSize: '0.75rem' }}>
                {categoryLabel(catKey)}
              </span>
              <span className="t-muted" style={{ fontSize: '0.75rem' }}>
                · {stats.equipmentCount} equipment
              </span>
              {stats.openIssueCount > 0 && (
                <span
                  style={{
                    padding: '1px 8px',
                    borderRadius: 10,
                    background: 'var(--color-danger)',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: '0.7rem',
                  }}
                >
                  {stats.openIssueCount} open
                </span>
              )}
            </button>

            {!collapsed && (
              <div style={{ border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 4px 4px' }}>
                {tops.map((top, idx) =>
                  renderEquipmentTree({
                    eq: top,
                    depth: 0,
                    isLastInSection: idx === tops.length - 1,
                    childrenByParent: tree.childrenByParent,
                    issuesByEq,
                    canEdit,
                    expandedId,
                    setExpandedId,
                    editingId,
                    setEditingId,
                    addingIssueFor,
                    setAddingIssueFor,
                    editingIssueId,
                    setEditingIssueId,
                    onCloseIssue: (issue, equipment) => setClosingIssue({ issue, equipment }),
                    onDeleteEquipment: async (eq) => {
                      const where = buildingShortCode ? ` from [${buildingShortCode}]` : '';
                      if (!confirm(`Remove ${eq.full_name}${where}? (Soft delete — can be restored.)`)) return;
                      await del.mutateAsync({ id: eq.id, building_id: eq.building_id });
                    },
                    buildingId,
                    buildingShortCode,
                    buildingName,
                  }),
                )}
              </div>
            )}
          </section>
        );
      })}

      {closingIssue && (
        <IssueCloseDialog
          ctx={{
            id: closingIssue.issue.id,
            equipment_id: closingIssue.issue.equipment_id,
            status: closingIssue.issue.status,
            detail: closingIssue.issue.detail,
            equipment_label: closingIssue.equipment.short_name
              ? `${closingIssue.equipment.short_name} · ${closingIssue.equipment.full_name}`
              : closingIssue.equipment.full_name,
            loto_applied_at: closingIssue.issue.loto_applied_at,
            loto_removed_at: closingIssue.issue.loto_removed_at,
            loto_applied_by_name: closingApplierName,
          }}
          onClose={() => setClosingIssue(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree rendering — pure function so the parent component stays compact.
// Recurses through parent → children, indenting each level. Each equipment
// emits either a Row (collapsed) or a Row + expanded body.
// ---------------------------------------------------------------------------

type RenderArgs = {
  eq: BuildingEquipment;
  depth: number;
  isLastInSection: boolean;
  childrenByParent: Map<string, BuildingEquipment[]>;
  issuesByEq: Map<string, EquipmentIssue[]>;
  canEdit: boolean;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  addingIssueFor: string | null;
  setAddingIssueFor: (id: string | null) => void;
  editingIssueId: string | null;
  setEditingIssueId: (id: string | null) => void;
  onCloseIssue: (i: EquipmentIssue, eq: BuildingEquipment) => void;
  onDeleteEquipment: (eq: BuildingEquipment) => void;
  buildingId: string;
  buildingShortCode?: string;
  buildingName?: string;
};

function renderEquipmentTree(args: RenderArgs): React.ReactNode {
  const {
    eq, depth, isLastInSection,
    childrenByParent, issuesByEq,
    canEdit, expandedId, setExpandedId, editingId, setEditingId,
    addingIssueFor, setAddingIssueFor,
    editingIssueId, setEditingIssueId,
    onCloseIssue, onDeleteEquipment, buildingId,
    buildingShortCode, buildingName,
  } = args;

  const children = childrenByParent.get(eq.id) ?? [];
  const ownIssues = issuesByEq.get(eq.id) ?? [];
  // Roll up descendants' issues for status display only.
  const allDescendantIssues: EquipmentIssue[] = (() => {
    const out: EquipmentIssue[] = [];
    const stack = [...children];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(...(issuesByEq.get(cur.id) ?? []));
      for (const c of childrenByParent.get(cur.id) ?? []) stack.push(c);
    }
    return out;
  })();

  const isExpanded = expandedId === eq.id;
  const isEditing = editingId === eq.id;

  return (
    <div key={eq.id}>
      {isEditing ? (
        <div style={{ padding: 10, paddingLeft: 10 + depth * 24 }}>
          <EquipmentForm
            buildingId={buildingId}
            buildingShortCode={buildingShortCode}
            buildingName={buildingName}
            existing={eq}
            onClose={() => setEditingId(null)}
          />
        </div>
      ) : (
        <>
          <EquipmentRow
            eq={eq}
            depth={depth}
            isLastInSection={isLastInSection && children.length === 0}
            ownIssues={ownIssues}
            descendantIssues={allDescendantIssues}
            childCount={children.length}
            expanded={isExpanded}
            onToggle={() => setExpandedId(isExpanded ? null : eq.id)}
            canEdit={canEdit}
            onEdit={() => setEditingId(eq.id)}
            onDelete={() => onDeleteEquipment(eq)}
          />
          {isExpanded && (
            <EquipmentExpandedDetail
              eq={eq}
              depth={depth}
              ownIssues={ownIssues}
              canEdit={canEdit}
              addingIssue={addingIssueFor === eq.id}
              onStartAddIssue={() => setAddingIssueFor(eq.id)}
              onCancelAddIssue={() => setAddingIssueFor(null)}
              editingIssueId={editingIssueId}
              onStartEditIssue={(id) => setEditingIssueId(id)}
              onCancelEditIssue={() => setEditingIssueId(null)}
              onCloseIssue={(i) => onCloseIssue(i, eq)}
              buildingShortCode={buildingShortCode}
              buildingName={buildingName}
            />
          )}
        </>
      )}
      {children.map((c, idx) =>
        renderEquipmentTree({
          ...args,
          eq: c,
          depth: depth + 1,
          isLastInSection: isLastInSection && idx === children.length - 1,
        }),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EquipmentRow — the dense A-style row.
// ---------------------------------------------------------------------------

function EquipmentRow({
  eq,
  depth,
  isLastInSection,
  ownIssues,
  descendantIssues,
  childCount,
  expanded,
  onToggle,
  canEdit,
  onEdit,
  onDelete,
}: {
  eq: BuildingEquipment;
  depth: number;
  isLastInSection: boolean;
  ownIssues: EquipmentIssue[];
  descendantIssues: EquipmentIssue[];
  childCount: number;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const effective: EffectiveEquipmentStatus =
    worstStatus([...ownIssues, ...descendantIssues].map((i) => i.status)) ?? eq.status;
  const tone = equipmentStatusTone(effective);
  const pill = statusPill(tone);
  const lotoOpenIssue = ownIssues.find((i) => isLotoActive(i));
  const totalIssues = ownIssues.length + descendantIssues.length;
  const firstIssue = ownIssues[0] ?? descendantIssues[0];
  const subBadge = !!eq.parent_equipment_id;

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(74px, max-content) minmax(60px, max-content) 1fr minmax(40px, max-content) minmax(50px, max-content) 30px minmax(36px, max-content) max-content',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        paddingLeft: 10 + depth * 22,
        borderBottom: isLastInSection ? 'none' : '1px solid var(--color-border-soft, rgba(0,0,0,0.08))',
        background: expanded
          ? 'var(--color-card-elevated, rgba(0,0,0,0.03))'
          : 'transparent',
        cursor: 'pointer',
        fontSize: '0.85rem',
        lineHeight: 1.3,
      }}
    >
      {/* Status pill */}
      <span
        style={{
          padding: '2px 6px',
          borderRadius: 3,
          fontSize: '0.6rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: pill.bg,
          color: pill.fg,
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
        title={`Last change: ${new Date(eq.last_status_change_at).toLocaleString()}`}
      >
        {shortStatusLabel(effective)}
      </span>
      {/* Short name */}
      <span
        className="t-mono"
        style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {subBadge && <span style={{ marginRight: 4 }}>↳</span>}
        {eq.short_name ?? '—'}
      </span>
      {/* Full name */}
      <span
        style={{
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={eq.full_name}
      >
        {eq.full_name}
        {childCount > 0 && (
          <span className="t-muted" style={{ marginLeft: 6, fontSize: '0.7rem' }}>
            ({childCount} sub)
          </span>
        )}
      </span>
      {/* Issue count badge */}
      <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {totalIssues > 0 ? (
          <span
            style={{
              padding: '1px 8px',
              borderRadius: 10,
              background: 'var(--color-danger)',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.7rem',
            }}
            title={
              ownIssues.length > 0 && descendantIssues.length > 0
                ? `${ownIssues.length} own, ${descendantIssues.length} sub`
                : descendantIssues.length > 0
                ? `${descendantIssues.length} on sub-components`
                : `${ownIssues.length} open`
            }
          >
            {totalIssues}
          </span>
        ) : (
          <span className="t-muted">—</span>
        )}
      </span>
      {/* WO# (first open issue's) */}
      <span
        className="t-mono"
        style={{
          fontSize: '0.7rem',
          color: 'var(--color-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={firstIssue?.wo_number ?? ''}
      >
        {firstIssue?.wo_number ?? '—'}
      </span>
      {/* LOTO icon */}
      <span style={{ textAlign: 'center' }}>
        {lotoOpenIssue ? (
          <span style={{ color: 'var(--color-danger)' }} title="LOTO / ISO active">
            🔒
          </span>
        ) : (
          <span className="t-muted">—</span>
        )}
      </span>
      {/* Opened-ago */}
      <span
        className="t-muted"
        style={{
          fontSize: '0.7rem',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
        title={firstIssue ? `Opened ${new Date(firstIssue.created_at).toLocaleString()}` : ''}
      >
        {firstIssue ? relTime(firstIssue.created_at) : '—'}
      </span>
      {/* Actions: caret + edit + remove */}
      <span
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit && (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="t-small t-accent"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.7rem',
              }}
              title="Edit equipment record"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="t-small"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-danger)',
                fontSize: '0.7rem',
              }}
              title="Soft-delete this equipment"
            >
              ✕
            </button>
          </>
        )}
        <span
          style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? '▴' : '▾'}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EquipmentExpandedDetail — full record. Photo / location / parts / SOP /
// troubleshooting + open-issues list + add-issue button. Lives under the
// row when expanded.
// ---------------------------------------------------------------------------

function EquipmentExpandedDetail({
  eq,
  depth,
  ownIssues,
  canEdit,
  addingIssue,
  onStartAddIssue,
  onCancelAddIssue,
  editingIssueId,
  onStartEditIssue,
  onCancelEditIssue,
  onCloseIssue,
  buildingShortCode,
  buildingName,
}: {
  eq: BuildingEquipment;
  depth: number;
  ownIssues: EquipmentIssue[];
  canEdit: boolean;
  addingIssue: boolean;
  onStartAddIssue: () => void;
  onCancelAddIssue: () => void;
  editingIssueId: string | null;
  onStartEditIssue: (id: string) => void;
  onCancelEditIssue: () => void;
  onCloseIssue: (i: EquipmentIssue) => void;
  buildingShortCode?: string;
  buildingName?: string;
}) {
  const equipmentLabel = eq.short_name
    ? `${eq.short_name} · ${eq.full_name}`
    : eq.full_name;
  return (
    <div
      style={{
        padding: '10px 12px 14px',
        paddingLeft: 10 + depth * 22 + 16,
        borderBottom: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))',
        background: 'var(--color-card-elevated, rgba(0,0,0,0.02))',
        display: 'grid',
        gap: 10,
      }}
    >
      {/* Issues block first — most important when expanding to see "what's broken". */}
      {ownIssues.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {ownIssues.map((iss) =>
            editingIssueId === iss.id ? (
              <IssueForm
                key={iss.id}
                equipmentId={eq.id}
                equipmentLabel={equipmentLabel}
                buildingShortCode={buildingShortCode}
                buildingName={buildingName}
                existing={iss}
                onClose={onCancelEditIssue}
              />
            ) : (
              <IssueRow
                key={iss.id}
                issue={iss}
                canEdit={canEdit}
                onEdit={() => onStartEditIssue(iss.id)}
                onClose={() => onCloseIssue(iss)}
              />
            ),
          )}
        </div>
      )}
      {canEdit && !addingIssue && (
        <button
          type="button"
          onClick={onStartAddIssue}
          className="t-small"
          style={{
            background: 'none',
            border: '1px dashed var(--color-border)',
            borderRadius: 4,
            padding: '4px 10px',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            justifySelf: 'start',
            fontSize: '0.75rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          + Add issue to {equipmentLabel}
          {buildingShortCode && (
            <span
              className="t-mono"
              style={{
                padding: '0 5px',
                borderRadius: 2,
                background: 'var(--color-accent)',
                color: 'white',
                fontSize: '0.65rem',
                fontWeight: 700,
              }}
            >
              {buildingShortCode}
            </span>
          )}
        </button>
      )}
      {addingIssue && (
        <IssueForm
          equipmentId={eq.id}
          equipmentLabel={equipmentLabel}
          buildingShortCode={buildingShortCode}
          buildingName={buildingName}
          onClose={onCancelAddIssue}
        />
      )}

      {/* KB fields — only render if present. Two-column on PC. */}
      {(eq.location_note || eq.parts_notes || eq.common_issues || eq.troubleshooting) && (
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {eq.location_note && <KbField label="Location" body={eq.location_note} />}
          {eq.parts_notes && <KbField label="Parts" body={eq.parts_notes} />}
          {eq.common_issues && <KbField label="Common issues" body={eq.common_issues} />}
          {eq.troubleshooting && <KbField label="Troubleshooting" body={eq.troubleshooting} />}
        </div>
      )}

      {/* Photo last — backup affordance per user direction. */}
      {eq.photo_url && (
        <details>
          <summary
            className="t-small t-muted"
            style={{ cursor: 'pointer', fontSize: '0.7rem' }}
          >
            Photo
          </summary>
          <a
            href={eq.photo_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-block', marginTop: 6 }}
          >
            <img
              src={eq.photo_url}
              alt={eq.full_name}
              style={{
                maxWidth: '100%',
                maxHeight: 280,
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                objectFit: 'contain',
                background: 'var(--color-bg)',
              }}
              loading="lazy"
            />
          </a>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssueRow — the open-issue inline block inside an expanded equipment row.
// ---------------------------------------------------------------------------

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
      style={{
        padding: 8,
        borderRadius: 4,
        background: tone === 'bad'
          ? 'rgba(239, 68, 68, 0.10)'
          : 'rgba(217, 119, 6, 0.10)',
        border: `1px solid ${accent}33`,
        display: 'grid',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="uppercase tracking-wider"
            style={{
              padding: '2px 8px',
              borderRadius: 3,
              fontSize: '0.6rem',
              fontWeight: 700,
              background: accent,
              color: 'white',
            }}
          >
            {EQUIPMENT_STATUS_LABELS[issue.status]}
          </span>
          {lotoActive && (
            <span
              className="uppercase tracking-wider"
              style={{
                padding: '2px 8px',
                borderRadius: 3,
                fontSize: '0.6rem',
                fontWeight: 700,
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
          {issue.status_date && (
            <span className="t-muted" style={{ fontSize: '0.7rem' }}>
              {issue.status_date}
            </span>
          )}
          {issue.wo_number && (
            <span className="t-mono" style={{ fontSize: '0.7rem' }}>
              WO {issue.wo_number}
            </span>
          )}
          {issue.rsp && (
            <span className="t-muted" style={{ fontSize: '0.7rem' }}>
              RSP {issue.rsp}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={onEdit}
              className="t-small t-accent"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem' }}
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
                  fontSize: '0.7rem',
                }}
                title="Lock / isolation removed but issue stays open"
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
                color: 'var(--color-ok, #10b981)', fontSize: '0.7rem',
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
                color: 'var(--color-danger)', fontSize: '0.7rem',
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
      {issue.detail && (
        <div
          className="t-text"
          style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}
        >
          {issue.detail}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function statusPill(tone: 'good' | 'warn' | 'bad'): { bg: string; fg: string } {
  if (tone === 'bad')
    return { bg: 'var(--color-danger)', fg: 'white' };
  if (tone === 'warn')
    return { bg: 'var(--color-warn, #d97706)', fg: 'white' };
  return { bg: 'var(--color-ok, #10b981)', fg: 'white' };
}

/** Compact 2-4 char status label for the dense row. Full label still lives
 *  in EQUIPMENT_STATUS_LABELS for the expanded-row IssueRow. */
function shortStatusLabel(s: EffectiveEquipmentStatus): string {
  switch (s) {
    case 'operational':  return 'OK';
    case 'standby_auto': return 'AUTO';
    case 'defaulted':    return 'DEF';
    case 'degraded':     return 'DEG';
    case 'bypass':       return 'BYP';
    case 'off_pm':       return 'PM';
    case 'down_cm':      return 'CM';
  }
}

function relTime(utcIso: string): string {
  const ms = Date.now() - new Date(utcIso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

function KbField({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div
        className="uppercase tracking-wider t-muted"
        style={{ fontSize: '0.6rem', marginBottom: 2 }}
      >
        {label}
      </div>
      <div
        className="t-text"
        style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}
      >
        {body}
      </div>
    </div>
  );
}
