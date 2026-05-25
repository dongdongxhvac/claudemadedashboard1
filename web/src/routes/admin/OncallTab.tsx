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
  useOncallNotes, useOncallNotesRealtime,
  type OncallParticipant,
} from '../../hooks/useOncall';
import {
  usePendingProposal, useProposeOncall, usePublishOncallProposal,
  useRejectProposal, useWithdrawProposal, useAdminProposalsRealtime,
  usePublishedProposalHistory,
  type OncallProposalPayload, type PublishedProposal,
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

/** Convert a proposal's payload into ({rows, settings}) shaped for rendering.
 *  Engineer full_name is looked up from engineersById; falls back to a
 *  placeholder if the engineer was deactivated since the snapshot. */
function payloadToRows(
  payload: OncallProposalPayload,
  engineersById: Record<string, { full_name: string; cmms_assignee_name: string | null }>,
): { rows: Row[]; settings: DisplaySettings } {
  return {
    rows: (payload.participants ?? []).map((p) => {
      const e = engineersById[p.user_id];
      return {
        user_id: p.user_id,
        full_name: e?.full_name ?? '(unknown engineer)',
        cmms_assignee_name: e?.cmms_assignee_name ?? null,
        effective_from: p.effective_from,
      };
    }),
    settings: {
      start_friday: payload.settings.start_friday,
      rotations_per_engineer: payload.settings.rotations_per_engineer,
    },
  };
}

/** Compute the diff between a "previous" snapshot and a "current" snapshot
 *  for the on-call schedule. Used by both DraftPreview (current=draft,
 *  previous=live) and HistoryEntry (current=published[i], previous=published[i+1]).
 *  prev=null means "no prior snapshot to compare against" → empty diff. */
function computeOncallDiff(
  prev: { rows: Row[]; settings: DisplaySettings } | null,
  curr: { rows: Row[]; settings: DisplaySettings },
): {
  rowAdded: Set<string>;
  removedRows: Row[];
  cellChanged: (userId: string, cycle: number) => boolean;
  livePositionByUser: Map<string, number>;
  startFridayChanged: boolean;
  rotationsChanged: boolean;
  hasBannerContent: boolean;
} {
  if (!prev) {
    return {
      rowAdded: new Set(),
      removedRows: [],
      cellChanged: () => false,
      livePositionByUser: new Map(),
      startFridayChanged: false,
      rotationsChanged: false,
      hasBannerContent: false,
    };
  }
  const prevIds = new Set(prev.rows.map((r) => r.user_id));
  const currIds = new Set(curr.rows.map((r) => r.user_id));
  const rowAdded = new Set<string>([...currIds].filter((id) => !prevIds.has(id)));
  const removedRows = prev.rows.filter((r) => !currIds.has(r.user_id));
  const livePositionByUser = new Map<string, number>();
  prev.rows.forEach((r, i) => livePositionByUser.set(r.user_id, i + 1));

  const visibleCycles = curr.settings.rotations_per_engineer + 1;
  const cycleRange = [-1, ...Array.from({ length: visibleCycles }, (_, i) => i)];
  const buildMap = (src: Row[], srcSettings: DisplaySettings): Map<string, string | null> => {
    const m = new Map<string, string | null>();
    const start = srcSettings.start_friday;
    if (!start) return m;
    const N = src.length;
    src.forEach((p, idx) => {
      for (const c of cycleRange) {
        const weekStart = addDaysIso(start, (c * N + idx) * 7);
        m.set(`${p.user_id}:${c}`,
          p.effective_from && p.effective_from > weekStart ? null : weekStart);
      }
    });
    return m;
  };
  const prevMap = buildMap(prev.rows, prev.settings);
  const currMap = buildMap(curr.rows, curr.settings);
  const cellChanged = (userId: string, cycle: number) => {
    if (rowAdded.has(userId)) return false;
    return prevMap.get(`${userId}:${cycle}`) !== currMap.get(`${userId}:${cycle}`);
  };

  const startFridayChanged = prev.settings.start_friday !== curr.settings.start_friday;
  const rotationsChanged = prev.settings.rotations_per_engineer !== curr.settings.rotations_per_engineer;
  const hasBannerContent = startFridayChanged || rotationsChanged
    || rowAdded.size > 0 || removedRows.length > 0;
  return { rowAdded, removedRows, cellChanged, livePositionByUser,
           startFridayChanged, rotationsChanged, hasBannerContent };
}

export function OncallTab() {
  useOncallRealtime();
  useAdminProposalsRealtime();
  const participantsQ = useOncallParticipants();
  const settingsQ = useOncallSettings();
  const engineersQ = useEngineers();
  const pendingQ = usePendingProposal<OncallProposalPayload>('oncall');
  const historyQ = usePublishedProposalHistory<OncallProposalPayload>('oncall', 20);
  const notesQ = useOncallNotes();
  useOncallNotesRealtime();
  const me = useMe();

  const propose = useProposeOncall();
  const publish = usePublishOncallProposal();
  const reject = useRejectProposal('oncall');
  const withdraw = useWithdrawProposal('oncall');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Row[]>([]);
  const [startFriday, setStartFriday] = useState<string>('');
  const [rotations, setRotations] = useState<number>(4);
  const [draftNotes, setDraftNotes] = useState<{ slot: number; body: string }[]>([
    { slot: 1, body: '' }, { slot: 2, body: '' },
  ]);
  const [proposerNote, setProposerNote] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Snapshot server state into local on entering edit mode (or first load).
  useEffect(() => {
    if (editing) return;
    if (!participantsQ.data || !settingsQ.data) return;
    setDraft(participantsToRows(participantsQ.data));
    setStartFriday(settingsQ.data.start_friday ?? nextFridayIso());
    setRotations(settingsQ.data.rotations_per_engineer ?? 4);
    setProposerNote('');
    const liveNotesArr = (notesQ.data ?? []).filter((n) => n.slot === 1 || n.slot === 2);
    setDraftNotes([1, 2].map((slot) => ({
      slot,
      body: liveNotesArr.find((n) => n.slot === slot)?.body ?? '',
    })));
  }, [editing, participantsQ.data, settingsQ.data, notesQ.data]);

  const liveNotes = useMemo(() => {
    return [1, 2].map((slot) => ({
      slot,
      body: (notesQ.data ?? []).find((n) => n.slot === slot)?.body ?? '',
    }));
  }, [notesQ.data]);

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

  // Engineer lookup map shared by DraftPreview + HistorySection.
  const engineersById = useMemo(() => {
    return (engineersQ.data ?? []).reduce<Record<string, { full_name: string; cmms_assignee_name: string | null }>>(
      (acc, e) => { acc[e.user_id] = { full_name: e.full_name, cmms_assignee_name: e.cmms_assignee_name }; return acc; },
      {},
    );
  }, [engineersQ.data]);

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
          notes: draftNotes.map((n) => ({ slot: n.slot, body: n.body })),
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
      <div className="t-card oncall-card oncall-print-target" style={{ padding: '0.5rem 1rem' }}>
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
          notes={editing ? draftNotes : liveNotes}
          notesMode={editing ? 'compose' : 'live'}
          onChangeNote={(slot, body) => setDraftNotes((cur) =>
            cur.map((n) => n.slot === slot ? { ...n, body } : n)
          )}
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
          engineersById={engineersById}
          live={{ rows: liveRows, settings: liveSettings, notes: liveNotes }}
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

      {/* ─────────────── HISTORY (published proposals, newest first) ─────────────── */}
      <HistorySection
        history={historyQ.data ?? []}
        loading={historyQ.isLoading}
        engineersById={engineersById}
        todayIso={todayIso}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

// ============================================================================
// LiveHeader — title + buttons for the top card
// ============================================================================
function LiveHeader({
  editing, canPropose, hasPending, participantCount,
  updatedAt, onStartEdit, onCancel, onSubmit, submitting,
  notes, notesMode, onChangeNote,
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
  notes: { slot: number; body: string }[];
  notesMode: 'live' | 'compose';
  onChangeNote: (slot: number, body: string) => void;
}) {
  const updatedAtLocal = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;
  const summary = `${participantCount} engineer${participantCount === 1 ? '' : 's'}`;
  const proposeDisabledReason = !canPropose
    ? 'You need admin, lead, or manager permission to propose changes.'
    : hasPending
    ? 'A draft is already pending review.'
    : null;

  // 3 columns, single row. The middle and right columns are sized so they
  // stack into 2 visual lines that match the left column's title+summary
  // height. Left = title (line 1) + count (line 2). Middle = note1 +
  // note2. Right = last-published (line 1) + buttons (line 2).
  return (
    <div className="flex items-stretch gap-4 mb-2 flex-wrap">
      {/* LEFT */}
      <div className="flex flex-col justify-center" style={{ minWidth: 180 }}>
        <h2 className="t-section-title" style={{ lineHeight: 1.2 }}>
          On-call schedule
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
        <p className="t-small t-muted">{summary}</p>
      </div>

      {/* MIDDLE: notes (stretches to fill) */}
      <div className="flex-1 min-w-[200px]">
        <NotesBar mode={notesMode} notes={notes} onChange={onChangeNote} />
      </div>

      {/* RIGHT */}
      <div className="flex flex-col items-end justify-center gap-1" style={{ minWidth: 220 }}>
        <p className="t-small text-right" style={{ color: 'var(--color-text-muted)' }}>
          {updatedAtLocal ? (
            <>Last published <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{updatedAtLocal}</span></>
          ) : (
            <span style={{ fontStyle: 'italic' }}>Never published</span>
          )}
        </p>
        <div className="flex items-center gap-2 oncall-no-print">
          {!editing ? (
            <>
              <button
                onClick={() => window.print()}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                title="Print this schedule (includes notes + last published)"
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
// OncallNotesCard — 3 fixed-slot editable sticky notes in the header middle
// ============================================================================
// ============================================================================
// NotesBar — full-width 2-line note strip.
//   - mode='live':    read-only display of current oncall_notes
//   - mode='compose': editable inputs bound to draftNotes (the proposal payload)
//   - mode='preview': read-only display of a pending proposal's notes, with
//                     yellow highlight on any row that differs from live notes
// All persistence flows through the proposal workflow (publish_oncall_proposal
// RPC); migration 0034 removed the direct write path to oncall_notes.
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
                if (e.key === 'Enter' || e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
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
        // 'live' or 'preview' — static display
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
// DraftPreview — read-only render of a pending proposal with reviewer actions
// ============================================================================
function DraftPreview({
  pending, isManager, isProposer, publishing, rejecting, withdrawing,
  engineersById, live, todayIso, onPublish, onReject, onWithdraw,
}: {
  pending: { id: string; payload: OncallProposalPayload; note: string | null;
             proposed_by_name: string; proposed_at: string };
  isManager: boolean;
  isProposer: boolean;
  publishing: boolean;
  rejecting: boolean;
  withdrawing: boolean;
  engineersById: Record<string, { full_name: string; cmms_assignee_name: string | null }>;
  live: { rows: Row[]; settings: DisplaySettings; notes: { slot: number; body: string }[] };
  todayIso: string;
  onPublish: () => void;
  onReject: (note: string | null) => void;
  onWithdraw: () => void;
}) {
  const [rejectNote, setRejectNote] = useState<string>('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const busy = publishing || rejecting || withdrawing;

  const { rows, settings } = payloadToRows(pending.payload, engineersById);
  const proposedWhen = new Date(pending.proposed_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  // Banner only lists structural changes (settings / add / remove). Position
  // swaps and cell shifts are visible inline (yellow cells + "was #N").
  const {
    rowAdded, removedRows, cellChanged, livePositionByUser,
    startFridayChanged, rotationsChanged, hasBannerContent,
  } = computeOncallDiff(live, { rows, settings });

  // Proposed notes (may be absent on Phase 9.0 proposals — default to live).
  const proposalNotes = pending.payload.notes
    ?? live.notes;
  const notesChanged = [1, 2].some((slot) => {
    const p = proposalNotes.find((n) => n.slot === slot)?.body ?? '';
    const l = live.notes.find((n) => n.slot === slot)?.body ?? '';
    return p !== l;
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
            <p className="t-small mt-1" style={{ color: 'var(--color-danger)', fontStyle: 'italic', fontWeight: 500 }}>
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

      {/* Proposed notes (with yellow highlight if changed vs live) */}
      <NotesBar mode="preview" notes={proposalNotes} liveNotes={live.notes} />

      {(hasBannerContent || notesChanged) && (
        <div className="mb-3 p-2 rounded border" style={{
          borderColor: '#d4a017', background: 'rgba(212,160,23,0.10)',
        }}>
          <p className="t-small font-semibold mb-1" style={{ color: '#a16207', letterSpacing: '0.3px' }}>
            CHANGES vs LIVE
          </p>
          <ul className="t-small" style={{ color: '#7c5800', listStyle: 'disc', paddingLeft: '1.25rem' }}>
            {startFridayChanged && (
              <li>
                Start Friday: <span className="t-mono font-medium">{settings.start_friday ?? '—'}</span>
                {' '}<span className="t-muted">(was <span className="t-mono">{live.settings.start_friday ?? '—'}</span>)</span>
              </li>
            )}
            {rotationsChanged && (
              <li>
                Cycles per engineer: <span className="font-medium">{settings.rotations_per_engineer}</span>
                {' '}<span className="t-muted">(was {live.settings.rotations_per_engineer})</span>
              </li>
            )}
            {rowAdded.size > 0 && (
              <li>
                Adding to rotation: <span className="font-medium">
                  {rows.filter((r) => rowAdded.has(r.user_id)).map((r) => r.full_name).join(', ')}
                </span>
              </li>
            )}
            {removedRows.length > 0 && (
              <li style={{ color: 'var(--color-danger)' }}>
                Removing from rotation: <span className="font-medium" style={{ textDecoration: 'line-through' }}>
                  {removedRows.map((r) => r.full_name).join(', ')}
                </span>
              </li>
            )}
            {notesChanged && (
              <li>Notes updated (yellow rows above show what changed)</li>
            )}
          </ul>
        </div>
      )}

      <RotationTable
        rows={rows}
        settings={settings}
        todayIso={todayIso}
        editing={false}
        diff={{ rowAdded, cellChanged, livePositionByUser }}
      />
    </div>
  );
}

// ============================================================================
// HistorySection — collapsible list of published proposals (newest first).
// Each entry can be expanded to show the snapshot with diff vs the previous
// published proposal. Lightweight "version control" for the schedule.
// ============================================================================
function HistorySection({
  history, loading, engineersById, todayIso, open, onOpenChange,
}: {
  history: PublishedProposal<OncallProposalPayload>[];
  loading: boolean;
  engineersById: Record<string, { full_name: string; cmms_assignee_name: string | null }>;
  todayIso: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  if (loading) return null;
  if (history.length === 0) {
    return (
      <div className="t-card oncall-no-print" style={{ padding: '0.5rem 1rem', opacity: 0.6 }}>
        <p className="t-small t-muted italic">No schedule changes published yet.</p>
      </div>
    );
  }
  return (
    <div className="t-card oncall-no-print" style={{ padding: '0.5rem 1rem' }}>
      <button
        onClick={() => onOpenChange(!open)}
        className="w-full flex items-center justify-between"
        style={{ textAlign: 'left' }}
      >
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
            const prev = history[i + 1] ?? null; // older one
            return (
              <HistoryEntry
                key={entry.id}
                entry={entry}
                previousEntry={prev}
                engineersById={engineersById}
                todayIso={todayIso}
                isLatest={i === 0}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryEntry({
  entry, previousEntry, engineersById, todayIso, isLatest,
}: {
  entry: PublishedProposal<OncallProposalPayload>;
  previousEntry: PublishedProposal<OncallProposalPayload> | null;
  engineersById: Record<string, { full_name: string; cmms_assignee_name: string | null }>;
  todayIso: string;
  isLatest: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reviewedAt = entry.reviewed_at
    ? new Date(entry.reviewed_at).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '(unknown time)';

  const currSnapshot = payloadToRows(entry.payload, engineersById);
  const prevSnapshot = previousEntry ? payloadToRows(previousEntry.payload, engineersById) : null;
  const diff = computeOncallDiff(prevSnapshot, currSnapshot);

  // Build a tight one-line summary of what changed (or "initial publish")
  const summaryParts: string[] = [];
  if (!previousEntry) {
    summaryParts.push('initial publish');
  } else {
    if (diff.startFridayChanged) summaryParts.push(`start ${currSnapshot.settings.start_friday}`);
    if (diff.rotationsChanged) summaryParts.push(`${currSnapshot.settings.rotations_per_engineer} cycles`);
    if (diff.rowAdded.size > 0) summaryParts.push(`+${diff.rowAdded.size}`);
    if (diff.removedRows.length > 0) summaryParts.push(`−${diff.removedRows.length}`);
    // Position swaps / cell changes (no add/remove/settings change)
    if (summaryParts.length === 0) {
      const movedCount = currSnapshot.rows.filter((p, idx) => {
        const livePos = diff.livePositionByUser.get(p.user_id);
        return livePos !== undefined && livePos !== idx + 1;
      }).length;
      if (movedCount > 0) summaryParts.push(`${movedCount} reorder${movedCount === 1 ? '' : 's'}`);
      else summaryParts.push('weeks shifted');
    }
  }

  return (
    <div className="border rounded" style={{
      borderColor: 'var(--color-border)',
      borderLeft: isLatest ? '3px solid var(--color-ok)' : '3px solid var(--color-border)',
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full p-2"
        style={{ textAlign: 'left' }}
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="t-text font-medium">{reviewedAt}</span>
            {isLatest && (
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
          <div className="flex items-center gap-2">
            <span className="t-small t-mono" style={{ color: '#a16207' }}>
              {summaryParts.join(' · ')}
            </span>
            <span className="t-small" style={{ color: 'var(--color-text-muted)' }}>
              {open ? '▾' : '▸'}
            </span>
          </div>
        </div>
        {entry.note && (
          <p className="t-small mt-1" style={{ color: 'var(--color-danger)', fontStyle: 'italic' }}>
            "{entry.note}"
          </p>
        )}
      </button>
      {open && (
        <div className="px-2 pb-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <RotationTable
            rows={currSnapshot.rows}
            settings={currSnapshot.settings}
            todayIso={todayIso}
            editing={false}
            diff={{
              rowAdded: diff.rowAdded,
              cellChanged: diff.cellChanged,
              livePositionByUser: diff.livePositionByUser,
            }}
          />
          {(diff.removedRows.length > 0 || diff.hasBannerContent) && (
            <p className="t-small mt-2" style={{ color: '#a16207' }}>
              {diff.startFridayChanged && previousEntry && (
                <>Start Friday changed from <span className="t-mono">{previousEntry.payload.settings.start_friday}</span> to <span className="t-mono">{entry.payload.settings.start_friday}</span>. </>
              )}
              {diff.rotationsChanged && previousEntry && (
                <>Cycles changed from {previousEntry.payload.settings.rotations_per_engineer} to {entry.payload.settings.rotations_per_engineer}. </>
              )}
              {diff.removedRows.length > 0 && (
                <span style={{ color: 'var(--color-danger)' }}>
                  Removed: <span style={{ textDecoration: 'line-through' }}>
                    {diff.removedRows.map((r) => r.full_name).join(', ')}
                  </span>.
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RotationTable — pure render of a rotation (editable or read-only)
// ============================================================================
function RotationTable({
  rows, settings, todayIso, editing,
  onMoveUp, onMoveDown, onRemove, onSetEffectiveFrom,
  diff,
}: {
  rows: Row[];
  settings: DisplaySettings;
  todayIso: string;
  editing: boolean;
  onMoveUp?: (idx: number) => void;
  onMoveDown?: (idx: number) => void;
  onRemove?: (idx: number) => void;
  onSetEffectiveFrom?: (idx: number, value: string) => void;
  diff?: {
    rowAdded: Set<string>;
    cellChanged: (userId: string, cycle: number) => boolean;
    livePositionByUser: Map<string, number>;
  };
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
              const isAdded = diff?.rowAdded.has(p.user_id) ?? false;
              return (
                <tr
                  key={p.user_id}
                  className={`border-b t-row-hover ${anyActive ? 'oncall-row' : ''}`}
                  style={{
                    borderColor: 'var(--color-border-soft)',
                    background: anyActive
                      ? 'rgba(34,197,94,0.16)'
                      : isAdded ? 'rgba(34,197,94,0.06)' : undefined,
                    borderLeft: anyActive
                      ? '4px solid var(--color-ok)'
                      : isAdded ? '4px solid #15803d' : '4px solid transparent',
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium t-text">{p.full_name}</span>
                      {anyActive && (
                        <span
                          className="px-2 py-0.5 rounded text-white font-semibold oncall-on-call-chip"
                          style={{ background: 'var(--color-ok)', fontSize: '11px', letterSpacing: '0.5px' }}
                        >
                          ON CALL
                        </span>
                      )}
                      {diff && diff.rowAdded.has(p.user_id) && (
                        <span
                          className="px-1.5 py-0.5 rounded text-white font-semibold"
                          style={{ background: '#15803d', fontSize: '10px', letterSpacing: '0.5px' }}
                        >
                          + NEW
                        </span>
                      )}
                      {diff && !diff.rowAdded.has(p.user_id) && (() => {
                        const livePos = diff.livePositionByUser.get(p.user_id);
                        const draftPos = idx + 1;
                        if (livePos === undefined || livePos === draftPos) return null;
                        const movedUp = draftPos < livePos;
                        return (
                          <span
                            className="t-small"
                            style={{ color: '#a16207', fontSize: '10px', fontWeight: 600 }}
                            title={`Moved from position #${livePos} to #${draftPos}`}
                          >
                            {movedUp ? '↑' : '↓'} was #{livePos}
                          </span>
                        );
                      })()}
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
                    const changed = !info.active && (diff?.cellChanged(p.user_id, c) ?? false);
                    return (
                      <td
                        key={c}
                        className={`py-1 px-1.5 text-center t-mono whitespace-nowrap ${info.active ? 'oncall-cell' : ''}`}
                        title={
                          info.holiday ? `${info.holiday.name} · ${info.holiday.date}`
                          : changed ? 'Changed from live schedule'
                          : undefined
                        }
                        style={{
                          background: info.active ? 'rgba(34,197,94,0.28)'
                            : changed ? 'rgba(212,160,23,0.25)' : undefined,
                          fontWeight: info.active ? 700 : changed ? 600 : undefined,
                          color: info.holiday ? 'var(--color-danger)' : info.preEffective ? 'var(--color-text-muted)' : undefined,
                          opacity: dim ? 0.7 : 1,
                          fontStyle: dim ? 'italic' : undefined,
                          border: info.active ? '1px solid var(--color-ok)'
                            : changed ? '1px solid #d4a017' : undefined,
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

