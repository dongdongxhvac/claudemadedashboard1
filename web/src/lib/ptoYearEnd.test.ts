// Ad-hoc test for ptoYearEnd.ts — no test framework in this repo; run:
//   node --experimental-strip-types web/src/lib/ptoYearEnd.test.ts
// Exit code 0 = all assertions pass.
declare const process: { exitCode?: number };

let failed = 0;
const assert = {
  deepEqual(actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { failed++; console.error(`FAIL: got ${a}, expected ${e}`); }
  },
  equal(actual: unknown, expected: unknown) { this.deepEqual(actual, expected); },
};
import { cbaAllotment, sickCloseoutPreview, vacationCloseoutPreview } from './ptoYearEnd.ts';

const pick = (h: string | null, y: number, d: number, prev?: number) => {
  const a = cbaAllotment(h, y, d, prev);
  return a && { vacation: a.vacation, sick: a.sick, holiday: a.holiday };
};

// Service measured on Jan 1 of the target year.
// 60-day probation; the year it ends is pro-rated by days left.
assert.deepEqual(pick('2026-11-01', 2027, 8), { vacation: 80, sick: 0, holiday: 8 });   // probation ended 12/31/26 → full 2027
assert.deepEqual(pick('2026-12-15', 2027, 8), { vacation: 71, sick: 0, holiday: 8 });   // ends 2/13/27 → 80 × 322/365
assert.deepEqual(pick('2027-11-15', 2027, 8), { vacation: 0, sick: 0, holiday: 8 });    // still in probation all of 2027
assert.equal(pick('2026-05-01', 2026, 8)!.vacation, 41);                                // ends 6/30/26 → 80 × 185/365
assert.equal(pick('2026-01-01', 2026, 8)!.vacation, 67);                                // ends 3/2/26 → 80 × 305/365
assert.deepEqual(pick('2026-07-01', 2027, 8), { vacation: 80, sick: 24, holiday: 8 });  // 6 mo, probation done in 2026
assert.deepEqual(pick('2026-03-15', 2027, 10), { vacation: 80, sick: 40, holiday: 10 }); // 9 mo
assert.equal(pick('2024-01-02', 2027, 8)!.vacation, 80);   // just under 3 yrs
assert.equal(pick('2024-01-01', 2027, 8)!.vacation, 120);  // 3 yrs
assert.equal(pick('2019-01-01', 2027, 8)!.vacation, 160);  // 8 yrs
assert.equal(pick('2009-01-01', 2027, 8)!.vacation, 200);  // 18 yrs
assert.deepEqual(pick('2020-05-01', 2027, 8, 16), { vacation: 120, sick: 64, holiday: 16 });
assert.equal(pick('2020-05-01', 2027, 8, 0)!.holiday, 0);  // 0 last year stays 0
assert.equal(cbaAllotment(null, 2027, 8), null);

assert.deepEqual(sickCloseoutPreview(40, 8), { cap: 16, carry: 16, payout: 24 });
assert.deepEqual(sickCloseoutPreview(10, 10), { cap: 20, carry: 10, payout: 0 });
assert.deepEqual(sickCloseoutPreview(-8, 8), { cap: 16, carry: -8, payout: 0 });
assert.deepEqual(vacationCloseoutPreview(-12, 'carry', null), { carry: -12, forfeit: 0 });
assert.deepEqual(vacationCloseoutPreview(30, 'lose', null), { carry: 0, forfeit: 30 });
assert.deepEqual(vacationCloseoutPreview(30, 'custom', 16), { carry: 16, forfeit: 14 });

if (failed) process.exitCode = 1;
else console.log('ptoYearEnd: all assertions pass');
