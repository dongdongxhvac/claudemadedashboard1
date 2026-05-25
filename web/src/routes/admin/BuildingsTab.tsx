// Admin → Buildings tab.
//
// Draft → review → publish workflow (Phase A port from on-call):
//   - Leads / admins / managers click "Propose changes" → all chip menus
//     mutate LOCAL draftAssignments state instead of firing supabase calls.
//   - "Submit for review" inserts a row into admin_proposals (tab='buildings');
//     live building_assignments are not touched.
//   - DRAFT card renders the proposed state below LIVE with per-chip diff:
//     green border + tint = newly added; a "Removing" banner above the table
//     lists assignments that will be ended on publish.
//   - Manager Publishes → publish_buildings_proposal RPC: ends current rows
//     not in payload, inserts payload rows that aren't currently active,
//     leaves role='manager' rows untouched, applies notes.
//   - Notes (2 slots) live in buildings_notes, editable only during compose.
import { useEffect, useMemo, useState } from 'react';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useShifts, useShiftsRealtime, fmtShiftTime, type Shift } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import {
  useCurrentBuildingAssignments,
  useBuildingAssignmentsRealtime,
  useBuildingsNotes, useBuildingsNotesRealtime,
  type BuildingAssignment,
  type AssignmentRole,
} from '../../hooks/useBuildingAssignments';
import {
  usePendingProposal, useProposeBuildings, usePublishBuildingsProposal,
  useRejectProposal, useWithdrawProposal, useAdminProposalsRealtime,
  usePublishedProposalHistory,
  type BuildingsProposalPayload, type PublishedProposal,
} from '../../hooks/useAdminProposals';
import { useMe } from '../../hooks/useMe';

type ChipDisplay = { key: string; building: Building; sourceLiveId: string | null; isNew: boolean };

type EngineerCard = {
  user_id: string;
  full_name: string;
  phone: string | null;
  title: string | null;
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

/** A draft assignment lives in local state during compose mode. The publish
 *  RPC keys off (building_id, user_id, role_in_building) so that's our
 *  identity; sourceLiveId tracks whether the same triple was already active
 *  in live data (used only for diff display). */
type DraftAssignment = {
  building_id: string;
  user_id: string;
  role_in_building: 'primary' | 'backup';
  sourceLiveId: string | null;
};

type MenuTarget =
  | { kind: 'chip'; key: string }
  | { kind: 'add'; user_id: string }
  | { kind: 'unassigned'; building_id: string };

function menuKey(t: MenuTarget): string {
  if (t.kind === 'chip') return `chip:${t.key}`;
  if (t.kind === 'add')  return `add:${t.user_id}`;
  return `tray:${t.building_id}`;
}

function tripleKey(a: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }): string {
  return `${a.building_id}:${a.user_id}:${a.role_in_building}`;
}

