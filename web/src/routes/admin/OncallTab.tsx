// Admin → On-call tab (v1.1: rotation builder).
//
// Admin picks a subset of engineers, orders them, sets start_friday +
// rotations_per_engineer; the system computes every shift deterministically
// and saves them to oncall_rotations so OncallBadge keeps working unchanged.
//
// - Round-robin: engineer[i] gets weekStart = start_friday + (cycle*N + i)*7
// - effective_from per participant filters out pre-effective cells (shown "—")
// - Preview cycle: R+1 columns rendered; only first R cycles materialized
// - Holiday weeks rendered in red (US federal calendar; weekContainsHoliday)
import { useEffect, useMemo, useState } from 'react';
import {
  useOncallParticipants, useOncallSettings, useSaveOncallSchedule,
  useOncallRealtime, addDaysIso, fmtMd,
} from '../../hooks/useOncall';
import { useEngineers } from '../../hooks/useEngineers';
import { weekContainsHoliday } from '../../lib/holidays';

type Draft = {
  user_id: string;
  full_name: string;
  cmms_assignee_name: string | null;
  effective_from: string | null;
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
  const participantsQ = useOncallParticipants();
  const settingsQ = useOncallSettings();
  const engineersQ = useEngineers();
  const save = useSaveOncallSchedule();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [startFriday, setStartFriday] = useState<string>('');
  const [rotations, setRotations] = useState<number>(4);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Snapshot server state into local on entering edit mode (or first load).
  useEffect(() => {
    if (editing) return; // don't clobber unsaved drafts
    if (!participantsQ.data || !settingsQ.data) return;
    setDraft(
      (participantsQ.data ?? []).map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        cmms_assignee_name: p.cmms_assignee_name,
        effective_from: p.effective_from,
      })),
    );
    setStartFriday(settingsQ.data.start_friday ?? nextFridayIso());
    setRotations(settingsQ.data.rotations_per_engineer ?? 4);
  }, [editing, participantsQ.data, settingsQ.data]);

  const todayIso = new Date().toISOString().slice(0, 10);

  // ----- Source-of-truth list to display: drafts in edit mode, server in read mode
  const displayedParticipants: Draft[] = editing
    ? draft
    : (participantsQ.data ?? []).map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        cmms_assignee_name: p.cmms_assignee_name,
        effective_from: p.effective_from,
      }));
  const displayedSettings = editing
    ? { start_friday: startFriday, rotations_per_engineer: rotations }
    : {
        start_friday: settingsQ.data?.start_friday ?? null,
        rotations_per_engineer: settingsQ.data?.rotations_per_engineer ?? 4,
      };

  const visibleCycles = displayedSettings.rotations_per_engineer + 1; // +1 preview
  // Column indices: -1 = previous cycle, 0..R-1 = regular cycles, R = preview
  const columnIndices = [-1, ...Array.from({ length: visibleCycles }, (_, i) => i)];

  // Picker source: engineers not yet in the (draft) participants list.
  const participantIds = useMemo(() => new Set(displayedParticipants.map((p) => p.user_id)), [displayedParticipants]);
  const pickerOptions = useMemo(() => {
    return (engineersQ.data ?? [])
      .filter((e) => e.active && !participantIds.has(e.user_id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [engineersQ.data, participantIds]);

  // ----- Computed cell value
  function cellInfo(p: Draft, i: number, cycle: number) {
    const start = displayedSettings.start_friday;
    if (!start) return { display: '—', preEffective: false, active: false, holiday: null as ReturnType<typeof weekContainsHoliday> };
    const N = displayedParticipants.length;
    const weekStart = addDaysIso(start, (cycle * N + i) * 7);
    if (p.effective_from && p.effective_from > weekStart) {
      return { display: '—', preEffective: true, active: false, holiday: null };
    }
    const display = `${fmtMd(weekStart)}–${fmtMd(addDaysIso(weekStart, 7))}`;
    return {
      display,
      preEffective: false,
      active: isActiveWeek(weekStart, todayIso),
      holiday: weekContainsHoliday(weekStart),
    };
  }

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

  const onStartEdit = () => setEditing(true);
  const onCancel = () => {
    setEditing(false);
    setSaveError(null);
    // useEffect will re-snapshot from server data on next render
  };
  const onSave = async () => {
    setSaveError(null);
    if (!startFriday) {
      setSaveError('Set a Start Friday date before saving.');
      return;
    }
    try {
      await save.mutateAsync({
        start_friday: startFriday,
        rotations_per_engineer: rotations,
        participants: draft.map((p) => ({ user_id: p.user_id, effective_from: p.effective_from })),
      });
      setEditing(false);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  if (participantsQ.isLoading || settingsQ.isLoading) {
    return <p className="t-text t-muted">Loading on-call schedule…</p>;
  }
  if (participantsQ.isError) return <p className="t-text t-danger">Error: {(participantsQ.error as Error).message}</p>;
  if (settingsQ.isError)     return <p className="t-text t-danger">Error: {(settingsQ.error as Error).message}</p>;

  // ----- Header info
  const startDate = displayedSettings.start_friday;
  const startWarning = startDate && !isFriday(startDate)
    ? `Heads up: ${startDate} is a ${dayName(startDate)}, not a Friday. Rotation will run ${dayName(startDate)}–${dayName(startDate)}.`
    : null;
  const updatedAt = settingsQ.data?.updated_at;
  const updatedAtLocal = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;
  const headerSummary = `${displayedParticipants.length} engineer${displayedParticipants.length === 1 ? '' : 's'} · ${displayedSettings.rotations_per_engineer} cycles + 1 preview · ${startDate ? 'starts ' + formatStartLong(startDate) : 'no start date set'}`;

  return (
    <div className="space-y-3 oncall-root">
      {/* Print rules: keep the on-screen content (highlights, ON CALL chip,
          legend, last-updated, table — everything in the 2nd screenshot the
          user pointed at), just drop the buttons and the surrounding
          dashboard chrome. Forces print-color-adjust so background highlights
          render on paper. */}
      <style>{`
        @media print {
          .oncall-no-print { display: none !important; }
          .oncall-card     { box-shadow: none !important; border: none !important; padding: 0 !important; }
          .oncall-root     { padding: 0 !important; }
          body             { background: white !important; }
          .oncall-row,
          .oncall-cell,
          .oncall-on-call-chip {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      <div className="t-card oncall-card" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-start justify-between mb-2 gap-4 flex-wrap">
          <div>
            <h2 className="t-section-title">On-call schedule</h2>
            <p className="t-small t-muted">{headerSummary}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="t-small t-muted text-right" style={{ maxWidth: '560px' }}>
              {updatedAtLocal && <>Last updated {updatedAtLocal} · </>}
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
                  className="t-small px-3 py-1 rounded border font-medium text-white"
                  style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
                >
                  Web Edit
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onCancel}
                  disabled={save.isPending}
                  className="t-small px-3 py-1 rounded border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={onSave}
                  disabled={save.isPending}
                  className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--color-ok)' }}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            </div>
          </div>
        </div>

        {/* Settings strip (edit mode only) */}
        {editing && (
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
            {startWarning && (
              <p className="t-small" style={{ color: 'var(--color-warn)' }}>{startWarning}</p>
            )}
          </div>
        )}

        {saveError && (
          <div className="mb-3 p-2 rounded border" style={{ borderColor: 'var(--color-danger)', background: '#fef2f2', color: '#7f1d1d' }}>
            <p className="t-small">{saveError}</p>
          </div>
        )}

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
              {displayedParticipants.length === 0 ? (
                <tr>
                  <td colSpan={1 + columnIndices.length + (editing ? 1 : 0)} className="py-6 text-center t-text t-muted italic">
                    {editing ? 'No participants yet. Use "+ Add to rotation" below.' : 'No on-call rotation defined yet. Click Web Edit to set it up.'}
                  </td>
                </tr>
              ) : (
                displayedParticipants.map((p, idx) => {
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
                            <button onClick={() => moveUp(idx)}   disabled={idx === 0}              className="px-1 disabled:opacity-30 t-text" title="Move up">↑</button>
                            <button onClick={() => moveDown(idx)} disabled={idx === draft.length-1} className="px-1 disabled:opacity-30 t-text" title="Move down">↓</button>
                            <button onClick={() => remove(idx)} className="px-1 t-text" style={{ color: 'var(--color-danger)' }} title="Remove from rotation">✕</button>
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
                                onChange={(e) => setEffectiveFrom(idx, e.target.value)}
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

        {editing && (
          <div className="mt-3">
            <AddPicker options={pickerOptions} onAdd={addParticipant} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// helpers
// ============================================================================

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
