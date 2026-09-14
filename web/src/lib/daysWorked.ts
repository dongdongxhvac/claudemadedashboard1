// Days an engineer worked in a window, derived from PTO — not from labor
// logs. Base is UPark's Mon–Fri workdays inside the window (capped at
// end-of-today: future days haven't been worked yet), minus BMR-observed
// building holidays (the crew is off; per user 2026-09-14 — Labor Day was
// inflating every denominator to /5), minus approved full-day PTO days.
// Partial-day PTO (out_from/out_until set) still counts as a worked day,
// same as the coverage headcount rule. Hours logged ON a holiday (on-call,
// OT) still count toward hrs — only the day denominator excludes it.
//
// The PM system's assigned_to_name and pto_requests.user_full_name are
// different systems' spellings of the same person — match via nameKey()
// (the UKG reconcile normalizer), never raw string equality.
import { nameKey } from './ukgReconcile.ts';
import { BMR_HOLIDAYS } from './bmrHolidays.ts';

const HOLIDAY_ISOS = new Set(BMR_HOLIDAYS.map((h) => h.date));

/** Structural subset of PtoRequest — keeps this lib free of hook imports. */
export type PtoDayRow = {
  user_full_name: string | null;
  status: string;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;   // YYYY-MM-DD
  out_from: string | null;
  out_until: string | null;
};

function localIso(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Mon–Fri ISO dates inside [start, end), capped at end-of-today, minus
 *  BMR-observed holidays (lib/bmrHolidays — the list the PTO heatmaps
 *  outline; only the OBSERVED weekday is listed there, so no weekend
 *  double-handling is needed). */
function weekdayIsos(win: { start: Date; end: Date }, now: Date): string[] {
  const cap = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const end = win.end < cap ? win.end : cap;
  const isoDays: string[] = [];
  for (const d = new Date(win.start); d < end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow < 1 || dow > 5) continue;
    const iso = localIso(d);
    if (HOLIDAY_ISOS.has(iso)) continue;
    isoDays.push(iso);
  }
  return isoDays;
}

/** Workdays available in the window — the "full attendance" day count a
 *  no-PTO engineer would have (5 for a trailing-7d window; 4 when a BMR
 *  holiday falls inside it). */
export function workdaysInWindow(win: { start: Date; end: Date }, now: Date): number {
  return weekdayIsos(win, now).length;
}

/** Map from each input name (verbatim) → days worked in [start, end). */
export function daysWorkedByName(
  names: string[],
  pto: PtoDayRow[],
  win: { start: Date; end: Date },
  now: Date,
): Map<string, number> {
  const isoDays = weekdayIsos(win, now);

  const byKey = new Map<string, PtoDayRow[]>();
  for (const r of pto) {
    if (r.status !== 'approved') continue;
    if (r.out_from || r.out_until) continue; // partial day = still worked
    const k = nameKey(r.user_full_name ?? '');
    if (!k) continue;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }

  const out = new Map<string, number>();
  for (const name of names) {
    const rows = byKey.get(nameKey(name)) ?? [];
    let off = 0;
    for (const iso of isoDays) {
      if (rows.some((r) => r.starts_on <= iso && r.ends_on >= iso)) off++;
    }
    out.set(name, Math.max(0, isoDays.length - off));
  }
  return out;
}
