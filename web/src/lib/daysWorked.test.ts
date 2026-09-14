// Ad-hoc test for daysWorked.ts — no test framework in this repo; run:
//   node --experimental-strip-types web/src/lib/daysWorked.test.ts
// Exit code 0 = all assertions pass. Lives under src/ so `npm run build`
// type-checks it, but vite never bundles it (not on the import graph).
//
// Pins the 2026-09-14 rule: BMR-observed holidays (lib/bmrHolidays) come
// out of the day denominator — Labor Day 2026-09-07 was making every
// crew row read "/5" for a 4-workday week.

declare const process: { exitCode?: number };

import { daysWorkedByName, workdaysInWindow, type PtoDayRow } from './daysWorked.ts';

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

// Trailing-7-day window Mon 2026-09-07 → Mon 2026-09-14 (exclusive).
// 2026-09-07 is Labor Day on the BMR list.
const laborDayWeek = { start: new Date(2026, 8, 7), end: new Date(2026, 8, 14) };
const endOfThatWeek = new Date(2026, 8, 13, 12); // "through yesterday" anchor = Sun

assertEq(workdaysInWindow(laborDayWeek, endOfThatWeek), 4,
  'Labor Day week: 5 weekdays minus the holiday = 4');

// The following week has no holiday → the usual 5.
const plainWeek = { start: new Date(2026, 8, 14), end: new Date(2026, 8, 21) };
assertEq(workdaysInWindow(plainWeek, new Date(2026, 8, 20, 12)), 5,
  'plain week: 5 workdays');

// Cap at end-of-today: anchored on Wed 09-09, only Tue + Wed have happened
// (Mon is the holiday).
assertEq(workdaysInWindow(laborDayWeek, new Date(2026, 8, 9, 12)), 2,
  'capped mid-week: Tue + Wed only, holiday Monday excluded');

// Per-engineer days: PTO on the holiday itself must NOT subtract twice.
const pto: PtoDayRow[] = [
  { user_full_name: 'Alice Holiday', status: 'approved', starts_on: '2026-09-07', ends_on: '2026-09-07', out_from: null, out_until: null },
  { user_full_name: 'Bob Tuesday',   status: 'approved', starts_on: '2026-09-08', ends_on: '2026-09-08', out_from: null, out_until: null },
  { user_full_name: 'Cara Partial',  status: 'approved', starts_on: '2026-09-08', ends_on: '2026-09-08', out_from: '12:00', out_until: null },
  { user_full_name: 'Dan Pending',   status: 'pending',  starts_on: '2026-09-08', ends_on: '2026-09-10', out_from: null, out_until: null },
];
const days = daysWorkedByName(
  ['Alice Holiday', 'Bob Tuesday', 'Cara Partial', 'Dan Pending', 'Eve Nobody'],
  pto, laborDayWeek, endOfThatWeek,
);
assertEq(days.get('Alice Holiday'), 4, 'PTO booked on the holiday: still 4 (no double subtract)');
assertEq(days.get('Bob Tuesday'),   3, 'full-day PTO on a workday: 4 - 1 = 3');
assertEq(days.get('Cara Partial'),  4, 'partial-day PTO still counts as worked: 4');
assertEq(days.get('Dan Pending'),   4, 'pending PTO is ignored: 4');
assertEq(days.get('Eve Nobody'),    4, 'no PTO: full 4');

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('\nall passed');
}
