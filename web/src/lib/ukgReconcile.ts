// UKG payroll export parsing + PTO reconciliation.
//
// The company did NOT buy UKG's PTO module — UKG is payroll-of-record only
// and managers key PTO into it BY HAND. The dashboard is the working PTO
// interface, so this lib compares a UKG Excel export (parsed to an
// array-of-arrays by SheetJS in the UI) against dashboard pto_requests and
// surfaces the gaps: approved-in-dashboard-but-missing-from-UKG (the payroll
// keying error being hunted), in-UKG-but-not-dashboard, and hour/type
// mismatches.
//
// Pure + dependency-free at runtime (the PtoType import is type-only) so the
// UI preview and the ad-hoc node test share one source of truth:
//   node --experimental-strip-types web/src/lib/ukgReconcile.test.ts
//
// ⚠ PROVISIONAL — the column detectors and paycode map below were built
// BEFORE a real UKG export was available (user will drop a sample file with
// "UKG" in the name; lock both against it and update this header per the
// mroCsv.ts "Tuned against…" convention). The UI's mapping-confidence chips
// are the safety net until then.

import type { PtoType } from '../hooks/usePto';

// ── constants ──

/** Payroll quarter-hour grain: |dash − ukg| ≤ this counts as matched. */
export const HOURS_TOLERANCE = 0.25;

/** Dashboard PTO history at Binney starts here (migrations 0107/0108 imported
 *  the future schedule only). UKG rows before this date are clipped from the
 *  compare — they are expected dashboard gaps, not errors. */
export const BINNEY_PTO_CUTOFF = '2026-07-13';

/** UPark books PTO against weekdays only (Mon–Fri 5×8); Binney's 4×10 crews
 *  cover all 7 days, so every calendar day counts. */
export type SiteRule = 'weekdays' | 'all_days';
export const SITE_RULE: Record<'upark' | 'binney', SiteRule> = {
  upark: 'weekdays',
  binney: 'all_days',
};

/** UKG pay/earning code → dashboard PTO type. PROVISIONAL guesses — unknown
 *  codes are surfaced in the UI (never silently guessed) and still take part
 *  in HOURS matching so a correctly-keyed day doesn't false-flag. Note
 *  'holiday' here means the FLOATING holiday PTO type, not a company holiday. */
export const PAYCODE_TO_PTO_TYPE: Record<string, PtoType> = {
  VAC: 'vacation', VACATION: 'vacation', PTO: 'vacation',
  SIC: 'sick', SICK: 'sick', SCK: 'sick',
  FLOAT: 'holiday', 'FLOATING HOLIDAY': 'holiday', FH: 'holiday', PER: 'holiday', PERSONAL: 'holiday',
  BRV: 'bereavement', BEREAVEMENT: 'bereavement',
  JUR: 'jury_duty', JURY: 'jury_duty', 'JURY DUTY': 'jury_duty',
  UNPAID: 'unpaid', LOA: 'leave', LEAVE: 'leave', STD: 'short_term', 'SHORT TERM': 'short_term',
};

export function paycodeToType(code: string): PtoType | null {
  return PAYCODE_TO_PTO_TYPE[code.trim().toUpperCase()] ?? null;
}

// ── column detection (mroCsv.ts pattern: ordered, first-match-wins) ──

export type UkgField = 'employee' | 'date' | 'end_date' | 'paycode' | 'hours';
export type UkgColumnMapping = Partial<Record<UkgField, number>>;

export const UKG_DETECTORS: { field: UkgField; patterns: RegExp[] }[] = [
  { field: 'employee', patterns: [/employee/i, /worker/i, /\bname\b/i] },
  // end_date before date so "End Date" isn't claimed by the generic date rule.
  { field: 'end_date', patterns: [/end\s*date/i, /date\s*to/i, /\bthru\b/i, /through/i] },
  { field: 'date',     patterns: [/work\s*date/i, /^date$/i, /start\s*date/i, /date\s*from/i, /\bdate\b/i] },
  { field: 'paycode',  patterns: [/pay\s*code/i, /earn(ing)?\s*code/i, /absence\s*type/i, /time\s*off\s*type/i, /\bcode\b/i, /\btype\b/i] },
  { field: 'hours',    patterns: [/hours/i, /\bhrs\b/i, /\bunits\b/i, /\bamount\b/i] },
];

export const UKG_REQUIRED: UkgField[] = ['employee', 'date', 'hours'];

