// Ad-hoc test for ukgReconcile.ts — no test framework in this repo; run:
//   node --experimental-strip-types web/src/lib/ukgReconcile.test.ts
// Exit code 0 = all assertions pass. Lives under src/ so `npm run build`
// type-checks it, but vite never bundles it (not on the import graph).
//
// When the real UKG sample export lands, add its actual header row (and a
// couple of real-shaped rows, names redacted) as a fixture here.

// Minimal node global so tsc (browser lib config, no @types/node) accepts
// the exit-code line; node itself provides the real object at runtime.
declare const process: { exitCode?: number };

import {
  detectUkgColumns, parseUkgAoa, cellToIsoDate, cellToNumber,
  nameKey, nameSuggestions, countedDays, nextCountedDay,
  expandRequestsToDays, expandUkgEntriesToDays, reconcile, aggregateGapsToRanges,
  HOURS_TOLERANCE, BINNEY_PTO_CUTOFF,
  type ReconRequestInput, type RosterEntry, type UkgEntry,
} from './ukgReconcile.ts';

let failures = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ── column detection ──
{
  const m = detectUkgColumns(['Employee Name', 'Work Date', 'Pay Code', 'Hours']);
  assertEq(m, { employee: 0, date: 1, paycode: 2, hours: 3 }, 'detect: flat per-day headers');

  const m2 = detectUkgColumns(['Worker', 'Start Date', 'End Date', 'Absence Type', 'Units']);
  assertEq(m2, { employee: 0, end_date: 2, date: 1, paycode: 3, hours: 4 }, 'detect: range headers, end_date not stolen by date');
}

// ── cell coercion ──
{
  assertEq(cellToIsoDate('7/21/2026'), '2026-07-21', 'date: MM/DD/YYYY string');
  assertEq(cellToIsoDate('2026-07-21'), '2026-07-21', 'date: ISO string');
  assertEq(cellToIsoDate('Jul 21, 2026'), '2026-07-21', 'date: "Mon DD, YYYY"');
  assertEq(cellToIsoDate(new Date(Date.UTC(2026, 6, 21))), '2026-07-21', 'date: Date at UTC midnight');
  // Excel serial for 2026-07-21 = days since 1899-12-30
  const serial = Math.round((Date.UTC(2026, 6, 21) - Date.UTC(1899, 11, 30)) / 86400000);
  assertEq(cellToIsoDate(serial), '2026-07-21', 'date: excel serial');
  assertEq(cellToIsoDate('Totals'), null, 'date: junk → null');
  assertEq(cellToNumber(8), 8, 'hours: number passthrough');
  assertEq(cellToNumber('8.00'), 8, 'hours: numeric string');
  assertEq(cellToNumber('8:30'), 8.5, 'hours: H:MM');
  assertEq(cellToNumber(''), null, 'hours: blank → null');
}

// ── name keys ──
{
  assertEq(nameKey('Lao, Jie'), 'jie lao', 'nameKey: Last, First flip');
  assertEq(nameKey('Lao, Jie A.'), 'jie lao', 'nameKey: middle initial dropped');
  assertEq(nameKey('  Jie   Lao '), 'jie lao', 'nameKey: whitespace collapse');
  const roster: RosterEntry[] = [
    { userId: 'u1', fullName: 'Jie Lao' },
    { userId: 'u2', fullName: 'Sean Martell' },
  ];
  assertEq(nameSuggestions('Martel, Sean', roster), ['Sean Martell'], 'suggestions: token overlap on misspelling');
}

// ── counted days ──
{
  // Fri 2026-07-24 .. Mon 2026-07-27
  assertEq(countedDays('2026-07-24', '2026-07-27', 'weekdays'), ['2026-07-24', '2026-07-27'], 'countedDays: weekdays skips the weekend');
  assertEq(countedDays('2026-07-24', '2026-07-27', 'all_days').length, 4, 'countedDays: all_days keeps the weekend');
  assertEq(countedDays('2026-07-25', '2026-07-26', 'weekdays'), [], 'countedDays: weekend-only → empty under weekdays');
  assertEq(nextCountedDay('2026-07-24', 'weekdays'), '2026-07-27', 'nextCountedDay: Fri → Mon under weekdays');
  assertEq(nextCountedDay('2026-07-24', 'all_days'), '2026-07-25', 'nextCountedDay: Fri → Sat under all_days');
}

