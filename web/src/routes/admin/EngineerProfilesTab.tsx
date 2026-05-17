import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useEngineers, useUpdateEngineerProfile, useUpdateUser, useAddEngineer,
  DISCIPLINES, ROLES,
  type EngineerRow, type Role, type Discipline,
} from '../../hooks/useEngineers';

export function EngineerProfilesTab() {
  const q = useEngineers();
  const updateProfile = useUpdateEngineerProfile();
  const updateUser = useUpdateUser();
  const addEngineer = useAddEngineer();
  const [editing, setEditing] = useState<EngineerRow | null>(null);
  const [adding, setAdding] = useState(false);

  if (q.isLoading) return <p className="t-text t-muted">Loading engineers...</p>;
  if (q.isError) return <p className="t-text t-danger">Error: {(q.error as Error).message}</p>;

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="t-card">
        <div className="flex items-baseline justify-between mb-3 gap-2">
          <h2 className="t-section-title">Engineer profiles</h2>
          <div className="flex items-center gap-3">
            <span className="t-small t-muted">{rows.length} engineers</span>
            <button
              onClick={() => setAdding(true)}
              className="t-small px-3 py-1 rounded border font-medium text-white"
              style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
            >
              + Add engineer
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full t-text border-collapse">
            <thead>
              <tr className="text-left t-small t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 px-2">Email · sign-in</th>
                <th className="py-2 px-2">Hired</th>
                <th className="py-2 px-2">Discipline</th>
                <th className="py-2 px-2 text-right">Level</th>
                <th className="py-2 px-2 text-right">XP</th>
                <th className="py-2 px-2 text-center">Visible to self</th>
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-b t-row-hover" style={{ borderColor: 'var(--color-border-soft)' }}>
                  <td className="py-2 pr-3 font-medium">{r.full_name}</td>
                  <td className="py-2 px-2">
                    {r.email ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="t-small">{r.email}</span>
                          {r.auth_user_id ? (
                            <span className="t-small px-1.5 py-0.5 rounded text-white" style={{ background: 'var(--color-ok)', fontSize: '9px' }} title="Engineer has signed in; auth.users linked to public.users">
                              ✓ LINKED
                            </span>
                          ) : (
                            <span className="t-small px-1.5 py-0.5 rounded t-muted" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '9px' }} title="Email set, awaiting first sign-in">
                              ⌛ PENDING
                            </span>
                          )}
                        </div>
                        {r.phone && (
                          <a href={`tel:${r.phone.replace(/[^0-9+]/g, '')}`} className="t-small t-muted t-mono hover:underline">
                            {r.phone}
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="t-small t-muted italic">— not set —</span>
                    )}
                  </td>
                  <td className="py-2 px-2 t-mono t-small t-muted whitespace-nowrap">
                    {r.hiring_date
                      ? new Date(r.hiring_date + 'T00:00:00').toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="py-2 px-2">{r.discipline ? labelFor(r.discipline) : <span className="t-muted">—</span>}</td>
                  <td className="py-2 px-2 text-right t-mono">{r.level}</td>
                  <td className="py-2 px-2 text-right t-mono">{r.xp}</td>
                  <td className="py-2 px-2 text-center">
                    <Toggle
                      checked={r.visible_to_self}
                      onChange={(v) =>
                        updateProfile.mutate({ user_id: r.user_id, patch: { visible_to_self: v } })
                      }
                    />
                  </td>
                  <td className="py-2 pl-2 whitespace-nowrap">
                    <button
                      onClick={() => setEditing(r)}
                      className="t-small px-2 py-0.5 rounded border mr-1"
                      style={{
                        color: 'var(--color-accent)',
                        borderColor: 'var(--color-border)',
                        background: 'var(--color-card)',
                      }}
                    >
                      Edit
                    </button>
                    <Link
                      to={`/engineer/${r.user_id}/profile`}
                      className="t-small px-2 py-0.5 rounded border inline-block"
                      style={{
                        color: 'var(--color-accent)',
                        borderColor: 'var(--color-border)',
                        background: 'var(--color-card)',
                      }}
                      title="Preview the RPG profile this engineer would see (if visible_to_self is on)"
                    >
                      Profile →
                    </Link>
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
            // Split: email + phone + role -> public.users; rest -> engineer_profiles.
            const { email, phone, role, ...profilePatch } = patch;
            const tasks: Promise<unknown>[] = [];
            const userPatch: { email?: string | null; phone?: string | null; role?: Role } = {};
            if (email !== undefined && email !== editing.email) userPatch.email = email;
            if (phone !== undefined && phone !== editing.phone) userPatch.phone = phone;
            if (role !== undefined && role !== editing.role) userPatch.role = role;
            if (Object.keys(userPatch).length > 0) {
              tasks.push(updateUser.mutateAsync({ user_id: editing.user_id, patch: userPatch }));
            }
            if (Object.keys(profilePatch).length > 0) {
              tasks.push(updateProfile.mutateAsync({ user_id: editing.user_id, patch: profilePatch }));
            }
            await Promise.all(tasks);
            setEditing(null);
          }}
        />
      )}

      {adding && (
        <AddEngineerDrawer
          onClose={() => setAdding(false)}
          onSubmit={async (input) => {
            await addEngineer.mutateAsync(input);
            setAdding(false);
          }}
          submitting={addEngineer.isPending}
          error={addEngineer.error ? (addEngineer.error as Error).message : null}
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
  const [email, setEmail] = useState<string>(row.email ?? '');
  const [phone, setPhone] = useState<string>(row.phone ?? '');
  const [role, setRole] = useState<Role>(row.role);
  const [discipline, setDiscipline] = useState<EngineerRow['discipline']>(row.discipline);
  const [level, setLevel] = useState<number>(row.level);
  const [notes, setNotes] = useState<string>(row.notes ?? '');
  const [saving, setSaving] = useState(false);

  const emailTrimmed = email.trim();
  const phoneTrimmed = phone.trim();
  const isLinked = !!row.auth_user_id;
  const roleWillRemove = role !== 'engineer';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        email: emailTrimmed === '' ? null : emailTrimmed,
        phone: phoneTrimmed === '' ? null : phoneTrimmed,
        role,
        discipline,
        level,
        notes: notes.trim() || null,
      });
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
          <span className="t-small t-muted uppercase tracking-wider block mb-1">
            Sign-in email{' '}
            {isLinked && (
              <span className="t-small text-white px-1 rounded ml-2" style={{ background: 'var(--color-ok)', fontSize: '9px' }}>
                ✓ LINKED
              </span>
            )}
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="engineer@company.com"
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Set this, then tell the engineer to sign in at <code>/login</code> with this email.
            The link is automatic.{' '}
            {isLinked && (
              <span style={{ color: 'var(--color-warn)' }}>
                Note: changing the email on a linked user clears the auth link;
                they'll need to sign in again with the new email.
              </span>
            )}
          </p>
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">
            Role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {roleWillRemove && (
            <p className="t-small mt-1" style={{ color: 'var(--color-warn)' }}>
              Changing role to <b>{role}</b> will hide this row from the Engineer Profiles
              list (this view only shows role = engineer).
            </p>
          )}
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="617-555-1234"
            className="w-full border rounded px-2 py-1 t-text t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

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

