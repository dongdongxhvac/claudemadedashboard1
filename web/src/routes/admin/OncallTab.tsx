// Admin → On-call tab.
//
// Draft → review → publish workflow (Phase A of admin proposals):
//   - Leads / admins / managers click "Propose changes" → in-place editor
//   - "Submit for review" inserts a row into admin_proposals (status=pending);
//     the live oncall_* tables are NOT touched.
//   - The pending draft renders as a second read-only RotationTable below the
//     live one, with proposer name / time / actions.
//   - Managers see [Publish] / [Reject]. Proposer sees [Withdraw].
//   - Only one pending proposal per tab (DB unique partial index); the
//     "Propose changes" button is disabled while one is open.
//
// Round-robin math (unchanged from v1.1): engineer[i] gets weekStart =
// start_friday + (cycle*N + i)*7. effective_from filters pre-effective cells.
// Preview cycle: R+1 columns rendered; only first R cycles get persisted.
// Holiday weeks rendered in red (US federal calendar; weekContainsHoliday).
import { useEffect, useMemo, useState } from 'react';
import {
  useOncallParticipants, useOncallSettings,
  useOncallRealtime, addDaysIso, fmtMd,
  type OncallParticipant,
} from '../../hooks/useOncall';
import {
  usePendingProposal, useProposeOncall, usePublishOncallProposal,
  useRejectProposal, useWithdrawProposal, useAdminProposalsRealtime,
  type OncallProposalPayload,
} from '../../hooks/useAdminProposals';
import { useEngineers } from '../../hooks/useEngineers';
import { useMe } from '../../hooks/useMe';
import { weekContainsHoliday } from '../../lib/holidays';

type Row = {
  user_id: string;
  full_name: string;
  cmms_assignee_name: string | null;
  effective_from: string | null;
};

type DisplaySettings = {
  start_friday: string | null;
  rotations_per_engineer: number;
};

/** Next upcoming Friday from today (today if today is Friday). */
function nextFridayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..5=Fri..6=Sat
  const offset = (5 - day + 7) % 7; // 0 if Friday
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Returns true iff today's local date is inside [weekStart, weekStart+7). */
function isActiveWeek(weekStart: string, todayIso: string): boolean {
  const end = addDaysIso(weekStart, 7);
  return weekStart <= todayIso && todayIso < end;
}