// ── expansion ──
{
  const reqs: ReconRequestInput[] = [
    // Fri→Mon vacation, manager typed 20h (override) — 2 weekdays → 10h/day
    { id: 'r1', user_id: 'u1', user_full_name: 'Jie Lao', type: 'vacation', status: 'approved',
      starts_on: '2026-07-24', ends_on: '2026-07-27', hours: 20, out_from: null, out_until: null },
    // partial sick day
    { id: 'r2', user_id: 'u2', user_full_name: 'Sean Martell', type: 'sick', status: 'approved',
      starts_on: '2026-07-22', ends_on: '2026-07-22', hours: 4, out_from: '12:00', out_until: null },
    // pending — must not expand
    { id: 'r3', user_id: 'u1', user_full_name: 'Jie Lao', type: 'vacation', status: 'pending',
      starts_on: '2026-07-28', ends_on: '2026-07-28', hours: 8, out_from: null, out_until: null },
  ];
  const parts = expandRequestsToDays(reqs, 'weekdays', { start: '2026-07-20', end: '2026-07-31' });
  assertEq(parts.length, 3, 'expand: 2 weekday parts + 1 partial, pending excluded');
  assertEq(parts.filter((p) => p.requestId === 'r1').map((p) => p.hours), [10, 10], 'expand: override hours tie out per day');
  assertEq(parts.find((p) => p.requestId === 'r2')?.partial, true, 'expand: partial flagged');

  // weekend-only UPark entry falls back to calendar days with a warning
  const wk = expandRequestsToDays([
    { id: 'r4', user_id: 'u1', user_full_name: 'Jie Lao', type: 'vacation', status: 'approved',
      starts_on: '2026-07-25', ends_on: '2026-07-26', hours: 8, out_from: null, out_until: null },
  ], 'weekdays', { start: '2026-07-20', end: '2026-07-31' });
  assertEq(wk.length, 2, 'expand: weekend-only fallback emits days');
  assertEq(wk[0].warnings.length > 0, true, 'expand: weekend-only fallback warns');
}

// ── parse AoA (title rows + section grouping + subtotal rows) ──
{
  const aoa: unknown[][] = [
    ['UKG Pro — Time Off Detail'],
    ['Period: 07/20/2026 - 07/26/2026'],
    ['Employee Name', 'Work Date', 'Pay Code', 'Hours'],
    ['Lao, Jie', '7/21/2026', 'VAC', 8],
    ['', '7/22/2026', 'VAC', 8],            // section-grouped: name carried forward
    ['Subtotal', '', '', ''],               // no date + no hours → skipped
    ['Martell, Sean', '7/23/2026', 'PTO-X', 8], // unknown paycode
  ];
  const p = parseUkgAoa(aoa);
  assertEq(p.headerRowIndex, 2, 'parse: header found after title rows');
  assertEq(p.missingFields, [], 'parse: required fields all detected');
  assertEq(p.entries.length, 3, 'parse: 3 entries');
  assertEq(p.entries[1].rawName, 'Lao, Jie', 'parse: carry-forward name');
  assertEq(p.unknownPaycodes.map((u) => u.code), ['PTO-X'], 'parse: unknown paycode surfaced');
  assertEq(p.periodStart, '2026-07-21', 'parse: period start');
  assertEq(p.periodEnd, '2026-07-23', 'parse: period end');
}

