// Shared utilities for the dashboard. Ports of V5's helpers (cove_pm_dashboard_REAL_DATA_v5.html).

export const TYPE_ORDER = ['Major', 'Filter Swap', 'Test/Record', 'Minor'] as const;
export type PmType = typeof TYPE_ORDER[number];

export const TYPE_COLORS: Record<PmType, string> = {
  Major:         '#aa3bff',
  'Filter Swap': '#5bb8e0',
  'Test/Record': '#f4b740',
  Minor:         '#9ca3af',
};

/** Local YYYY-MM-DD (en-CA happens to use ISO format). */
export function localISODate(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Monday of the week containing the given date, at local midnight. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();                 // Sun=0..Sat=6
  const offset = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + offset);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isClosed(status: string | null | undefined): boolean {
  if (!status) return false;
  return /closed|complete|cancel/i.test(status);
}

export function isCompletedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'completed' || s === 'closed' || s === 'complete';
}

/**
 * "Needs Updating PM" — a PM that's open but unsuitable to schedule:
 *   - building AND equipment both NULL, OR
 *   - name contains "unscheduled" (case-insensitive), OR
 *   - cmms_type is "On-Demand" / "On Demand" (the new Type column from CMMS).
 *
 * Caller is responsible for filtering to open rows (status not closed/complete/cancel).
 */
export function isNpm(row: {
  building_code: string | null;
  equipment: string | null;
  name: string | null;
  cmms_type?: string | null;
}): boolean {
  if (!row.building_code && !row.equipment) return true;
  if (row.name && /unscheduled/i.test(row.name)) return true;
  if (row.cmms_type && /on[-\s]?demand/i.test(row.cmms_type)) return true;
  return false;
}

export function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Returns "MM/DD" formatted from a YYYY-MM-DD string (treated as local). */
export function fmtMd(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

// ---------------------------------------------------------------------------
// Period selector — shared across the §00 Crew Performance family of tiles.
// Hoisting these here lets multiple components stay in sync on one toggle.
// ---------------------------------------------------------------------------

export type Period = 'today' | '7d' | 'this_wk' | 'last_wk' | '30d';

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'today',   label: 'Today' },
  { key: '7d',      label: '7d' },
  { key: 'this_wk', label: 'This wk' },
  { key: 'last_wk', label: 'Last wk' },
  { key: '30d',     label: '30d' },
];

export type Win = { start: Date; end: Date; label: string };

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function windowFor(period: Period, anchor: Date): Win {
  switch (period) {
    case 'today': {
      const start = startOfDay(anchor);
      const end = addDays(start, 1);
      return { start, end, label: fmtDateShort(start) };
    }
    case '7d': {
      const end = addDays(startOfDay(anchor), 1);
      const start = addDays(end, -7);
      return { start, end, label: `${fmtDateShort(start)} → ${fmtDateShort(addDays(end, -1))}` };
    }
    case 'this_wk': {
      const start = mondayOf(anchor);
      const end = addDays(start, 7);
      return { start, end, label: `${fmtDateShort(start)} → ${fmtDateShort(addDays(start, 6))}` };
    }
    case 'last_wk': {
      const thisMon = mondayOf(anchor);
      const start = addDays(thisMon, -7);
      const end = thisMon;
      return { start, end, label: `${fmtDateShort(start)} → ${fmtDateShort(addDays(start, 6))}` };
    }
    case '30d': {
      const end = addDays(startOfDay(anchor), 1);
      const start = addDays(end, -30);
      return { start, end, label: `${fmtDateShort(start)} → ${fmtDateShort(addDays(end, -1))}` };
    }
  }
}

export function prevWindow(current: Win): Win {
  const spanMs = current.end.getTime() - current.start.getTime();
  const start = new Date(current.start.getTime() - spanMs);
  const end = current.start;
  return { start, end, label: `${fmtDateShort(start)} → ${fmtDateShort(addDays(end, -1))}` };
}
