// Days an engineer worked in a window, derived from PTO — not from labor
// logs. Base is UPark's Mon–Fri workdays inside the window (capped at
// end-of-today: future days haven't been worked yet), minus approved
// full-day PTO days. Partial-day PTO (out_from/out_until set) still
// counts as a worked day, same as the coverage headcount rule.
//
// The PM system's assigned_to_name and pto_requests.user_full_name are
// different systems' spellings of the same person — match via nameKey()
// (the UKG reconcile normalizer), never raw string equality.
import { nameKey } from './ukgReconcile';

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

/** Mon–Fri ISO dates inside [start, end), capped at end-of-today. */
function weekdayIsos(win: { start: Date; end: Date }, now: Date): string[] {
  const cap = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const end = win.end < cap ? win.end : cap;
  const isoDays: string[] = [];
  for (const d = new Date(win.start); d < end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) isoDays.push(localIso(d));
  }
  return isoDays;
}

/** Workdays available in the window — the "full attendance" day count a
 *  no-PTO engineer would have (5 for a trailing-7d window). */
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
