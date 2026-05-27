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

/** True if any day in [startsOn, endsOn] (inclusive) falls inside the
 *  Fri–Thu window starting at weekStart. */
function rangeOverlapsWeek(startsOn: string, endsOn: string, weekStart: string): boolean {
  const weekEnd = addDaysIso(weekStart, 7); // exclusive Friday-of-next-week
  // overlap iff startsOn < weekEnd AND endsOn >= weekStart
  return startsOn < weekEnd && endsOn >= weekStart;
}

/** Enumerate the YYYY-MM-DD dates of [startsOn, endsOn] that fall inside
 *  the given week. Used to render which specific days inside a cell are
 *  covered by a multi-day swap that straddles week boundaries. */
function datesInRangeAndWeek(startsOn: string, endsOn: string, weekStart: string): string[] {
  const out: string[] = [];
  const weekEnd = addDaysIso(weekStart, 7);
  let cur = startsOn > weekStart ? startsOn : weekStart;
  while (cur <= endsOn && cur < weekEnd) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** "Mon" / "Mon–Wed" / "Mon 5/26–Wed 5/28" — compact summary of a date list. */
function compactDays(dates: string[]): string {
  if (dates.length === 0) return '—';
  if (dates.length === 1) return dayName(dates[0]);
  // Are they consecutive?
  const allConsecutive = dates.every((d, i) => i === 0 || d === addDaysIso(dates[i - 1], 1));
  if (allConsecutive) {
    return `${dayName(dates[0])}–${dayName(dates[dates.length - 1])}`;
  }
  return dates.map(dayName).join(', ');
}

/** Next upcoming Friday from today (today if today is Friday). */
function nextFridayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const offset = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Days between two YYYY-MM-DD dates (b - a, can be negative). */
function daysBetween(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso + 'T00:00:00').getTime() - new Date(aIso + 'T00:00:00').getTime()) / 86_400_000);
}

/** The Friday that started the rotation week containing todayIso, given the
 *  rotation's start_friday. Returns null if today is before start_friday. */
function activeWeekStart(startFriday: string, todayIso: string): string | null {
  const diff = daysBetween(startFriday, todayIso);
  if (diff < 0) return null;
  const weeksSince = Math.floor(diff / 7);
  return addDaysIso(startFriday, weeksSince * 7);
}

/** Who's actually on call right now, accounting for any active overrides.
 *  Returns null if rotation isn't configured or today is pre-start. */
type EffectiveOncall = {
  scheduled: { user_id: string; full_name: string };
  effective: { user_id: string; full_name: string };
  source: 'base' | 'week' | 'day';
  swapUntil: string | null;
  reason: string | null;
};
function computeEffectiveOncall(
  participants: OncallParticipant[],
  startFriday: string,
  todayIso: string,
  overrides: CoverageOverride[],
  engById: Map<string, EngineerRow>,
): EffectiveOncall | null {
  if (participants.length === 0) return null;
  const ws = activeWeekStart(startFriday, todayIso);
  if (!ws) return null;
  const N = participants.length;
  const diff = daysBetween(startFriday, ws);
  const idx = (Math.floor(diff / 7)) % N;
  const scheduled = participants[idx];
  if (!scheduled) return null;
  const sched = { user_id: scheduled.user_id, full_name: scheduled.full_name };

  // Day override beats week override beats base.
  const todayDay = overrides.find(
    (o) => o.kind === 'day'
        && o.original_user_id === scheduled.user_id
        && o.starts_on <= todayIso && o.ends_on >= todayIso,
  );
  if (todayDay) {
    const c = engById.get(todayDay.cover_user_id);
    return {
      scheduled: sched,
      effective: { user_id: todayDay.cover_user_id, full_name: c?.full_name ?? '?' },
      source: 'day',
      swapUntil: todayDay.ends_on,
      reason: todayDay.reason,
    };
  }
  const weekOv = overrides.find(
    (o) => o.kind === 'week'
        && o.original_user_id === scheduled.user_id
        && o.starts_on === ws,
  );
  if (weekOv) {
    const c = engById.get(weekOv.cover_user_id);
    return {
      scheduled: sched,
      effective: { user_id: weekOv.cover_user_id, full_name: c?.full_name ?? '?' },
      source: 'week',
      swapUntil: weekOv.ends_on,
      reason: weekOv.reason,
    };
  }
  return {
    scheduled: sched,
    effective: sched,
    source: 'base',
    swapUntil: null,
    reason: null,
  };
}

