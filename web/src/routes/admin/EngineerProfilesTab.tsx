import { useState } from 'react';
import { useEngineers, useUpdateEngineerProfile, DISCIPLINES, type EngineerRow } from '../../hooks/useEngineers';

export function EngineerProfilesTab() {
  const q = useEngineers();
  const update = useUpdateEngineerProfile();
  const [editing, setEditing] = useState<EngineerRow | null>(null);

  if (q.isLoading) return <p className="t-text t-muted">Loading engineers...</p>;
  if (q.isError) return <p className="t-text t-danger">Error: {(q.error as Error).message}</p>;

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="t-card">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="t-section-title">Engineer profiles</h2>
          <span className="t-small t-muted">{rows.length} engineers</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full t-text border-collapse">
            <thead>
              <tr className="text-left t-small t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 px-2">CMMS name</th>
                <th className="py-2 px-2">Discipline</th>
                <th className="py-2 px-2 text-right">Level</th>
                <th className="py-2 px-2 text-right">XP</th>
                <th className="py-2 px-2 text-center">Visible to self</th>
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
                  <td className="py-2 pr-3 font-medium">{r.full_name}</td>
                  <td className="py-2 px-2 t-mono t-small t-muted">{r.cmms_assignee_name}</td>
                  <td className="py-2 px-2">{r.discipline ? labelFor(r.discipline) : <span className="t-muted">—</span>}</td>
                  <td className="py-2 px-2 text-right t-mono">{r.level}</td>
                  <td className="py-2 px-2 text-right t-mono">{r.xp}</td>
                  <td className="py-2 px-2 text-center">
                    <Toggle
                      checked={r.visible_to_self}
                      onChange={(v) =>
                        update.mutate({ user_id: r.user_id, patch: { visible_to_self: v } })
                      }
                    />
                  </td>
                  <td className="py-2 pl-2">
                    <button
                      onClick={() => setEditing(r)}
                      className="t-small px-2 py-0.5 rounded border"
                      style={{
                        color: 'var(--color-accent)',
                        borderColor: 'var(--color-border)',
                        background: 'var(--color-card)',
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDrawer
          row={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await update.mutateAsync({ user_id: editing.user_id, patch });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function labelFor(d: string): string {
  return DISCIPLINES.find((x) => x.value === d)?.label ?? d;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center w-9 h-5 rounded-full transition-colors"
      style={{ background: checked ? 'var(--color-accent)' : 'var(--color-border)' }}
      title={checked ? 'Click to hide from engineer' : 'Click to expose to engineer'}
    >
      <span
        className="inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

function EditDrawer({
  row,
  onClose,
  onSave,
}: {
  row: EngineerRow;
  onClose: () => void;
  onSave: (patch: Partial<EngineerRow>) => Promise<void>;
}) {
  const [discipline, setDiscipline] = useState<EngineerRow['discipline']>(row.discipline);
  const [level, setLevel] = useState<number>(row.level);
  const [notes, setNotes] = useState<string>(row.notes ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ discipline, level, notes: notes.trim() || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full overflow-y-auto p-6"
        style={{ background: 'var(--color-card)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="t-section-title">{row.full_name}</h3>
            <p className="t-small t-muted">CMMS: {row.cmms_assignee_name}</p>
          </div>
          <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
        </div>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Discipline</span>
          <select
            value={discipline ?? ''}
            onChange={(e) => setDiscipline((e.target.value || null) as EngineerRow['discipline'])}
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— none —</option>
            {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Level (1–10)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="w-24 border rounded px-2 py-1 t-text t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <label className="block mb-4">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Anything you want to remember about this engineer..."
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
