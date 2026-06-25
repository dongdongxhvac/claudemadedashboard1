// Admin → Rounds tab.
//
// Draft → review → publish workflow (Phase 9.2 port from on-call/buildings):
//   - All chip menus + Add Round + inline rename + delete + assign + reorder
//     mutate LOCAL draftRounds state instead of firing supabase mutations.
//   - "Submit for review" packages the full intended state of rounds (each
//     with id|null, stops ordered, assigned_user_id) into a RoundsProposalPayload.
//   - Manager Publishes → publish_rounds_proposal RPC reconciles three tables:
//     UPDATE rounds whose id matched, INSERT rounds with null id, soft-delete
//     (active=false) live rounds not in payload, rebuild stops per round,
//     close-and-open assignments where the desired user changed.
//   - Notes (2 slots, rounds_notes) edited via proposal payload only.
//
// Round = one engineer's daily walk through several buildings, scoped to a
// shift. Within a shift, each building appears in at most one round
// (enforced in the UI by hiding already-covered buildings from the picker).
import { useEffect, useMemo, useState } from 'react';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useShifts, useShiftsRealtime, fmtShiftTime, type Shift } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import {
  useRounds, useRoundsRealtime,
  useRoundsNotes, useRoundsNotesRealtime,
  type Round,
} from '../../hooks/useRounds';
import {
  usePendingProposal, useProposeRounds, usePublishRoundsProposal,
  useRejectProposal, useWithdrawProposal, useAdminProposalsRealtime,
  usePublishedProposalHistory,
  type RoundsProposalPayload, type PublishedProposal,
} from '../../hooks/useAdminProposals';
import { useMe } from '../../hooks/useMe';

type MenuKey = string;

type DraftStop = {
  client_key: string;
  building_id: string;
};

type DraftRound = {
  id: string | null;      // null = new round to create on publish
  client_key: string;     // stable React key
  name: string;
  shift_id: string | null;
  sort_order: number;
  estimated_minutes: number | null;
  stops: DraftStop[];
  assigned_user_id: string | null;
};

function rndKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RoundsTab() {
  useShiftsRealtime();
  useBuildingsRealtime();
  useRoundsRealtime();
  useRoundsNotesRealtime();
  useAdminProposalsRealtime();

  const engineersQ = useEngineers();
  const shiftsQ    = useShifts();
  const buildingsQ = useBuildings();
  const roundsQ    = useRounds();
  const notesQ     = useRoundsNotes();
  const pendingQ   = usePendingProposal<RoundsProposalPayload>('rounds');
  const historyQ   = usePublishedProposalHistory<RoundsProposalPayload>('rounds', 20);
  const me         = useMe();

  const propose  = useProposeRounds();
  const publish  = usePublishRoundsProposal();
  const reject   = useRejectProposal('rounds');
  const withdraw = useWithdrawProposal('rounds');

  const [editing, setEditing] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const closeMenu = () => setOpenMenu(null);
  const [draftRounds, setDraftRounds] = useState<DraftRound[]>([]);
  const [draftNotes, setDraftNotes] = useState<{ slot: number; body: string }[]>([
    { slot: 1, body: '' }, { slot: 2, body: '' },
  ]);
  const [proposerNote, setProposerNote] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = () => closeMenu();
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', onDocClick); };
  }, [openMenu]);
  useEffect(() => { if (!editing) closeMenu(); }, [editing]);

  // Snapshot live → draft when entering compose (or when live changes outside compose).
  // Only ROUNDS gate the seed — notes are optional (empty slots default
  // below). Coupling them previously meant a failed rounds_notes query
  // left the draft blank even though live rounds existed.
  useEffect(() => {
    if (editing) return;
    if (!roundsQ.data) return;
    setDraftRounds(roundsQ.data.map((r) => ({
      id: r.id,
      client_key: r.id,
      name: r.name,
      shift_id: r.shift_id,
      sort_order: r.sort_order,
      estimated_minutes: r.estimated_minutes,
      stops: r.stops.map((s) => ({ client_key: s.id, building_id: s.building_id })),
      assigned_user_id: r.current?.user_id ?? null,
    })));
    setDraftNotes([1, 2].map((slot) => ({
      slot,
      body: (notesQ.data ?? []).find((n) => n.slot === slot)?.body ?? '',
    })));
    setProposerNote('');
  }, [editing, roundsQ.data, notesQ.data]);

  const liveNotes = useMemo(() =>
    [1, 2].map((slot) => ({
      slot,
      body: (notesQ.data ?? []).find((n) => n.slot === slot)?.body ?? '',
    })), [notesQ.data]);

  const loading = engineersQ.isLoading || shiftsQ.isLoading || buildingsQ.isLoading
    || roundsQ.isLoading || notesQ.isLoading || me.isLoading;
  const errorObj = engineersQ.error ?? shiftsQ.error ?? buildingsQ.error ?? roundsQ.error ?? notesQ.error;
  if (loading) return <p className="t-text t-muted">Loading rounds…</p>;
  if (errorObj) return <p className="t-text t-danger">Error: {(errorObj as Error).message}</p>;

  const engineers = (engineersQ.data ?? []).filter((e) => e.active && e.role === 'engineer');
  const buildings = buildingsQ.data ?? [];
  const liveRounds = roundsQ.data ?? [];
  const pending = pendingQ.data ?? null;
  const hasPending = pending !== null;
  const canPropose = !!(me.data && (me.data.role === 'admin' || me.data.is_lead || me.data.is_manager));
  const isManager = me.data?.is_manager === true;
  const isProposer = pending && me.data ? pending.proposed_by_user_id === me.data.id : false;

  // Top card data: compose → draftRounds; otherwise live.
  const topRoundsView: RoundView[] = editing
    ? draftRounds.map(draftToRoundView)
    : liveRounds.map(liveToRoundView);
  const topGroups = buildGroups(topRoundsView, shiftsQ.data ?? []);
  const topTotals = countTotals(topRoundsView);

  const lastPublishedAt = (historyQ.data ?? [])[0]?.reviewed_at ?? null;

  // ---- Local mutators (compose mode only) ----
  const addRound = (shift_id: string | null, label: string) => {
    setDraftRounds((cur) => {
      const sameShift = cur.filter((r) => r.shift_id === shift_id);
      const nextSort = sameShift.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
      const prefix = label.toLowerCase().includes('7') ? 'AM Route' : 'PM Route';
      return [...cur, {
        id: null, client_key: rndKey(),
        name: `${prefix} ${sameShift.length + 1}`,
        shift_id,
        sort_order: nextSort,
        estimated_minutes: null,
        stops: [],
        assigned_user_id: null,
      }];
    });
  };
  const updateRoundField = <K extends keyof DraftRound>(client_key: string, field: K, value: DraftRound[K]) => {
    setDraftRounds((cur) => cur.map((r) => r.client_key === client_key ? { ...r, [field]: value } : r));
  };
  const removeRound = (client_key: string) => {
    setDraftRounds((cur) => cur.filter((r) => r.client_key !== client_key));
  };
  const addStop = (round_client_key: string, building_id: string) => {
    setDraftRounds((cur) => cur.map((r) => r.client_key === round_client_key
      ? { ...r, stops: [...r.stops, { client_key: rndKey(), building_id }] }
      : r));
  };
  const removeStop = (round_client_key: string, stop_client_key: string) => {
    setDraftRounds((cur) => cur.map((r) => r.client_key === round_client_key
      ? { ...r, stops: r.stops.filter((s) => s.client_key !== stop_client_key) }
      : r));
  };
  const moveStop = (round_client_key: string, stop_client_key: string, dir: -1 | 1) => {
    setDraftRounds((cur) => cur.map((r) => {
      if (r.client_key !== round_client_key) return r;
      const idx = r.stops.findIndex((s) => s.client_key === stop_client_key);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= r.stops.length) return r;
      const next = r.stops.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...r, stops: next };
    }));
  };
  const setAssignee = (round_client_key: string, user_id: string | null) => {
    updateRoundField(round_client_key, 'assigned_user_id', user_id);
  };

  const onStartEdit = () => { setActionError(null); setEditing(true); };
  const onCancel = () => { setEditing(false); setActionError(null); };
  const onSubmit = async () => {
    setActionError(null);
    try {
      await propose.mutateAsync({
        payload: {
          rounds: draftRounds.map((r) => ({
            id: r.id,
            name: r.name,
            shift_id: r.shift_id,
            sort_order: r.sort_order,
            estimated_minutes: r.estimated_minutes,
            stops: r.stops.map((s) => ({ building_id: s.building_id })),
            assigned_user_id: r.assigned_user_id,
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
    <div className="space-y-3 rounds-root">
      <RoundsTabStyles />

      {/* ─────────────── LIVE / COMPOSE card ─────────────── */}
      <div className="t-card rounds-card rounds-print-target" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-stretch gap-4 mb-2 flex-wrap">
          {/* LEFT */}
          <div className="flex flex-col justify-center" style={{ minWidth: 200 }}>
            <h2 className="t-section-title" style={{ lineHeight: 1.2 }}>
              Rounds
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
              <b>{topTotals.rounds}</b> round{topTotals.rounds === 1 ? '' : 's'} ·{' '}
              <b>{topTotals.stops}</b> stop{topTotals.stops === 1 ? '' : 's'} ·{' '}
              <b>{topTotals.assigned}</b> assigned
              {topTotals.unassigned > 0 && <> · <span className="t-danger">{topTotals.unassigned} unassigned</span></>}
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
            <div className="flex items-center gap-2 rounds-no-print">
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
          <div className="mb-2 p-2 rounded border rounds-no-print"
            style={{ borderColor: 'var(--color-accent)', background: 'rgba(59, 130, 246, 0.06)' }}>
            <p className="t-small">
              <b>Composing draft</b> · changes are local until you Submit for review.
            </p>
            <div className="mt-2">
              <input
                type="text"
                value={proposerNote}
                onChange={(e) => setProposerNote(e.target.value)}
                placeholder="Optional note to reviewer"
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

        <div className="rounds-grid">
          {topGroups.map((g) => (
            <ShiftBlock
              key={g.key}
              shift={g.shift}
              label={g.label}
              rounds={g.rounds}
              mode={editing ? 'compose' : 'live'}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              engineers={engineers}
              buildings={buildings}
              onAddRound={() => addRound(g.shift?.id ?? null, g.label)}
              onUpdateRoundName={(ck, name) => updateRoundField(ck, 'name', name)}
              onRemoveRound={removeRound}
              onAddStop={addStop}
              onRemoveStop={removeStop}
              onMoveStop={moveStop}
              onSetAssignee={setAssignee}
            />
          ))}
        </div>
      </div>

      {/* ─────────────── DRAFT preview card ─────────────── */}
      {!editing && pending && (
        <RoundsDraftPreview
          pending={pending}
          isManager={isManager}
          isProposer={isProposer}
          publishing={publish.isPending}
          rejecting={reject.isPending}
          withdrawing={withdraw.isPending}
          engineers={engineers}
          buildings={buildings}
          shifts={shiftsQ.data ?? []}
          liveRounds={liveRounds}
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
      <RoundsHistorySection
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
// NotesBar (mirror of buildings/oncall versions)
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
        padding: '4px 8px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '6px',
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
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
              placeholder={`note ${slot}`}
              className="w-full t-text"
              style={{
                fontSize: 12, lineHeight: 1.2, textAlign: 'center',
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
              fontSize: 12, lineHeight: 1.2, textAlign: 'center',
              padding: '0 2px',
              borderBottom: '1px dashed var(--color-border-soft)',
              background: changed ? 'rgba(212,160,23,0.20)' : undefined,
              color: body ? (changed ? '#7c5800' : undefined) : 'var(--color-text-muted)',
              fontStyle: body ? 'normal' : 'italic',
              fontWeight: changed ? 600 : undefined,
              minHeight: '1.2em',
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
// RoundView — a normalized type RoundsTable can render from either live or draft data
// ============================================================================
type StopView = {
  client_key: string;
  building_id: string;
};
type RoundView = {
  client_key: string;
  id: string | null;            // null when this is a draft-new round
  name: string;
  shift_id: string | null;
  sort_order: number;
  stops: StopView[];
  current_user_id: string | null;
  current_user_name: string | null;
};

function liveToRoundView(r: Round): RoundView {
  return {
    client_key: r.id,
    id: r.id,
    name: r.name,
    shift_id: r.shift_id,
    sort_order: r.sort_order,
    stops: r.stops.map((s) => ({ client_key: s.id, building_id: s.building_id })),
    current_user_id: r.current?.user_id ?? null,
    current_user_name: r.current?.full_name ?? null,
  };
}

function draftToRoundView(d: DraftRound): RoundView {
  return {
    client_key: d.client_key,
    id: d.id,
    name: d.name,
    shift_id: d.shift_id,
    sort_order: d.sort_order,
    stops: d.stops,
    current_user_id: d.assigned_user_id,
    current_user_name: null, // name resolved at render time from engineer list
  };
}

// ============================================================================
// ShiftBlock
// ============================================================================
function ShiftBlock(props: {
  shift: Shift | null;
  label: string;
  rounds: RoundView[];
  mode: 'live' | 'compose' | 'preview';
  openMenu: MenuKey | null;
  setOpenMenu: (k: MenuKey | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  onAddRound: () => void;
  onUpdateRoundName: (ck: string, name: string) => void;
  onRemoveRound: (ck: string) => void;
  onAddStop: (round_ck: string, building_id: string) => void;
  onRemoveStop: (round_ck: string, stop_ck: string) => void;
  onMoveStop: (round_ck: string, stop_ck: string, dir: -1 | 1) => void;
  onSetAssignee: (round_ck: string, user_id: string | null) => void;
}) {
  const { shift, label, rounds, mode, engineers, buildings, onAddRound } = props;
  const editable = mode === 'compose';
  return (
    <div className="shift-block">
      <div className="shift-band flex items-baseline gap-3 flex-wrap">
        <span className="t-section-title" style={{ fontSize: 14 }}>{label}</span>
        <span className="t-small t-muted">· {rounds.length} round{rounds.length === 1 ? '' : 's'}</span>
        {shift && (
          <span className="t-small t-mono" style={{ fontWeight: 700, color: 'var(--color-text)' }}>
            · {shiftTimesLabel(shift)}
          </span>
        )}
      </div>

      {rounds.length === 0 ? (
        <p className="t-small t-muted italic px-2 py-3">No rounds in this shift yet.</p>
      ) : (
        <table className="min-w-full t-text border-collapse">
          <colgroup>
            <col style={{ width: '140px' }} />
            <col />
            <col style={{ width: editable ? '36px' : '0px' }} />
          </colgroup>
          <thead>
            <tr className="text-left t-text t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
              <th className="py-0.5 pr-1">Engineer</th>
              <th className="py-0.5 px-1">Buildings (in walk order)</th>
              {editable && <th className="py-0.5 px-1 rounds-no-print"></th>}
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => {
              const siblingBuildingIds = new Set<string>();
              for (const other of rounds) {
                if (other.client_key === r.client_key) continue;
                for (const s of other.stops) siblingBuildingIds.add(s.building_id);
              }
              return (
                <RoundRow
                  key={r.client_key}
                  round={r}
                  mode={mode}
                  openMenu={props.openMenu}
                  setOpenMenu={props.setOpenMenu}
                  engineers={engineers}
                  buildings={buildings}
                  siblingBuildingIds={siblingBuildingIds}
                  onUpdateRoundName={props.onUpdateRoundName}
                  onRemoveRound={props.onRemoveRound}
                  onAddStop={props.onAddStop}
                  onRemoveStop={props.onRemoveStop}
                  onMoveStop={props.onMoveStop}
                  onSetAssignee={props.onSetAssignee}
                />
              );
            })}
          </tbody>
        </table>
      )}

      {editable && (
        <div className="rounds-no-print pt-2">
          <button
            type="button"
            onClick={onAddRound}
            className="t-small px-3 py-1 rounded border"
            style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'transparent' }}
          >
            + Add round
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RoundRow
// ============================================================================
function RoundRow(props: {
  round: RoundView;
  mode: 'live' | 'compose' | 'preview';
  openMenu: MenuKey | null;
  setOpenMenu: (k: MenuKey | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
  siblingBuildingIds: Set<string>;
  onUpdateRoundName: (ck: string, name: string) => void;
  onRemoveRound: (ck: string) => void;
  onAddStop: (round_ck: string, building_id: string) => void;
  onRemoveStop: (round_ck: string, stop_ck: string) => void;
  onMoveStop: (round_ck: string, stop_ck: string, dir: -1 | 1) => void;
  onSetAssignee: (round_ck: string, user_id: string | null) => void;
}) {
  const { round, mode, openMenu, setOpenMenu, engineers, buildings, siblingBuildingIds } = props;
  const editable = mode === 'compose';
  const buildingsById = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  const engineersById = useMemo(() => new Map(engineers.map((e) => [e.user_id, e])), [engineers]);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(round.name);
  useEffect(() => setNameDraft(round.name), [round.name]);

  const engKey = `eng:${round.client_key}`;
  const addKey = `add:${round.client_key}`;
  const moreKey = `more:${round.client_key}`;
  const isOpen = (k: MenuKey) => openMenu === k;

  const usedBuildingIds = new Set(round.stops.map((s) => s.building_id));
  const availableBuildings = buildings.filter(
    (b) => !usedBuildingIds.has(b.id) && !siblingBuildingIds.has(b.id),
  );

  const closeMenu = () => setOpenMenu(null);

  // Resolve current assignee display name (works in compose mode where the
  // RoundView doesn't carry the joined name).
  const currentName = round.current_user_id
    ? round.current_user_name ?? engineersById.get(round.current_user_id)?.full_name ?? '(unknown)'
    : null;

  const isNewRound = mode === 'preview' && round.id === null;

  return (
    <tr className="border-b round-row" style={{
      borderColor: 'var(--color-border-soft)',
      background: isNewRound ? 'rgba(34,197,94,0.06)' : undefined,
      borderLeft: isNewRound ? '4px solid #15803d' : undefined,
    }}>
      {/* Engineer cell */}
      <td className="py-1 pr-1 align-top">
        {!editable ? (
          currentName ? (
            <span className="round-eng-chip" title={`Assigned to ${currentName}`}>
              {currentName}
            </span>
          ) : (
            <span className="t-small t-muted italic">Unassigned</span>
          )
        ) : (
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenMenu(isOpen(engKey) ? null : engKey); }}
              className={`round-eng-chip chip-editable ${currentName ? '' : 'unassigned'}`}
              style={{ cursor: 'pointer' }}
              title="Change engineer"
            >
              {currentName ?? '+ assign engineer'}
            </button>
            {isOpen(engKey) && (
              <EngineerMenu
                engineers={engineers}
                currentUserId={round.current_user_id}
                onPick={(uid) => { props.onSetAssignee(round.client_key, uid); closeMenu(); }}
                onUnassign={currentName ? () => { props.onSetAssignee(round.client_key, null); closeMenu(); } : null}
                onClose={closeMenu}
              />
            )}
          </span>
        )}

        {/* Round name */}
        <div style={{ marginTop: 2 }}>
          {renaming && editable ? (
            <input
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                if (nameDraft.trim() && nameDraft.trim() !== round.name) {
                  props.onUpdateRoundName(round.client_key, nameDraft.trim());
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setNameDraft(round.name); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="t-small px-1 py-0 border rounded"
              style={{ width: 130, borderColor: 'var(--color-border)' }}
            />
          ) : (
            <button
              type="button"
              onClick={(e) => { if (editable) { e.stopPropagation(); setRenaming(true); } }}
              className="t-small t-muted"
              style={{
                background: 'transparent', border: 'none', padding: 0,
                cursor: editable ? 'text' : 'default',
                textAlign: 'left',
              }}
              title={editable ? 'Click to rename' : round.name}
            >
              {round.name}
              {isNewRound && (
                <span className="ml-1 px-1 rounded text-white" style={{ background: '#15803d', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px' }}>
                  NEW
                </span>
              )}
            </button>
          )}
        </div>
      </td>

      {/* Building stops */}
      <td className="py-1 px-1 align-top">
        {round.stops.length === 0 && !editable ? (
          <span className="t-small t-muted italic">No stops</span>
        ) : (
          <>
            {round.stops.map((stop) => {
              const stopKey = `stop:${stop.client_key}`;
              const stopOpen = isOpen(stopKey);
              const b = buildingsById.get(stop.building_id);
              return (
                <span key={stop.client_key} style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={(e) => {
                      if (!editable) return;
                      e.stopPropagation();
                      setOpenMenu(stopOpen ? null : stopKey);
                    }}
                    className={`round-bld-chip ${editable ? 'chip-editable' : ''}`}
                    title={editable ? `Edit ${b?.name ?? ''}` : (b?.name ?? '')}
                    style={editable ? { cursor: 'pointer' } : undefined}
                  >
                    {b?.short_code ?? b?.code ?? '?'}
                  </button>
                  {stopOpen && editable && b && (
                    <StopMenu
                      buildingName={b.name}
                      buildingCode={b.short_code ?? b.code}
                      canMoveLeft={round.stops[0]?.client_key !== stop.client_key}
                      canMoveRight={round.stops[round.stops.length - 1]?.client_key !== stop.client_key}
                      onMoveLeft={() => { props.onMoveStop(round.client_key, stop.client_key, -1); closeMenu(); }}
                      onMoveRight={() => { props.onMoveStop(round.client_key, stop.client_key, 1); closeMenu(); }}
                      onRemove={() => { props.onRemoveStop(round.client_key, stop.client_key); closeMenu(); }}
                      onClose={closeMenu}
                    />
                  )}
                </span>
              );
            })}

            {editable && (
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpenMenu(isOpen(addKey) ? null : addKey); }}
                  className="round-bld-chip chip-editable rounds-no-print"
                  style={{ cursor: 'pointer', borderStyle: 'solid', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                  title="Add a building to this round"
                >
                  + stop
                </button>
                {isOpen(addKey) && (
                  <BuildingMenu
                    buildings={availableBuildings}
                    onPick={(bid) => { props.onAddStop(round.client_key, bid); closeMenu(); }}
                    onClose={closeMenu}
                  />
                )}
              </span>
            )}
          </>
        )}
      </td>

      {/* More menu */}
      {editable && (
        <td className="py-1 px-1 align-top rounds-no-print">
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenMenu(isOpen(moreKey) ? null : moreKey); }}
              className="t-small"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0 6px' }}
              title="More"
            >
              ⋯
            </button>
            {isOpen(moreKey) && (
              <div onClick={(e) => e.stopPropagation()} className="chip-menu" style={menuStyle}>
                <button
                  type="button"
                  onClick={() => { props.onRemoveRound(round.client_key); closeMenu(); }}
                  className="t-small px-2 py-1 rounded border"
                  style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}
                >
                  Delete round
                </button>
              </div>
            )}
          </span>
        </td>
      )}
    </tr>
  );
}

// ============================================================================
// Popovers
// ============================================================================
const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  zIndex: 50,
  minWidth: 200,
  background: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
  padding: 8,
};

function EngineerMenu(props: {
  engineers: EngineerRow[];
  currentUserId: string | null;
  onPick: (user_id: string) => void;
  onUnassign: (() => void) | null;
  onClose: () => void;
}) {
  const sorted = useMemo(
    () => props.engineers.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [props.engineers],
  );
  return (
    <div onClick={(e) => e.stopPropagation()} className="chip-menu" style={menuStyle}>
      <div className="space-y-2">
        <p className="t-small t-muted uppercase tracking-wider">Assign engineer</p>
        <select
          autoFocus
          value={props.currentUserId ?? ''}
          onChange={(e) => { if (e.target.value) props.onPick(e.target.value); }}
          className="w-full border rounded px-2 py-1 t-text"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
        >
          <option value="">— pick engineer —</option>
          {sorted.map((e) => (
            <option key={e.user_id} value={e.user_id}>
              {e.is_lead ? '★ ' : ''}{e.full_name}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between gap-2 pt-1">
          {props.onUnassign ? (
            <button type="button" onClick={props.onUnassign}
              className="t-small px-2 py-1 rounded border"
              style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}>
              Unassign
            </button>
          ) : <span />}
          <button type="button" onClick={props.onClose}
            className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function BuildingMenu(props: {
  buildings: Building[];
  onPick: (building_id: string) => void;
  onClose: () => void;
}) {
  const sorted = useMemo(
    () => props.buildings.slice().sort((a, b) =>
      (a.short_code ?? a.code).localeCompare(b.short_code ?? b.code, undefined, { numeric: true })),
    [props.buildings],
  );
  return (
    <div onClick={(e) => e.stopPropagation()} className="chip-menu" style={menuStyle}>
      <div className="space-y-2">
        <p className="t-small t-muted uppercase tracking-wider">Add building stop</p>
        {sorted.length === 0 ? (
          <p className="t-small t-muted italic">All buildings are already covered by rounds in this shift.</p>
        ) : (
          <select
            autoFocus
            defaultValue=""
            onChange={(e) => { if (e.target.value) props.onPick(e.target.value); }}
            className="w-full border rounded px-2 py-1 t-text"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
          >
            <option value="">— pick building —</option>
            {sorted.map((b) => (
              <option key={b.id} value={b.id}>
                {b.short_code ?? b.code} — {b.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center justify-end pt-1">
          <button type="button" onClick={props.onClose}
            className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StopMenu(props: {
  buildingName: string;
  buildingCode: string;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="chip-menu" style={menuStyle}>
      <div className="space-y-2">
        <p className="t-small t-muted uppercase tracking-wider">{props.buildingCode}</p>
        <p className="t-small">{props.buildingName}</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!props.canMoveLeft} onClick={props.onMoveLeft}
            className="t-small px-2 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)' }} title="Move earlier in walk order">
            ◀ earlier
          </button>
          <button type="button" disabled={!props.canMoveRight} onClick={props.onMoveRight}
            className="t-small px-2 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)' }} title="Move later in walk order">
            later ▶
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" onClick={props.onRemove}
            className="t-small px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}>
            Remove
          </button>
          <button type="button" onClick={props.onClose}
            className="t-small px-2 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DraftPreview for rounds
// ============================================================================
function RoundsDraftPreview({
  pending, isManager, isProposer, publishing, rejecting, withdrawing,
  engineers, buildings, shifts, liveRounds, liveNotes,
  onPublish, onReject, onWithdraw,
}: {
  pending: { id: string; payload: RoundsProposalPayload; note: string | null;
             proposed_by_name: string; proposed_at: string; proposed_by_user_id: string };
  isManager: boolean;
  isProposer: boolean;
  publishing: boolean;
  rejecting: boolean;
  withdrawing: boolean;
  engineers: EngineerRow[];
  buildings: Building[];
  shifts: Shift[];
  liveRounds: Round[];
  liveNotes: { slot: number; body: string }[];
  onPublish: () => void;
  onReject: (note: string | null) => void;
  onWithdraw: () => void;
}) {
  const [rejectNote, setRejectNote] = useState<string>('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const busy = publishing || rejecting || withdrawing;

  // Render the proposed state as RoundView[]
  const proposedRounds: RoundView[] = (pending.payload.rounds ?? []).map((r, i) => ({
    client_key: r.id ?? `draft-${i}`,
    id: r.id,
    name: r.name,
    shift_id: r.shift_id,
    sort_order: r.sort_order,
    stops: r.stops.map((s, j) => ({ client_key: `${i}-${j}`, building_id: s.building_id })),
    current_user_id: r.assigned_user_id,
    current_user_name: r.assigned_user_id
      ? engineers.find((e) => e.user_id === r.assigned_user_id)?.full_name ?? null
      : null,
  }));
  const groups = buildGroups(proposedRounds, shifts);

  // Summary diff vs live
  const liveIds = new Set(liveRounds.map((r) => r.id));
  const proposedIds = new Set((pending.payload.rounds ?? []).filter((r) => r.id !== null).map((r) => r.id as string));
  const addedRounds = (pending.payload.rounds ?? []).filter((r) => r.id === null);
  const removedRounds = liveRounds.filter((r) => !proposedIds.has(r.id));

  // Detect assignment changes on kept rounds
  const reassigned: { roundName: string; from: string; to: string }[] = [];
  for (const pr of (pending.payload.rounds ?? [])) {
    if (pr.id === null || !liveIds.has(pr.id)) continue;
    const live = liveRounds.find((r) => r.id === pr.id);
    if (!live) continue;
    const liveUid = live.current?.user_id ?? null;
    if (liveUid === pr.assigned_user_id) continue;
    const fromName = live.current?.full_name ?? 'unassigned';
    const toName = pr.assigned_user_id
      ? engineers.find((e) => e.user_id === pr.assigned_user_id)?.full_name ?? '?'
      : 'unassigned';
    reassigned.push({ roundName: pr.name, from: fromName, to: toName });
  }

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
            Rounds
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
              className="t-small px-3 py-1 rounded border" style={{ borderColor: 'var(--color-border)' }}>
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

      <div className="mb-2">
        <NotesBar mode="preview" notes={proposedNotes} liveNotes={liveNotes} />
      </div>

      {(addedRounds.length > 0 || removedRounds.length > 0 || reassigned.length > 0) && (
        <div className="mb-3 p-2 rounded border" style={{
          borderColor: '#d4a017', background: 'rgba(212,160,23,0.10)',
        }}>
          <p className="t-small font-semibold mb-1" style={{ color: '#a16207', letterSpacing: '0.3px' }}>
            CHANGES vs LIVE
          </p>
          <ul className="t-small" style={{ color: '#7c5800', listStyle: 'disc', paddingLeft: '1.25rem' }}>
            {addedRounds.length > 0 && (
              <li>Adding {addedRounds.length} round{addedRounds.length === 1 ? '' : 's'}: {addedRounds.map((r) => r.name).join(', ')}</li>
            )}
            {removedRounds.length > 0 && (
              <li style={{ color: 'var(--color-danger)' }}>
                Removing {removedRounds.length} round{removedRounds.length === 1 ? '' : 's'}:{' '}
                <span style={{ textDecoration: 'line-through' }}>{removedRounds.map((r) => r.name).join(', ')}</span>
              </li>
            )}
            {reassigned.map((r, i) => (
              <li key={i}>
                <span className="font-medium">{r.roundName}</span>: {r.from} → {r.to}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounds-grid">
        {groups.map((g) => (
          <ShiftBlock
            key={g.key}
            shift={g.shift}
            label={g.label}
            rounds={g.rounds}
            mode="preview"
            openMenu={null}
            setOpenMenu={() => {}}
            engineers={engineers}
            buildings={buildings}
            onAddRound={() => {}}
            onUpdateRoundName={() => {}}
            onRemoveRound={() => {}}
            onAddStop={() => {}}
            onRemoveStop={() => {}}
            onMoveStop={() => {}}
            onSetAssignee={() => {}}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// HistorySection for rounds
// ============================================================================
function RoundsHistorySection({
  history, loading, engineersById, buildingsById, open, onOpenChange,
}: {
  history: PublishedProposal<RoundsProposalPayload>[];
  loading: boolean;
  engineersById: Record<string, EngineerRow>;
  buildingsById: Record<string, Building>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  if (loading) return null;
  if (history.length === 0) {
    return (
      <div className="t-card rounds-no-print" style={{ padding: '0.5rem 1rem', opacity: 0.6 }}>
        <p className="t-small t-muted italic">No round changes published yet.</p>
      </div>
    );
  }
  // Silence unused warnings - these may be useful for richer diffs later
  void engineersById; void buildingsById;
  return (
    <div className="t-card rounds-no-print" style={{ padding: '0.5rem 1rem' }}>
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
            const currIds = new Set((entry.payload.rounds ?? []).filter((r) => r.id).map((r) => r.id as string));
            const prevIds = new Set((prev?.payload.rounds ?? []).filter((r) => r.id).map((r) => r.id as string));
            const addedCount = prev ? Array.from(currIds).filter((id) => !prevIds.has(id)).length
                                    + (entry.payload.rounds ?? []).filter((r) => r.id === null).length
                                    : (entry.payload.rounds ?? []).length;
            const removedCount = prev ? Array.from(prevIds).filter((id) => !currIds.has(id)).length : 0;
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
                    {prev ? `+${addedCount} · −${removedCount}` : `initial publish (${(entry.payload.rounds ?? []).length})`}
                  </span>
                </div>
                {entry.note && (
                  <p className="t-small mt-1" style={{ color: 'var(--color-danger)', fontStyle: 'italic' }}>
                    "{entry.note}"
                  </p>
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
type ShiftGroupView = {
  key: string;
  shift: Shift | null;
  label: string;
  rounds: RoundView[];
};

function buildGroups(rounds: RoundView[], shifts: Shift[]): ShiftGroupView[] {
  const byShift = new Map<string, RoundView[]>();
  const noShift: RoundView[] = [];
  for (const r of rounds) {
    if (r.shift_id) {
      const list = byShift.get(r.shift_id) ?? [];
      list.push(r);
      byShift.set(r.shift_id, list);
    } else {
      noShift.push(r);
    }
  }
  for (const list of byShift.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  noShift.sort((a, b) => a.sort_order - b.sort_order);

  const groups: ShiftGroupView[] = shifts
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({
      key: s.id,
      shift: s,
      label: `${s.name} shift`,
      rounds: byShift.get(s.id) ?? [],
    }));

  if (noShift.length > 0) {
    groups.push({ key: '_unassigned', shift: null, label: 'No shift', rounds: noShift });
  }
  return groups;
}

function countTotals(rounds: RoundView[]) {
  const stops = rounds.reduce((a, r) => a + r.stops.length, 0);
  const assigned = rounds.filter((r) => r.current_user_id !== null).length;
  return { rounds: rounds.length, stops, assigned, unassigned: rounds.length - assigned };
}

function shiftTimesLabel(s: Shift): string {
  const start = fmtShiftTime(s.start_time);
  const end = fmtShiftTime(s.end_time);
  return `${start} – ${end}`;
}

// ============================================================================
// styles (unchanged shape, just print-target rename for the live-only card)
// ============================================================================
function RoundsTabStyles() {
  return (
    <style>{`
      @page { size: letter landscape; margin: 0.4in; }
      @media print {
        body * { visibility: hidden !important; }
        .rounds-print-target, .rounds-print-target * { visibility: visible !important; }
        .rounds-print-target {
          position: absolute !important;
          top: 0; left: 0;
          width: 100%;
          padding: 12px !important;
          background: white !important;
        }
        .rounds-no-print { display: none !important; }
        .rounds-card { box-shadow: none !important; border: none !important; padding: 0 !important; }
        body { background: white !important; }
        .round-bld-chip, .round-eng-chip {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        tr, .round-row { page-break-inside: avoid; }
        .rounds-grid { grid-template-columns: 1fr 1fr !important; gap: 16px !important; }
      }
      .rounds-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
        gap: 12px;
      }
      .shift-block {
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: transparent;
      }
      .shift-band {
        margin: -8px -10px 6px -10px;
        padding: 6px 10px;
        background: transparent;
        border-bottom: 1px solid var(--color-border);
        border-radius: 8px 8px 0 0;
      }
      .round-bld-chip {
        display: inline-block;
        padding: 0px 6px;
        margin: 1px 2px 1px 0;
        border-radius: 5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        line-height: 1.4;
        white-space: nowrap;
        background: var(--color-accent);
        color: white;
        border: 1px solid var(--color-accent);
      }
      .round-bld-chip.chip-editable:hover {
        filter: brightness(1.08);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }
      button.round-bld-chip { font: inherit; cursor: pointer; }
      .round-eng-chip {
        display: inline-block;
        padding: 1px 8px;
        border-radius: 12px;
        font-size: 12px;
        line-height: 1.4;
        background: rgba(34, 197, 94, 0.12);
        color: #166534;
        border: 1px solid #86efac;
        white-space: nowrap;
        font-weight: 500;
      }
      .round-eng-chip.unassigned {
        background: transparent;
        color: var(--color-text-muted);
        border: 1px dashed var(--color-border);
        font-weight: 400;
      }
      .round-eng-chip.chip-editable:hover {
        filter: brightness(1.05);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }
      button.round-eng-chip { font: inherit; cursor: pointer; }
    `}</style>
  );
}