/** True if this override is "past" — ends more than 7 days ago. */
function isPastOverride(o: CoverageOverride, todayIso: string): boolean {
  return daysBetween(o.ends_on, todayIso) > 7;
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
  const [showPast, setShowPast] = useState(false);
  // Preset filled when the user clicks a grid cell to add coverage there.
  const [addPreset, setAddPreset] = useState<{ originalId: string; weekStart: string } | null>(null);
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

  // Active vs. past overrides (past = ends_on > 7 days ago).
  const { activeOverrides, pastOverrides } = useMemo(() => {
    const active: CoverageOverride[] = [];
    const past:   CoverageOverride[] = [];
    for (const o of overrides) {
      if (isPastOverride(o, todayIso)) past.push(o);
      else                              active.push(o);
    }
    return { activeOverrides: active, pastOverrides: past };
  }, [overrides, todayIso]);

  // Right-now effective coverage (banner #2).
  const effective = useMemo(
    () => startFriday ? computeEffectiveOncall(participants, startFriday, todayIso, overrides, engById) : null,
    [participants, startFriday, todayIso, overrides, engById],
  );

  const openAddFromCell = (originalId: string, weekStart: string) => {
    setAddPreset({ originalId, weekStart });
    setShowAdd(true);
  };
  const closeAdd = () => {
    setShowAdd(false);
    setAddPreset(null);
  };

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

      {/* "Right now" effective coverage */}
      {effective && <EffectiveNowBanner data={effective} />}

      {/* Rotation grid with override overlays */}
      <div className="t-card" style={{ padding: '0.5rem 1rem' }}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="t-section-title" style={{ fontSize: '1rem' }}>Rotation (live, read-only) · with overrides</h3>
          <p className="t-small t-muted">
            * = week swap · D = day swap
            {canWrite && <span style={{ marginLeft: 8, color: '#7e22ce' }}>· click any cell to add coverage</span>}
          </p>
        </div>
        <OverrideGrid
          participants={participants}
          startFriday={startFriday}
          rotations={rotations}
          todayIso={todayIso}
          overrides={overrides}
          engById={engById}
          onCellClick={canWrite ? openAddFromCell : undefined}
        />
      </div>

      {/* Overrides panel */}
      <div className="t-card" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
          <h3 className="t-section-title" style={{ fontSize: '1rem' }}>
            Coverage overrides
            <span className="ml-2 t-small t-muted">
              ({activeOverrides.length} active{pastOverrides.length > 0 && ` · ${pastOverrides.length} past`})
            </span>
          </h3>
          {canWrite && (
            <button
              onClick={() => { setAddPreset(null); setShowAdd(true); }}
              className="t-small px-3 py-1 rounded border font-medium text-white"
              style={{ background: '#7e22ce', borderColor: '#7e22ce' }}
            >
              + Add coverage
            </button>
          )}
        </div>
        {activeOverrides.length === 0 && pastOverrides.length === 0 ? (
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
              {([
                ...activeOverrides,
                ...(showPast ? pastOverrides : []),
              ])
                .slice()
                .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
                .map((o) => {
                  const past = isPastOverride(o, todayIso);
                  const orig = engById.get(o.original_user_id);
                  const cov  = engById.get(o.cover_user_id);
                  const whenStr = o.kind === 'week'
                    ? `Week of ${fmtMd(o.starts_on)}`
                    : o.starts_on === o.ends_on
                      ? `${dayName(o.starts_on)} ${fmtMd(o.starts_on)}`
                      : `${dayName(o.starts_on)} ${fmtMd(o.starts_on)} – ${dayName(o.ends_on)} ${fmtMd(o.ends_on)}`;
                  return (
                    <tr
                      key={o.id}
                      className="border-b"
                      style={{
                        borderColor: 'var(--color-border-soft)',
                        opacity: past ? 0.5 : 1,
                      }}
                    >
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
        {pastOverrides.length > 0 && (
          <button
            onClick={() => setShowPast((v) => !v)}
            className="t-small t-muted hover:underline mt-2"
          >
            {showPast ? '▴ Hide past overrides' : `▾ Show ${pastOverrides.length} past`}
          </button>
        )}
      </div>

      {showAdd && (
        <AddCoverageModal
          participants={participants}
          engById={engById}
          startFriday={startFriday}
          rotations={rotations}
          overrides={overrides}
          preset={addPreset}
          onClose={closeAdd}
        />
      )}
    </div>
  );
}

// ============================================================================
// "Right now" banner
// ============================================================================

function EffectiveNowBanner({ data }: { data: EffectiveOncall }) {
  const covered = data.source !== 'base';
  const bg     = covered ? 'rgba(20,184,166,0.10)' : 'rgba(34,197,94,0.10)';
  const border = covered ? '#14b8a6' : '#10b981';
  const tag    = covered ? (data.source === 'week' ? 'WEEK SWAP' : 'DAY SWAP') : 'BASE ROTATION';
  const tagBg  = covered
    ? (data.source === 'week' ? 'rgba(168,85,247,0.18)' : 'rgba(20,184,166,0.18)')
    : 'rgba(34,197,94,0.18)';
  const tagFg  = covered
    ? (data.source === 'week' ? '#7e22ce' : '#0f766e')
    : '#15803d';
  return (
    <div
      className="t-card"
      style={{ padding: '0.6rem 1rem', background: bg, borderLeft: `4px solid ${border}` }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="t-small t-muted uppercase tracking-wider">Right now</span>
          <span className="t-section-title" style={{ display: 'inline-block', fontSize: '1.05rem' }}>
            {data.effective.full_name}
          </span>
          {covered && (
            <span className="t-small t-muted">
              covering for <strong style={{ color: 'var(--color-text)' }}>{data.scheduled.full_name}</strong>
              {data.swapUntil && (
                <> until <span className="t-mono">{data.swapUntil}</span></>
              )}
              {data.reason && <> · {data.reason}</>}
            </span>
          )}
        </div>
        <span
          className="t-small px-2 py-0.5 rounded"
          style={{ background: tagBg, color: tagFg, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }}
        >
          {tag}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Rotation grid with override overlay
// ============================================================================

function OverrideGrid({
  participants, startFriday, rotations, todayIso, overrides, engById, onCellClick,
}: {
  participants: OncallParticipant[];
  startFriday: string;
  rotations: number;
  todayIso: string;
  overrides: CoverageOverride[];
  engById: Map<string, EngineerRow>;
  onCellClick?: (originalId: string, weekStart: string) => void;
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
    // Find any day-kind overrides whose date range overlaps this week.
    // (Multi-day swaps that straddle week boundaries appear in each affected week.)
    const dayOverrides = overrides.filter(
      (o) => o.kind === 'day'
          && o.original_user_id === p.user_id
          && rangeOverlapsWeek(o.starts_on, o.ends_on, weekStart),
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
                  // Cells are clickable only when add-mode is available AND
                  // the cell isn't a past cycle (no point assigning coverage
                  // for a week that's already over).
                  const clickable = !!onCellClick && !isPrev && !info.preEffective;
                  const coverName = info.weekOverride
                    ? shortName(engById.get(info.weekOverride.cover_user_id)?.full_name)
                    : null;
                  // Build a tooltip line per override, including multi-day spans.
                  const tooltip = [
                    info.weekOverride && `WEEK swap → ${engById.get(info.weekOverride.cover_user_id)?.full_name ?? '?'}`,
                    ...info.dayOverrides.map((o) => {
                      const cov = engById.get(o.cover_user_id)?.full_name ?? '?';
                      if (o.starts_on === o.ends_on) {
                        return `DAY ${dayName(o.starts_on)} ${o.starts_on} → ${cov}`;
                      }
                      return `DAYS ${o.starts_on} → ${o.ends_on} → ${cov}`;
                    }),
                  ].filter(Boolean).join('\n');
                  return (
                    <td
                      key={c}
                      className="py-1 px-1.5 text-center t-mono whitespace-nowrap"
                      title={clickable ? (tooltip ? `${tooltip}\n\nClick to add coverage` : 'Click to add coverage') : (tooltip || undefined)}
                      onClick={clickable ? () => onCellClick!(p.user_id, info.weekStart) : undefined}
                      style={{
                        cursor: clickable ? 'pointer' : undefined,
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
                            ? `${compactDays(datesInRangeAndWeek(
                                info.dayOverrides[0].starts_on,
                                info.dayOverrides[0].ends_on,
                                info.weekStart,
                              ))} → ${shortName(engById.get(info.dayOverrides[0].cover_user_id)?.full_name)}`
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

/** UI mode for the modal — adds 'swap' on top of the DB-level kinds. */
type ModalMode = 'week' | 'day' | 'swap';

function AddCoverageModal({
  participants, engById, startFriday, rotations, overrides, preset, onClose,
}: {
  participants: OncallParticipant[];
  engById: Map<string, EngineerRow>;
  startFriday: string;
  rotations: number;
  overrides: CoverageOverride[];
  preset: { originalId: string; weekStart: string } | null;
  onClose: () => void;
}) {
  const create = useCreateCoverageOverride();
  const del    = useDeleteCoverageOverride();
  // null = no mode picked yet; forces a conscious choice.
  const [mode, setMode]                 = useState<ModalMode | null>(null);
  const [originalId, setOriginalId]     = useState<string>(preset?.originalId ?? '');
  const [coverId, setCoverId]           = useState<string>('');
  const [weekStart, setWeekStart]       = useState<string>(preset?.weekStart ?? nextFridayIso());
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dayStart, setDayStart]         = useState<string>(todayStr);
  const [dayEnd, setDayEnd]             = useState<string>('');  // empty = single day = dayStart
  // Swap-mode state: two engineers and two weeks. Engineer A defaults to the
  // preset engineer (the row whose cell was clicked).
  const [swapAId, setSwapAId]           = useState<string>(preset?.originalId ?? '');
  const [swapBId, setSwapBId]           = useState<string>('');
  const [swapAWeek, setSwapAWeek]       = useState<string>(preset?.weekStart ?? nextFridayIso());
  const [swapBWeek, setSwapBWeek]       = useState<string>(nextFridayIso());
  const [reason, setReason]             = useState('');
  const [err, setErr]                   = useState<string | null>(null);

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

  /** Return a conflict-error string for a candidate override, or null if OK.
   *  Examples:
   *   - Duplicate week override on same engineer+week
   *   - Day-range overlapping an existing day-range on same engineer
   *   - (For week kind) Already-existing day overrides inside that week are
   *     allowed but produce a confirm() warning, not a hard reject. */
  function findConflict(
    candKind: OverrideKind, candOriginalId: string,
    candStartsOn: string, candEndsOn: string,
  ): { hard: string | null; soft: string | null } {
    if (candKind === 'week') {
      const dup = overrides.find(
        (o) => o.kind === 'week' && o.original_user_id === candOriginalId && o.starts_on === candStartsOn,
      );
      if (dup) {
        const c = engById.get(dup.cover_user_id)?.full_name ?? '?';
        return { hard: `A week swap already exists for this engineer & week (covered by ${c}). Remove that first.`, soft: null };
      }
      // Soft warn if existing day swaps fall inside this week.
      const dayInside = overrides.filter(
        (o) => o.kind === 'day'
            && o.original_user_id === candOriginalId
            && o.starts_on <= candEndsOn && o.ends_on >= candStartsOn,
      );
      if (dayInside.length > 0) {
        return {
          hard: null,
          soft: `This engineer already has ${dayInside.length} day swap${dayInside.length === 1 ? '' : 's'} inside the same week. The week swap will visually take precedence in the grid.`,
        };
      }
    } else {
      // day kind: reject any overlapping day-range on same engineer.
      const overlap = overrides.find(
        (o) => o.kind === 'day'
            && o.original_user_id === candOriginalId
            && o.starts_on <= candEndsOn && o.ends_on >= candStartsOn,
      );
      if (overlap) {
        const c = engById.get(overlap.cover_user_id)?.full_name ?? '?';
        const whenStr = overlap.starts_on === overlap.ends_on
          ? overlap.starts_on
          : `${overlap.starts_on}–${overlap.ends_on}`;
        return { hard: `Overlapping day swap already exists (${whenStr} → ${c}). Remove that first.`, soft: null };
      }
      // Soft warn if an existing week swap covers any of these days.
      const weekCovers = overrides.find(
        (o) => o.kind === 'week'
            && o.original_user_id === candOriginalId
            && o.starts_on <= candEndsOn && o.ends_on >= candStartsOn,
      );
      if (weekCovers) {
        const c = engById.get(weekCovers.cover_user_id)?.full_name ?? '?';
        return {
          hard: null,
          soft: `A week swap (covered by ${c}) is already active across these days. This day swap will be visually shadowed by the week swap.`,
        };
      }
    }
    return { hard: null, soft: null };
  }

  const submit = async () => {
    setErr(null);
    if (!mode) { setErr('Pick a coverage type first.'); return; }

    if (mode === 'swap') {
      // ── Bidirectional week trade: 2 overrides as one logical operation.
      if (!swapAId || !swapBId)             { setErr('Pick both engineers.'); return; }
      if (swapAId === swapBId)              { setErr('Pick two different engineers.'); return; }
      if (!isFriday(swapAWeek))             { setErr('Engineer A’s week must start on a Friday.'); return; }
      if (!isFriday(swapBWeek))             { setErr('Engineer B’s week must start on a Friday.'); return; }
      if (swapAWeek === swapBWeek)          { setErr('Pick two different weeks to swap.'); return; }

      // Each direction = original (engineer being covered) + cover (covering engineer).
      // A wants B's week → original=B, cover=A, week=B's
      // B wants A's week → original=A, cover=B, week=A's
      const dir1 = { original: swapBId, cover: swapAId, week: swapBWeek };
      const dir2 = { original: swapAId, cover: swapBId, week: swapAWeek };

      const c1 = findConflict('week', dir1.original, dir1.week, addDaysIso(dir1.week, 6));
      const c2 = findConflict('week', dir2.original, dir2.week, addDaysIso(dir2.week, 6));
      if (c1.hard) { setErr(`Direction 1: ${c1.hard}`); return; }
      if (c2.hard) { setErr(`Direction 2: ${c2.hard}`); return; }
      const softs = [c1.soft, c2.soft].filter(Boolean);
      if (softs.length > 0 && !confirm(`${softs.join('\n\n')}\n\nContinue?`)) return;

      let firstRowId: string | null = null;
      try {
        const firstRow = await create.mutateAsync({
          original_user_id: dir1.original,
          cover_user_id:    dir1.cover,
          kind: 'week',
          starts_on:        dir1.week,
          ends_on:          addDaysIso(dir1.week, 6),
          reason:           reason.trim() ? `${reason.trim()} (swap)` : 'swap',
        }) as { id: string };
        firstRowId = firstRow?.id ?? null;
        await create.mutateAsync({
          original_user_id: dir2.original,
          cover_user_id:    dir2.cover,
          kind: 'week',
          starts_on:        dir2.week,
          ends_on:          addDaysIso(dir2.week, 6),
          reason:           reason.trim() ? `${reason.trim()} (swap)` : 'swap',
        });
        onClose();
      } catch (e) {
        // Second insert failed — roll back first to avoid orphan half-swap.
        if (firstRowId) {
          try { await del.mutateAsync(firstRowId); } catch { /* best-effort */ }
        }
        setErr(`Swap failed: ${(e as Error).message}`);
      }
      return;
    }

    // ── Single coverage (week or day)
    if (!originalId) { setErr('Pick the engineer being covered.'); return; }
    if (!coverId)    { setErr('Pick the engineer covering.');     return; }
    if (originalId === coverId) {
      setErr('Engineer covering must be different from engineer being covered.');
      return;
    }

    let kind: OverrideKind;
    let startsOn: string;
    let endsOn:   string;
    if (mode === 'week') {
      kind = 'week';
      if (!weekStart || !isFriday(weekStart)) {
        setErr('Week swaps must start on a Friday (matches the rotation cutover).');
        return;
      }
      startsOn = weekStart;
      endsOn   = addDaysIso(weekStart, 6);
    } else {
      kind = 'day';
      if (!dayStart) { setErr('Pick a start date.'); return; }
      const effectiveEnd = dayEnd || dayStart;
      if (effectiveEnd < dayStart) {
        setErr('End date can’t be before start date.');
        return;
      }
      startsOn = dayStart;
      endsOn   = effectiveEnd;
    }

    const conflict = findConflict(kind, originalId, startsOn, endsOn);
    if (conflict.hard) { setErr(conflict.hard); return; }
    if (conflict.soft && !confirm(`${conflict.soft}\n\nContinue?`)) return;

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
        // Translucent backdrop — keeps the grid visible behind so you can
        // sanity-check the date/engineer while picking. Click outside to close.
        background: 'rgba(0,0,0,0.25)',
        display: 'flex', justifyContent: 'flex-end',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="t-card"
        style={{
          width: 'min(440px, 92vw)',
          height: '100%',
          overflow: 'auto',
          padding: '1.25rem',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="t-section-title">Add coverage</h3>
          <button onClick={onClose} className="t-small t-muted">✕</button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setMode('week')}
            className="t-small px-3 py-1 rounded border font-medium"
            style={
              mode === 'week'
                ? { background: '#a855f7', borderColor: '#a855f7', color: 'white' }
                : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
            }
          >Full week</button>
          <button
            onClick={() => setMode('day')}
            className="t-small px-3 py-1 rounded border font-medium"
            style={
              mode === 'day'
                ? { background: '#14b8a6', borderColor: '#14b8a6', color: 'white' }
                : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
            }
          >Day(s)</button>
          <button
            onClick={() => setMode('swap')}
            className="t-small px-3 py-1 rounded border font-medium"
            style={
              mode === 'swap'
                ? { background: '#ea580c', borderColor: '#ea580c', color: 'white' }
                : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
            }
            title="Bidirectional week trade: A covers B's week AND B covers A's week"
          >Swap ⇄</button>
        </div>

        {mode === 'swap' && (
          <p className="t-small t-muted mb-3" style={{ paddingLeft: 2 }}>
            <strong>Swap mode</strong> trades two engineers' weeks. Creates 2 override rows in one click — A covers B's week, B covers A's week.
          </p>
        )}

        {!mode && (
          <div
            className="t-card t-small t-muted"
            style={{
              padding: '0.75rem 1rem',
              background: 'rgba(168,85,247,0.05)',
              borderLeft: '3px solid #a855f7',
              marginBottom: '0.5rem',
            }}
          >
            Pick a coverage type above to continue.
          </div>
        )}

        {mode && (
        <div className="grid grid-cols-2 gap-3">
          {mode === 'swap' ? (
            <>
              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">Engineer A</span>
                <select
                  value={swapAId}
                  onChange={(e) => setSwapAId(e.target.value)}
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
                <span className="t-small t-muted uppercase tracking-wider block mb-1">Engineer B</span>
                <select
                  value={swapBId}
                  onChange={(e) => setSwapBId(e.target.value)}
                  className="w-full border rounded px-2 py-1 t-text"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                >
                  <option value="">— pick —</option>
                  {originalOptions
                    .filter((e) => e.user_id !== swapAId)
                    .map((e) => (
                      <option key={e.user_id} value={e.user_id}>{e.full_name}</option>
                    ))}
                </select>
              </label>

              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">A's week (Friday)</span>
                <input
                  type="date"
                  value={swapAWeek}
                  onChange={(e) => setSwapAWeek(e.target.value)}
                  className="w-full border rounded px-2 py-1 t-text t-mono"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
                {swapAWeek && !isFriday(swapAWeek) && (
                  <p className="t-small mt-1" style={{ color: 'var(--color-warn)' }}>Pick a Friday.</p>
                )}
              </label>
              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">B's week (Friday)</span>
                <input
                  type="date"
                  value={swapBWeek}
                  onChange={(e) => setSwapBWeek(e.target.value)}
                  className="w-full border rounded px-2 py-1 t-text t-mono"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
                {swapBWeek && !isFriday(swapBWeek) && (
                  <p className="t-small mt-1" style={{ color: 'var(--color-warn)' }}>Pick a Friday.</p>
                )}
              </label>

              {upcomingFridays.length > 0 && (
                <div className="col-span-2 t-small t-muted">
                  Quick pick (click then choose A or B):{' '}
                  {upcomingFridays.slice(0, 10).map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        // Tap-cycle: empty A first, then empty B, otherwise overwrite A.
                        if (!swapAWeek || swapAWeek === nextFridayIso()) setSwapAWeek(d);
                        else if (!swapBWeek || swapBWeek === nextFridayIso()) setSwapBWeek(d);
                        else setSwapAWeek(d);
                      }}
                      className="t-small px-1.5 py-0.5 rounded border ml-1"
                      style={
                        swapAWeek === d
                          ? { background: '#ea580c', borderColor: '#ea580c', color: 'white' }
                          : swapBWeek === d
                            ? { background: '#fb923c', borderColor: '#fb923c', color: 'white' }
                            : { background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
                      }
                    >{fmtMd(d)}</button>
                  ))}
                </div>
              )}
            </>
          ) : (
          <>
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

          {mode === 'week' ? (
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
            <>
              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">Start date</span>
                <input
                  type="date"
                  value={dayStart}
                  onChange={(e) => setDayStart(e.target.value)}
                  className="w-full border rounded px-2 py-1 t-text t-mono"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
                {dayStart && (
                  <p className="t-small t-muted mt-1">{dayName(dayStart)} {fmtMd(dayStart)}</p>
                )}
              </label>
              <label className="block">
                <span className="t-small t-muted uppercase tracking-wider block mb-1">
                  End date <span className="t-muted">(blank = single day)</span>
                </span>
                <input
                  type="date"
                  value={dayEnd}
                  min={dayStart || undefined}
                  onChange={(e) => setDayEnd(e.target.value)}
                  className="w-full border rounded px-2 py-1 t-text t-mono"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                />
                {dayEnd && dayStart && dayEnd >= dayStart && (
                  <p className="t-small t-muted mt-1">
                    {dayName(dayEnd)} {fmtMd(dayEnd)}{' · '}
                    {dayEnd === dayStart
                      ? '1 day'
                      : `${Math.round((new Date(dayEnd).getTime() - new Date(dayStart).getTime()) / 86_400_000) + 1} days`}
                  </p>
                )}
              </label>
            </>
          )}
          </>
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
        )}

        {err && <p className="t-small t-danger mt-2">{err}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="t-small px-3 py-1 rounded border"
            style={{ borderColor: 'var(--color-border)' }}
          >Cancel</button>
          {mode && (
            <button
              onClick={submit}
              disabled={create.isPending}
              className="t-small px-3 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{
                background: mode === 'swap' ? '#ea580c'
                          : mode === 'week' ? '#7e22ce'
                          : '#0f766e',
              }}
            >
              {create.isPending
                ? (mode === 'swap' ? 'Creating swap…' : 'Adding…')
                : (mode === 'swap' ? 'Create swap (2 rows)' : 'Add coverage')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
