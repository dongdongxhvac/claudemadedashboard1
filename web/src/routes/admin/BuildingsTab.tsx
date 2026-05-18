// Admin → Buildings tab (Phase 3: edit mode).
//
// Direct-write model: every action in edit mode fires a mutation immediately
// (no Save/Cancel buffer — assignment rows are independent and atomic).
//
// Edit interactions:
//   - Click a chip          → popover: change engineer, change role, remove
//   - Click "+ Add building" → popover: pick building + role for this engineer
//   - Click an unassigned tray chip → popover: pick engineer + role
//   - Per-row shift select   → moves engineer to a different shift / unassigns
//   - Per-row ★ toggle       → flips engineer_profiles.is_lead
import { useEffect, useMemo, useState } from 'react';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useShifts, useShiftsRealtime, fmtShiftTime, type Shift } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import {
  useCurrentBuildingAssignments,
  useBuildingAssignmentsRealtime,
  useCreateAssignment,
  useEndAssignment,
  useChangeRole,
  useAssignPrimary,
  useUpdateEngineerShiftAndLead,
  type BuildingAssignment,
  type AssignmentRole,
} from '../../hooks/useBuildingAssignments';

type ChipDisplay = { assignment_id: string; building: Building };

type EngineerCard = {
  user_id: string;
  full_name: string;
  phone: string | null;
  is_lead: boolean;
  shift_id: string | null;
  primary: ChipDisplay[];
  backup: ChipDisplay[];
};

type ShiftGroup = {
  key: string;
  label: string;
  times: string | null;
  engineers: EngineerCard[];
};

type MenuTarget =
  | { kind: 'chip'; assignment_id: string }
  | { kind: 'add'; user_id: string }
  | { kind: 'unassigned'; building_id: string };

function menuKey(t: MenuTarget): string {
  if (t.kind === 'chip') return `chip:${t.assignment_id}`;
  if (t.kind === 'add')  return `add:${t.user_id}`;
  return `tray:${t.building_id}`;
}