export function detectUkgColumns(headers: string[]): UkgColumnMapping {
  const map: UkgColumnMapping = {};
  const used = new Set<number>();
  for (const { field, patterns } of UKG_DETECTORS) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = String(headers[i] ?? '').trim();
      if (h && patterns.some((p) => p.test(h))) { map[field] = i; used.add(i); break; }
    }
  }
  return map;
}

// ── cell coercion (AoA cells from sheet_to_json are unknown) ──

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // Excel serial day 0

/** Date object (SheetJS cellDates), Excel serial number, "MM/DD/YYYY",
 *  "YYYY-MM-DD" or "Jul 25, 2026" → YYYY-MM-DD. Null if unparseable. */
export function cellToIsoDate(cell: unknown): string | null {
  if (cell == null) return null;
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    // SheetJS date cells land at (or within seconds of) UTC midnight; local
    // parsing of string cells lands at local midnight. Prefer UTC parts when
    // the UTC time-of-day is ~midnight, else local parts.
    const utcMidnight = cell.getUTCHours() === 0 && cell.getUTCMinutes() <= 1;
    const y = utcMidnight ? cell.getUTCFullYear() : cell.getFullYear();
    const m = utcMidnight ? cell.getUTCMonth() + 1 : cell.getMonth() + 1;
    const d = utcMidnight ? cell.getUTCDate() : cell.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    if (cell < 20000 || cell > 60000) return null; // not a plausible date serial (1954–2064)
    return new Date(EXCEL_EPOCH_UTC + Math.round(cell) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(cell).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, mm, dd] = m;
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/); // "Jul 25, 2026"
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mi = months.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** Numeric cell or "8", "8.00", "8:30"→8.5. Null if not finite. */
export function cellToNumber(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const s = String(cell ?? '').trim();
  if (!s) return null;
  const hm = s.match(/^(\d{1,3}):(\d{2})$/); // some payroll exports print H:MM
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && s.replace(/[^0-9]/g, '') !== '' ? n : null;
}

// ── name matching ──

/** "Lao, Jie" / "Lao, Jie A." / "Jie Lao" → "jie lao". Drops periods and
 *  single-letter (middle-initial) tokens so UKG's legal-name formatting
 *  still matches the dashboard's "First Last". */
export function nameKey(raw: string): string {
  let s = String(raw ?? '').trim();
  const m = s.match(/^([^,]+),\s*(.+)$/);
  if (m) s = `${m[2].trim()} ${m[1].trim()}`;
  return s
    .toLowerCase()
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .join(' ');
}

export type RosterEntry = { userId: string; fullName: string };

/** Token-overlap "did you mean…" suggestions for an unmatched UKG name.
 *  Suggestions ONLY — never auto-matched; a wrong person-match would corrupt
 *  a payroll reconciliation. */
