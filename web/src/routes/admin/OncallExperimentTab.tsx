// Admin → Temp Coverage tab (EXPERIMENT).
//
// Sandbox copy of the On-call rotation grid with a coverage-overrides panel
// underneath. Lets you try out "Engineer X covers Engineer Y" for either a
// full rotation week (kind='week') or a single day (kind='day') without
// touching the live oncall_* tables.
//
// Data:
//   - Live rotation: read-only from useOncallParticipants + useOncallSettings
//   - Overrides:     oncall_coverage_overrides_sandbox via useCoverageOverrides
//
// Rendering rules for the grid:
//   - Cells inherit the same Friday-cutover week math from OncallTab
//   - If an active WEEK override matches this engineer + this week start,
//     append " *" and show "→ CoverShortName" inline
//   - If any active DAY override falls inside this week for this engineer,
//     append " D" and list it
//
// Drop oncall_coverage_overrides_sandbox to wipe the experiment.
import { useMemo, useState } from 'react';
import {
  useOncallParticipants, useOncallSettings,
  useOncallRealtime, addDaysIso, fmtMd,
  type OncallParticipant,
} from '../../hooks/useOncall';
import {
  useCoverageOverrides, useCoverageOverridesRealtime,
  useCreateCoverageOverride, useDeleteCoverageOverride,
  type CoverageOverride, type OverrideKind,
} from '../../hooks/useOncallCoverageOverrides';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useMe } from '../../hooks/useMe';

// ============================================================================
// Helpers
// ============================================================================

function isFriday(iso: string): boolean {
  return new Date(iso + 'T00:00:00').getDay() === 5;
}