// ── range-row splitting ──
{
  const entries: UkgEntry[] = [{
    rawName: 'Lao, Jie', nameKeyed: nameKey('Lao, Jie'),
    date: '2026-07-24', endDate: '2026-07-27', hours: 16, paycode: 'VAC',
    ptoType: 'vacation', rowIndex: 3, rowWarnings: [],
  }];
  const split = expandUkgEntriesToDays(entries, 'weekdays');
  assertEq(split.map((e) => [e.date, e.hours]), [['2026-07-24', 8], ['2026-07-27', 8]], 'ukg range row splits under weekdays');
}

// ── full reconcile matrix ──
{
  const roster: RosterEntry[] = [
    { userId: 'u1', fullName: 'Jie Lao' },
    { userId: 'u2', fullName: 'Sean Martell' },
    { userId: 'u3', fullName: 'Mark Donovan' },
  ];
  const requests: ReconRequestInput[] = [
    // matched exactly (Mon–Tue vacation 16h)
    { id: 'a', user_id: 'u1', user_full_name: 'Jie Lao', type: 'vacation', status: 'approved',
      starts_on: '2026-07-20', ends_on: '2026-07-21', hours: 16, out_from: null, out_until: null },
    // in dashboard, missing from UKG (Wed–Thu)
    { id: 'b', user_id: 'u2', user_full_name: 'Sean Martell', type: 'sick', status: 'approved',
      starts_on: '2026-07-22', ends_on: '2026-07-23', hours: 16, out_from: null, out_until: null },
    // hours mismatch on Friday (dash 8 vs ukg 4)
    { id: 'c', user_id: 'u3', user_full_name: 'Mark Donovan', type: 'vacation', status: 'approved',
      starts_on: '2026-07-24', ends_on: '2026-07-24', hours: 8, out_from: null, out_until: null },
    // pending overlap — listed, not compared
    { id: 'd', user_id: 'u1', user_full_name: 'Jie Lao', type: 'vacation', status: 'pending',
      starts_on: '2026-07-24', ends_on: '2026-07-24', hours: 8, out_from: null, out_until: null },
  ];
  const mk = (name: string, date: string, hours: number, paycode = 'VAC'): UkgEntry => ({
    rawName: name, nameKeyed: nameKey(name), date, endDate: null, hours, paycode,
    ptoType: paycode === 'PTO-X' ? null : 'vacation', rowIndex: 0, rowWarnings: [],
  });
  const entries: UkgEntry[] = [
    mk('Lao, Jie', '2026-07-20', 8),
    mk('Lao, Jie', '2026-07-21', 8),
    mk('Donovan, Mark', '2026-07-24', 4),          // hours mismatch
    mk('Piotr Olszewski', '2026-07-21', 8),        // not in roster → unmatched
    mk('Martell, Sean', '2026-07-21', 8, 'PTO-X'), // ukg-only day + unknown code: still a missing_in_dashboard gap
  ];
  const res = reconcile({ entries, requests, roster, rule: 'weekdays' });
  assertEq(res.window, { start: '2026-07-20', end: '2026-07-24' }, 'reconcile: window from report span');
  assertEq(res.matchedDays, 2, 'reconcile: 2 matched days');
  assertEq(res.summary.missingInUkgDays, 2, 'reconcile: Sean Wed+Thu missing in UKG');
  assertEq(res.summary.missingInDashboardDays, 1, 'reconcile: Sean Tue UKG-only');
  assertEq(res.summary.mismatchedDays, 1, 'reconcile: Friday hours mismatch');
  assertEq(res.unmatchedUkgNames.length, 1, 'reconcile: 1 unmatched name');
  assertEq(res.unmatchedUkgNames[0].suggestions.length > 0, false, 'reconcile: no bogus suggestion for unrelated name');
  assertEq(res.pendingOverlaps.map((p) => p.requestId), ['d'], 'reconcile: pending listed not compared');

  // tolerance boundary: within 0.25h counts as matched
  const res2 = reconcile({
    entries: [mk('Lao, Jie', '2026-07-20', 8 - HOURS_TOLERANCE), mk('Lao, Jie', '2026-07-21', 8)],
    requests: [requests[0]], roster, rule: 'weekdays',
  });
  assertEq(res2.summary.mismatchedDays, 0, 'reconcile: delta at tolerance is matched');

  // type mismatch when codes are known and differ
  const res3 = reconcile({
    entries: [{ ...mk('Lao, Jie', '2026-07-20', 8), paycode: 'SICK', ptoType: 'sick' },
              mk('Lao, Jie', '2026-07-21', 8)],
    requests: [requests[0]], roster, rule: 'weekdays',
  });
  assertEq(res3.gaps.filter((g) => g.kind === 'type_mismatch').length, 1, 'reconcile: type mismatch flagged');

  // Binney cutoff clip
  const res4 = reconcile({
    entries: [mk('Lao, Jie', '2026-07-01', 8), mk('Lao, Jie', '2026-07-20', 8), mk('Lao, Jie', '2026-07-21', 8)],
    requests: [requests[0]], roster, rule: 'all_days', cutoff: BINNEY_PTO_CUTOFF,
  });
  assertEq(res4.clippedToCutoff, BINNEY_PTO_CUTOFF, 'reconcile: cutoff reported');
  assertEq(res4.entriesBeforeCutoff, 1, 'reconcile: pre-cutoff entry excluded');
  assertEq(res4.summary.missingInDashboardDays, 0, 'reconcile: pre-cutoff row not a gap');
}

