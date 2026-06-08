// Weekly Update Report — the running forecast-meeting agenda, editable
// like a spreadsheet. Each cell is inline-editable: type and click away
// (blur) to save; status is a dropdown that saves on change. "+ Add row"
// appends a blank row; the ✕ soft-deletes.
//
// Imported from "2026-06-05 Upark Forecast Meeting.xlsx" — only the
// incomplete items (migration 0076).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCanAccessAdmin } from '../../hooks/useMe';
import { useBuildings } from '../../hooks/useBuildings';
import {
  useWeeklyUpdates,
  useUpsertWeeklyUpdate,
  useDeleteWeeklyUpdate,
  useWeeklyUpdatesRealtime,
  WEEKLY_STATUSES,
  WEEKLY_STATUS_LABELS,
  weeklyStatusTone,
  isWeeklyOpen,
  type WeeklyUpdate,
  type WeeklyStatus,
} from '../../hooks/useWeeklyUpdates';

// ───────────────────────── sorting helpers

/** Numeric-aware location sort key: "20" < "88" < "300" < "Engine".
 *  Pure-number locations sort numerically first; alpha ones (Engine) after;
 *  empty locations last so freshly-added rows surface at the bottom. */
function locationSortKey(loc: string | null): [number, string] {
  const s = (loc ?? '').trim();
  if (!s) return [Number.POSITIVE_INFINITY, ''];
  const m = s.match(/^(\d+)/);
  if (m) return [parseInt(m[1], 10), s];
  return [Number.MAX_SAFE_INTEGER, s.toLowerCase()];
}

type SortMode = 'location' | 'status' | 'date';