export function BuildingsTab() {
  useShiftsRealtime();
  useBuildingsRealtime();
  useBuildingAssignmentsRealtime();
  useBuildingsNotesRealtime();
  useAdminProposalsRealtime();

  const engineersQ = useEngineers();
  const shiftsQ = useShifts();
  const buildingsQ = useBuildings();
  const assignmentsQ = useCurrentBuildingAssignments();
  const notesQ = useBuildingsNotes();
  const pendingQ = usePendingProposal<BuildingsProposalPayload>('buildings');
  const historyQ = usePublishedProposalHistory<BuildingsProposalPayload>('buildings', 20);
  const me = useMe();

  const propose = useProposeBuildings();
  const publish = usePublishBuildingsProposal();
  const reject = useRejectProposal('buildings');
  const withdraw = useWithdrawProposal('buildings');

  const [editing, setEditing] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const closeMenu = () => setOpenMenu(null);
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);
  const [draftNotes, setDraftNotes] = useState<{ slot: number; body: string }[]>([
    { slot: 1, body: '' }, { slot: 2, body: '' },
  ]);
  const [proposerNote, setProposerNote] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Click-outside closes the open menu.
  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = () => closeMenu();
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', onDocClick); };
  }, [openMenu]);

  useEffect(() => { if (!editing) closeMenu(); }, [editing]);

  // Snapshot live → draft when entering compose (or when live data changes
  // while not composing).
  useEffect(() => {
    if (editing) return;
    if (!assignmentsQ.data || !notesQ.data) return;
    setDraftAssignments(
      assignmentsQ.data
        .filter((a): a is BuildingAssignment & { role_in_building: 'primary' | 'backup' } =>
          a.role_in_building === 'primary' || a.role_in_building === 'backup')
        .map((a) => ({
          building_id: a.building_id,
          user_id: a.user_id,
          role_in_building: a.role_in_building,
          sourceLiveId: a.id,
        })),
    );
    setDraftNotes([1, 2].map((slot) => ({
      slot,
      body: (notesQ.data ?? []).find((n) => n.slot === slot)?.body ?? '',
    })));
    setProposerNote('');
  }, [editing, assignmentsQ.data, notesQ.data]);

  const liveNotes = useMemo(() =>
    [1, 2].map((slot) => ({
      slot,
      body: (notesQ.data ?? []).find((n) => n.slot === slot)?.body ?? '',
    })), [notesQ.data]);

  const loading = engineersQ.isLoading || shiftsQ.isLoading || buildingsQ.isLoading
    || assignmentsQ.isLoading || notesQ.isLoading || me.isLoading;
  const errorObj = engineersQ.error ?? shiftsQ.error ?? buildingsQ.error ?? assignmentsQ.error;
  if (loading) return <p className="t-text t-muted">Loading building assignments…</p>;
  if (errorObj) return <p className="t-text t-danger">Error: {(errorObj as Error).message}</p>;

  const engineers = (engineersQ.data ?? []).filter((e) => e.active && e.role === 'engineer');
  const buildings = buildingsQ.data ?? [];
  const liveAssignments = assignmentsQ.data ?? [];
  const pending = pendingQ.data ?? null;
  const hasPending = pending !== null;
  const canPropose = !!(me.data && (me.data.role === 'admin' || me.data.is_lead || me.data.is_manager));
  const isManager = me.data?.is_manager === true;
  const isProposer = pending && me.data ? pending.proposed_by_user_id === me.data.id : false;

  // What does the top card show?
  //   - compose mode: render draftAssignments (editable chips)
  //   - read mode:   render liveAssignments (read-only chips)
  const topAssignments: BuildingAssignment[] = editing
    ? draftToBuildingAssignments(draftAssignments)
    : liveAssignments;
  const topGroups = buildGroups(engineers, shiftsQ.data ?? [], buildings, topAssignments,
    editing ? draftAssignments : null, liveAssignments);
  const topTotals = countTotals(topGroups);

  // Unassigned tray sourced from the same data view. Plain const (not
  // useMemo) because we're past the early-return loading/error guards —
  // putting hooks here would violate rules of hooks.
  const unassignedBuildingsCovered = new Set(
    topAssignments
      .filter((a) => a.role_in_building === 'primary')
      .map((a) => a.building_id),
  );
  const unassignedBuildings: Building[] = buildings.filter((b) => !unassignedBuildingsCovered.has(b.id));

  const lastPublishedAt = (historyQ.data ?? [])[0]?.reviewed_at ?? null;

  // ---- Local draft mutators (called from ChipMenu in compose mode) ----
  const addAssignmentLocal = (input: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => {
    setDraftAssignments((cur) => {
      let next = cur.slice();
      // If adding a primary: remove any other primary on the same building.
      if (input.role_in_building === 'primary') {
        next = next.filter((a) => !(a.building_id === input.building_id && a.role_in_building === 'primary'));
      }
      // Dedupe: if same triple already exists, no-op.
      const existing = next.find((a) =>
        a.building_id === input.building_id && a.user_id === input.user_id && a.role_in_building === input.role_in_building);
      if (existing) return cur;
      // Find sourceLiveId if this triple is also active in live (to mark as unchanged in diff)
      const liveMatch = liveAssignments.find((a) =>
        a.ends_on === null && a.building_id === input.building_id
        && a.user_id === input.user_id && a.role_in_building === input.role_in_building);
      next.push({
        building_id: input.building_id,
        user_id: input.user_id,
        role_in_building: input.role_in_building,
        sourceLiveId: liveMatch?.id ?? null,
      });
      return next;
    });
  };
  const removeAssignmentLocal = (key: string) => {
    setDraftAssignments((cur) => cur.filter((a) => tripleKey(a) !== key));
  };
  /** Edit an existing draft chip: replace it with a new triple (possibly different engineer/role). */
  const editAssignmentLocal = (oldKey: string, next: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => {
    setDraftAssignments((cur) => {
      let updated = cur.filter((a) => tripleKey(a) !== oldKey);
      // If promoting to primary, remove any other primary on the same building.
      if (next.role_in_building === 'primary') {
        updated = updated.filter((a) => !(a.building_id === next.building_id && a.role_in_building === 'primary'));
      }
      // Dedupe.
      const dup = updated.find((a) => tripleKey(a) === tripleKey(next));
      if (dup) return updated; // already present, just dropped the old
      const liveMatch = liveAssignments.find((a) =>
        a.ends_on === null && a.building_id === next.building_id
        && a.user_id === next.user_id && a.role_in_building === next.role_in_building);
      updated.push({
        ...next,
        sourceLiveId: liveMatch?.id ?? null,
      });
      return updated;
    });
  };

  const onStartEdit = () => { setActionError(null); setEditing(true); };
  const onCancel = () => { setEditing(false); setActionError(null); };
  const onSubmit = async () => {
    setActionError(null);
    try {
      await propose.mutateAsync({
        payload: {
          assignments: draftAssignments.map((a) => ({
            building_id: a.building_id,
            user_id: a.user_id,
            role_in_building: a.role_in_building,
          })),
          notes: draftNotes,
        },
        note: proposerNote.trim() || null,
      });
      setEditing(false);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const proposeDisabledReason = !canPropose
    ? 'You need admin, lead, or manager permission to propose changes.'
    : hasPending
    ? 'A draft is already pending review.'
    : null;

  return (
    <div className="space-y-3 buildings-root">
      <BuildingsTabStyles />

      {/* ─────────────── LIVE / COMPOSE card ─────────────── */}
      <div className="t-card buildings-card buildings-print-target" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-stretch gap-4 mb-2 flex-wrap">
          {/* LEFT */}
          <div className="flex flex-col justify-center" style={{ minWidth: 200 }}>
            <h2 className="t-section-title" style={{ lineHeight: 1.2 }}>
              Building assignments
              {!editing && (
                <span className="ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.18)', color: '#15803d', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}>
                  LIVE
                </span>
              )}
              {editing && (
                <span className="ml-2 px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,160,23,0.18)', color: '#a16207', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}>
                  COMPOSING DRAFT
                </span>
              )}
            </h2>
            <p className="t-small t-muted">
              <b>{topTotals.engineers}</b> engineer{topTotals.engineers === 1 ? '' : 's'} ·{' '}
              <b>{topTotals.primary}</b> primary · <b>{topTotals.backup}</b> coverage
            </p>
          </div>

          {/* MIDDLE: notes */}
          <div className="flex-1 min-w-[200px]">
            <NotesBar
              mode={editing ? 'compose' : 'live'}
              notes={editing ? draftNotes : liveNotes}
              onChange={(slot, body) => setDraftNotes((cur) =>
                cur.map((n) => n.slot === slot ? { ...n, body } : n))}
            />
          </div>

          {/* RIGHT */}
          <div className="flex flex-col items-end justify-center gap-1" style={{ minWidth: 240 }}>
            <p className="t-small text-right" style={{ color: 'var(--color-text-muted)' }}>
              {lastPublishedAt ? (
                <>Last published <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                  {new Date(lastPublishedAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span></>
              ) : (
                <span style={{ fontStyle: 'italic' }}>Never published</span>
              )}
            </p>
            <div className="flex items-center gap-2 buildings-no-print">
              {!editing ? (
                <>
                  <button
                    onClick={() => window.print()}
                    className="t-small px-3 py-1 rounded border"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                  >
                    ⎙ Print
                  </button>
                  <button
                    onClick={onStartEdit}
                    disabled={proposeDisabledReason !== null}
                    title={proposeDisabledReason ?? undefined}
                    className="t-small px-3 py-1 rounded border font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
                  >
                    Propose changes
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onCancel}
                    disabled={propose.isPending}
                    className="t-small px-3 py-1 rounded border"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onSubmit}
                    disabled={propose.isPending}
                    className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--color-accent)' }}
                  >
                    {propose.isPending ? 'Submitting…' : 'Submit for review'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {editing && (
          <div className="mb-2 p-2 rounded border buildings-no-print"
            style={{ borderColor: 'var(--color-accent)', background: 'rgba(59, 130, 246, 0.06)' }}>
            <p className="t-small">
              <b>Composing draft</b> · changes are local until you Submit for review. Then a manager publishes them.
            </p>
            <div className="mt-2">
              <input
                type="text"
                value={proposerNote}
                onChange={(e) => setProposerNote(e.target.value)}
                placeholder="Optional note to reviewer (e.g. swap primary on 40 to Edwin)"
                className="w-full border rounded px-2 py-1 t-text"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
              />
            </div>
          </div>
        )}

        {actionError && (
          <div className="mb-2 p-2 rounded border" style={{ borderColor: 'var(--color-danger)', background: '#fef2f2', color: '#7f1d1d' }}>
            <p className="t-small">{actionError}</p>
          </div>
        )}

        <AssignmentsTable
          groups={topGroups}
          mode={editing ? 'compose' : 'live'}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          engineers={engineers}
          buildings={buildings}
          draftAssignments={draftAssignments}
          unassignedBuildings={unassignedBuildings}
          onAdd={addAssignmentLocal}
          onEdit={editAssignmentLocal}
          onRemove={removeAssignmentLocal}
        />
      </div>

      {/* ─────────────── DRAFT preview card ─────────────── */}
      {!editing && pending && (
        <BuildingsDraftPreview
          pending={pending}
          isManager={isManager}
          isProposer={isProposer}
          publishing={publish.isPending}
          rejecting={reject.isPending}
          withdrawing={withdraw.isPending}
          engineers={engineers}
          buildings={buildings}
          shifts={shiftsQ.data ?? []}
          liveAssignments={liveAssignments}
          liveNotes={liveNotes}
          onPublish={async () => {
            setActionError(null);
            try { await publish.mutateAsync(pending.id); }
            catch (e) { setActionError((e as Error).message); }
          }}
          onReject={async (note) => {
            setActionError(null);
            try { await reject.mutateAsync({ proposalId: pending.id, note }); }
            catch (e) { setActionError((e as Error).message); }
          }}
          onWithdraw={async () => {
            setActionError(null);
            try { await withdraw.mutateAsync(pending.id); }
            catch (e) { setActionError((e as Error).message); }
          }}
        />
      )}

      {/* ─────────────── HISTORY ─────────────── */}
      <BuildingsHistorySection
        history={historyQ.data ?? []}
        loading={historyQ.isLoading}
        engineersById={Object.fromEntries(engineers.map((e) => [e.user_id, e]))}
        buildingsById={Object.fromEntries(buildings.map((b) => [b.id, b]))}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

// ============================================================================
// NotesBar — same UX as on-call's NotesBar but localized here for now
// ============================================================================
function NotesBar({
  mode, notes, liveNotes, onChange,
}: {
  mode: 'live' | 'compose' | 'preview';
  notes: { slot: number; body: string }[];
  liveNotes?: { slot: number; body: string }[];
  onChange?: (slot: number, body: string) => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'var(--color-bg)',
        padding: '2px 8px',
        height: '100%',
      }}
    >
      {[1, 2].map((slot) => {
        const body = notes.find((n) => n.slot === slot)?.body ?? '';
        const liveBody = liveNotes?.find((n) => n.slot === slot)?.body ?? '';
        const changed = mode === 'preview' && body !== liveBody;
        if (mode === 'compose') {
          return (
            <input
              key={slot}
              type="text"
              value={body}
              onChange={(e) => onChange?.(slot, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder={`note ${slot}`}
              className="w-full t-text"
              style={{
                fontSize: 12, lineHeight: 1.25,
                border: 'none', background: 'transparent',
                padding: '0 2px', outline: 'none',
                borderBottom: '1px dashed var(--color-border-soft)',
              }}
              onFocus={(e) => { e.currentTarget.style.borderBottomColor = 'var(--color-accent)'; }}
              onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'var(--color-border-soft)'; }}
            />
          );
        }
        return (
          <div
            key={slot}
            className="t-text"
            title={changed ? `Was: "${liveBody || '(empty)'}"` : undefined}
            style={{
              fontSize: 12, lineHeight: 1.25,
              padding: '0 2px',
              borderBottom: '1px dashed var(--color-border-soft)',
              background: changed ? 'rgba(212,160,23,0.20)' : undefined,
              color: body ? (changed ? '#7c5800' : undefined) : 'var(--color-text-muted)',
              fontStyle: body ? 'normal' : 'italic',
              fontWeight: changed ? 600 : undefined,
              minHeight: '1.25em',
            }}
          >
            {body || `(note ${slot} empty)`}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// AssignmentsTable — the shift-grouped engineer / chip table
// ============================================================================
function AssignmentsTable({
  groups, mode, openMenu, setOpenMenu,
  engineers, buildings, draftAssignments,
  unassignedBuildings, onAdd, onEdit, onRemove,
}: {
  groups: ShiftGroup[];
  mode: 'live' | 'compose' | 'preview';
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  draftAssignments: DraftAssignment[];
  unassignedBuildings: Building[];
  onAdd: (input: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onEdit: (oldKey: string, next: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onRemove: (key: string) => void;
}) {
  const closeMenu = () => setOpenMenu(null);
  return (
    <>
      <table className="min-w-full t-text border-collapse">
        <colgroup>
          <col style={{ width: mode === 'compose' ? '220px' : '180px' }} />
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
              mode={mode}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              engineers={engineers}
              buildings={buildings}
              draftAssignments={draftAssignments}
              onAdd={onAdd}
              onEdit={onEdit}
              onRemove={onRemove}
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
              const editable = mode === 'compose';
              return (
                <span key={b.id} style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={(e) => {
                      if (!editable) return;
                      e.stopPropagation();
                      setOpenMenu(openMenu === key ? null : key);
                    }}
                    className={`bld-chip backup ${editable ? 'chip-editable' : ''}`}
                    title={editable ? `Assign ${b.name}` : b.name}
                    style={editable ? { cursor: 'pointer' } : undefined}
                  >
                    {b.short_code ?? b.code}
                  </button>
                  {openMenu === key && editable && (
                    <ChipMenu
                      mode="create"
                      lockedBuilding={b}
                      defaultRole="primary"
                      engineers={engineers}
                      buildings={buildings}
                      onSave={(input) => { onAdd(input); closeMenu(); }}
                      onClose={closeMenu}
                    />
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Shift block
// ============================================================================
function ShiftBlock(props: {
  group: ShiftGroup;
  mode: 'live' | 'compose' | 'preview';
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  draftAssignments: DraftAssignment[];
  onAdd: (input: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onEdit: (oldKey: string, next: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onRemove: (key: string) => void;
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
  mode: 'live' | 'compose' | 'preview';
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  draftAssignments: DraftAssignment[];
  onAdd: (input: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onEdit: (oldKey: string, next: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onRemove: (key: string) => void;
}) {
  const { eng, mode, openMenu, setOpenMenu, engineers, buildings, onAdd, onEdit, onRemove } = props;
  const editable = mode === 'compose';
  const addKey = menuKey({ kind: 'add', user_id: eng.user_id });

  return (
    <tr className="border-b eng-row" style={{ borderColor: 'var(--color-border-soft)' }}>
      <td className="py-1 pr-1 align-top">
        <div className="flex items-center flex-wrap gap-1">
          {eng.is_lead && <span className="lead-star" title="Lead engineer">★</span>}
          <span className="font-medium t-text">{eng.full_name}</span>
          {eng.title && (
            <span className="t-small t-muted" style={{ fontSize: '11px' }}>· {eng.title}</span>
          )}
        </div>
      </td>
      <td className="py-1 px-1 align-top">
        {eng.primary.length === 0 && eng.backup.length === 0 && !editable ? (
          <span className="t-small t-muted italic">No buildings assigned</span>
        ) : (
          <>
            {eng.primary.map((c) => (
              <ChipWithMenu
                key={`p-${c.key}`}
                kind="primary"
                chip={c}
                mode={mode}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                engineers={engineers}
                buildings={buildings}
                currentUserId={eng.user_id}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ))}
            {eng.backup.map((c) => (
              <ChipWithMenu
                key={`b-${c.key}`}
                kind="backup"
                chip={c}
                mode={mode}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                engineers={engineers}
                buildings={buildings}
                currentUserId={eng.user_id}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ))}
            {editable && (
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
                    onSave={(input) => { onAdd(input); setOpenMenu(null); }}
                    onClose={() => setOpenMenu(null)}
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
  mode: 'live' | 'compose' | 'preview';
  openMenu: string | null;
  setOpenMenu: (k: string | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  currentUserId: string;
  onEdit: (oldKey: string, next: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onRemove: (key: string) => void;
}) {
  const { kind, chip, mode, openMenu, setOpenMenu, engineers, buildings, currentUserId, onEdit, onRemove } = props;
  const role: AssignmentRole = kind === 'primary' ? 'primary' : 'backup';
  const key = menuKey({ kind: 'chip', key: chip.key });
  const isOpen = openMenu === key;
  const editable = mode === 'compose';
  const titleSuffix = kind === 'backup' ? ' (coverage)' : '';

  // Diff styling for DRAFT preview: green border + light tint on chips that
  // are NEW (not in live for this triple).
  const diffStyle: React.CSSProperties | undefined = mode === 'preview' && chip.isNew
    ? { borderColor: '#15803d', borderStyle: 'solid', borderWidth: 2, background: 'rgba(34,197,94,0.18)', color: '#15803d' }
    : undefined;

  if (!editable) {
    return (
      <span
        className={`bld-chip ${kind}`}
        title={`${chip.building.name}${titleSuffix}${mode === 'preview' && chip.isNew ? ' (new in this proposal)' : ''}`}
        style={diffStyle}
      >
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
          lockedBuilding={chip.building}
          defaultEngineerId={currentUserId}
          defaultRole={role}
          engineers={engineers}
          buildings={buildings}
          onSave={(next) => { onEdit(chip.key, next); setOpenMenu(null); }}
          onRemove={() => { onRemove(chip.key); setOpenMenu(null); }}
          onClose={() => setOpenMenu(null)}
        />
      )}
    </span>
  );
}

// ============================================================================
// Chip menu (popover): local-state edition
// ============================================================================
function ChipMenu(props: {
  mode: 'edit' | 'create';
  lockedBuilding?: Building;
  lockedEngineer?: EngineerRow | null;
  defaultEngineerId?: string;
  defaultRole: AssignmentRole;
  engineers: EngineerRow[];
  buildings: Building[];
  onSave: (input: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup' }) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const {
    mode, lockedBuilding, lockedEngineer,
    defaultEngineerId, defaultRole, engineers, buildings, onSave, onRemove, onClose,
  } = props;

  const [engineerId, setEngineerId] = useState<string>(defaultEngineerId ?? lockedEngineer?.user_id ?? '');
  const [buildingId, setBuildingId] = useState<string>(lockedBuilding?.id ?? '');
  const [role, setRole] = useState<'primary' | 'backup'>(defaultRole === 'manager' ? 'primary' : defaultRole);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = () => {
    setErr(null);
    if (!engineerId || !buildingId) {
      setErr('Pick an engineer and a building.');
      return;
    }
    onSave({ building_id: buildingId, user_id: engineerId, role_in_building: role });
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
        position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
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

        {err && <p className="t-small" style={{ color: 'var(--color-danger)' }}>{err}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {mode === 'edit' && onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="t-small px-2 py-1 rounded border"
                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="t-small px-2 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}>
              Cancel
            </button>
            <button type="button" onClick={handleSave}
              className="t-small px-3 py-1 rounded font-medium text-white"
              style={{ background: 'var(--color-accent)' }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DraftPreview for buildings
// ============================================================================
function BuildingsDraftPreview({
  pending, isManager, isProposer, publishing, rejecting, withdrawing,
  engineers, buildings, shifts, liveAssignments, liveNotes,
  onPublish, onReject, onWithdraw,
}: {
  pending: { id: string; payload: BuildingsProposalPayload; note: string | null;
             proposed_by_name: string; proposed_at: string; proposed_by_user_id: string };
  isManager: boolean;
  isProposer: boolean;
  publishing: boolean;
  rejecting: boolean;
  withdrawing: boolean;
  engineers: EngineerRow[];
  buildings: Building[];
  shifts: Shift[];
  liveAssignments: BuildingAssignment[];
  liveNotes: { slot: number; body: string }[];
  onPublish: () => void;
  onReject: (note: string | null) => void;
  onWithdraw: () => void;
}) {
  const [rejectNote, setRejectNote] = useState<string>('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const busy = publishing || rejecting || withdrawing;

  const proposedAssignments: BuildingAssignment[] = draftToBuildingAssignments(
    (pending.payload.assignments ?? []).map((a) => ({
      building_id: a.building_id, user_id: a.user_id, role_in_building: a.role_in_building,
      sourceLiveId: null,
    })),
  );

  // Identify diffs
  const liveTriples = new Set(
    liveAssignments
      .filter((a) => a.role_in_building === 'primary' || a.role_in_building === 'backup')
      .map((a) => `${a.building_id}:${a.user_id}:${a.role_in_building}`));
  const proposedTriples = new Set(
    (pending.payload.assignments ?? []).map((a) => `${a.building_id}:${a.user_id}:${a.role_in_building}`));

  const buildingsById = new Map(buildings.map((b) => [b.id, b]));
  const engineersById = new Map(engineers.map((e) => [e.user_id, e]));

  const added = (pending.payload.assignments ?? []).filter(
    (a) => !liveTriples.has(`${a.building_id}:${a.user_id}:${a.role_in_building}`));
  const removed = liveAssignments
    .filter((a) => (a.role_in_building === 'primary' || a.role_in_building === 'backup')
      && !proposedTriples.has(`${a.building_id}:${a.user_id}:${a.role_in_building}`));

  // For the diff render in the table, pass the proposed list + a NEW set
  // by tripleKey so chips can be marked.
  const newTripleSet = new Set(added.map((a) => `${a.building_id}:${a.user_id}:${a.role_in_building}`));
  const groups = buildGroups(engineers, shifts, buildings, proposedAssignments,
    proposedAssignments
      .filter((a) => a.role_in_building === 'primary' || a.role_in_building === 'backup')
      .map((a) => ({
        building_id: a.building_id, user_id: a.user_id,
        role_in_building: a.role_in_building as 'primary' | 'backup',
        sourceLiveId: newTripleSet.has(`${a.building_id}:${a.user_id}:${a.role_in_building}`) ? null : 'existing',
      })),
    liveAssignments);
  const unassignedBuildings: Building[] = (() => {
    const covered = new Set(proposedAssignments.filter((a) => a.role_in_building === 'primary').map((a) => a.building_id));
    return buildings.filter((b) => !covered.has(b.id));
  })();

  const proposedWhen = new Date(pending.proposed_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const proposedNotes = pending.payload.notes ?? [{ slot: 1, body: '' }, { slot: 2, body: '' }];

  return (
    <div className="t-card" style={{
      padding: '0.75rem 1rem',
      borderLeft: '4px solid #d4a017',
      background: 'rgba(212,160,23,0.04)',
    }}>
      <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
        <div>
          <h2 className="t-section-title">
            Building assignments
            <span className="ml-2 px-2 py-0.5 rounded-full" style={{
              background: '#d4a017', color: 'white', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
            }}>
              DRAFT
            </span>
          </h2>
          <p className="t-small t-muted">
            Proposed by <span className="font-medium" style={{ color: 'var(--color-text)' }}>{pending.proposed_by_name}</span> · {proposedWhen}
          </p>
          {pending.note && (
            <p className="t-small mt-1" style={{ color: 'var(--color-danger)', fontStyle: 'italic', fontWeight: 500 }}>
              "{pending.note}"
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isProposer && (
            <button onClick={onWithdraw} disabled={busy}
              className="t-small px-3 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}>
              {withdrawing ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
          {isManager && (
            <>
              <button onClick={() => setShowRejectBox((s) => !s)} disabled={busy}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
                Reject…
              </button>
              <button onClick={onPublish} disabled={busy}
                className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-ok)' }}>
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </>
          )}
          {!isProposer && !isManager && (
            <span className="t-small t-muted italic">awaiting manager review</span>
          )}
        </div>
      </div>

      {showRejectBox && isManager && (
        <div className="mb-3 p-3 rounded border" style={{ borderColor: 'var(--color-danger)', background: '#fef2f2' }}>
          <label className="block">
            <span className="t-small uppercase tracking-wider block mb-1" style={{ color: '#7f1d1d' }}>
              Reason for rejecting (optional)
            </span>
            <input type="text" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'white' }} />
          </label>
          <div className="mt-2 flex gap-2 justify-end">
            <button onClick={() => { setShowRejectBox(false); setRejectNote(''); }} disabled={busy}
              className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
            <button onClick={() => { onReject(rejectNote.trim() || null); setShowRejectBox(false); setRejectNote(''); }}
              disabled={busy} className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-danger)' }}>
              {rejecting ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </div>
        </div>
      )}

      {/* Notes diff strip */}
      <div className="mb-2">
        <NotesBar mode="preview" notes={proposedNotes} liveNotes={liveNotes} />
      </div>

      {/* Changes summary banner */}
      {(added.length > 0 || removed.length > 0) && (
        <div className="mb-3 p-2 rounded border" style={{
          borderColor: '#d4a017', background: 'rgba(212,160,23,0.10)',
        }}>
          <p className="t-small font-semibold mb-1" style={{ color: '#a16207', letterSpacing: '0.3px' }}>
            CHANGES vs LIVE
          </p>
          <ul className="t-small" style={{ color: '#7c5800', listStyle: 'disc', paddingLeft: '1.25rem' }}>
            {added.length > 0 && (
              <li>
                Adding {added.length} assignment{added.length === 1 ? '' : 's'}:{' '}
                {added.map((a) => {
                  const e = engineersById.get(a.user_id);
                  const b = buildingsById.get(a.building_id);
                  return `${e?.full_name ?? '?'} → ${b?.short_code ?? b?.code ?? '?'} (${a.role_in_building})`;
                }).join(', ')}
              </li>
            )}
            {removed.length > 0 && (
              <li style={{ color: 'var(--color-danger)' }}>
                Removing {removed.length} assignment{removed.length === 1 ? '' : 's'}:{' '}
                <span style={{ textDecoration: 'line-through' }}>
                  {removed.map((a) => {
                    const e = engineersById.get(a.user_id);
                    const b = buildingsById.get(a.building_id);
                    return `${e?.full_name ?? '?'} → ${b?.short_code ?? b?.code ?? '?'} (${a.role_in_building})`;
                  }).join(', ')}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      <AssignmentsTable
        groups={groups}
        mode="preview"
        openMenu={null}
        setOpenMenu={() => {}}
        engineers={engineers}
        buildings={buildings}
        draftAssignments={[]}
        unassignedBuildings={unassignedBuildings}
        onAdd={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />
    </div>
  );
}

// ============================================================================
// HistorySection for buildings
// ============================================================================
function BuildingsHistorySection({
  history, loading, engineersById, buildingsById, open, onOpenChange,
}: {
  history: PublishedProposal<BuildingsProposalPayload>[];
  loading: boolean;
  engineersById: Record<string, EngineerRow>;
  buildingsById: Record<string, Building>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  if (loading) return null;
  if (history.length === 0) {
    return (
      <div className="t-card buildings-no-print" style={{ padding: '0.5rem 1rem', opacity: 0.6 }}>
        <p className="t-small t-muted italic">No building changes published yet.</p>
      </div>
    );
  }
  return (
    <div className="t-card buildings-no-print" style={{ padding: '0.5rem 1rem' }}>
      <button onClick={() => onOpenChange(!open)}
        className="w-full flex items-center justify-between" style={{ textAlign: 'left' }}>
        <div>
          <span className="t-section-title">Schedule history</span>
          <span className="t-small t-muted ml-2">
            {history.length} published change{history.length === 1 ? '' : 's'} · newest first
          </span>
        </div>
        <span className="t-text" style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {history.map((entry, i) => {
            const prev = history[i + 1] ?? null;
            const currTriples = new Set((entry.payload.assignments ?? []).map(
              (a) => `${a.building_id}:${a.user_id}:${a.role_in_building}`));
            const prevTriples = new Set((prev?.payload.assignments ?? []).map(
              (a) => `${a.building_id}:${a.user_id}:${a.role_in_building}`));
            const addedCount = prev ? Array.from(currTriples).filter((t) => !prevTriples.has(t)).length : currTriples.size;
            const removedCount = prev ? Array.from(prevTriples).filter((t) => !currTriples.has(t)).length : 0;
            const reviewedAt = entry.reviewed_at
              ? new Date(entry.reviewed_at).toLocaleString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })
              : '(unknown time)';
            return (
              <div key={entry.id} className="border rounded p-2" style={{
                borderColor: 'var(--color-border)',
                borderLeft: i === 0 ? '3px solid var(--color-ok)' : '3px solid var(--color-border)',
              }}>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="t-text font-medium">{reviewedAt}</span>
                    {i === 0 && (
                      <span className="px-1.5 py-0.5 rounded text-white font-semibold"
                        style={{ background: 'var(--color-ok)', fontSize: '10px', letterSpacing: '0.5px' }}>
                        CURRENT
                      </span>
                    )}
                    <span className="t-small t-muted">
                      by <span style={{ color: 'var(--color-text)' }}>{entry.reviewed_by_name ?? '(unknown)'}</span>
                      {entry.proposed_by_user_id !== entry.reviewed_by_user_id && (
                        <> · proposed by <span style={{ color: 'var(--color-text)' }}>{entry.proposed_by_name}</span></>
                      )}
                    </span>
                  </div>
                  <span className="t-small t-mono" style={{ color: '#a16207' }}>
                    {prev ? `+${addedCount} · −${removedCount}` : `initial publish (${currTriples.size})`}
                  </span>
                </div>
                {entry.note && (
                  <p className="t-small mt-1" style={{ color: 'var(--color-danger)', fontStyle: 'italic' }}>
                    "{entry.note}"
                  </p>
                )}
                {prev && (addedCount > 0 || removedCount > 0) && (
                  <details className="mt-1">
                    <summary className="t-small t-accent" style={{ cursor: 'pointer' }}>view diff</summary>
                    <ul className="t-small mt-1" style={{ paddingLeft: '1.25rem', listStyle: 'disc' }}>
                      {Array.from(currTriples).filter((t) => !prevTriples.has(t)).map((t) => {
                        const [b, u, r] = t.split(':');
                        return (
                          <li key={`+${t}`} style={{ color: '#15803d' }}>
                            + {engineersById[u]?.full_name ?? '?'} → {buildingsById[b]?.short_code ?? buildingsById[b]?.code ?? '?'} ({r})
                          </li>
                        );
                      })}
                      {Array.from(prevTriples).filter((t) => !currTriples.has(t)).map((t) => {
                        const [b, u, r] = t.split(':');
                        return (
                          <li key={`-${t}`} style={{ color: 'var(--color-danger)', textDecoration: 'line-through' }}>
                            − {engineersById[u]?.full_name ?? '?'} → {buildingsById[b]?.short_code ?? buildingsById[b]?.code ?? '?'} ({r})
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// data shaping
// ============================================================================

function draftToBuildingAssignments(draft: DraftAssignment[]): BuildingAssignment[] {
  // Synthesize BuildingAssignment shape for renderers. The id is just a synthetic key.
  return draft.map((d) => ({
    id: d.sourceLiveId ?? `draft-${tripleKey(d)}`,
    building_id: d.building_id,
    user_id: d.user_id,
    role_in_building: d.role_in_building,
    starts_on: '',
    ends_on: null,
    notes: null,
  }));
}

function buildGroups(
  engineers: EngineerRow[],
  shifts: Shift[],
  buildings: Building[],
  assignments: BuildingAssignment[],
  /** When rendering a draft/preview: pass the draft slice so we can mark chips
   *  whose triple is new (sourceLiveId === null). null means "live mode, no
   *  diff annotations". */
  draftMarkers: { building_id: string; user_id: string; role_in_building: 'primary' | 'backup'; sourceLiveId: string | null }[] | null,
  _liveForReference: BuildingAssignment[],
): ShiftGroup[] {
  const bldById = new Map(buildings.map((b) => [b.id, b]));
  const primaryByUser = new Map<string, ChipDisplay[]>();
  const backupByUser  = new Map<string, ChipDisplay[]>();
  const markerByTriple = new Map<string, { sourceLiveId: string | null }>();
  if (draftMarkers) {
    for (const m of draftMarkers) {
      markerByTriple.set(`${m.building_id}:${m.user_id}:${m.role_in_building}`, { sourceLiveId: m.sourceLiveId });
    }
  }
  for (const a of assignments) {
    const b = bldById.get(a.building_id);
    if (!b) continue;
    const map = a.role_in_building === 'primary' ? primaryByUser
              : a.role_in_building === 'backup'  ? backupByUser
              : null;
    if (!map) continue;
    const list = map.get(a.user_id) ?? [];
    const triple = `${a.building_id}:${a.user_id}:${a.role_in_building}`;
    const marker = markerByTriple.get(triple);
    list.push({
      key: a.id,
      building: b,
      sourceLiveId: a.id.startsWith('draft-') ? null : a.id,
      isNew: marker ? marker.sourceLiveId === null : false,
    });
    map.set(a.user_id, list);
  }

  const sortChips = (list: ChipDisplay[]) => {
    list.sort((x, y) =>
      (x.building.short_code ?? x.building.code).localeCompare(
        y.building.short_code ?? y.building.code, undefined, { numeric: true }));
    return list;
  };

  const cards: EngineerCard[] = engineers
    .filter((e) => e.active && e.role === 'engineer')
    .map((e) => ({
      user_id: e.user_id,
      full_name: e.full_name,
      phone: e.phone,
      title: e.title,
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
      engineers: cards.filter((c) => c.shift_id === s.id).sort(byLeadThenName),
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

function countTotals(groups: ShiftGroup[]) {
  let p = 0, s = 0;
  for (const g of groups) for (const e of g.engineers) { p += e.primary.length; s += e.backup.length; }
  return { engineers: groups.reduce((a, g) => a + g.engineers.length, 0), primary: p, backup: s };
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

// ============================================================================
// styles (unchanged + a small print hook for the LIVE-only target)
// ============================================================================
function BuildingsTabStyles() {
  return (
    <style>{`
      @page { size: letter landscape; margin: 0.4in; }
      @media print {
        body * { visibility: hidden !important; }
        .buildings-print-target, .buildings-print-target * { visibility: visible !important; }
        .buildings-print-target {
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