function AddEngineerDrawer({
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (input: {
    full_name: string;
    cmms_assignee_name: string;
    email: string | null;
    phone: string | null;
    hiring_date: string | null;
    discipline: Discipline | null;
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}) {
  const [fullName, setFullName] = useState('');
  const [cmmsName, setCmmsName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [hiringDate, setHiringDate] = useState('');
  const [discipline, setDiscipline] = useState<Discipline | ''>('');
  const [cmmsTouched, setCmmsTouched] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !cmmsName.trim()) return;
    await onSubmit({
      full_name: fullName,
      cmms_assignee_name: cmmsName,
      email: email.trim() || null,
      phone: phone.trim() || null,
      hiring_date: hiringDate || null,
      discipline: discipline || null,
    });
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
          <h3 className="t-section-title">Add engineer</h3>
          <button type="button" onClick={onClose} className="t-small t-muted hover:underline">
            Close
          </button>
        </div>

        <p className="t-small t-muted mb-4">
          Creates a public.users row (role = engineer) + an engineer_profiles
          row. Level / XP start at 1 / 0; XP populates automatically as PMs
          with this CMMS name complete in future snapshots.
        </p>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">
            Full name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (!cmmsTouched) setCmmsName(e.target.value);
            }}
            placeholder="Robert Atkinson"
            autoFocus
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">
            CMMS assignee name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            type="text"
            required
            value={cmmsName}
            onChange={(e) => {
              setCmmsName(e.target.value);
              setCmmsTouched(true);
            }}
            placeholder="exact spelling from CMMS exports"
            className="w-full border rounded px-2 py-1 t-text t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Must match the <code>Assigned To</code> column in PM CSV exports exactly.
            XP won't accumulate if this doesn't match.
          </p>
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Sign-in email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="engineer@company.com"
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Optional. Set this to let the engineer sign in via magic link.
          </p>
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="617-555-1234"
            className="w-full border rounded px-2 py-1 t-text t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Hire date</span>
          <input
            type="date"
            value={hiringDate}
            onChange={(e) => setHiringDate(e.target.value)}
            className="border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <label className="block mb-4">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Discipline</span>
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value as Discipline | '')}
            className="border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— none —</option>
            {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>

        {error && (
          <p className="t-small t-danger mb-3 whitespace-pre-wrap">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="t-small px-3 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !fullName.trim() || !cmmsName.trim()}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {submitting ? 'Adding...' : 'Add engineer'}
          </button>
        </div>
      </form>
    </div>
  );
}