export function WeeklyUpdateTab() {
  useWeeklyUpdatesRealtime();
  const canEdit = useCanAccessAdmin();
  const rowsQ = useWeeklyUpdates();
  const buildingsQ = useBuildings();
  const upsert = useUpsertWeeklyUpdate();
  const del = useDeleteWeeklyUpdate();

  const [showAll, setShowAll] = useState(false);          // default: incomplete only
  const [locFilter, setLocFilter] = useState<string>('');  // '' = all
  const [sortMode, setSortMode] = useState<SortMode>('location');
  const [error, setError] = useState<string | null>(null);

  const allRows = rowsQ.data ?? [];

  // Datalist of known location codes: building short_codes + whatever
  // locations already exist + the central-plant "Engine".
  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of buildingsQ.data ?? []) {
      const code = b.short_code ?? b.code;
      if (code) set.add(code);
    }
    for (const r of allRows) if (r.location) set.add(r.location);
    set.add('Engine');
    return Array.from(set).sort((a, b) => {
      const [an, as] = locationSortKey(a);
      const [bn, bs] = locationSortKey(b);
      return an - bn || as.localeCompare(bs);
    });
  }, [buildingsQ.data, allRows]);

  // Per-location pill data: { loc, open } where open = count of not-yet-
  // complete items. Sorted numeric-aware (20 < 88 < 300 < Engine) so the
  // pill row reads like the building list. Also returns the grand open
  // total for the "All" pill.
  const { locationPills, totalOpen } = useMemo(() => {
    const open = new Map<string, number>();
    let total = 0;
    for (const r of allRows) {
      if (!r.location) continue;
      const isOpen = isWeeklyOpen(r.status);
      open.set(r.location, (open.get(r.location) ?? 0) + (isOpen ? 1 : 0));
      if (isOpen) total += 1;
    }
    const pills = Array.from(open.keys())
      .sort((a, b) => {
        const [an, as] = locationSortKey(a);
        const [bn, bs] = locationSortKey(b);
        return an - bn || as.localeCompare(bs);
      })
      .map((loc) => ({ loc, open: open.get(loc) ?? 0 }));
    return { locationPills: pills, totalOpen: total };
  }, [allRows]);

  const visible = useMemo(() => {
    let rows = allRows;
    if (!showAll) rows = rows.filter((r) => isWeeklyOpen(r.status));
    if (locFilter) rows = rows.filter((r) => (r.location ?? '') === locFilter);
    const sorted = [...rows];
    if (sortMode === 'location') {
      sorted.sort((a, b) => {
        const [an, as] = locationSortKey(a.location);
        const [bn, bs] = locationSortKey(b.location);
        return an - bn || as.localeCompare(bs) || a.sort_order - b.sort_order;
      });
    } else if (sortMode === 'status') {
      const order: Record<WeeklyStatus, number> = {
        blocked: 0, in_progress: 1, on_hold: 2, pending: 3, complete: 4,
      };
      sorted.sort((a, b) => (order[a.status] - order[b.status]) || a.sort_order - b.sort_order);
    } else {
      // date — most recent first, nulls last
      sorted.sort((a, b) => {
        const ad = a.item_date ?? '';
        const bd = b.item_date ?? '';
        if (ad && bd) return bd.localeCompare(ad);
        if (ad) return -1;
        if (bd) return 1;
        return a.sort_order - b.sort_order;
      });
    }
    return sorted;
  }, [allRows, showAll, locFilter, sortMode]);

  // Status counts for the header summary.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of allRows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [allRows]);
  const openCount = allRows.filter((r) => isWeeklyOpen(r.status)).length;

  const commit = async (patch: Partial<WeeklyUpdate>) => {
    setError(null);
    try {
      await upsert.mutateAsync(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  };

  const addRow = async () => {
    setError(null);
    const nextSort = allRows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 10;
    try {
      await upsert.mutateAsync({
        location: locFilter || null,
        status: 'pending',
        sort_order: nextSort,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed.');
    }
  };

  return (
    <div>
      {/* Excel-like cell affordances: cells are borderless until you hover
          (faint outline) or focus (accent outline + card bg), so it reads
          as an editable grid without drawing 8 boxes per row at rest. */}
      <style>{`
        .weekly-grid input:hover,
        .weekly-grid textarea:hover,
        .weekly-grid select:hover {
          border-color: var(--color-border) !important;
        }
        .weekly-grid input:focus,
        .weekly-grid textarea:focus,
        .weekly-grid select:focus {
          outline: none;
          border-color: var(--color-accent) !important;
          background: var(--color-card) !important;
          box-shadow: 0 0 0 1px var(--color-accent);
        }
        .weekly-grid tr:hover { background: rgba(99,102,241,0.03); }
      `}</style>

      {/* Header / controls */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="t-section-title">Weekly Update Report</h2>
          <p className="t-small t-muted">
            Forecast-meeting agenda · edit any cell inline (click away to save)
            {openCount > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--color-warn, #d97706)', fontWeight: 600 }}>
                  {openCount} open
                </span>
              </>
            )}
            {counts.complete ? ` · ${counts.complete} complete` : ''}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={addRow}
            disabled={upsert.isPending}
            className="t-small t-accent"
            style={{
              padding: '6px 14px',
              border: '1px solid var(--color-accent)',
              borderRadius: 4,
              background: 'var(--color-card)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ color: 'var(--color-accent)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1 }}>+</span>
            Add row
          </button>
        )}
      </div>

      {/* Show + Sort */}
      <div className="flex items-center gap-2 flex-wrap mb-2" style={{ fontSize: '0.8rem' }}>
        <span className="t-small t-muted uppercase tracking-wider">Show</span>
        <Toggle active={!showAll} onClick={() => setShowAll(false)} label="Incomplete" />
        <Toggle active={showAll} onClick={() => setShowAll(true)} label="All" />
        <span className="t-small t-muted uppercase tracking-wider ml-3">Sort</span>
        <Toggle active={sortMode === 'location'} onClick={() => setSortMode('location')} label="Location" />
        <Toggle active={sortMode === 'status'} onClick={() => setSortMode('status')} label="Status" />
        <Toggle active={sortMode === 'date'} onClick={() => setSortMode('date')} label="Date" />
      </div>

      {/* Building filter pills — each shows its open (not-complete) count. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <span className="t-small t-muted uppercase tracking-wider mr-1">Bldg</span>
        <Pill active={locFilter === ''} onClick={() => setLocFilter('')} label="All" count={totalOpen} />
        {locationPills.map(({ loc, open }) => (
          <Pill
            key={loc}
            active={locFilter === loc}
            onClick={() => setLocFilter(locFilter === loc ? '' : loc)}
            label={loc}
            count={open}
          />
        ))}
      </div>

      {error && (
        <p className="t-small mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>
      )}

      {/* Datalist shared by every Location cell */}
      <datalist id="weekly-location-options">
        {locationOptions.map((l) => <option key={l} value={l} />)}
      </datalist>

      {rowsQ.isLoading ? (
        <p className="t-text t-muted">Loading…</p>
      ) : rowsQ.error ? (
        <p className="t-text t-danger">Error: {(rowsQ.error as Error).message}</p>
      ) : visible.length === 0 ? (
        <p className="t-text t-muted">
          {locFilter ? `No ${showAll ? '' : 'open '}items for ${locFilter}.` : 'No items.'}
          {canEdit && ' Click "Add row" to start.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="weekly-grid t-small" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 920 }}>
            <thead>
              <tr className="t-muted" style={{ textAlign: 'left' }}>
                <Th w={64}>Loc</Th>
                <Th w={42}>Pri</Th>
                <Th w={190}>Description</Th>
                <Th>Activity / notes</Th>
                <Th w={116}>Date</Th>
                <Th w={118}>Status</Th>
                <Th w={104}>Assignee</Th>
                {canEdit && <Th w={32}>{''}</Th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <WeeklyRow
                  key={r.id}
                  row={r}
                  canEdit={canEdit}
                  onCommit={(patch) => commit({ id: r.id, ...patch })}
                  onDelete={() => {
                    if (!confirm(`Remove "${r.description || r.location || 'this item'}"? (Soft delete.)`)) return;
                    del.mutate(r.id, { onError: (e) => setError((e as Error).message) });
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── one row

function WeeklyRow({
  row, canEdit, onCommit, onDelete,
}: {
  row: WeeklyUpdate;
  canEdit: boolean;
  onCommit: (patch: Partial<WeeklyUpdate>) => void;
  onDelete: () => void;
}) {
  const tone = weeklyStatusTone(row.status);
  // Subtle left-border tint by status so the eye groups open vs done.
  const accent =
    tone === 'bad'  ? 'var(--color-danger)' :
    tone === 'warn' ? 'var(--color-warn, #d97706)' :
    tone === 'good' ? 'var(--color-ok, #10b981)' :
    'var(--color-border)';

  return (
    <tr
      style={{
        borderTop: '1px solid var(--color-border-soft, rgba(0,0,0,0.08))',
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <Td>
        <EditableText
          value={row.location}
          placeholder="—"
          list="weekly-location-options"
          readOnly={!canEdit}
          mono
          onCommit={(v) => onCommit({ location: v })}
        />
      </Td>
      <Td>
        <EditableText
          value={row.priority}
          placeholder="—"
          readOnly={!canEdit}
          onCommit={(v) => onCommit({ priority: v })}
        />
      </Td>
      <Td>
        <EditableText
          value={row.description}
          placeholder="(description)"
          readOnly={!canEdit}
          weight={600}
          onCommit={(v) => onCommit({ description: v })}
        />
      </Td>
      <Td>
        <EditableTextarea
          value={row.activity}
          placeholder="(activity / notes)"
          readOnly={!canEdit}
          onCommit={(v) => onCommit({ activity: v })}
        />
      </Td>
      <Td>
        <EditableDate
          value={row.item_date}
          readOnly={!canEdit}
          onCommit={(v) => onCommit({ item_date: v })}
        />
      </Td>
      <Td>
        <StatusSelect
          value={row.status}
          readOnly={!canEdit}
          onChange={(v) => onCommit({ status: v })}
        />
      </Td>
      <Td>
        <EditableText
          value={row.assignee}
          placeholder="—"
          readOnly={!canEdit}
          onCommit={(v) => onCommit({ assignee: v })}
        />
      </Td>
      {canEdit && (
        <Td center>
          <button
            type="button"
            onClick={onDelete}
            title="Remove (soft delete)"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-danger)', fontSize: '0.85rem', lineHeight: 1,
              padding: 2,
            }}
          >
            ✕
          </button>
        </Td>
      )}
    </tr>
  );
}

// ───────────────────────── editable cells
//
// Each cell holds a local draft so typing doesn't fight React Query
// refetches. It re-syncs from the incoming value ONLY when the input is
// not focused, so an external (realtime) update to a different field
// doesn't clobber the cell you're editing. Commit happens on blur (text /
// date) — empty strings normalize to null.

function EditableText({
  value, onCommit, placeholder, readOnly, list, mono, weight,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  placeholder?: string;
  readOnly?: boolean;
  list?: string;
  mono?: boolean;
  weight?: number;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  // Set by the Escape handler so onBlur knows to DISCARD (not commit) the
  // draft. We can't rely on setDraft-then-blur because setState is async —
  // onBlur would still read the stale edited draft and commit it.
  const cancelRef = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '');
  }, [value]);

  if (readOnly) {
    return (
      <span
        className={mono ? 't-mono' : undefined}
        style={{ fontWeight: weight, color: value ? 'var(--color-text)' : 'var(--color-text-muted)' }}
      >
        {value || placeholder || '—'}
      </span>
    );
  }
  return (
    <input
      type="text"
      value={draft}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        if (cancelRef.current) {        // Escape pressed — discard
          cancelRef.current = false;
          setDraft(value ?? '');
          return;
        }
        const norm = draft.trim() || null;
        if (norm !== (value ?? null)) onCommit(norm);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { cancelRef.current = true; (e.target as HTMLInputElement).blur(); }
      }}
      className={mono ? 't-mono' : undefined}
      style={{ ...cellInputStyle, fontWeight: weight }}
    />
  );
}

function EditableTextarea({
  value, onCommit, placeholder, readOnly,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  const cancelRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '');
  }, [value]);

  // Auto-grow to fit content: reset to auto then size to scrollHeight.
  // Runs on every draft change + on mount so the full note is always
  // visible without an inner scrollbar.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  if (readOnly) {
    return (
      <span style={{ whiteSpace: 'pre-wrap', color: value ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
        {value || placeholder || '—'}
      </span>
    );
  }
  return (
    <textarea
      ref={taRef}
      value={draft}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        if (cancelRef.current) {        // Escape pressed — discard
          cancelRef.current = false;
          setDraft(value ?? '');
          return;
        }
        const norm = draft.trim() || null;
        if (norm !== (value ?? null)) onCommit(norm);
      }}
      onKeyDown={(e) => {
        // Enter commits; Shift+Enter inserts a newline.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') { cancelRef.current = true; (e.target as HTMLTextAreaElement).blur(); }
      }}
      style={{
        ...cellInputStyle,
        resize: 'none',
        overflow: 'hidden',
        minHeight: 28,
        lineHeight: 1.35,
      }}
    />
  );
}

function EditableDate({
  value, onCommit, readOnly,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  const cancelRef = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value ?? '');
  }, [value]);

  if (readOnly) {
    return <span className="t-muted">{value || '—'}</span>;
  }
  return (
    <input
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        if (cancelRef.current) {        // Escape pressed — discard
          cancelRef.current = false;
          setDraft(value ?? '');
          return;
        }
        const norm = draft || null;
        if (norm !== (value ?? null)) onCommit(norm);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { cancelRef.current = true; (e.target as HTMLInputElement).blur(); }
      }}
      style={cellInputStyle}
    />
  );
}