export function OncallTab() {
  useOncallRealtime();
  useAdminProposalsRealtime();
  const participantsQ = useOncallParticipants();
  const settingsQ = useOncallSettings();
  const engineersQ = useEngineers();
  const pendingQ = usePendingProposal<OncallProposalPayload>('oncall');
  const me = useMe();

  const propose = useProposeOncall();
  const publish = usePublishOncallProposal();
  const reject = useRejectProposal('oncall');
  const withdraw = useWithdrawProposal('oncall');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Row[]>([]);
  const [startFriday, setStartFriday] = useState<string>('');
  const [rotations, setRotations] = useState<number>(4);
  const [proposerNote, setProposerNote] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Snapshot server state into local on entering edit mode (or first load).
  useEffect(() => {
    if (editing) return;
    if (!participantsQ.data || !settingsQ.data) return;
    setDraft(participantsToRows(participantsQ.data));
    setStartFriday(settingsQ.data.start_friday ?? nextFridayIso());
    setRotations(settingsQ.data.rotations_per_engineer ?? 4);
    setProposerNote('');
  }, [editing, participantsQ.data, settingsQ.data]);

  const todayIso = new Date().toISOString().slice(0, 10);

  const liveRows: Row[] = participantsToRows(participantsQ.data ?? []);
  const liveSettings: DisplaySettings = {
    start_friday: settingsQ.data?.start_friday ?? null,
    rotations_per_engineer: settingsQ.data?.rotations_per_engineer ?? 4,
  };

  // What table is shown in the TOP card?
  //   - editing → the draft being composed (with edit controls)
  //   - otherwise → the live data
  const topRows: Row[] = editing ? draft : liveRows;
  const topSettings: DisplaySettings = editing
    ? { start_friday: startFriday, rotations_per_engineer: rotations }
    : liveSettings;

  // Engineer picker: only those not in the draft (edit mode) / live (read mode).
  const topParticipantIds = useMemo(
    () => new Set(topRows.map((p) => p.user_id)),
    [topRows],
  );
  const pickerOptions = useMemo(() => {
    return (engineersQ.data ?? [])
      .filter((e) => e.active && !topParticipantIds.has(e.user_id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [engineersQ.data, topParticipantIds]);

  // ----- Action handlers (edit mode only)
  const moveUp   = (idx: number) => idx > 0 && setDraft((d) => swap(d, idx, idx - 1));
  const moveDown = (idx: number) => idx < draft.length - 1 && setDraft((d) => swap(d, idx, idx + 1));
  const remove   = (idx: number) => setDraft((d) => d.filter((_, i) => i !== idx));
  const setEffectiveFrom = (idx: number, value: string) =>
    setDraft((d) => d.map((p, i) => (i === idx ? { ...p, effective_from: value || null } : p)));
  const addParticipant = (user_id: string) => {
    const eng = (engineersQ.data ?? []).find((e) => e.user_id === user_id);
    if (!eng) return;
    setDraft((d) => [
      ...d,
      {
        user_id: eng.user_id,
        full_name: eng.full_name,
        cmms_assignee_name: eng.cmms_assignee_name,
        effective_from: null,
      },
    ]);
  };

  const canPropose = !!(me.data && (me.data.role === 'admin' || me.data.is_lead || me.data.is_manager));
  const pending = pendingQ.data ?? null;
  const isManager = me.data?.is_manager === true;
  const isProposer = pending && me.data ? pending.proposed_by_user_id === me.data.id : false;
  const hasPending = pending !== null;

  const onStartEdit = () => {
    setActionError(null);
    setEditing(true);
  };
  const onCancel = () => {
    setEditing(false);
    setActionError(null);
  };
  const onSubmit = async () => {
    setActionError(null);
    if (!startFriday) {
      setActionError('Set a Start Friday date before submitting.');
      return;
    }
    try {
      await propose.mutateAsync({
        payload: {
          settings: { start_friday: startFriday, rotations_per_engineer: rotations },
          participants: draft.map((p) => ({ user_id: p.user_id, effective_from: p.effective_from })),
        },
        note: proposerNote.trim() || null,
      });
      setEditing(false);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  if (participantsQ.isLoading || settingsQ.isLoading || me.isLoading) {
    return <p className="t-text t-muted">Loading on-call schedule…</p>;
  }
  if (participantsQ.isError) return <p className="t-text t-danger">Error: {(participantsQ.error as Error).message}</p>;
  if (settingsQ.isError)     return <p className="t-text t-danger">Error: {(settingsQ.error as Error).message}</p>;

  return (
    <div className="space-y-3 oncall-root">
      {/* Print rules: only the LIVE on-call card prints (draft section is
          hidden on paper). Trick: visibility:hidden on everything, then
          re-show .oncall-print-target subtree and pin it to page top. */}
      <style>{`
        @page { size: letter landscape; margin: 0.4in; }
        @media print {
          body * { visibility: hidden !important; }
          .oncall-print-target, .oncall-print-target * { visibility: visible !important; }
          .oncall-print-target {
            position: absolute !important;
            top: 0; left: 0;
            width: 100%;
            padding: 12px !important;
            background: white !important;
          }
          .oncall-no-print, .oncall-draft-section { display: none !important; }
          .oncall-card { box-shadow: none !important; border: none !important; padding: 0 !important; }
          body { background: white !important; }
          .oncall-row, .oncall-cell, .oncall-on-call-chip {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          tr { page-break-inside: avoid; }
          table { page-break-inside: auto; }
        }
      `}</style>

      {/* ─────────────── LIVE / EDIT card ─────────────── */}
      <div className="t-card oncall-card oncall-print-target" style={{ padding: '0.75rem 1rem' }}>
        <LiveHeader
          editing={editing}
          canPropose={canPropose}
          hasPending={hasPending}
          settings={topSettings}
          participantCount={topRows.length}
          updatedAt={settingsQ.data?.updated_at ?? null}
          onStartEdit={onStartEdit}
          onCancel={onCancel}
          onSubmit={onSubmit}
          submitting={propose.isPending}
        />

        {editing && (
          <>
            <div className="flex flex-wrap items-end gap-4 p-3 mb-3 rounded border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">Start Friday</span>
                <input
                  type="date"
                  value={startFriday}
                  onChange={(e) => setStartFriday(e.target.value)}
                  className="border rounded px-2 py-1 t-text t-mono"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
              </label>
              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">Rotations per engineer</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={rotations}
                  onChange={(e) => setRotations(Math.min(12, Math.max(1, parseInt(e.target.value || '1', 10))))}
                  className="w-20 border rounded px-2 py-1 t-text t-mono"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
              </label>
              <label className="block flex-1 min-w-[240px]">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">Note for reviewer (optional)</span>
                <input
                  type="text"
                  value={proposerNote}
                  onChange={(e) => setProposerNote(e.target.value)}
                  placeholder="e.g. Swap Sean and Dariusz weeks of 6/12"
                  className="w-full border rounded px-2 py-1 t-text"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
              </label>
              {startFriday && !isFriday(startFriday) && (
                <p className="t-small w-full" style={{ color: 'var(--color-warn)' }}>
                  Heads up: {startFriday} is a {dayName(startFriday)}, not a Friday. Rotation will run {dayName(startFriday)}–{dayName(startFriday)}.
                </p>
              )}
            </div>
          </>
        )}

        {actionError && (
          <div className="mb-3 p-2 rounded border" style={{ borderColor: 'var(--color-danger)', background: '#fef2f2', color: '#7f1d1d' }}>
            <p className="t-small">{actionError}</p>
          </div>
        )}

        <RotationTable
          rows={topRows}
          settings={topSettings}
          todayIso={todayIso}
          editing={editing}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          onRemove={remove}
          onSetEffectiveFrom={setEffectiveFrom}
        />

        {editing && (
          <div className="mt-3">
            <AddPicker options={pickerOptions} onAdd={addParticipant} />
          </div>
        )}
      </div>

      {/* ─────────────── DRAFT preview card (when a proposal is pending) ─────────────── */}
      {!editing && pending && (
        <DraftPreview
          pending={pending}
          isManager={isManager}
          isProposer={isProposer}
          publishing={publish.isPending}
          rejecting={reject.isPending}
          withdrawing={withdraw.isPending}
          engineersById={(engineersQ.data ?? []).reduce<Record<string, { full_name: string; cmms_assignee_name: string | null }>>(
            (acc, e) => { acc[e.user_id] = { full_name: e.full_name, cmms_assignee_name: e.cmms_assignee_name }; return acc; },
            {},
          )}
          todayIso={todayIso}
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
    </div>
  );
}

// ============================================================================
// LiveHeader — title + buttons for the top card
// ============================================================================
function LiveHeader({
  editing, canPropose, hasPending, settings, participantCount,
  updatedAt, onStartEdit, onCancel, onSubmit, submitting,
}: {
  editing: boolean;
  canPropose: boolean;
  hasPending: boolean;
  settings: DisplaySettings;
  participantCount: number;
  updatedAt: string | null;
  onStartEdit: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const startDate = settings.start_friday;
  const updatedAtLocal = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;
  const summary = `${participantCount} engineer${participantCount === 1 ? '' : 's'} · ${settings.rotations_per_engineer} cycles + 1 preview · ${startDate ? 'starts ' + formatStartLong(startDate) : 'no start date set'}`;
  const proposeDisabledReason = !canPropose
    ? 'You need admin, lead, or manager permission to propose changes.'
    : hasPending
    ? 'A draft is already pending review.'
    : null;

  return (
    <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
      <div>
        <h2 className="t-section-title">
          On-call schedule
          {!editing && (
            <span className="ml-2 px-2 py-0.5 rounded-full t-small" style={{ background: 'rgba(34,197,94,0.18)', color: '#15803d', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}>
              LIVE
            </span>
          )}
          {editing && (
            <span className="ml-2 px-2 py-0.5 rounded-full t-small" style={{ background: 'rgba(212,160,23,0.18)', color: '#a16207', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}>
              COMPOSING DRAFT
            </span>
          )}
        </h2>
        <p className="t-small t-muted">{summary}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <p className="t-small t-muted text-right" style={{ maxWidth: '560px' }}>
          {updatedAtLocal && <>Last published {updatedAtLocal} · </>}
          Holiday weeks in red. <span className="px-1 rounded" style={{ background: 'rgba(34,197,94,0.28)' }}>green</span> = active rotation. — = before effective date.
        </p>
        <div className="flex items-center gap-2 oncall-no-print">
          {!editing ? (
            <>
              <button
                onClick={() => window.print()}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                title="Print this schedule without the highlight colors"
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
                disabled={submitting}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)' }}
              >
                Cancel
              </button>
              <button
                onClick={onSubmit}
                disabled={submitting}
                className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-accent)' }}
              >
                {submitting ? 'Submitting…' : 'Submit for review'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DraftPreview — read-only render of a pending proposal with reviewer actions
// ============================================================================
function DraftPreview({
  pending, isManager, isProposer, publishing, rejecting, withdrawing,
  engineersById, todayIso, onPublish, onReject, onWithdraw,
}: {
  pending: { id: string; payload: OncallProposalPayload; note: string | null;
             proposed_by_name: string; proposed_at: string };
  isManager: boolean;
  isProposer: boolean;
  publishing: boolean;
  rejecting: boolean;
  withdrawing: boolean;
  engineersById: Record<string, { full_name: string; cmms_assignee_name: string | null }>;
  todayIso: string;
  onPublish: () => void;
  onReject: (note: string | null) => void;
  onWithdraw: () => void;
}) {
  const [rejectNote, setRejectNote] = useState<string>('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const busy = publishing || rejecting || withdrawing;

  const rows: Row[] = (pending.payload.participants ?? []).map((p) => {
    const e = engineersById[p.user_id];
    return {
      user_id: p.user_id,
      full_name: e?.full_name ?? '(unknown engineer)',
      cmms_assignee_name: e?.cmms_assignee_name ?? null,
      effective_from: p.effective_from,
    };
  });
  const settings: DisplaySettings = {
    start_friday: pending.payload.settings.start_friday,
    rotations_per_engineer: pending.payload.settings.rotations_per_engineer,
  };

  const proposedWhen = new Date(pending.proposed_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="t-card oncall-draft-section" style={{
      padding: '0.75rem 1rem',
      borderLeft: '4px solid #d4a017',
      background: 'rgba(212,160,23,0.04)',
    }}>
      <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
        <div>
          <h2 className="t-section-title">
            On-call schedule
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
            <p className="t-small mt-1" style={{ color: 'var(--color-text)', fontStyle: 'italic' }}>
              "{pending.note}"
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isProposer && (
            <button
              onClick={onWithdraw}
              disabled={busy}
              className="t-small px-3 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {withdrawing ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
          {isManager && (
            <>
              <button
                onClick={() => setShowRejectBox((s) => !s)}
                disabled={busy}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
              >
                Reject…
              </button>
              <button
                onClick={onPublish}
                disabled={busy}
                className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-ok)' }}
              >
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
              Reason for rejecting (optional, shown to proposer)
            </span>
            <input
              type="text"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'white' }}
              placeholder="e.g. Sean is on PTO that week"
            />
          </label>
          <div className="mt-2 flex gap-2 justify-end">
            <button
              onClick={() => { setShowRejectBox(false); setRejectNote(''); }}
              disabled={busy}
              className="t-small px-3 py-1 rounded border"
              style={{ borderColor: 'var(--color-border)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => { onReject(rejectNote.trim() || null); setShowRejectBox(false); setRejectNote(''); }}
              disabled={busy}
              className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-danger)' }}
            >
              {rejecting ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </div>
        </div>
      )}

      <RotationTable
        rows={rows}
        settings={settings}
        todayIso={todayIso}
        editing={false}
      />
    </div>
  );
}

// ============================================================================
// RotationTable — pure render of a rotation (editable or read-only)
// ============================================================================
function RotationTable({
  rows, settings, todayIso, editing,
  onMoveUp, onMoveDown, onRemove, onSetEffectiveFrom,
}: {
  rows: Row[];
  settings: DisplaySettings;
  todayIso: string;
  editing: boolean;
  onMoveUp?: (idx: number) => void;
  onMoveDown?: (idx: number) => void;
  onRemove?: (idx: number) => void;
  onSetEffectiveFrom?: (idx: number, value: string) => void;
}) {
  const visibleCycles = settings.rotations_per_engineer + 1; // +1 preview
  const columnIndices = [-1, ...Array.from({ length: visibleCycles }, (_, i) => i)];

  function cellInfo(p: Row, i: number, cycle: number) {
    const start = settings.start_friday;
    if (!start) return { display: '—', preEffective: false, active: false, holiday: null as ReturnType<typeof weekContainsHoliday> };
    const N = rows.length;
    const weekStart = addDaysIso(start, (cycle * N + i) * 7);
    if (p.effective_from && p.effective_from > weekStart) {
      return { display: '—', preEffective: true, active: false, holiday: null };
    }
    return {
      display: `${fmtMd(weekStart)}–${fmtMd(addDaysIso(weekStart, 7))}`,
      preEffective: false,
      active: isActiveWeek(weekStart, todayIso),
      holiday: weekContainsHoliday(weekStart),
    };
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full t-text border-collapse">
        <thead>
          <tr className="text-left t-text t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
            {editing && <th className="py-1 px-1 w-16"></th>}
            <th className="py-1 pr-2">Engineer</th>
            {columnIndices.map((c) => {
              const isPreview = c === visibleCycles - 1;
              const isPrev = c === -1;
              const label = isPrev ? 'Prev' : isPreview ? '+1 preview' : `Cycle ${c + 1}`;
              const dim = isPreview || isPrev;
              return (
                <th key={c} className="py-1 px-1.5 text-center whitespace-nowrap" style={dim ? { fontStyle: 'italic', opacity: 0.7 } : undefined}>
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={1 + columnIndices.length + (editing ? 1 : 0)} className="py-6 text-center t-text t-muted italic">
                {editing ? 'No participants yet. Use "+ Add to rotation" below.' : 'No on-call rotation defined yet.'}
              </td>
            </tr>
          ) : (
            rows.map((p, idx) => {
              const anyActive = columnIndices.some((c) => cellInfo(p, idx, c).active);
              return (
                <tr
                  key={p.user_id}
                  className={`border-b t-row-hover ${anyActive ? 'oncall-row' : ''}`}
                  style={{
                    borderColor: 'var(--color-border-soft)',
                    background: anyActive ? 'rgba(34,197,94,0.16)' : undefined,
                    borderLeft: anyActive ? '4px solid var(--color-ok)' : '4px solid transparent',
                  }}
                >
                  {editing && (
                    <td className="py-1 px-1 whitespace-nowrap oncall-no-print">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => onMoveUp?.(idx)}   disabled={idx === 0}            className="px-1 disabled:opacity-30 t-text" title="Move up">↑</button>
                        <button onClick={() => onMoveDown?.(idx)} disabled={idx === rows.length-1} className="px-1 disabled:opacity-30 t-text" title="Move down">↓</button>
                        <button onClick={() => onRemove?.(idx)} className="px-1 t-text" style={{ color: 'var(--color-danger)' }} title="Remove from rotation">✕</button>
                      </div>
                    </td>
                  )}
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium t-text">{p.full_name}</span>
                      {anyActive && (
                        <span
                          className="px-2 py-0.5 rounded text-white font-semibold oncall-on-call-chip"
                          style={{ background: 'var(--color-ok)', fontSize: '11px', letterSpacing: '0.5px' }}
                        >
                          ON CALL
                        </span>
                      )}
                    </div>
                    {editing ? (
                      <div className="mt-0.5 t-small t-muted">
                        <label>
                          eff from:{' '}
                          <input
                            type="date"
                            value={p.effective_from ?? ''}
                            onChange={(e) => onSetEffectiveFrom?.(idx, e.target.value)}
                            className="border rounded px-1 py-0.5 t-mono"
                            style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)', fontSize: '11px' }}
                          />
                        </label>
                      </div>
                    ) : (
                      p.effective_from && (
                        <div className="t-small t-muted">since {p.effective_from}</div>
                      )
                    )}
                  </td>
                  {columnIndices.map((c) => {
                    const info = cellInfo(p, idx, c);
                    const isPreview = c === visibleCycles - 1;
                    const isPrev = c === -1;
                    const dim = isPreview || isPrev;
                    return (
                      <td
                        key={c}
                        className={`py-1 px-1.5 text-center t-mono whitespace-nowrap ${info.active ? 'oncall-cell' : ''}`}
                        title={info.holiday ? `${info.holiday.name} · ${info.holiday.date}` : undefined}
                        style={{
                          background: info.active ? 'rgba(34,197,94,0.28)' : undefined,
                          fontWeight: info.active ? 700 : undefined,
                          color: info.holiday ? 'var(--color-danger)' : info.preEffective ? 'var(--color-text-muted)' : undefined,
                          opacity: dim ? 0.7 : 1,
                          fontStyle: dim ? 'italic' : undefined,
                          border: info.active ? '1px solid var(--color-ok)' : undefined,
                        }}
                      >
                        {info.display}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// helpers
// ============================================================================

function participantsToRows(participants: OncallParticipant[]): Row[] {
  return (participants ?? []).map((p) => ({
    user_id: p.user_id,
    full_name: p.full_name,
    cmms_assignee_name: p.cmms_assignee_name,
    effective_from: p.effective_from,
  }));
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function isFriday(iso: string): boolean {
  return new Date(iso + 'T00:00:00').getDay() === 5;
}

function dayName(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
}

function formatStartLong(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function AddPicker({
  options,
  onAdd,
}: {
  options: { user_id: string; full_name: string }[];
  onAdd: (user_id: string) => void;
}) {
  const [value, setValue] = useState('');
  if (options.length === 0) {
    return (
      <p className="t-small t-muted italic">All active engineers are in the rotation.</p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border rounded px-2 py-1 t-text"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
      >
        <option value="">+ Add to rotation…</option>
        {options.map((o) => (
          <option key={o.user_id} value={o.user_id}>{o.full_name}</option>
        ))}
      </select>
      <button
        onClick={() => {
          if (value) {
            onAdd(value);
            setValue('');
          }
        }}
        disabled={!value}
        className="t-small px-3 py-1 rounded border font-medium text-white disabled:opacity-40"
        style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
      >
        Add
      </button>
    </div>
  );
}

