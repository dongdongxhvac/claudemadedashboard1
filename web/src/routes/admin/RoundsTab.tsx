// Admin → Rounds tab.
//
// Mirrors BuildingsTab's direct-write edit model. A "round" is one engineer's
// daily walk through several buildings, scoped to a shift (e.g. AM Route 1 —
// Edwin walks 10 → 300 → 350 → 730 → 750 during the 7am shift).
//
// Edit interactions:
//   * Click engineer chip → popover: change engineer / unassign
//   * Click building chip → popover: remove / reorder
//   * Click "+ add stop"  → popover: pick building (only unused-in-this-round)
//   * Click round name    → inline rename
//   * "+ Add round"       → creates an empty round in that shift
import { useEffect, useMemo, useState } from 'react';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useShifts, useShiftsRealtime, fmtShiftTime, type Shift } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import {
  useRounds,
  useRoundsRealtime,
  useCreateRound,
  useUpdateRound,
  useDeleteRound,
  useAddStop,
  useRemoveStop,
  useReorderStops,
  useAssignRoundEngineer,
  useUnassignRoundEngineer,
  type Round,
  type RoundStop,
} from '../../hooks/useRounds';

type MenuKey = string;

export function RoundsTab() {
  useShiftsRealtime();
  useBuildingsRealtime();
  useRoundsRealtime();

  const engineersQ = useEngineers();
  const shiftsQ    = useShifts();
  const buildingsQ = useBuildings();
  const roundsQ    = useRounds();

  const [editing, setEditing] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const closeMenu = () => setOpenMenu(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = () => closeMenu();
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', onDocClick); };
  }, [openMenu]);

  useEffect(() => { if (!editing) closeMenu(); }, [editing]);

  const loading = engineersQ.isLoading || shiftsQ.isLoading || buildingsQ.isLoading || roundsQ.isLoading;
  const error   = engineersQ.error ?? shiftsQ.error ?? buildingsQ.error ?? roundsQ.error;

  const groups = useMemo(() => buildGroups(roundsQ.data ?? [], shiftsQ.data ?? []), [roundsQ.data, shiftsQ.data]);

  const totals = useMemo(() => {
    const rs = roundsQ.data ?? [];
    const stops = rs.reduce((a, r) => a + r.stops.length, 0);
    const assigned = rs.filter((r) => r.current).length;
    return { rounds: rs.length, stops, assigned, unassigned: rs.length - assigned };
  }, [roundsQ.data]);

  if (loading) return <p className="t-text t-muted">Loading rounds…</p>;
  if (error)   return <p className="t-text t-danger">Error: {(error as Error).message}</p>;

  const engineers = (engineersQ.data ?? []).filter((e) => e.active && e.role === 'engineer');
  const buildings = buildingsQ.data ?? [];

  return (
    <div className="space-y-3 rounds-root">
      <RoundsTabStyles />

      <div className="t-card rounds-card" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
          <div>
            <h2 className="t-section-title">Rounds</h2>
            <p className="t-small t-muted">
              <b>{totals.rounds}</b> round{totals.rounds === 1 ? '' : 's'} ·{' '}
              <b>{totals.stops}</b> building stop{totals.stops === 1 ? '' : 's'} ·{' '}
              <b>{totals.assigned}</b> assigned
              {totals.unassigned > 0 && <> · <span className="t-danger">{totals.unassigned} unassigned</span></>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="t-small t-muted text-right">
              <span className="round-bld-chip" style={{ marginRight: 6 }}>10</span>building stop &nbsp;
              <span className="round-eng-chip" style={{ marginRight: 6 }}>Edwin</span>engineer assigned
            </p>
            <div className="flex items-center gap-2 rounds-no-print">
              <button
                onClick={() => window.print()}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                title="Print landscape"
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
          <div className="mb-3 p-2 rounded border rounds-no-print"
            style={{ borderColor: 'var(--color-accent)', background: 'rgba(59, 130, 246, 0.06)' }}>
            <p className="t-small">
              <b>Editing mode</b> · changes save immediately. Click the engineer chip to reassign · click a building chip to remove · click <b>+ stop</b> to add a building · click the round name to rename. Use <b>+ Add round</b> at the bottom of each shift.
            </p>
          </div>
        )}

        <div className="rounds-grid">
          {groups.map((g) => (
            <ShiftBlock
              key={g.key}
              shift={g.shift}
              label={g.label}
              rounds={g.rounds}
              editing={editing}
              openMenu={openMenu}
              setOpenMenu={setOpenMenu}
              engineers={engineers}
              buildings={buildings}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Shift block (one per shift)
// ============================================================================

function ShiftBlock(props: {
  shift: Shift | null;
  label: string;
  rounds: Round[];
  editing: boolean;
  openMenu: MenuKey | null;
  setOpenMenu: (k: MenuKey | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
}) {
  const { shift, label, rounds, editing, openMenu, setOpenMenu, engineers, buildings } = props;

  const create = useCreateRound();
  const onAddRound = async () => {
    const nextSort = (rounds.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1);
    const prefix = label.toLowerCase().includes('7') ? 'AM Route' : 'PM Route';
    await create.mutateAsync({
      name: `${prefix} ${rounds.length + 1}`,
      shift_id: shift?.id ?? null,
      sort_order: nextSort,
    });
  };

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
            <col style={{ width: editing ? '36px' : '0px' }} />
          </colgroup>
          <thead>
            <tr className="text-left t-text t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
              <th className="py-0.5 pr-1">Engineer</th>
              <th className="py-0.5 px-1">Buildings (in walk order)</th>
              {editing && <th className="py-0.5 px-1 rounds-no-print"></th>}
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <RoundRow
                key={r.id}
                round={r}
                editing={editing}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                engineers={engineers}
                buildings={buildings}
              />
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="rounds-no-print pt-2">
          <button
            type="button"
            onClick={onAddRound}
            disabled={create.isPending}
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
// Round row
// ============================================================================

function RoundRow(props: {
  round: Round;
  editing: boolean;
  openMenu: MenuKey | null;
  setOpenMenu: (k: MenuKey | null) => void;
  engineers: EngineerRow[];
  buildings: Building[];
}) {
  const { round, editing, openMenu, setOpenMenu, engineers, buildings } = props;

  const update    = useUpdateRound();
  const remove    = useDeleteRound();
  const addStop   = useAddStop();
  const removeStop = useRemoveStop();
  const reorder   = useReorderStops();
  const assign    = useAssignRoundEngineer();
  const unassign  = useUnassignRoundEngineer();

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(round.name);
  useEffect(() => setNameDraft(round.name), [round.name]);

  const engKey  = `eng:${round.id}`;
  const addKey  = `add:${round.id}`;
  const moreKey = `more:${round.id}`;

  const isOpen = (k: MenuKey) => openMenu === k;

  const usedBuildingIds = new Set(round.stops.map((s) => s.building_id));
  const availableBuildings = buildings.filter((b) => !usedBuildingIds.has(b.id));

  const closeMenu = () => setOpenMenu(null);

  const onMove = async (stop: RoundStop, dir: -1 | 1) => {
    const idx = round.stops.findIndex((s) => s.id === stop.id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= round.stops.length) return;
    const reordered = round.stops.slice();
    [reordered[idx], reordered[j]] = [reordered[j], reordered[idx]];
    await reorder.mutateAsync({ ordered_stop_ids: reordered.map((s) => s.id) });
  };

  return (
    <tr className="border-b round-row" style={{ borderColor: 'var(--color-border-soft)' }}>
      {/* Engineer cell */}
      <td className="py-1 pr-1 align-top">
        {!editing ? (
          round.current ? (
            <span className="round-eng-chip" title={`Assigned ${round.current.starts_on}`}>
              {round.current.full_name ?? '—'}
            </span>
          ) : (
            <span className="t-small t-muted italic">Unassigned</span>
          )
        ) : (
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpenMenu(isOpen(engKey) ? null : engKey); }}
              className={`round-eng-chip chip-editable ${round.current ? '' : 'unassigned'}`}
              style={{ cursor: 'pointer' }}
              title="Change engineer"
            >
              {round.current?.full_name ?? '+ assign engineer'}
            </button>
            {isOpen(engKey) && (
              <EngineerMenu
                engineers={engineers}
                currentUserId={round.current?.user_id ?? null}
                onPick={async (uid) => {
                  await assign.mutateAsync({ round_id: round.id, user_id: uid });
                  closeMenu();
                }}
                onUnassign={round.current ? async () => {
                  await unassign.mutateAsync({ round_id: round.id });
                  closeMenu();
                } : null}
                onClose={closeMenu}
              />
            )}
          </span>
        )}

        {/* Round name (line 2). Click to rename in edit mode. */}
        <div style={{ marginTop: 2 }}>
          {renaming ? (
            <input
              type="text"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={async () => {
                setRenaming(false);
                if (nameDraft.trim() && nameDraft.trim() !== round.name) {
                  await update.mutateAsync({ id: round.id, patch: { name: nameDraft.trim() } });
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
              onClick={(e) => { if (editing) { e.stopPropagation(); setRenaming(true); } }}
              className="t-small t-muted"
              style={{
                background: 'transparent', border: 'none', padding: 0,
                cursor: editing ? 'text' : 'default',
                textAlign: 'left',
              }}
              title={editing ? 'Click to rename' : round.name}
            >
              {round.name}
            </button>
          )}
        </div>
      </td>

      {/* Building stops */}
      <td className="py-1 px-1 align-top">
        {round.stops.length === 0 && !editing ? (
          <span className="t-small t-muted italic">No stops</span>
        ) : (
          <>
            {round.stops.map((stop) => {
              const stopKey = `stop:${stop.id}`;
              const stopOpen = isOpen(stopKey);
              return (
                <span key={stop.id} style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    type="button"
                    disabled={!editing}
                    onClick={(e) => {
                      if (!editing) return;
                      e.stopPropagation();
                      setOpenMenu(stopOpen ? null : stopKey);
                    }}
                    className={`round-bld-chip ${editing ? 'chip-editable' : ''}`}
                    title={editing ? `Edit ${stop.name}` : stop.name}
                    style={editing ? { cursor: 'pointer' } : undefined}
                  >
                    {stop.short_code ?? stop.code}
                  </button>
                  {stopOpen && (
                    <StopMenu
                      stop={stop}
                      canMoveLeft={round.stops[0]?.id !== stop.id}
                      canMoveRight={round.stops[round.stops.length - 1]?.id !== stop.id}
                      onMoveLeft={async () => { await onMove(stop, -1); closeMenu(); }}
                      onMoveRight={async () => { await onMove(stop, 1); closeMenu(); }}
                      onRemove={async () => { await removeStop.mutateAsync({ stop_id: stop.id }); closeMenu(); }}
                      onClose={closeMenu}
                    />
                  )}
                </span>
              );
            })}

            {editing && (
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
                    onPick={async (bid) => {
                      await addStop.mutateAsync({ round_id: round.id, building_id: bid });
                      closeMenu();
                    }}
                    onClose={closeMenu}
                  />
                )}
              </span>
            )}
          </>
        )}
      </td>

      {/* More menu (delete) */}
      {editing && (
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
                  onClick={async () => {
                    if (!confirm(`Delete "${round.name}"? This removes all stops and the current assignment.`)) return;
                    await remove.mutateAsync({ id: round.id });
                    closeMenu();
                  }}
                  disabled={remove.isPending}
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
  onPick: (user_id: string) => void | Promise<void>;
  onUnassign: (() => void | Promise<void>) | null;
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
            <button
              type="button"
              onClick={() => props.onUnassign?.()}
              className="t-small px-2 py-1 rounded border"
              style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}
            >
              Unassign
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={props.onClose}
            className="t-small px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function BuildingMenu(props: {
  buildings: Building[];
  onPick: (building_id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const sorted = useMemo(
    () => props.buildings.slice().sort((a, b) =>
      (a.short_code ?? a.code).localeCompare(b.short_code ?? b.code, undefined, { numeric: true })
    ),
    [props.buildings],
  );
  return (
    <div onClick={(e) => e.stopPropagation()} className="chip-menu" style={menuStyle}>
      <div className="space-y-2">
        <p className="t-small t-muted uppercase tracking-wider">Add building stop</p>
        {sorted.length === 0 ? (
          <p className="t-small t-muted italic">All active buildings are already in this round.</p>
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
          <button
            type="button"
            onClick={props.onClose}
            className="t-small px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StopMenu(props: {
  stop: RoundStop;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft:  () => void | Promise<void>;
  onMoveRight: () => void | Promise<void>;
  onRemove:    () => void | Promise<void>;
  onClose:     () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="chip-menu" style={menuStyle}>
      <div className="space-y-2">
        <p className="t-small t-muted uppercase tracking-wider">{props.stop.short_code ?? props.stop.code}</p>
        <p className="t-small">{props.stop.name}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!props.canMoveLeft}
            onClick={() => props.onMoveLeft()}
            className="t-small px-2 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)' }}
            title="Move earlier in walk order"
          >
            ◀ earlier
          </button>
          <button
            type="button"
            disabled={!props.canMoveRight}
            onClick={() => props.onMoveRight()}
            className="t-small px-2 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)' }}
            title="Move later in walk order"
          >
            later ▶
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => props.onRemove()}
            className="t-small px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent' }}
          >
            Remove
          </button>
          <button
            type="button"
            onClick={props.onClose}
            className="t-small px-2 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================

function RoundsTabStyles() {
  return (
    <style>{`
      @page { size: letter landscape; margin: 0.4in; }
      @media print {
        body * { visibility: hidden !important; }
        .rounds-root, .rounds-root * { visibility: visible !important; }
        .rounds-root {
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
        background: var(--color-card);
      }
      .shift-band {
        margin: -8px -10px 6px -10px;
        padding: 6px 10px;
        background: var(--color-bg);
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

// ============================================================================
// data shaping
// ============================================================================

type ShiftGroup = {
  key: string;
  shift: Shift | null;
  label: string;
  rounds: Round[];
};

function buildGroups(rounds: Round[], shifts: Shift[]): ShiftGroup[] {
  const byShift = new Map<string, Round[]>();
  const noShift: Round[] = [];
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

  const groups: ShiftGroup[] = shifts
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

function shiftTimesLabel(s: Shift): string {
  const start = fmtShiftTime(s.start_time);
  const end = fmtShiftTime(s.end_time);
  return `${start} – ${end}`;
}
