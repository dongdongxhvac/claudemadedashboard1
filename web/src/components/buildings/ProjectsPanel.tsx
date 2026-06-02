// Building projects — lightweight per-building project log (title /
// detail / RSP). Distinct from §10.1 equipment status: status tracks
// "this asset is broken right now", projects track "this is the
// higher-level initiative" (HVAC upgrade, lighting retrofit, leak
// investigation, etc.).
//
// Same edit-gating shape as equipment / parts: admin / manager / lead
// can add/edit/delete via the form; everyone can view.
import { useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import {
  useBuildingProjects,
  useUpsertBuildingProject,
  useDeleteBuildingProject,
  type BuildingProject,
} from '../../hooks/useBuildingKb';

function fmtTime(utcIso: string): string {
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function ProjectsPanel({ buildingId }: { buildingId: string }) {
  const canEdit = useCanAccessAdmin();
  const projectsQ = useBuildingProjects(buildingId);
  const del = useDeleteBuildingProject();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  if (projectsQ.isLoading) {
    return <p className="t-text t-muted">Loading projects…</p>;
  }
  if (projectsQ.error) {
    return <p className="t-text t-danger">Error: {(projectsQ.error as Error).message}</p>;
  }

  const rows = projectsQ.data ?? [];

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
          + Add project
        </button>
      )}

      {addingNew && (
        <ProjectForm
          buildingId={buildingId}
          onClose={() => setAddingNew(false)}
        />
      )}

      {rows.length === 0 && !addingNew && (
        <p className="t-text t-muted">
          No projects logged yet.{canEdit ? ' Click "Add project" to start.' : ''}
        </p>
      )}

      {rows.map((p) =>
        editingId === p.id ? (
          <ProjectForm
            key={p.id}
            buildingId={buildingId}
            existing={p}
            onClose={() => setEditingId(null)}
          />
        ) : (
          <ProjectCard
            key={p.id}
            project={p}
            canEdit={canEdit}
            onEdit={() => setEditingId(p.id)}
            onDelete={async () => {
              if (!confirm(`Remove project "${p.title}"? (Soft delete — can be restored.)`)) return;
              await del.mutateAsync({ id: p.id, building_id: p.building_id });
            }}
          />
        ),
      )}
    </div>
  );
}

function ProjectCard({
  project,
  canEdit,
  onEdit,
  onDelete,
}: {
  project: BuildingProject;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="t-card"
      style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 8 }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="t-section-title" style={{ fontSize: '1.05rem' }}>
          {project.title}
        </h3>
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

      {project.detail && (
        <div>
          <PillLabel label="Detail" />
          <div className="t-text" style={{ whiteSpace: 'pre-wrap' }}>{project.detail}</div>
        </div>
      )}
      {project.rsp && (
        <div>
          <PillLabel label="RSP" />
          <div className="t-text">{project.rsp}</div>
        </div>
      )}
      <div className="t-small t-muted" style={{ fontSize: '0.7rem' }}>
        Updated {fmtTime(project.updated_at)}
      </div>
    </div>
  );
}

function ProjectForm({
  buildingId,
  existing,
  onClose,
}: {
  buildingId: string;
  existing?: BuildingProject;
  onClose: () => void;
}) {
  const upsert = useUpsertBuildingProject();
  const [title, setTitle]   = useState(existing?.title ?? '');
  const [detail, setDetail] = useState(existing?.detail ?? '');
  const [rsp, setRsp]       = useState(existing?.rsp ?? '');
  const [error, setError]   = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    try {
      await upsert.mutateAsync({
        id: existing?.id,
        building_id: buildingId,
        title:  title.trim(),
        detail: detail.trim() || null,
        rsp:    rsp.trim() || null,
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
        {existing ? 'Edit project' : 'Add project'}
      </div>

      <Field label="Title (required)" hint='e.g. "Boiler 2 replacement"'>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Detail" hint="scope, status, milestones — anything useful">
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <Field label="RSP (responsible party)" hint="who's owning this — engineer / vendor / PM">
        <input
          type="text"
          value={rsp}
          onChange={(e) => setRsp(e.target.value)}
          style={inputStyle}
        />
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
          {upsert.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add project'}
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

function PillLabel({ label }: { label: string }) {
  return (
    <div
      className="t-small t-muted uppercase tracking-wider"
      style={{ fontSize: '0.65rem' }}
    >
      {label}
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
