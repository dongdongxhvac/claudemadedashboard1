import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useAllUsers, useUpdateEngineerProfile, useUpdateUser, useAddEngineer,
  DISCIPLINES, ROLES,
  type EngineerRow, type Role, type Discipline,
} from '../../hooks/useEngineers';
import { useShifts } from '../../hooks/useShifts';
import { useUparkUserIds } from '../../hooks/useSiteScope';
import { useMe } from '../../hooks/useMe';
import { supabase } from '../../lib/supabase';

type Filter = 'active' | 'engineer' | 'manager' | 'director' | 'admin' | 'inactive';
const FILTERS_ADMIN: { key: Filter; label: string }[] = [
  { key: 'active',   label: 'All active' },
  { key: 'engineer', label: 'Engineers' },
  { key: 'manager',  label: 'Managers' },
  { key: 'director', label: 'Directors' },
  { key: 'admin',    label: 'Admins' },
  { key: 'inactive', label: 'Inactive' },
];
// Leads only see engineers (active + inactive). No managers / directors / admins.
const FILTERS_LEAD: { key: Filter; label: string }[] = [
  { key: 'engineer', label: 'Engineers' },
  { key: 'inactive', label: 'Inactive engineers' },
];

function applyFilter(rows: EngineerRow[], f: Filter): EngineerRow[] {
  switch (f) {
    case 'active':   return rows.filter((r) => r.active);
    case 'engineer': return rows.filter((r) => r.active && r.role === 'engineer');
    case 'manager':  return rows.filter((r) => r.active && r.role === 'manager');
    case 'director': return rows.filter((r) => r.active && r.role === 'director');
    case 'admin':    return rows.filter((r) => r.active && r.role === 'admin');
    case 'inactive': return rows.filter((r) => !r.active);
  }
}

// ── Credential/activity helpers (invite links + account activity log) ──────
// Who may set passwords, generate invite links and read the activity log.
// Matches the edge functions' gate: admin/manager/director roles or the
// is_manager permission flag. (Leads and engineers see none of it.)
function useCanCredential(): boolean {
  const me = useMe();
  return !!me.data && me.data.active &&
    (['admin', 'manager', 'director'].includes(me.data.role) || me.data.is_manager === true);
}

/** Last sign-in per user via the manager-gated get_auth_activity() RPC
 *  (auth.users isn't client-readable). Map of user_id → ISO timestamp. */
function useAuthActivity(enabled: boolean) {
  return useQuery({
    queryKey: ['auth_activity'],
    enabled,
    queryFn: async (): Promise<Map<string, string | null>> => {
      const { data, error } = await supabase.rpc('get_auth_activity');
      if (error) throw error;
      const m = new Map<string, string | null>();
      for (const r of (data ?? []) as { user_id: string; last_sign_in_at: string | null }[]) {
        m.set(r.user_id, r.last_sign_in_at);
      }
      return m;
    },
    staleTime: 60_000,
  });
}

type AccountEvent = {
  id: string;
  target_user_id: string;
  actor_user_id: string | null;
  event: 'invite_link_generated' | 'reset_link_generated' | 'password_set' | 'auth_account_created' | 'signed_in';
  detail: string | null;
  created_at: string;
  actor?: { full_name: string } | null;
  target?: { full_name: string } | null;
};

const EVENT_LABELS: Record<AccountEvent['event'], string> = {
  invite_link_generated: 'Invite link generated',
  reset_link_generated:  'Reset link generated',
  password_set:          'Password set',
  auth_account_created:  'Account created',
  signed_in:             'Signed in',
};