function shortName(full: string | null | undefined): string {
  if (!full) return '—';
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function dayName(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
}

/** Date is inside [weekStart, weekStart+7). All YYYY-MM-DD strings. */
function dateInWeek(date: string, weekStart: string): boolean {
  const end = addDaysIso(weekStart, 7);
  return weekStart <= date && date < end;
}

/** Next upcoming Friday from today (today if today is Friday). */
function nextFridayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const offset = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Tab
// ============================================================================

export function OncallExperimentTab() {
  useOncallRealtime();
  useCoverageOverridesRealtime();

  const participantsQ = useOncallParticipants();
  const settingsQ     = useOncallSettings();
  const overridesQ    = useCoverageOverrides();
  const engineersQ    = useEngineers();
  const meQ           = useMe();

  const me = meQ.data;
  const canWrite = !!(me && (me.role === 'admin' || me.is_lead || me.is_manager));

  const [showAdd, setShowAdd] = useState(false);
  const del = useDeleteCoverageOverride();

  const participants: OncallParticipant[] = useMemo(
    () => participantsQ.data ?? [],
    [participantsQ.data],
  );
  const startFriday = settingsQ.data?.start_friday ?? null;
  const rotations   = settingsQ.data?.rotations_per_engineer ?? 4;
  const todayIso    = new Date().toISOString().slice(0, 10);

  const overrides   = overridesQ.data ?? [];
  const engineers   = engineersQ.data ?? [];
  const engById     = useMemo(() => {
    const m = new Map<string, EngineerRow>();
    for (const e of engineers) m.set(e.user_id, e);
    return m;
  }, [engineers]);

  if (participantsQ.isLoading || settingsQ.isLoading) {
    return <p className="t-text t-muted">Loading rotation…</p>;
  }
  if (!startFriday) {
    return <p className="t-text t-muted">No rotation start date set. Configure the live On-call tab first.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div
        className="t-card"
        style={{
          padding: '0.75rem 1rem',
          background: 'rgba(168,85,247,0.08)',
          borderLeft: '4px solid #a855f7',
        }}
      >
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="t-section-title" style={{ display: 'inline-block' }}>Temp Coverage</h2>
            <span
              className="ml-2 px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(168,85,247,0.18)', color: '#7e22ce', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px' }}
            >
              EXPERIMENT · SANDBOX
            </span>
          </div>
          <p className="t-small t-muted" style={{ maxWidth: 520, textAlign: 'right' }}>
            Edits here do <strong>not</strong> affect the live On-call tab, /tv,
            or anything else. Drop the sandbox table to wipe the experiment.
          </p>
        </div>
      </div>

      {/* Rotation grid with override overlays */}
      <div className="t-card" style={{ padding: '0.5rem 1rem' }}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="t-section-title" style={{ fontSize: '1rem' }}>Rotation (live, read-only) · with overrides</h3>
          <p className="t-small t-muted">* = week swap · D = day swap</p>
        </div>
        <OverrideGrid
          participants={participants}
          startFriday={startFriday}
          rotations={rotations}
          todayIso={todayIso}
          overrides={overrides}
          engById={engById}
        />
      </div>

      {/* Overrides panel */}
      <div className="t-card" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
          <h3 className="t-section-title" style={{ fontSize: '1rem' }}>
            Coverage overrides
            <span className="ml-2 t-small t-muted">({overrides.length})</span>
          </h3>
          {canWrite && (
            <button
              onClick={() => setShowAdd(true)}
              className="t-small px-3 py-1 rounded border font-medium text-white"
              style={{ background: '#7e22ce', borderColor: '#7e22ce' }}
            >
              + Add coverage
            </button>
          )}
        </div>
        {overrides.length === 0 ? (
          <p className="t-text t-muted italic">No overrides yet.</p>
        ) : (
          <table className="min-w-full t-text border-collapse">
            <thead>
              <tr className="text-left t-small t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-1 pr-2">Kind</th>
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Coverage</th>
                <th className="py-1 pr-2">Reason</th>
                {canWrite && <th className="py-1 pl-2"></th>}
              </tr>
            </thead>
            <tbody>
              {overrides
                .slice()
                .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
                .map((o) => {
                  const orig = engById.get(o.original_user_id);
                  const cov  = engById.get(o.cover_user_id);
                  const whenStr = o.kind === 'week'
                    ? `Week of ${fmtMd(o.starts_on)}`
                    : `${dayName(o.starts_on)} ${fmtMd(o.starts_on)}`;
                  return (
                    <tr key={o.id} className="border-b" style={{ borderColor: 'var(--color-border-soft)' }}>
                      <td className="py-1 pr-2">
                        <span
                          className="t-small px-1.5 py-0.5 rounded"
                          style={
                            o.kind === 'week'
                              ? { background: 'rgba(168,85,247,0.15)', color: '#7e22ce', fontWeight: 600, fontSize: 10, letterSpacing: '0.5px' }
                              : { background: 'rgba(20,184,166,0.15)', color: '#0f766e', fontWeight: 600, fontSize: 10, letterSpacing: '0.5px' }
                          }
                        >
                          {o.kind === 'week' ? 'WEEK' : 'DAY'}
                        </span>
                      </td>
                      <td className="py-1 pr-2 t-mono">{whenStr}</td>
                      <td className="py-1 pr-2">
                        <span>{orig?.full_name ?? '?'}</span>
                        <span className="mx-2 t-muted">→</span>
                        <span className="font-medium">{cov?.full_name ?? '?'}</span>
                      </td>
                      <td className="py-1 pr-2 t-small t-muted">{o.reason ?? '—'}</td>
                      {canWrite && (
                        <td className="py-1 pl-2 text-right">
                          <button
                            onClick={() => { if (confirm('Remove this override?')) del.mutate(o.id); }}
                            className="t-small t-muted hover:t-danger"
                            title="Remove"
                          >×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddCoverageModal
          participants={participants}
          engById={engById}
          startFriday={startFriday}
          rotations={rotations}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Rotation grid with override overlay
// ============================================================================

function OverrideGrid({
  participants, startFriday, rotations, todayIso, overrides, engById,
}: {
  participants: OncallParticipant[];
  startFriday: string;
  rotations: number;
  todayIso: string;
  overrides: CoverageOverride[];
  engById: Map<string, EngineerRow>;
}) {
  const visibleCycles = rotations + 1;
  const columnIndices = [-1, ...Array.from({ length: visibleCycles }, (_, i) => i)];
  const N = participants.length;

  function cellInfo(p: OncallParticipant, i: number, cycle: number) {
    const weekStart = addDaysIso(startFriday, (cycle * N + i) * 7);
    const weekEnd   = addDaysIso(weekStart, 7);
    const active = weekStart <= todayIso && todayIso < weekEnd;
    const preEffective = p.effective_from != null && p.effective_from > weekStart;

    // Find any week-level override matching this engineer's week.
    const weekOverride = overrides.find(
      (o) => o.kind === 'week'
          && o.original_user_id === p.user_id
          && o.starts_on === weekStart,
    );
    // Find any day overrides whose date falls inside this week for this engineer.
    const dayOverrides = overrides.filter(
      (o) => o.kind === 'day'
          && o.original_user_id === p.user_id
          && dateInWeek(o.starts_on, weekStart),
    );

    return {
      display: `${fmtMd(weekStart)}–${fmtMd(weekEnd)}`,
      weekStart, active, preEffective,
      weekOverride, dayOverrides,
    };
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full t-text border-collapse">
        <thead>
          <tr className="text-left t-text t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
            <th className="py-1 pr-2">Engineer</th>
            {columnIndices.map((c) => {
              const isPreview = c === visibleCycles - 1;
              const isPrev    = c === -1;
              const dim       = isPreview || isPrev;
              const label     = isPrev ? 'Prev' : isPreview ? '+1 preview' : `Cycle ${c + 1}`;
              return (
                <th key={c} className="py-1 px-1.5 text-center whitespace-nowrap" style={dim ? { fontStyle: 'italic', opacity: 0.7 } : undefined}>
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {participants.map((p, idx) => {
            const anyActive = columnIndices.some((c) => cellInfo(p, idx, c).active);
            return (
              <tr
                key={p.user_id}
                className="border-b"
                style={{
                  borderColor: 'var(--color-border-soft)',
                  background: anyActive ? 'rgba(34,197,94,0.10)' : undefined,
                }}
              >
                <td className="py-1 pr-2 whitespace-nowrap font-medium">
                  {p.full_name}
                </td>
                {columnIndices.map((c) => {
                  const info = cellInfo(p, idx, c);
                  const isPreview = c === visibleCycles - 1;
                  const isPrev    = c === -1;
                  const dim       = isPreview || isPrev;
                  const hasWeek = !!info.weekOverride;
                  const hasDay  = info.dayOverrides.length > 0;
                  const coverName = info.weekOverride
                    ? shortName(engById.get(info.weekOverride.cover_user_id)?.full_name)
                    : null;
                  const tooltip = [
                    info.weekOverride && `WEEK swap → ${engById.get(info.weekOverride.cover_user_id)?.full_name ?? '?'}`,
                    ...info.dayOverrides.map((o) =>
                      `DAY ${dayName(o.starts_on)} ${o.starts_on} → ${engById.get(o.cover_user_id)?.full_name ?? '?'}`,
                    ),
                  ].filter(Boolean).join('\n');
                  return (
                    <td
                      key={c}
                      className="py-1 px-1.5 text-center t-mono whitespace-nowrap"
                      title={tooltip || undefined}
                      style={{
                        background: hasWeek
                          ? 'rgba(168,85,247,0.18)'
                          : hasDay
                            ? 'rgba(20,184,166,0.14)'
                            : info.active ? 'rgba(34,197,94,0.18)' : undefined,
                        border: hasWeek
                          ? '1px solid #a855f7'
                          : hasDay
                            ? '1px solid #14b8a6'
                            : info.active ? '1px solid var(--color-ok)' : undefined,
                        opacity: dim ? 0.7 : 1,
                        fontStyle: dim ? 'italic' : undefined,
                        color: info.preEffective ? 'var(--color-text-muted)' : undefined,
                      }}
                    >
                      <div style={{ textDecoration: hasWeek ? 'line-through' : undefined }}>
                        {info.display}{hasWeek && ' *'}{hasDay && !hasWeek && ' D'}
                      </div>
                      {hasWeek && coverName && (
                        <div className="t-small" style={{ color: '#7e22ce', fontWeight: 600 }}>→ {coverName}</div>
                      )}
                      {hasDay && !hasWeek && (
                        <div className="t-small" style={{ color: '#0f766e', fontWeight: 600 }}>
                          {info.dayOverrides.length === 1
                            ? `${dayName(info.dayOverrides[0].starts_on)} → ${shortName(engById.get(info.dayOverrides[0].cover_user_id)?.full_name)}`
                            : `${info.dayOverrides.length} day swaps`}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Add-coverage modal
// ============================================================================

function AddCoverageModal({
  participants, engById, startFriday, rotations, onClose,
}: {
  participants: OncallParticipant[];
  engById: Map<string, EngineerRow>;
  startFriday: string;
  rotations: number;
  onClose: () => void;
}) {
  const create = useCreateCoverageOverride();
  const [kind, setKind]                 = useState<OverrideKind>('week');
  const [originalId, setOriginalId]     = useState<string>('');
  const [coverId, setCoverId]           = useState<string>('');
  const [weekStart, setWeekStart]       = useState<string>(nextFridayIso());
  const [dayDate, setDayDate]           = useState<string>(new Date().toISOString().slice(0, 10));
  const [reason, setReason]             = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Engineer options for "Cover with": all active engineers minus the chosen original.
  const coverOptions = useMemo(() => {
    const out: EngineerRow[] = [];
    for (const e of engById.values()) {
      if (!e.active) continue;
      if (e.role !== 'engineer' && e.role !== 'manager') continue;
      if (e.user_id === originalId) continue;
      out.push(e);
    }
    return out.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [engById, originalId]);

  // Original options = current rotation participants only (they're who's on call).
  const originalOptions = useMemo(() => {
    return participants
      .map((p) => engById.get(p.user_id))
      .filter((e): e is EngineerRow => !!e)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [participants, engById]);

  const submit = async () => {
    setErr(null);
    if (!originalId) { setErr('Pick the engineer being covered.'); return; }
    if (!coverId)    { setErr('Pick the engineer covering.');     return; }

    let startsOn: string;
    let endsOn:   string;
    if (kind === 'week') {
      if (!weekStart || !isFriday(weekStart)) {
        setErr('Week swaps must start on a Friday (matches the rotation cutover).');
        return;
      }
      startsOn = weekStart;
      endsOn   = addDaysIso(weekStart, 6); // inclusive end = Thursday
    } else {
      if (!dayDate) { setErr('Pick a date.'); return; }
      startsOn = dayDate;
      endsOn   = dayDate;
    }

    try {
      await create.mutateAsync({
        original_user_id: originalId,
        cover_user_id:    coverId,
        kind,
        starts_on:        startsOn,
        ends_on:          endsOn,
        reason:           reason.trim() || null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Quick-pick: list the next several rotation Fridays so the user can click
  // one instead of typing a date.
  const upcomingFridays = useMemo(() => {
    const out: string[] = [];
    const N = participants.length;
    if (N === 0) return out;
    // Cover the visible cycles (same horizon the grid shows).
    const totalWeeks = rotations * N + N; // rotations*N + preview cycle
    let cur = startFriday;
    for (let i = 0; i < Math.min(totalWeeks, 20); i++) {
      out.push(cur);
      cur = addDaysIso(cur, 7);
    }
    // Filter out past weeks (start more than 7d ago).
    const today = new Date().toISOString().slice(0, 10);
    return out.filter((w) => addDaysIso(w, 7) > today);
  }, [participants.length, rotations, startFriday]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{ width: 'min(540px, 92vw)', maxHeight: '90vh', overflow: 'auto', padding: '1.25rem' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-section-title">Add coverage</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setKind('week')}
            className="t-small px-3 py-1 rounded border font-medium"
            style={
              kind === 'week'
                ? { background: '#a855f7', borderColor: '#a855f7', color: 'white' }
                : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
            }
          >Full week</button>
          <button
            onClick={() => setKind('day')}
            className="t-small px-3 py-1 rounded border font-medium"
            style={
              kind === 'day'
                ? { background: '#14b8a6', borderColor: '#14b8a6', color: 'white' }
                : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
            }
          >One day</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Engineer being covered</span>
            <select
              value={originalId}
              onChange={(e) => setOriginalId(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="">— pick —</option>
              {originalOptions.map((e) => (
                <option key={e.user_id} value={e.user_id}>{e.full_name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Engineer covering</span>
            <select
              value={coverId}
              onChange={(e) => setCoverId(e.target.value)}
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            >
              <option value="">— pick —</option>
              {coverOptions.map((e) => (
                <option key={e.user_id} value={e.user_id}>{e.full_name}</option>
              ))}
            </select>
          </label>

          {kind === 'week' ? (
            <label className="block col-span-2">
              <span className="t-small t-muted uppercase tracking-wider block mb-1">
                Week start (Friday) <span className="t-muted">— covers Fri–Thu</span>
              </span>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="border rounded px-2 py-1 t-text t-mono"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
              />
              {weekStart && !isFriday(weekStart) && (
                <p className="t-small mt-1" style={{ color: 'var(--color-warn)' }}>
                  {weekStart} is a {new Date(weekStart + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })}, not a Friday. Pick a Friday so the swap aligns with the rotation cutover.
                </p>
              )}
              {upcomingFridays.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="t-small t-muted self-center mr-1">Quick pick:</span>
                  {upcomingFridays.slice(0, 8).map((d) => (
                    <button
                      key={d}
                      onClick={() => setWeekStart(d)}
                      className="t-small px-1.5 py-0.5 rounded border"
                      style={
                        weekStart === d
                          ? { background: '#a855f7', borderColor: '#a855f7', color: 'white' }
                          : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
                      }
                    >{fmtMd(d)}</button>
                  ))}
                </div>
              )}
            </label>
          ) : (
            <label className="block col-span-2">
              <span className="t-small t-muted uppercase tracking-wider block mb-1">Day</span>
              <input
                type="date"
                value={dayDate}
                onChange={(e) => setDayDate(e.target.value)}
                className="border rounded px-2 py-1 t-text t-mono"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
              />
              {dayDate && (
                <p className="t-small t-muted mt-1">{dayName(dayDate)} {fmtMd(dayDate)}</p>
              )}
            </label>
          )}

          <label className="block col-span-2">
            <span className="t-small t-muted uppercase tracking-wider block mb-1">Reason (optional)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. vacation, doctor appt, schedule swap"
              className="w-full border rounded px-2 py-1 t-text"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
            />
          </label>
        </div>

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="t-small px-3 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          >Cancel</button>
          <button
            onClick={submit}
            disabled={create.isPending}
            className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
            style={{ background: kind === 'week' ? '#7e22ce' : '#0f766e' }}
          >
            {create.isPending ? 'Adding…' : 'Add coverage'}
          </button>
        </div>
      </div>
    </div>
  );
}