export function BuildingsTab() {
  useShiftsRealtime();
  useBuildingsRealtime();
  useBuildingAssignmentsRealtime();

  const engineersQ = useEngineers();
  const shiftsQ = useShifts();
  const buildingsQ = useBuildings();
  const assignmentsQ = useCurrentBuildingAssignments();

  const [editing, setEditing] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const closeMenu = () => setOpenMenu(null);

  // Click-outside closes the open menu. Skip the click that opened it.
  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = () => closeMenu();
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', onDocClick); };
  }, [openMenu]);

  // Auto-close menu when leaving edit mode
  useEffect(() => { if (!editing) closeMenu(); }, [editing]);

  const loading = engineersQ.isLoading || shiftsQ.isLoading || buildingsQ.isLoading || assignmentsQ.isLoading;
  const error = engineersQ.error ?? shiftsQ.error ?? buildingsQ.error ?? assignmentsQ.error;

  const groups: ShiftGroup[] = useMemo(() => {
    if (!engineersQ.data || !shiftsQ.data || !buildingsQ.data || !assignmentsQ.data) return [];
    return buildGroups(engineersQ.data, shiftsQ.data, buildingsQ.data, assignmentsQ.data);
  }, [engineersQ.data, shiftsQ.data, buildingsQ.data, assignmentsQ.data]);

  const totals = useMemo(() => {
    let p = 0, s = 0;
    for (const g of groups) for (const e of g.engineers) { p += e.primary.length; s += e.backup.length; }
    return { engineers: groups.reduce((a, g) => a + g.engineers.length, 0), primary: p, backup: s };
  }, [groups]);

  const unassignedBuildings: Building[] = useMemo(() => {
    if (!buildingsQ.data || !assignmentsQ.data) return [];
    const covered = new Set(
      assignmentsQ.data
        .filter((a) => a.role_in_building === 'primary')
        .map((a) => a.building_id),
    );
    return buildingsQ.data.filter((b) => !covered.has(b.id));
  }, [buildingsQ.data, assignmentsQ.data]);

  if (loading) return <p className="t-text t-muted">Loading building assignments…</p>;
  if (error) return <p className="t-text t-danger">Error: {(error as Error).message}</p>;

  const engineers = (engineersQ.data ?? []).filter((e) => e.active && e.role === 'engineer');
  const buildings = buildingsQ.data ?? [];
  const assignments = assignmentsQ.data ?? [];

  return (
    <div className="space-y-3 buildings-root">
      <BuildingsTabStyles />

      <div className="t-card buildings-card" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
          <div>
            <h2 className="t-section-title">Building assignments</h2>
            <p className="t-small t-muted">
              <b>{totals.engineers}</b> engineer{totals.engineers === 1 ? '' : 's'} ·{' '}
              <b>{totals.primary}</b> primary · <b>{totals.backup}</b> coverage
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="t-small t-muted text-right">
              <span className="bld-chip primary" style={{ marginRight: 6 }}>40</span> primary · day-to-day owner &nbsp;
              <span className="bld-chip backup" style={{ marginRight: 6 }}>40</span> coverage · alarm + high-level repair &nbsp;
              <span className="lead-star">★</span> lead engineer
            </p>
            <div className="flex items-center gap-2 buildings-no-print">
              <button
                onClick={() => window.print()}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                title="Print landscape, ready to post in the shop"
              >
                ⎙ Print
              </button>
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="t-small px-3 py-1 rounded border font-medium text-white"
                  style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
                >
                  Web Edit
                </button>
              ) : (
                <button
                  onClick={() => setEditing(false)}
                  className="t-small px-3 py-1 rounded font-medium text-white"
                  style={{ background: 'var(--color-ok)' }}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>

        {editing && (
          <div className="mb-3 p-2 rounded border buildings-no-print"
            style={{ borderColor: 'var(--color-accent)', background: 'rgba(59, 130, 246, 0.06)' }}>
            <p className="t-small">
              <b>Editing mode</b> · changes save immediately. Click a chip to reassign or remove · use the row controls to change shift, toggle ★ lead, or add a building · click an unassigned-tray chip to assign it.
            </p>
          </div>
        )}

        <table className="min-w-full t-text border-collapse">
          <colgroup>
            <col style={{ width: editing ? '220px' : '180px' }} />
            <col />
            <col style={{ width: '120px' }} />
          </colgroup>
          <thead>
            <tr className="text-left t-text t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
              <th className="py-0.5 pr-1">Engineer</th>
              <th className="py-0.5 px-1">Assigned buildings</th>
              <th className="py-0.5 px-1">Phone</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <ShiftBlock
                key={g.key}
                group={g}
                editing={editing}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                engineers={engineers}
                buildings={buildings}
                assignments={assignments}
                shifts={shiftsQ.data ?? []}
              />
            ))}
          </tbody>
        </table>

        {unassignedBuildings.length > 0 && (
          <div className="mt-4 p-3 rounded border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="t-small t-muted uppercase tracking-wider mb-1">
              Unassigned buildings ({unassignedBuildings.length})
            </p>
            <div>
              {unassignedBuildings.map((b) => {
                const key = menuKey({ kind: 'unassigned', building_id: b.id });
                return (
                  <span key={b.id} style={{ position: 'relative', display: 'inline-block' }}>
                    <button
                      type="button"
                      disabled={!editing}
                      onClick={(e) => {
                        if (!editing) return;
                        e.stopPropagation();
                        setOpenMenu(openMenu === key ? null : key);
                      }}
                      className={`bld-chip backup ${editing ? 'chip-editable' : ''}`}
                      title={editing ? `Assign ${b.name}` : b.name}
                      style={editing ? { cursor: 'pointer' } : undefined}
                    >
                      {b.short_code ?? b.code}
                    </button>
                    {openMenu === key && (
                      <ChipMenu
                        mode="create"
                        lockedBuilding={b}
                        defaultRole="primary"
                        engineers={engineers}
                        buildings={buildings}
                        onClose={closeMenu}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Shift block
// ============================================================================

function ShiftBlock(props: {
  group: ShiftGroup;
  editing: boolean;
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  assignments: BuildingAssignment[];
  shifts: Shift[];
}) {
  const { group } = props;
  return (
    <>
      <tr>
        <td colSpan={3} className="shift-band">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="t-section-title" style={{ fontSize: 14 }}>{group.label}</span>
            <span className="t-small t-muted">
              · {group.engineers.length} engineer{group.engineers.length === 1 ? '' : 's'}
            </span>
            {group.times && (
              <span className="t-small t-mono" style={{ fontWeight: 700, color: 'var(--color-text)' }}>
                · {group.times}
              </span>
            )}
          </div>
        </td>
      </tr>
      {group.engineers.length === 0 ? (
        <tr>
          <td colSpan={3} className="py-3 px-2 t-small t-muted italic">No engineers in this shift yet.</td>
        </tr>
      ) : (
        group.engineers.map((e) => (
          <EngineerRowView key={e.user_id} eng={e} {...props} />
        ))
      )}
    </>
  );
}

// ============================================================================
// Engineer row
// ============================================================================

function EngineerRowView(props: {
  eng: EngineerCard;
  editing: boolean;
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  assignments: BuildingAssignment[];
  shifts: Shift[];
}) {
  const { eng, editing, openMenu, setOpenMenu, engineers, buildings, assignments, shifts } = props;
  const updateEng = useUpdateEngineerShiftAndLead();

  const closeMenu = () => setOpenMenu(null);
  const addKey = menuKey({ kind: 'add', user_id: eng.user_id });

  return (
    <tr className="border-b eng-row" style={{ borderColor: 'var(--color-border-soft)' }}>
      <td className="py-1 pr-1 align-top">
        <div className="flex items-center flex-wrap gap-1">
          {editing ? (
            <button
              type="button"
              onClick={() => updateEng.mutate({ user_id: eng.user_id, patch: { is_lead: !eng.is_lead } })}
              title={eng.is_lead ? 'Remove lead status' : 'Mark as lead engineer'}
              className="lead-star buildings-no-print"
              style={{
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: eng.is_lead ? '#d4a017' : '#cbd5e1',
              }}
            >
              ★
            </button>
          ) : (
            eng.is_lead && <span className="lead-star" title="Lead engineer">★</span>
          )}
          <span className="font-medium t-text">{eng.full_name}</span>
        </div>
        {editing && (
          <div className="mt-1 buildings-no-print">
            <label className="t-small t-muted">
              Shift:{' '}
              <select
                value={eng.shift_id ?? ''}
                onChange={(e) => updateEng.mutate({ user_id: eng.user_id, patch: { shift_id: e.target.value || null } })}
                className="border rounded px-1 py-0.5 t-text"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', fontSize: '11px' }}
              >
                <option value="">— none —</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </td>
      <td className="py-1 px-1 align-top">
        {eng.primary.length === 0 && eng.backup.length === 0 && !editing ? (
          <span className="t-small t-muted italic">No buildings assigned</span>
        ) : (
          <>
            {eng.primary.map((c) => (
              <ChipWithMenu
                key={`p-${c.assignment_id}`}
                kind="primary"
                chip={c}
                editing={editing}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                engineers={engineers}
                buildings={buildings}
                assignments={assignments}
                currentUserId={eng.user_id}
              />
            ))}
            {eng.backup.map((c) => (
              <ChipWithMenu
                key={`b-${c.assignment_id}`}
                kind="backup"
                chip={c}
                editing={editing}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                engineers={engineers}
                buildings={buildings}
                assignments={assignments}
                currentUserId={eng.user_id}
              />
            ))}
            {editing && (
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenu(openMenu === addKey ? null : addKey);
                  }}
                  className="bld-chip backup chip-editable buildings-no-print"
                  style={{ cursor: 'pointer', borderStyle: 'solid', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                  title="Add a building to this engineer"
                >
                  + add
                </button>
                {openMenu === addKey && (
                  <ChipMenu
                    mode="create"
                    lockedEngineer={engineers.find((e) => e.user_id === eng.user_id) ?? null}
                    defaultRole="primary"
                    engineers={engineers}
                    buildings={buildings}
                    onClose={closeMenu}
                  />
                )}
              </span>
            )}
          </>
        )}
      </td>
      <td className="py-1 px-1 t-small t-mono align-top">{eng.phone ?? <span className="t-muted">—</span>}</td>
    </tr>
  );
}

// ============================================================================
// Chip with menu
// ============================================================================

function ChipWithMenu(props: {
  kind: 'primary' | 'backup';
  chip: ChipDisplay;
  editing: boolean;
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  assignments: BuildingAssignment[];
  currentUserId: string;
}) {
  const { kind, chip, editing, openMenu, setOpenMenu, engineers, buildings, assignments, currentUserId } = props;
  const role: AssignmentRole = kind === 'primary' ? 'primary' : 'backup';
  const key = menuKey({ kind: 'chip', assignment_id: chip.assignment_id });
  const isOpen = openMenu === key;

  const titleSuffix = kind === 'backup' ? ' (coverage)' : '';
  if (!editing) {
    return (
      <span className={`bld-chip ${kind}`} title={`${chip.building.name}${titleSuffix}`}>
        {chip.building.short_code ?? chip.building.code}
      </span>
    );
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpenMenu(isOpen ? null : key); }}
        className={`bld-chip ${kind} chip-editable`}
        title={`Edit ${chip.building.name}${titleSuffix}`}
        style={{ cursor: 'pointer' }}
      >
        {chip.building.short_code ?? chip.building.code}
      </button>
      {isOpen && (
        <ChipMenu
          mode="edit"
          assignment_id={chip.assignment_id}
          lockedBuilding={chip.building}
          defaultEngineerId={currentUserId}
          defaultRole={role}
          engineers={engineers}
          buildings={buildings}
          assignments={assignments}
          onClose={() => setOpenMenu(null)}
        />
      )}
    </span>
  );
}

// ============================================================================
// Chip menu (popover): edit / create
// ============================================================================

function ChipMenu(props: {
  mode: 'edit' | 'create';
  assignment_id?: string;
  lockedBuilding?: Building;
  lockedEngineer?: EngineerRow | null;
  defaultEngineerId?: string;
  defaultRole: AssignmentRole;
  engineers: EngineerRow[];
  buildings: Building[];
  assignments?: BuildingAssignment[];
  onClose: () => void;
}) {
  const {
    mode, assignment_id, lockedBuilding, lockedEngineer,
    defaultEngineerId, defaultRole, engineers, buildings, assignments, onClose,
  } = props;

  const [engineerId, setEngineerId] = useState<string>(defaultEngineerId ?? lockedEngineer?.user_id ?? '');
  const [buildingId, setBuildingId] = useState<string>(lockedBuilding?.id ?? '');
  const [role, setRole] = useState<AssignmentRole>(defaultRole);
  const [err, setErr] = useState<string | null>(null);

  const create = useCreateAssignment();
  const endAssign = useEndAssignment();
  const changeRole = useChangeRole();
  const assignPrimary = useAssignPrimary();

  const busy = create.isPending || endAssign.isPending || changeRole.isPending || assignPrimary.isPending;

  const onSave = async () => {
    setErr(null);
    if (!engineerId || !buildingId) {
      setErr('Pick an engineer and a building.');
      return;
    }
    try {
      if (mode === 'edit' && assignment_id) {
        const current = (assignments ?? []).find((a) => a.id === assignment_id);
        if (!current) throw new Error('Assignment no longer exists — refresh.');

        const engineerChanged = current.user_id !== engineerId;
        const roleChanged = current.role_in_building !== role;
        if (!engineerChanged && !roleChanged) { onClose(); return; }

        // Path A: simple role change on the same engineer/building (backup<->primary)
        if (!engineerChanged && roleChanged) {
          if (role === 'primary') {
            // Promote: must clear any other primary on this building first
            await assignPrimary.mutateAsync({ building_id: buildingId, user_id: engineerId });
            // The new primary row was just inserted; end the original coverage row
            await endAssign.mutateAsync({ id: assignment_id });
          } else {
            await changeRole.mutateAsync({ id: assignment_id, role });
          }
        }
        // Path B: engineer changed (with or without role change)
        else if (engineerChanged) {
          await endAssign.mutateAsync({ id: assignment_id });
          if (role === 'primary') {
            await assignPrimary.mutateAsync({ building_id: buildingId, user_id: engineerId });
          } else {
            await create.mutateAsync({ building_id: buildingId, user_id: engineerId, role_in_building: 'backup' });
          }
        }
      } else {
        // create
        if (role === 'primary') {
          await assignPrimary.mutateAsync({ building_id: buildingId, user_id: engineerId });
        } else {
          await create.mutateAsync({ building_id: buildingId, user_id: engineerId, role_in_building: 'backup' });
        }
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const onRemove = async () => {
    if (!assignment_id) return;
    setErr(null);
    try {
      await endAssign.mutateAsync({ id: assignment_id });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const sortedEngineers = useMemo(
    () => engineers.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [engineers],
  );
  const sortedBuildings = useMemo(
    () => buildings.slice().sort((a, b) => (a.short_code ?? a.code).localeCompare(b.short_code ?? b.code, undefined, { numeric: true })),
    [buildings],
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="chip-menu"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 4,
        zIndex: 50,
        minWidth: 260,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        padding: 10,
      }}
    >
      <div className="space-y-2">
        <label className="block">
          <span className="t-small t-muted uppercase tracking-wider block mb-0.5">Engineer</span>
          <select
            value={engineerId}
            onChange={(e) => setEngineerId(e.target.value)}
            disabled={!!lockedEngineer}
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— pick engineer —</option>
            {sortedEngineers.map((e) => (
              <option key={e.user_id} value={e.user_id}>
                {e.is_lead ? '★ ' : ''}{e.full_name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="t-small t-muted uppercase tracking-wider block mb-0.5">Building</span>
          <select
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
            disabled={!!lockedBuilding}
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— pick building —</option>
            {sortedBuildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.short_code ?? b.code} — {b.name}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="border rounded px-2 py-1" style={{ borderColor: 'var(--color-border)' }}>
          <legend className="t-small t-muted uppercase tracking-wider px-1">Role</legend>
          <label className="t-small inline-flex items-center gap-1 mr-3 cursor-pointer">
            <input type="radio" name="role" checked={role === 'primary'} onChange={() => setRole('primary')} />
            Primary
          </label>
          <label className="t-small inline-flex items-center gap-1 cursor-pointer">
            <input type="radio" name="role" checked={role === 'backup'}  onChange={() => setRole('backup')} />
            Coverage
          </label>
        </fieldset>

        {err && (
          <p className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                className="t-small px-2 py-1 rounded border"
                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="t-small px-2 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              {busy ? '…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// styles
// ============================================================================

function BuildingsTabStyles() {
  return (
    <style>{`
      @page { size: letter landscape; margin: 0.4in; }
      @media print {
        body * { visibility: hidden !important; }
        .buildings-root, .buildings-root * { visibility: visible !important; }
        .buildings-root {
          position: absolute !important;
          top: 0; left: 0;
          width: 100%;
          padding: 12px !important;
          background: white !important;
        }
        .buildings-no-print { display: none !important; }
        .buildings-card { box-shadow: none !important; border: none !important; padding: 0 !important; }
        body { background: white !important; }
        .bld-chip, .lead-star {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        tr, .eng-row { page-break-inside: avoid; }
      }
      .bld-chip {
        display: inline-block;
        padding: 0px 6px;
        margin: 1px 2px 1px 0;
        border-radius: 5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        line-height: 1.4;
        white-space: nowrap;
      }
      .bld-chip.primary {
        background: var(--color-accent);
        color: white;
        border: 1px solid var(--color-accent);
      }
      .bld-chip.backup {
        background: rgba(148, 163, 184, 0.12);
        color: #64748b;
        border: 1.5px dashed #94a3b8;
      }
      .bld-chip.chip-editable:hover {
        filter: brightness(1.08);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }
      button.bld-chip { font: inherit; cursor: pointer; }
      .lead-star {
        display: inline-block;
        color: #d4a017;
        margin-right: 4px;
        font-size: 14px;
        line-height: 1;
      }
      .shift-band {
        background: var(--color-bg);
        border-top: 2px solid var(--color-border);
        padding: 4px 8px;
      }
    `}</style>
  );
}

// ============================================================================
// data shaping
// ============================================================================

function buildGroups(
  engineers: EngineerRow[],
  shifts: Shift[],
  buildings: Building[],
  assignments: BuildingAssignment[],
): ShiftGroup[] {
  const bldById = new Map(buildings.map((b) => [b.id, b]));
  const primaryByUser = new Map<string, ChipDisplay[]>();
  const backupByUser  = new Map<string, ChipDisplay[]>();
  for (const a of assignments) {
    const b = bldById.get(a.building_id);
    if (!b) continue;
    const map = a.role_in_building === 'primary' ? primaryByUser
              : a.role_in_building === 'backup'  ? backupByUser
              : null;
    if (!map) continue;
    const list = map.get(a.user_id) ?? [];
    list.push({ assignment_id: a.id, building: b });
    map.set(a.user_id, list);
  }

  const sortChips = (list: ChipDisplay[]) => {
    list.sort((x, y) =>
      (x.building.short_code ?? x.building.code).localeCompare(
        y.building.short_code ?? y.building.code,
        undefined,
        { numeric: true },
      ),
    );
    return list;
  };

  const cards: EngineerCard[] = engineers
    .filter((e) => e.active && e.role === 'engineer')
    .map((e) => ({
      user_id: e.user_id,
      full_name: e.full_name,
      phone: e.phone,
      is_lead: e.is_lead,
      shift_id: e.shift_id,
      primary: sortChips(primaryByUser.get(e.user_id) ?? []),
      backup:  sortChips(backupByUser.get(e.user_id)  ?? []),
    }));

  const groups: ShiftGroup[] = shifts
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({
      key: s.id,
      label: `${s.name} shift`,
      times: shiftTimesLabel(s),
      engineers: cards
        .filter((c) => c.shift_id === s.id)
        .sort(byLeadThenName),
    }));

  const unassigned = cards.filter((c) => c.shift_id == null);
  if (unassigned.length > 0) {
    groups.push({
      key: '_unassigned',
      label: 'No shift assigned',
      times: null,
      engineers: unassigned.sort(byLeadThenName),
    });
  }

  return groups;
}

function byLeadThenName(a: EngineerCard, b: EngineerCard): number {
  if (a.is_lead !== b.is_lead) return a.is_lead ? -1 : 1;
  return a.full_name.localeCompare(b.full_name);
}

function shiftTimesLabel(s: Shift): string {
  const start = fmtShiftTime(s.start_time);
  const end = fmtShiftTime(s.end_time);
  const lo = fmtShiftTime(s.lunch_out);
  const li = fmtShiftTime(s.lunch_in);
  const lunch = lo && li ? ` · lunch ${lo}–${li}` : '';
  return `${start} – ${end}${lunch}`;
}