function StatusSelect({
  value, onChange, readOnly,
}: {
  value: WeeklyStatus;
  onChange: (v: WeeklyStatus) => void;
  readOnly?: boolean;
}) {
  const tone = weeklyStatusTone(value);
  const colors = statusColors(tone);
  if (readOnly) {
    return (
      <span
        className="uppercase tracking-wider"
        style={{
          padding: '2px 8px', borderRadius: 4, fontSize: '0.62rem', fontWeight: 700,
          background: colors.bg, color: colors.fg, whiteSpace: 'nowrap',
        }}
      >
        {WEEKLY_STATUS_LABELS[value]}
      </span>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as WeeklyStatus)}
      style={{
        ...cellInputStyle,
        fontWeight: 700,
        color: colors.fg,
        background: colors.bg,
        borderRadius: 4,
        textTransform: 'uppercase',
        fontSize: '0.62rem',
        letterSpacing: '0.04em',
        padding: '3px 6px',
      }}
    >
      {WEEKLY_STATUSES.map((s) => (
        <option key={s} value={s} style={{ background: 'var(--color-card)', color: 'var(--color-text)' }}>
          {WEEKLY_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

// ───────────────────────── presentational atoms

function Th({ children, w }: { children: React.ReactNode; w?: number }) {
  return (
    <th
      className="t-small t-muted"
      style={{ padding: '4px 6px', fontWeight: 600, width: w, whiteSpace: 'nowrap' }}
    >
      {children}
    </th>
  );
}

function Td({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <td style={{ padding: '2px 4px', verticalAlign: 'top', textAlign: center ? 'center' : 'left' }}>
      {children}
    </td>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-small"
      style={{
        padding: '3px 10px',
        borderRadius: 4,
        border: '1px solid',
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        background: active ? 'rgba(99,102,241,0.08)' : 'transparent',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/** Compact building-code chip for the location filter — smaller + rounder
 *  than Toggle since there can be a dozen on one wrapping row. Shows the
 *  building's open (not-complete) item count as a trailing badge; the
 *  badge is dimmed to 0 when nothing is open there. */
function Pill({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count?: number;
}) {
  const hasCount = count !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      className="t-small t-mono"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px 2px 9px',
        borderRadius: 12,
        border: '1px solid',
        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'white' : 'var(--color-text-muted)',
        fontWeight: active ? 700 : 500,
        fontSize: '0.72rem',
        cursor: 'pointer',
        lineHeight: 1.4,
      }}
    >
      {label}
      {hasCount && (
        <span
          style={{
            minWidth: 15,
            textAlign: 'center',
            padding: '0 4px',
            borderRadius: 8,
            fontSize: '0.62rem',
            fontWeight: 700,
            background: active
              ? 'rgba(255,255,255,0.25)'
              : (count ? 'rgba(217,119,6,0.18)' : 'var(--color-border-soft, rgba(0,0,0,0.08))'),
            color: active
              ? 'white'
              : (count ? 'var(--color-warn, #d97706)' : 'var(--color-text-muted)'),
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function statusColors(tone: 'good' | 'warn' | 'bad' | 'neutral'): { bg: string; fg: string } {
  if (tone === 'good') return { bg: 'rgba(16,185,129,0.15)', fg: 'var(--color-ok, #10b981)' };
  if (tone === 'warn') return { bg: 'rgba(217,119,6,0.15)', fg: 'var(--color-warn, #d97706)' };
  if (tone === 'bad')  return { bg: 'rgba(239,68,68,0.15)', fg: 'var(--color-danger)' };
  return { bg: 'rgba(100,116,139,0.12)', fg: 'var(--color-text-muted)' };
}

const cellInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  borderRadius: 3,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: '0.8rem',
};