// ── range aggregation across a weekend ──
{
  const roster: RosterEntry[] = [{ userId: 'u2', fullName: 'Sean Martell' }];
  const requests: ReconRequestInput[] = [
    { id: 'b', user_id: 'u2', user_full_name: 'Sean Martell', type: 'sick', status: 'approved',
      starts_on: '2026-07-23', ends_on: '2026-07-28', hours: 32, out_from: null, out_until: null },
  ];
  // UKG has nothing → whole thing is one missing_in_ukg range spanning the weekend
  const entries: UkgEntry[] = [{
    rawName: 'Someone Else', nameKeyed: nameKey('Someone Else'),
    date: '2026-07-23', endDate: null, hours: 8, paycode: 'VAC', ptoType: 'vacation',
    rowIndex: 0, rowWarnings: [],
  }, {
    rawName: 'Someone Else', nameKeyed: nameKey('Someone Else'),
    date: '2026-07-28', endDate: null, hours: 8, paycode: 'VAC', ptoType: 'vacation',
    rowIndex: 1, rowWarnings: [],
  }];
  const res = reconcile({ entries, requests, roster, rule: 'weekdays' });
  const ranges = res.gapRanges.filter((r) => r.kind === 'missing_in_ukg');
  assertEq(ranges.length, 1, 'aggregate: Thu–Tue merges across the weekend under weekdays');
  assertEq([ranges[0].start, ranges[0].end, ranges[0].days], ['2026-07-23', '2026-07-28', 4], 'aggregate: range bounds + counted days');
  assertEq(ranges[0].dashHours, 32, 'aggregate: range hours sum');
}

// direct aggregate check with all_days: Fri + Mon do NOT merge
{
  const gaps = [
    { kind: 'missing_in_ukg' as const, userId: 'u1', name: 'Jie Lao', date: '2026-07-24',
      dashHours: 8, ukgHours: null, dashTypes: ['vacation' as const], ukgTypes: [], ukgPaycodes: [], requestIds: ['x'], partial: false },
    { kind: 'missing_in_ukg' as const, userId: 'u1', name: 'Jie Lao', date: '2026-07-27',
      dashHours: 8, ukgHours: null, dashTypes: ['vacation' as const], ukgTypes: [], ukgPaycodes: [], requestIds: ['x'], partial: false },
  ];
  assertEq(aggregateGapsToRanges(gaps, 'all_days').length, 2, 'aggregate: Fri+Mon separate under all_days');
  assertEq(aggregateGapsToRanges(gaps, 'weekdays').length, 1, 'aggregate: Fri+Mon merge under weekdays');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log('\nAll ukgReconcile assertions passed.');
}
