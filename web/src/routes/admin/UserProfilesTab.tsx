import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useEngineers, useUpdateEngineerProfile, useUpdateUser, useAddEngineer,
  DISCIPLINES, ROLES,
  type EngineerRow, type Role, type Discipline,
} from '../../hooks/useEngineers';
import { useShifts } from '../../hooks/useShifts';

export function UserProfilesTab() {
  const q = useEngineers();
  const shiftsQ = useShifts();
  const updateProfile = useUpdateEngineerProfile();
  const updateUser = useUpdateUser();
  const addEngineer = useAddEngineer();
  const [editing, setEditing] = useState<EngineerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  if (q.isLoading) return <p className="t-text t-muted">Loading users...</p>;
  if (q.isError) return <p className="t-text t-danger">Error: {(q.error as Error).message}</p>;

  const allRows = q.data ?? [];
  const rows = showInactive ? allRows : allRows.filter((r) => r.active);
  const inactiveCount = allRows.length - allRows.filter((r) => r.active).length;
  const shifts = shiftsQ.data ?? [];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="t-card">
        <div className="flex items-baseline justify-between mb-3 gap-2">
          <h2 className="t-section-title">User profiles</h2>
          <div className="flex items-center gap-3">
            <label className="t-small t-muted inline-flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive ({inactiveCount})
            </label>
            <span className="t-small t-muted">{rows.length} shown</span>
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
                <th className="py-2 px-2">Title</th>
                <th className="py-2 px-2">Shift</th>
                <th className="py-2 px-2">Email · sign-in</th>
                <th className="py-2 px-2">Discipline</th>
                <th className="py-2 px-2 text-right">Level</th>
                <th className="py-2 px-2 text-right">XP</th>
                <th className="py-2 px-2 text-center">Visible</th>
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const shift = r.shift_id ? shiftById.get(r.shift_id) : null;
                return (
                  <tr
                    key={r.user_id}
                    className="border-b t-row-hover"
                    style={{
                      borderColor: 'var(--color-border-soft)',
                      opacity: r.active ? 1 : 0.5,
                    }}
                  >
                    <td className="py-2 pr-3 font-medium">
                      <div className="flex items-center gap-1">
                        {r.is_lead && (
                          <span style={{ color: '#d4a017', fontSize: 14, lineHeight: 1 }} title="Lead engineer">★</span>
                        )}
                        <span>{r.full_name}</span>
                        {!r.active && (
                          <span className="t-small px-1.5 py-0.5 rounded t-muted ml-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: '9px' }}>
                            INACTIVE
                          </span>
                        )}
                      </div>
                      {r.hiring_date && (
                        <div className="t-small t-muted">
                          hired {new Date(r.hiring_date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 t-small">
                      {r.title ?? <span className="t-muted italic">—</span>}
                    </td>
                    <td className="py-2 px-2 t-small t-mono">
                      {shift ? shift.name : <span className="t-muted">—</span>}
                    </td>
                    <td className="py-2 px-2">
                      {r.email ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="t-small">{r.email}</span>
                            {r.auth_user_id ? (
                              <span className="t-small px-1.5 py-0.5 rounded text-white" style={{ background: 'var(--color-ok)', fontSize: '9px' }} title="User has signed in; auth.users linked to public.users">
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
                        title="Preview the RPG profile this user would see (if Visible is on)"
                      >
                        Profile →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDrawer
          row={editing}
          shifts={shifts}
          onClose={() => setEditing(null)}
          onSave={async (patch, userPatch) => {
            const tasks: Promise<unknown>[] = [];
            const _userPatch: { email?: string | null; phone?: string | null; role?: Role; active?: boolean } = {};
            if (userPatch.email !== undefined && userPatch.email !== editing.email) _userPatch.email = userPatch.email;
            if (userPatch.phone !== undefined && userPatch.phone !== editing.phone) _userPatch.phone = userPatch.phone;
            if (userPatch.role !== undefined && userPatch.role !== editing.role)    _userPatch.role  = userPatch.role;
            if (userPatch.active !== undefined && userPatch.active !== editing.active) _userPatch.active = userPatch.active;
            if (Object.keys(_userPatch).length > 0) {
              tasks.push(updateUser.mutateAsync({ user_id: editing.user_id, patch: _userPatch }));
            }
            if (Object.keys(patch).length > 0) {
              tasks.push(updateProfile.mutateAsync({ user_id: editing.user_id, patch }));
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

function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center w-9 h-5 rounded-full transition-colors"
      style={{ background: checked ? 'var(--color-accent)' : 'var(--color-border)' }}
      title={title}
    >
      <span
        className="inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

type ProfilePatch = Partial<Pick<EngineerRow, 'discipline' | 'level' | 'notes' | 'visible_to_self' | 'title' | 'shift_id' | 'is_lead'>>;
type UserPatch = { email: string | null; phone: string | null; role: Role; active: boolean };

function EditDrawer({
  row,
  shifts,
  onClose,
  onSave,
}: {
  row: EngineerRow;
  shifts: { id: string; name: string }[];
  onClose: () => void;
  onSave: (profile: ProfilePatch, user: UserPatch) => Promise<void>;
}) {
  const [title, setTitle] = useState<string>(row.title ?? '');
  const [email, setEmail] = useState<string>(row.email ?? '');
  const [phone, setPhone] = useState<string>(row.phone ?? '');
  const [role, setRole] = useState<Role>(row.role);
  const [shiftId, setShiftId] = useState<string>(row.shift_id ?? '');
  const [isLead, setIsLead] = useState<boolean>(row.is_lead);
  const [discipline, setDiscipline] = useState<EngineerRow['discipline']>(row.discipline);
  const [level, setLevel] = useState<number>(row.level);
  const [notes, setNotes] = useState<string>(row.notes ?? '');
  const [active, setActive] = useState<boolean>(row.active);
  const [saving, setSaving] = useState(false);

  const isLinked = !!row.auth_user_id;
  const roleWillRemove = role !== 'engineer';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(
        {
          title: title.trim() || null,
          shift_id: shiftId || null,
          is_lead: isLead,
          discipline,
          level,
          notes: notes.trim() || null,
        },
        {
          email: email.trim() === '' ? null : email.trim(),
          phone: phone.trim() === '' ? null : phone.trim(),
          role,
          active,
        },
      );
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
            <p className="t-small t-muted">CMMS: {row.cmms_assignee_name ?? '—'}</p>
          </div>
          <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
        </div>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lead Engineer, Building Engineer, BMS Specialist"
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <div className="flex items-end gap-3 mb-3">
          <label className="block flex-1">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Shift</span>
            <select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="">— none —</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Lead engineer</span>
            <div className="flex items-center gap-2 h-7">
              <Toggle
                checked={isLead}
                onChange={setIsLead}
                title={isLead ? 'Click to unmark as lead' : 'Click to mark as lead'}
              />
              <span className="t-small" style={{ color: isLead ? '#d4a017' : 'var(--color-text-muted)' }}>
                {isLead ? '★ Lead' : '—'}
              </span>
            </div>
          </label>
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
            placeholder="user@company.com"
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Set this, then have the user sign in at <code>/login</code> with this email.
            {isLinked && (
              <span style={{ color: 'var(--color-warn)' }}>
                {' '}Changing email on a linked user clears the auth link; they'll need to sign in again.
              </span>
            )}
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
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Role</span>
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
              Changing role to <b>{role}</b> will hide this user from the User Profiles list
              (this view shows role = engineer; toggle "Show inactive" doesn't affect role filtering).
            </p>
          )}
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
            placeholder="Anything you want to remember about this user..."
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
        </label>

        <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <span className="t-small t-muted uppercase tracking-wider block">Account status</span>
              <p className="t-small t-muted mt-0.5">
                Inactive users are hidden from Buildings, On-call, and other tabs by default.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActive(!active)}
              className="t-small px-3 py-1 rounded border font-medium"
              style={
                active
                  ? { color: 'var(--color-danger)', borderColor: 'var(--color-danger)', background: 'transparent' }
                  : { color: 'white', background: 'var(--color-ok)', borderColor: 'var(--color-ok)' }
              }
            >
              {active ? 'Deactivate user' : 'Reactivate user'}
            </button>
          </div>
        </div>

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
          row. Title / shift / lead can be set after creation via Edit.
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
            placeholder="user@company.com"
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Optional. Set this to let the user sign in via magic link.
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