export function nameSuggestions(raw: string, roster: RosterEntry[], max = 3): string[] {
  const tokens = new Set(nameKey(raw).split(' ').filter(Boolean));
  if (tokens.size === 0) return [];
  const scored = roster
    .map((r) => {
      const rt = new Set(nameKey(r.fullName).split(' ').filter(Boolean));
      let overlap = 0;
      for (const t of tokens) if (rt.has(t)) overlap++;
      return { name: r.fullName, score: overlap / Math.min(tokens.size, rt.size || 1) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.name);
}

// ── UKG parse ──

export type UkgEntry = {
  rawName: string;
  nameKeyed: string;
  date: string;               // YYYY-MM-DD (range start when endDate set)
  endDate: string | null;     // set only for range-style exports
  hours: number;
  paycode: string;
  ptoType: PtoType | null;    // null = unknown paycode (surfaced, not guessed)
  rowIndex: number;
  rowWarnings: string[];
};

export type ParsedUkg = {
  headers: string[];
  headerRowIndex: number;     // UKG exports often lead with title/date rows
  mapping: UkgColumnMapping;
  missingFields: UkgField[];
  entries: UkgEntry[];
  skippedRows: number;        // blank / subtotal / unparseable rows
  unknownPaycodes: { code: string; count: number; totalHours: number }[];
  periodStart: string | null;
  periodEnd: string | null;
};

/** Parse the AoA from XLSX.utils.sheet_to_json(ws, { header: 1, ... }).
 *  Handles: title rows before the header, section-grouped exports where the
 *  employee name prints once per block (blank cells inherit the previous
 *  name), and per-day OR per-range rows (end_date column). */
export function parseUkgAoa(rows: unknown[][]): ParsedUkg {
  const empty: ParsedUkg = {
    headers: [], headerRowIndex: -1, mapping: {}, missingFields: UKG_REQUIRED,
    entries: [], skippedRows: 0, unknownPaycodes: [], periodStart: null, periodEnd: null,
  };
  if (!rows || rows.length === 0) return empty;

  // Header row = first of the leading rows where ≥3 detectors hit.
  let headerRowIndex = -1;
  let mapping: UkgColumnMapping = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cand = (rows[i] ?? []).map((c) => String(c ?? ''));
    const m = detectUkgColumns(cand);
    if (Object.keys(m).length >= 3) { headerRowIndex = i; mapping = m; break; }
  }
  if (headerRowIndex === -1) return { ...empty, skippedRows: rows.length };

  const headers = (rows[headerRowIndex] ?? []).map((c) => String(c ?? '').trim());
  const missingFields = UKG_REQUIRED.filter((f) => mapping[f] === undefined);

  const entries: UkgEntry[] = [];
  const unknown = new Map<string, { count: number; totalHours: number }>();
  let skippedRows = 0;
  let carriedName = '';

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const at = (f: UkgField) => (mapping[f] !== undefined ? cells[mapping[f]!] : undefined);

    const rawNameCell = String(at('employee') ?? '').trim();
    if (rawNameCell) carriedName = rawNameCell; // section-grouped carry-forward
    const rawName = rawNameCell || carriedName;

    const date = cellToIsoDate(at('date'));
    const hours = cellToNumber(at('hours'));

    // Section labels, subtotals, blank spacers: no date AND no hours.
    if (date === null && hours === null) { skippedRows++; continue; }
    if (!rawName || date === null || hours === null || hours <= 0) { skippedRows++; continue; }

    const endRaw = cellToIsoDate(at('end_date'));
    const paycode = String(at('paycode') ?? '').trim();
    const ptoType = paycode ? paycodeToType(paycode) : null;
    if (paycode && ptoType === null) {
      const cur = unknown.get(paycode.toUpperCase()) ?? { count: 0, totalHours: 0 };
      cur.count++; cur.totalHours += hours;
      unknown.set(paycode.toUpperCase(), cur);
    }

    entries.push({
      rawName,
      nameKeyed: nameKey(rawName),
      date,
      endDate: endRaw && endRaw !== date ? endRaw : null,
      hours,
      paycode,
      ptoType,
      rowIndex: i,
      rowWarnings: [],
    });
  }

  const dates = entries
    .flatMap((e) => [e.date, e.endDate ?? e.date])
    .sort();
  return {
    headers, headerRowIndex, mapping, missingFields, entries, skippedRows,
    unknownPaycodes: [...unknown.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.totalHours - a.totalHours),
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}

// ── calendar helpers (UTC arithmetic — deterministic in any timezone) ──

function dow(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of counted days in a range under the site rule.
 *  weekdays: Sat/Sun skipped. Hard cap guards a typo'd year. */
export function countedDays(startsOn: string, endsOn: string, rule: SiteRule): string[] {
  const out: string[] = [];
  if (!startsOn || !endsOn || endsOn < startsOn) return out;
  let cur = startsOn;
  while (cur <= endsOn && out.length < 400) {
    const d = dow(cur);
    if (rule === 'all_days' || (d !== 0 && d !== 6)) out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** Next counted day after `iso` under the rule — used to merge gap days into
 *  display ranges (at UPark, Friday→Monday are adjacent). */
export function nextCountedDay(iso: string, rule: SiteRule): string {
  let cur = addDaysIso(iso, 1);
  for (let i = 0; i < 4; i++) {
    const d = dow(cur);
    if (rule === 'all_days' || (d !== 0 && d !== 6)) return cur;
    cur = addDaysIso(cur, 1);
  }
  return cur;
}

// ── dashboard expansion ──

/** Thin adapter target for PtoRequest rows (MroAutoMatch pattern: the pure
 *  lib owns a narrow input type; the UI maps DB rows onto it). */
export type ReconRequestInput = {
  id: string;
  user_id: string;
  user_full_name: string | null;
  type: PtoType;
  status: string;
  starts_on: string;
  ends_on: string;
  hours: number;
  out_from: string | null;
  out_until: string | null;
};

export type DashDayPart = {
  userId: string;
  date: string;
  hours: number;
  type: PtoType;
  requestId: string;
  partial: boolean;
  warnings: string[];
};

/** Expand approved requests into per-day parts inside the window.
 *  Per-day hours = request.hours / countedDays — NOT the site daily rate —
 *  so manually-overridden totals still tie out. Partial-day requests
 *  (out_from/out_until) contribute their own hours on their single day. */
export function expandRequestsToDays(
  requests: ReconRequestInput[],
  rule: SiteRule,
  window: { start: string; end: string },
): DashDayPart[] {
  const out: DashDayPart[] = [];
  for (const r of requests) {
    if (r.status !== 'approved') continue;
    if (r.ends_on < window.start || r.starts_on > window.end) continue;

    const partial = r.out_from !== null || r.out_until !== null;
    if (partial) {
      if (r.starts_on >= window.start && r.starts_on <= window.end) {
        out.push({
          userId: r.user_id, date: r.starts_on, hours: r.hours, type: r.type,
          requestId: r.id, partial: true, warnings: [],
        });
      }
      continue;
    }

    let days = countedDays(r.starts_on, r.ends_on, rule);
    const warnings: string[] = [];
    if (days.length === 0) {
      // Weekend-only UPark entry (rare manual case) — fall back to calendar
      // days so its hours aren't silently dropped.
      days = countedDays(r.starts_on, r.ends_on, 'all_days');
      warnings.push('weekend-only range; counted as calendar days');
      if (days.length === 0) continue;
    }
    const perDay = r.hours / days.length;
    for (const d of days) {
      if (d < window.start || d > window.end) continue;
      out.push({
        userId: r.user_id, date: d, hours: perDay, type: r.type,
        requestId: r.id, partial: false, warnings,
      });
    }
  }
  return out;
}

/** Split range-style UKG rows (endDate set) into per-day entries under the
 *  site rule; per-day rows pass through unchanged. */
export function expandUkgEntriesToDays(entries: UkgEntry[], rule: SiteRule): UkgEntry[] {
  const out: UkgEntry[] = [];
  for (const e of entries) {
    if (!e.endDate) { out.push(e); continue; }
    let days = countedDays(e.date, e.endDate, rule);
    if (days.length === 0) days = countedDays(e.date, e.endDate, 'all_days');
    if (days.length === 0) { out.push({ ...e, endDate: null }); continue; }
    const perDay = e.hours / days.length;
    for (const d of days) out.push({ ...e, date: d, endDate: null, hours: perDay });
  }
  return out;
}

// ── reconcile ──

export type GapKind = 'missing_in_ukg' | 'missing_in_dashboard' | 'hours_mismatch' | 'type_mismatch';

export type DayGap = {
  kind: GapKind;
  userId: string | null;      // always set today (unmatched names never become gaps); nullable for future alias rows
  name: string;
  date: string;
  dashHours: number | null;
  ukgHours: number | null;
  dashTypes: PtoType[];
  ukgTypes: PtoType[];        // mapped types only (unknown paycodes excluded)
  ukgPaycodes: string[];
  requestIds: string[];
  partial: boolean;
};

export type GapRange = {
  kind: GapKind;
  userId: string | null;
  name: string;
  start: string;
  end: string;
  days: number;
  dashHours: number;
  ukgHours: number;
  dashTypes: PtoType[];
  ukgPaycodes: string[];
  dayGaps: DayGap[];
};

export type ReconcileResult = {
  window: { start: string; end: string } | null;
  clippedToCutoff: string | null;
  entriesBeforeCutoff: number;
  matchedDays: number;
  gaps: DayGap[];
  gapRanges: GapRange[];
  unmatchedUkgNames: { rawName: string; entryCount: number; totalHours: number; suggestions: string[] }[];
  rosterCollisions: string[];
  pendingOverlaps: { requestId: string; name: string; type: PtoType; start: string; end: string; hours: number }[];
  summary: {
    missingInUkgDays: number;
    missingInDashboardDays: number;
    mismatchedDays: number;
    matchedDays: number;
    ukgComparedHours: number;
    dashComparedHours: number;
  };
};

const EMPTY_RESULT: ReconcileResult = {
  window: null, clippedToCutoff: null, entriesBeforeCutoff: 0, matchedDays: 0,
  gaps: [], gapRanges: [], unmatchedUkgNames: [], rosterCollisions: [], pendingOverlaps: [],
  summary: {
    missingInUkgDays: 0, missingInDashboardDays: 0, mismatchedDays: 0,
    matchedDays: 0, ukgComparedHours: 0, dashComparedHours: 0,
  },
};

export function reconcile(args: {
  entries: UkgEntry[];
  requests: ReconRequestInput[];
  roster: RosterEntry[];
  rule: SiteRule;
  cutoff?: string | null;
  hoursTolerance?: number;
}): ReconcileResult {
  const { entries, requests, roster, rule } = args;
  const tol = args.hoursTolerance ?? HOURS_TOLERANCE;
  if (entries.length === 0) return EMPTY_RESULT;

  // Window = the UKG report's own span, optionally clipped to the site cutoff.
  const perDay = expandUkgEntriesToDays(entries, rule);
  const allDates = perDay.map((e) => e.date).sort();
  let start = allDates[0];
  const end = allDates[allDates.length - 1];
  let clippedToCutoff: string | null = null;
  if (args.cutoff && args.cutoff > start) { start = args.cutoff; clippedToCutoff = args.cutoff; }
  const compared = perDay.filter((e) => e.date >= start && e.date <= end);
  const entriesBeforeCutoff = perDay.length - compared.length;
  if (compared.length === 0) {
    return { ...EMPTY_RESULT, window: { start, end }, clippedToCutoff, entriesBeforeCutoff };
  }

  // Roster: nameKey → userId. Collisions (two roster names normalizing to the
  // same key) are excluded from matching and surfaced — an ambiguous match is
  // worse than an unmatched name in a payroll check.
  const keyToUser = new Map<string, RosterEntry>();
  const collided = new Set<string>();
  for (const r of roster) {
    const k = nameKey(r.fullName);
    if (!k) continue;
    if (keyToUser.has(k)) collided.add(k);
    else keyToUser.set(k, r);
  }
  for (const k of collided) keyToUser.delete(k);
  const nameByUserId = new Map(roster.map((r) => [r.userId, r.fullName]));

  // Bucket UKG side into (userId, date) cells; unmatched names aside.
  type UkgCell = { hours: number; types: Set<PtoType>; paycodes: Set<string>; hasUnknownCode: boolean };
  const ukgCells = new Map<string, UkgCell>();
  const unmatched = new Map<string, { entryCount: number; totalHours: number; rawName: string }>();
  for (const e of compared) {
    const hit = keyToUser.get(e.nameKeyed);
    if (!hit) {
      const cur = unmatched.get(e.nameKeyed) ?? { entryCount: 0, totalHours: 0, rawName: e.rawName };
      cur.entryCount++; cur.totalHours += e.hours;
      unmatched.set(e.nameKeyed, cur);
      continue;
    }
    const key = `${hit.userId}|${e.date}`;
    const cell = ukgCells.get(key) ?? { hours: 0, types: new Set(), paycodes: new Set(), hasUnknownCode: false };
    cell.hours += e.hours;
    if (e.ptoType) cell.types.add(e.ptoType);
    else if (e.paycode) cell.hasUnknownCode = true;
    if (e.paycode) cell.paycodes.add(e.paycode);
    ukgCells.set(key, cell);
  }

  // Dashboard side.
  const parts = expandRequestsToDays(requests, rule, { start, end });
  type DashCell = { hours: number; types: Set<PtoType>; requestIds: Set<string>; partial: boolean };
  const dashCells = new Map<string, DashCell>();
  for (const p of parts) {
    const key = `${p.userId}|${p.date}`;
    const cell = dashCells.get(key) ?? { hours: 0, types: new Set(), requestIds: new Set(), partial: false };
    cell.hours += p.hours;
    cell.types.add(p.type);
    cell.requestIds.add(p.requestId);
    cell.partial = cell.partial || p.partial;
    dashCells.set(key, cell);
  }

  // Walk the union of cells.
  const gaps: DayGap[] = [];
  let matchedDays = 0;
  let ukgComparedHours = 0;
  let dashComparedHours = 0;
  const keys = new Set([...ukgCells.keys(), ...dashCells.keys()]);
  for (const key of keys) {
    const [userId, date] = key.split('|');
    const name = nameByUserId.get(userId) ?? '?';
    const u = ukgCells.get(key);
    const d = dashCells.get(key);
    if (u) ukgComparedHours += u.hours;
    if (d) dashComparedHours += d.hours;

    const base = {
      userId, name, date,
      dashHours: d ? round2(d.hours) : null,
      ukgHours: u ? round2(u.hours) : null,
      dashTypes: d ? [...d.types] : [],
      ukgTypes: u ? [...u.types] : [],
      ukgPaycodes: u ? [...u.paycodes] : [],
      requestIds: d ? [...d.requestIds] : [],
      partial: d?.partial ?? false,
    };

    if (d && !u) { gaps.push({ kind: 'missing_in_ukg', ...base }); continue; }
    if (u && !d) { gaps.push({ kind: 'missing_in_dashboard', ...base }); continue; }
    if (!u || !d) continue;

    if (Math.abs(u.hours - d.hours) > tol) {
      gaps.push({ kind: 'hours_mismatch', ...base });
      continue;
    }
    // Type compare only when every UKG entry that day mapped to a known type.
    if (!u.hasUnknownCode && u.types.size > 0) {
      const dt = [...d.types].sort().join(',');
      const ut = [...u.types].sort().join(',');
      if (dt !== ut) { gaps.push({ kind: 'type_mismatch', ...base }); continue; }
    }
    matchedDays++;
  }

  gaps.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));

  // Pending requests overlapping the window — excluded from the compare by
  // design (not yet approved → not expected in UKG), listed for context.
  const pendingOverlaps = requests
    .filter((r) => r.status === 'pending' && r.ends_on >= start && r.starts_on <= end)
    .map((r) => ({
      requestId: r.id,
      name: r.user_full_name ?? nameByUserId.get(r.user_id) ?? '?',
      type: r.type, start: r.starts_on, end: r.ends_on, hours: r.hours,
    }));

  const summary = {
    missingInUkgDays: gaps.filter((g) => g.kind === 'missing_in_ukg').length,
    missingInDashboardDays: gaps.filter((g) => g.kind === 'missing_in_dashboard').length,
    mismatchedDays: gaps.filter((g) => g.kind === 'hours_mismatch' || g.kind === 'type_mismatch').length,
    matchedDays,
    ukgComparedHours: round2(ukgComparedHours),
    dashComparedHours: round2(dashComparedHours),
  };

  return {
    window: { start, end },
    clippedToCutoff,
    entriesBeforeCutoff,
    matchedDays,
    gaps,
    gapRanges: aggregateGapsToRanges(gaps, rule),
    unmatchedUkgNames: [...unmatched.values()]
      .map((v) => ({
        rawName: v.rawName,
        entryCount: v.entryCount,
        totalHours: round2(v.totalHours),
        suggestions: nameSuggestions(v.rawName, roster),
      }))
      .sort((a, b) => b.totalHours - a.totalHours),
    rosterCollisions: [...collided],
    pendingOverlaps,
    summary,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Merge same-person same-kind gap days that are adjacent under the site
 *  rule (UPark: Friday→Monday count as adjacent) into display ranges — a
 *  5-day missing vacation reads as one line, not five. */
export function aggregateGapsToRanges(gaps: DayGap[], rule: SiteRule): GapRange[] {
  const groups = new Map<string, DayGap[]>();
  for (const g of gaps) {
    const key = `${g.userId ?? g.name}|${g.kind}|${g.dashTypes.join(',')}|${g.ukgPaycodes.join(',')}`;
    const cur = groups.get(key) ?? [];
    cur.push(g);
    groups.set(key, cur);
  }
  const out: GapRange[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date));
    let range: GapRange | null = null;
    for (const g of group) {
      if (range && g.date === nextCountedDay(range.end, rule)) {
        range.end = g.date;
        range.days++;
        range.dashHours = round2(range.dashHours + (g.dashHours ?? 0));
        range.ukgHours = round2(range.ukgHours + (g.ukgHours ?? 0));
        range.dayGaps.push(g);
      } else {
        if (range) out.push(range);
        range = {
          kind: g.kind, userId: g.userId, name: g.name,
          start: g.date, end: g.date, days: 1,
          dashHours: round2(g.dashHours ?? 0), ukgHours: round2(g.ukgHours ?? 0),
          dashTypes: g.dashTypes, ukgPaycodes: g.ukgPaycodes,
          dayGaps: [g],
        };
      }
    }
    if (range) out.push(range);
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.start.localeCompare(b.start));
  return out;
}