/** "3d ago" style relative timestamp for the activity surfaces. */
function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 60) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function UserProfilesTab({ canManageUsers = true }: { canManageUsers?: boolean }) {
  const q = useAllUsers();
  const shiftsQ = useShifts();
  const updateProfile = useUpdateEngineerProfile();
  const updateUser = useUpdateUser();
  const addEngineer = useAddEngineer();
  const [editing, setEditing] = useState<EngineerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>(canManageUsers ? 'active' : 'engineer');
  const canCredential = useCanCredential();
  const activityQ = useAuthActivity(canCredential);

  const FILTERS = canManageUsers ? FILTERS_ADMIN : FILTERS_LEAD;

  // UPark home-site scope (NULL home_site = UPark; see useSiteScope.ts) —
  // Binney people are managed from /binney/admin, one click away via the
  // → Binney St nav link. Fails open while the id set loads.
  const uparkIds = useUparkUserIds();

  // Leads only ever see engineer rows (active + inactive).
  const allRows = (q.data ?? [])
    .filter((r) => !uparkIds || uparkIds.has(r.user_id))
    .filter((r) => canManageUsers || r.role === 'engineer');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { active: 0, engineer: 0, manager: 0, director: 0, admin: 0, inactive: 0 };
    for (const r of allRows) {
      if (r.active) {
        c.active++;
        if (r.role === 'engineer') c.engineer++;
        else if (r.role === 'manager')  c.manager++;
        else if (r.role === 'director') c.director++;
        else if (r.role === 'admin')    c.admin++;
      } else {
        c.inactive++;
      }
    }
    return c;
  }, [allRows]);

  if (q.isLoading) return <p className="t-text t-muted">Loading users...</p>;
  if (q.isError) return <p className="t-text t-danger">Error: {(q.error as Error).message}</p>;

  const rows = applyFilter(allRows, filter);
  const shifts = shiftsQ.data ?? [];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="t-card">
        <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="t-section-title">User profiles</h2>
            <div className="flex items-center gap-1 flex-wrap">
              {FILTERS.map((f) => {
                const isActive = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className="t-small px-2.5 py-0.5 rounded-full border"
                    style={
                      isActive
                        ? {
                            background: 'var(--color-accent)',
                            borderColor: 'var(--color-accent)',
                            color: 'white',
                            fontWeight: 600,
                          }
                        : {
                            background: 'var(--color-card)',
                            borderColor: 'var(--color-border)',
                            color: 'var(--color-text-muted)',
                          }
                    }
                  >
                    {f.label} <span style={{ opacity: isActive ? 0.85 : 0.6, fontSize: 11 }}>· {counts[f.key]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="t-small t-muted">{rows.length} shown</span>
            {canManageUsers && (
              <button
                onClick={() => setAdding(true)}
                className="t-small px-3 py-1 rounded border font-medium text-white"
                style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
              >
                + Add user
              </button>
            )}
            {!canManageUsers && (
              <span className="t-small px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.15)', color: '#a16207', fontSize: 11, fontWeight: 500 }} title="Leads can view but not edit user profiles">
                ★ View only
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full t-text border-collapse">
            <thead>
              <tr className="text-left t-small t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 px-2">Role</th>
                <th className="py-2 px-2">Title</th>
                <th className="py-2 px-2">Shift</th>
                <th className="py-2 px-2">Email · sign-in</th>
                {canCredential && <th className="py-2 px-2">Last sign-in</th>}
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={canCredential ? 7 : 6} className="py-6 text-center t-text t-muted italic">
                  No users match this filter.
                </td></tr>
              )}
              {rows.map((r) => {
                const shift = r.shift_id ? shiftById.get(r.shift_id) : null;
                return (
                  <tr
                    key={r.user_id}
                    className="border-b t-row-hover"
                    style={{
                      borderColor: 'var(--color-border-soft)',
                      opacity: r.active ? 1 : 0.55,
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
                    <td className="py-2 px-2">
                      <RoleBadge role={r.role} />
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
                    {canCredential && (
                      <td className="py-2 px-2 t-small t-muted whitespace-nowrap"
                        title={(() => {
                          const ts = activityQ.data?.get(r.user_id);
                          return ts ? new Date(ts).toLocaleString() : 'Never signed in';
                        })()}
                      >
                        {fmtAgo(activityQ.data?.get(r.user_id))}
                      </td>
                    )}
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
                        {canManageUsers ? 'Edit' : 'View'}
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

      {canCredential && (
        <AccountActivityFeed userIds={new Set(allRows.map((r) => r.user_id))} />
      )}

      {editing && (
        <EditDrawer
          row={editing}
          shifts={shifts}
          readOnly={!canManageUsers}
          onClose={() => setEditing(null)}
          onSave={async (patch, userPatch) => {
            const tasks: Promise<unknown>[] = [];
            const _userPatch: { email?: string | null; phone?: string | null; role?: Role; active?: boolean; full_name?: string; is_manager?: boolean } = {};
            if (userPatch.full_name !== undefined && userPatch.full_name !== editing.full_name) _userPatch.full_name = userPatch.full_name;
            if (userPatch.email !== undefined && userPatch.email !== editing.email) _userPatch.email = userPatch.email;
            if (userPatch.phone !== undefined && userPatch.phone !== editing.phone) _userPatch.phone = userPatch.phone;
            if (userPatch.role !== undefined && userPatch.role !== editing.role)    _userPatch.role  = userPatch.role;
            if (userPatch.active !== undefined && userPatch.active !== editing.active) _userPatch.active = userPatch.active;
            if (userPatch.is_manager !== undefined && userPatch.is_manager !== editing.is_manager) _userPatch.is_manager = userPatch.is_manager;
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
        <AddUserDrawer
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

function RoleBadge({ role }: { role: Role }) {
  const cfg: Record<Role, { label: string; bg: string; color: string }> = {
    engineer: { label: 'Engineer', bg: 'rgba(59,130,246,0.12)', color: '#1e40af' },
    manager:  { label: 'Manager',  bg: 'rgba(168,85,247,0.12)', color: '#7e22ce' },
    director: { label: 'Director', bg: 'rgba(245,158,11,0.15)', color: '#b45309' },
    admin:    { label: 'Admin',    bg: 'rgba(244,63,94,0.12)',  color: '#be123c' },
    client:   { label: 'Client',   bg: 'rgba(20,184,166,0.12)', color: '#0f766e' },
    tv:       { label: 'TV',       bg: 'rgba(100,116,139,0.15)', color: '#475569' },
  };
  const c = cfg[role];
  return (
    <span className="t-small px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.color, fontWeight: 500, fontSize: 11 }}>
      {c.label}
    </span>
  );
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

type ProfilePatch = Partial<Pick<EngineerRow, 'discipline' | 'level' | 'notes' | 'visible_to_self' | 'title' | 'shift_id' | 'is_lead' | 'cmms_assignee_name' | 'plantlog_username'>>;
type UserPatch = { full_name: string; email: string | null; phone: string | null; role: Role; active: boolean; is_manager: boolean };

function EditDrawer({
  row,
  shifts,
  readOnly = false,
  onClose,
  onSave,
}: {
  row: EngineerRow;
  shifts: { id: string; name: string }[];
  readOnly?: boolean;
  onClose: () => void;
  onSave: (profile: ProfilePatch, user: UserPatch) => Promise<void>;
}) {
  const [fullName, setFullName] = useState<string>(row.full_name);
  const [title, setTitle] = useState<string>(row.title ?? '');
  const [cmmsName, setCmmsName] = useState<string>(row.cmms_assignee_name ?? '');
  const [plantlogUsername, setPlantlogUsername] = useState<string>(row.plantlog_username ?? '');
  const [email, setEmail] = useState<string>(row.email ?? '');
  const [phone, setPhone] = useState<string>(row.phone ?? '');
  const [role, setRole] = useState<Role>(row.role);
  const [shiftId, setShiftId] = useState<string>(row.shift_id ?? '');
  const [isLead, setIsLead] = useState<boolean>(row.is_lead);
  const [isManager, setIsManager] = useState<boolean>(row.is_manager);
  const [discipline, setDiscipline] = useState<EngineerRow['discipline']>(row.discipline);
  const [level, setLevel] = useState<number>(row.level);
  const [notes, setNotes] = useState<string>(row.notes ?? '');
  const [active, setActive] = useState<boolean>(row.active);
  const [saving, setSaving] = useState(false);

  const isLinked = !!row.auth_user_id;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(
        {
          title: title.trim() || null,
          cmms_assignee_name: cmmsName.trim() || null,
          plantlog_username: plantlogUsername.trim() || null,
          shift_id: shiftId || null,
          is_lead: isLead,
          discipline,
          level,
          notes: notes.trim() || null,
        },
        {
          full_name: fullName.trim() || row.full_name,
          email: email.trim() === '' ? null : email.trim(),
          phone: phone.trim() === '' ? null : phone.trim(),
          role,
          active,
          is_manager: isManager,
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
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full overflow-y-auto p-6"
        style={{ background: 'var(--color-card)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="t-section-title">
              {row.full_name}
              {readOnly && (
                <span className="t-small ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.15)', color: '#a16207', fontSize: 11, fontWeight: 500 }}>
                  ★ View only
                </span>
              )}
            </h3>
            <p className="t-small t-muted">CMMS: {row.cmms_assignee_name ?? '—'}</p>
          </div>
          <button type="button" onClick={onClose} className="t-small t-muted hover:underline">Close</button>
        </div>

        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, opacity: readOnly ? 0.85 : 1 }}>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Full name</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full border rounded px-2 py-1 t-text"
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
        </label>

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
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Manager</span>
            <div className="flex items-center gap-2 h-7">
              <Toggle
                checked={isManager}
                onChange={setIsManager}
                title={isManager ? 'Click to remove manager rights' : 'Click to grant manager rights (publish drafts)'}
              />
              <span className="t-small" style={{ color: isManager ? '#7e22ce' : 'var(--color-text-muted)' }}>
                {isManager ? '✓ Manager' : '—'}
              </span>
            </div>
          </label>
        </div>

        <p className="t-small t-muted -mt-2 mb-3" style={{ paddingLeft: 2 }}>
          <strong>Lead</strong> can propose changes to On-call / Bldg Assign / Rounds.{' '}
          <strong>Manager</strong> can also publish or reject drafts. Both are independent of Role.
        </p>

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
          <span className="t-small t-muted uppercase tracking-wider block mb-1">CMMS assignee name</span>
          <input
            type="text"
            value={cmmsName}
            onChange={(e) => setCmmsName(e.target.value)}
            placeholder="exact spelling from CMMS exports (engineers only)"
            className="w-full border rounded px-2 py-1 t-text t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Must match the <code>Assigned To</code> column in PM CSV exports exactly. Only relevant for engineers; XP won't accumulate if this doesn't match.
          </p>
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Plantlog username</span>
          <input
            type="text"
            value={plantlogUsername}
            onChange={(e) => setPlantlogUsername(e.target.value)}
            placeholder='exact username from plantlog (e.g. "Bgonzalez", "Mdonovan")'
            className="w-full border rounded px-2 py-1 t-text t-mono"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          />
          <p className="t-small t-muted mt-1">
            Maps plantlog activity (rounds, readings) to this profile so the §06 panel can show full names. Engineers only.
          </p>
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

        </fieldset>

        {/* Credential panels self-gate on admin/manager (useCanCredential) —
            managers get them inside the otherwise view-only drawer; leads
            and engineers see none of them. */}
        <PasswordPanel userId={row.user_id} email={email} />
        <InviteLinkPanel userId={row.user_id} email={email} />
        <AccountActivityPanel userId={row.user_id} />

        {!readOnly && (
          <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between">
              <div>
                <span className="t-small t-muted uppercase tracking-wider block">Account status</span>
                <p className="t-small t-muted mt-0.5">
                  Inactive users are hidden from Buildings, On-call, and other tabs.
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
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              type="submit"
              disabled={saving}
              className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function AddUserDrawer({
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
    role?: Role;
  }) => Promise<void>;
  submitting: boolean;
  error: string | null;
}) {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('engineer');
  const [cmmsName, setCmmsName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [hiringDate, setHiringDate] = useState('');
  const [discipline, setDiscipline] = useState<Discipline | ''>('');
  const [cmmsTouched, setCmmsTouched] = useState(false);

  const cmmsRequired = role === 'engineer';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    if (cmmsRequired && !cmmsName.trim()) return;
    await onSubmit({
      full_name: fullName,
      cmms_assignee_name: cmmsName,
      email: email.trim() || null,
      phone: phone.trim() || null,
      hiring_date: hiringDate || null,
      discipline: discipline || null,
      role,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full overflow-y-auto p-6"
        style={{ background: 'var(--color-card)' }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="t-section-title">Add user</h3>
          <button type="button" onClick={onClose} className="t-small t-muted hover:underline">
            Close
          </button>
        </div>

        <p className="t-small t-muted mb-4">
          Creates a public.users row. The engineer_profiles row is auto-created
          by trigger. Title / shift / lead can be set after creation via Edit.
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
          <span className="t-small t-muted uppercase tracking-wider block mb-1">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>

        <label className="block mb-3">
          <span className="t-small t-muted uppercase tracking-wider block mb-1">
            CMMS assignee name {cmmsRequired && <span style={{ color: 'var(--color-danger)' }}>*</span>}
          </span>
          <input
            type="text"
            required={cmmsRequired}
            value={cmmsName}
            onChange={(e) => {
              setCmmsName(e.target.value);
              setCmmsTouched(true);
            }}
            placeholder={cmmsRequired ? 'exact spelling from CMMS exports' : '(optional for non-engineers)'}
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
            disabled={submitting || !fullName.trim() || (cmmsRequired && !cmmsName.trim())}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {submitting ? 'Adding...' : 'Add user'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// PasswordPanel — admin sets/changes another user's password via Edge Function.
// Useful when corporate email filters block magic links (e.g. Mimecast).
// ============================================================================
function PasswordPanel({ userId, email }: { userId: string; email: string }) {
  const canCredential = useCanCredential();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [status, setStatus]     = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [message, setMessage]   = useState<string | null>(null);

  const submit = async () => {
    if (password.length < 8) { setStatus('error'); setMessage('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setStatus('error'); setMessage('Passwords do not match.'); return; }
    if (!email.trim())        { setStatus('error'); setMessage('Set a sign-in email first (and save), then return to set a password.'); return; }
    setStatus('saving');
    setMessage(null);
    const { data, error } = await supabase.functions.invoke('admin-set-password', {
      body: { target_user_id: userId, new_password: password },
    });
    if (error) {
      const ctx = (error as { context?: { error?: string } }).context;
      setStatus('error');
      setMessage(ctx?.error ?? error.message);
      return;
    }
    const created = (data as { created_auth_user?: boolean })?.created_auth_user;
    setStatus('ok');
    setPassword('');
    setConfirm('');
    setMessage(created
      ? 'Password set. Auth account created — user can now sign in with email + password.'
      : 'Password updated.');
    qc.invalidateQueries({ queryKey: ['user_account_events'] });
  };

  if (!canCredential) return null;

  return (
    <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--color-border)' }}>
      <span className="t-small t-muted uppercase tracking-wider block">Password</span>
      <p className="t-small t-muted mt-0.5 mb-2">
        Set a password for this user. They can then sign in via the Password tab on /login
        without an email round-trip — useful when corporate filters block magic links.
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 8 characters)"
          className="w-full border rounded px-2 py-1 t-text"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          className="w-full border rounded px-2 py-1 t-text"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={status === 'saving' || !password || !confirm}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {status === 'saving' ? 'Setting…' : 'Set password'}
          </button>
          {status === 'ok'    && <span className="t-small" style={{ color: 'var(--color-ok)' }}>{message}</span>}
          {status === 'error' && <span className="t-small t-danger">{message}</span>}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// InviteLinkPanel — generate a one-time link (admin-invite-link edge fn) the
// user opens to set their own password. Copy-to-clipboard pattern follows
// MroFieldLink. Self-gated to admin/manager like PasswordPanel.
// ============================================================================
function InviteLinkPanel({ userId, email }: { userId: string; email: string }) {
  const canCredential = useCanCredential();
  const qc = useQueryClient();
  const [link, setLink]     = useState<string | null>(null);
  const [kind, setKind]     = useState<'invite' | 'recovery' | null>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!email.trim()) {
      setStatus('error');
      setMessage('Set a sign-in email first (and save), then return to generate a link.');
      return;
    }
    setStatus('working');
    setMessage(null);
    const { data, error } = await supabase.functions.invoke('admin-invite-link', {
      body: { target_user_id: userId, redirect_to: `${location.origin}/set-password` },
    });
    if (error) {
      const ctx = (error as { context?: { error?: string } }).context;
      setStatus('error');
      setMessage(ctx?.error ?? error.message);
      return;
    }
    const res = data as { link?: string; action_link?: string; kind?: 'invite' | 'recovery' };
    const bestLink = res?.link ?? res?.action_link;
    if (!bestLink) {
      setStatus('error');
      setMessage('No link returned — try again.');
      return;
    }
    setLink(bestLink);
    setKind(res.kind ?? 'invite');
    setStatus('idle');
    setCopied(false);
    qc.invalidateQueries({ queryKey: ['user_account_events'] });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage('Copy failed — select the link text and copy manually.');
    }
  };

  if (!canCredential) return null;

  return (
    <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--color-border)' }}>
      <span className="t-small t-muted uppercase tracking-wider block">Invite link</span>
      <p className="t-small t-muted mt-0.5 mb-2">
        Generate a one-time link this user opens to set their own password — send it by
        text/Teams. Each new link replaces the old one, and links expire quickly. Don't
        open it yourself: it signs you in as them.
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={status === 'working'}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            {status === 'working' ? 'Generating…' : link ? 'Generate new link' : 'Generate invite link'}
          </button>
          {status === 'error' && <span className="t-small t-danger">{message}</span>}
        </div>
        {link && (
          <div>
            <div className="t-small t-muted mb-1">
              {kind === 'recovery'
                ? 'Password reset link — this user already has an account.'
                : 'Invite link — first sign-in, they pick their own password.'}
            </div>
            <div className="flex items-center gap-2">
              <code
                className="t-small flex-1 px-2 py-1 rounded border"
                style={{
                  borderColor: 'var(--color-border)', background: 'var(--color-bg)',
                  overflowWrap: 'anywhere', maxHeight: 64, overflow: 'auto',
                }}
              >
                {link}
              </code>
              <button
                type="button"
                onClick={copy}
                className="t-small px-2 py-1 rounded border shrink-0"
                style={{ color: 'var(--color-accent)', borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// AccountActivityPanel — per-user credential + sign-in history from
// user_account_events (0104). Sign-ins are recorded by a DB trigger on
// auth.users.last_sign_in_at. Self-gated to admin/manager.
// ============================================================================
function AccountActivityPanel({ userId }: { userId: string }) {
  const canCredential = useCanCredential();
  const q = useQuery({
    queryKey: ['user_account_events', userId],
    enabled: canCredential,
    queryFn: async (): Promise<AccountEvent[]> => {
      const { data, error } = await supabase
        .from('user_account_events')
        .select('*, actor:users!user_account_events_actor_user_id_fkey(full_name)')
        .eq('target_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AccountEvent[];
    },
    staleTime: 30_000,
  });

  if (!canCredential) return null;

  return (
    <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--color-border)' }}>
      <span className="t-small t-muted uppercase tracking-wider block mb-1">Account activity</span>
      {q.isLoading ? (
        <p className="t-small t-muted italic">Loading…</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="t-small t-muted italic">No account activity recorded yet.</p>
      ) : (
        <ul className="space-y-0.5" style={{ maxHeight: 180, overflow: 'auto' }}>
          {(q.data ?? []).map((e) => (
            <li key={e.id} className="t-small flex items-baseline gap-2">
              <span className="t-muted t-mono shrink-0" style={{ minWidth: 64 }} title={new Date(e.created_at).toLocaleString()}>
                {fmtAgo(e.created_at)}
              </span>
              <span>{EVENT_LABELS[e.event] ?? e.event}</span>
              {e.actor?.full_name && <span className="t-muted">by {e.actor.full_name}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// AccountActivityFeed — site-wide credential-event feed under the users table.
// Sign-ins are excluded here (they'd flood it) — they live in each user's
// drawer panel + the Last sign-in column. Collapsed by default.
// ============================================================================
function AccountActivityFeed({ userIds }: { userIds: Set<string> }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['user_account_events', 'feed'],
    enabled: open,
    queryFn: async (): Promise<AccountEvent[]> => {
      const { data, error } = await supabase
        .from('user_account_events')
        .select('*, actor:users!user_account_events_actor_user_id_fkey(full_name), target:users!user_account_events_target_user_id_fkey(full_name)')
        .neq('event', 'signed_in')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AccountEvent[];
    },
    staleTime: 30_000,
  });

  const rows = (q.data ?? []).filter((e) => userIds.has(e.target_user_id));

  return (
    <div className="t-card mt-4" style={{ padding: '0.75rem 1rem' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="t-small t-muted uppercase tracking-wider flex items-center gap-2"
      >
        <span>{open ? '▾' : '▸'}</span> Account activity feed
      </button>
      {open && (
        q.isLoading ? (
          <p className="t-small t-muted italic mt-2">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="t-small t-muted italic mt-2">No credential activity yet.</p>
        ) : (
          <ul className="space-y-0.5 mt-2" style={{ maxHeight: 240, overflow: 'auto' }}>
            {rows.map((e) => (
              <li key={e.id} className="t-small flex items-baseline gap-2 flex-wrap">
                <span className="t-muted t-mono shrink-0" style={{ minWidth: 64 }} title={new Date(e.created_at).toLocaleString()}>
                  {fmtAgo(e.created_at)}
                </span>
                <span className="font-medium">{e.target?.full_name ?? '?'}</span>
                <span>{EVENT_LABELS[e.event] ?? e.event}</span>
                {e.actor?.full_name && <span className="t-muted">by {e.actor.full_name}</span>}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
