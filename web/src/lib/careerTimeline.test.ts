// Ad-hoc test for careerTimeline.ts — no test framework in this repo; run:
//   node --experimental-strip-types web/src/lib/careerTimeline.test.ts
// Exit code 0 = all assertions pass. Lives under src/ so `npm run build`
// type-checks it, but vite never bundles it (not on the import graph).

declare const process: { exitCode?: number };

import {
  pmMilestones, anniversaries, certExpiryState, buildCareerTimeline, autoMilestones, levelFromXp, xpForPm,
  type TimelineSources, type TimelineContext,
} from './careerTimeline.ts';

let failures = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

// XP rules mirror migration 0007.
assertEq(xpForPm(0), 10, 'xp floor');
assertEq(xpForPm(30), 50, 'xp cap');
assertEq(xpForPm(2.5), 15, 'xp 2.5h');
assertEq([levelFromXp(0), levelFromXp(99), levelFromXp(100), levelFromXp(400), levelFromXp(900), levelFromXp(99999)], [1, 1, 2, 3, 4, 10], 'levels');

// PM milestones: 50 rows of 2 h (=14 XP each). Level 2 at 100 XP → 8th PM; level 3 at 400 XP → 29th PM.
const pms = Array.from({ length: 50 }, (_, i) => ({ first_seen_at: `2026-0${1 + Math.floor(i / 25)}-${String((i % 25) + 1).padStart(2, '0')}T12:00:00Z`, labor_hours: 2 }));
const pmEv = pmMilestones(pms);
assertEq(pmEv.map((e) => e.id), ['pm:1', 'pmlevel:2', 'pmlevel:3', 'pm:50'], 'pm milestone ids');
assertEq(pmEv.find((e) => e.id === 'pmlevel:2')!.date, '2026-01-08', 'level 2 on the 8th PM');
assertEq(pmEv.find((e) => e.id === 'pmlevel:3')!.date, '2026-02-04', 'level 3 on the 29th PM');
assertEq(pmMilestones(pms, { levelUpsBefore: '2026-01-08' }).map((e) => e.id), ['pm:1', 'pm:50'], 'level-ups suppressed on/after the first stored level row');

// Anniversaries only once the date has passed.
assertEq(anniversaries('2024-03-15', new Date(2026, 2, 14)).map((e) => e.date), ['2025-03-15'], 'day before 2nd anniversary');
assertEq(anniversaries('2024-03-15', new Date(2026, 2, 15)).map((e) => e.date), ['2025-03-15', '2026-03-15'], 'on the 2nd anniversary');
assertEq(anniversaries(null, new Date()), [], 'no hire date');

// Expiry badge thresholds.
const today = new Date(2026, 8, 22);
assertEq(certExpiryState(null, today), 'none', 'no expiry');
assertEq(certExpiryState('2026-09-21', today), 'expired', 'yesterday');
assertEq(certExpiryState('2026-09-22', today), 'soon', 'today (0 days) = soon');
assertEq(certExpiryState('2026-12-20', today), 'soon', '89 days');
assertEq(certExpiryState('2026-12-21', today), 'ok', '90 days');

// Full merge: ordering, week sign-off, certified date, audiences.
const sheet = {
  html: '', title: '', groups: [
    { key: 'wk1', title: 'WEEK 1 — Onboarding', hint: '', week: 1, items: [{ key: 'wk1.a', text: 'a', group: 'wk1', index: 0 }, { key: 'wk1.b', text: 'b', group: 'wk1', index: 1 }] },
    { key: 'wk2', title: 'WEEK 2', hint: '', week: 2, items: [{ key: 'wk2.a', text: 'a', group: 'wk2', index: 2 }] },
  ], items: [], reps: [{ key: 'rep.boiler', label: 'Boiler start', levels: [], target: 3 }], coveWeeks: [], signers: [], fields: [],
};
const src: TimelineSources = {
  hiringDate: '2026-08-03',
  careerEvents: [{ id: 'e1', user_id: 'u', kind: 'title', occurred_on: '2026-09-10', title: 'Title: Lead', detail: null, meta: {}, visibility: 'public', created_by: null, created_at: '2026-09-10T09:00:00Z' },
                 { id: 'e2', user_id: 'u', kind: 'note', occurred_on: '2026-09-10', title: 'private', detail: null, meta: {}, visibility: 'managers', created_by: null, created_at: '2026-09-10T10:00:00Z' }],
  certifications: [{ id: 'c1', name: 'EPA 608', issuer: 'EPA', issued_on: '2026-08-20', expires_on: null }],
  enrollments: [{ program_key: 'upark_l1_plan_b', start_date: '2026-08-10', status: 'completed', created_at: '2026-08-09T00:00:00Z', updated_at: '2026-09-30T00:00:00Z' }],
  checkoffs: [
    { program_key: 'upark_l1_plan_b', item_key: 'wk1.a', done_at: '2026-08-11T15:00:00Z' },
    { program_key: 'upark_l1_plan_b', item_key: 'wk1.b', done_at: '2026-08-13T15:00:00Z' },
    { program_key: 'upark_l1_plan_b', item_key: 'cert.mentor', done_at: '2026-09-20T15:00:00Z' },
  ],
  repLogs: [{ program_key: 'upark_l1_plan_b', rep_key: 'rep.boiler', occurred_on: '2026-08-12' }],
  quizzes: [{ program_key: 'upark_l1_plan_b', doc_key: 'hvac', quiz_title: 'How HVAC Works', score: 14, total: 16, at: '2026-08-12T18:00:00Z' },
            { program_key: 'upark_l1_plan_b', doc_key: 'bms', quiz_title: 'BMS', score: 5, total: 16, at: '2026-08-12T19:00:00Z' }],
  oncall: [{ week_start: '2026-09-04', primary_user_id: 'u', secondary_user_id: null }, { week_start: '2027-01-01', primary_user_id: 'u', secondary_user_id: null }],
  overtime: [{ starts_at: '2026-08-30T22:00:00Z', status: 'completed' }, { starts_at: '2026-09-01T22:00:00Z', status: 'cancelled' }],
  pto: [{ starts_on: '2026-09-14', ends_on: '2026-09-15', days: 2, status: 'approved' }, { starts_on: '2026-09-16', ends_on: '2026-09-16', days: 1, status: 'pending' }],
  accountEvents: [{ event: 'signed_in', created_at: '2026-08-05T12:00:00Z' }, { event: 'signed_in', created_at: '2026-08-04T12:00:00Z' }],
  pms: [],
};
const ctx: TimelineContext = { userId: 'u', sheets: new Map([['upark_l1_plan_b', sheet]]), today };
const tl = buildCareerTimeline(src, ctx);
assertEq(tl.map((e) => e.id), [
  'certified:upark_l1_plan_b', 'pto:2026-09-14:2026-09-15', 'ce:e2', 'ce:e1', 'oncall:2026-09-04', 'ot:2026-08-30T22:00:00Z:0',
  'cert:c1', 'week:upark_l1_plan_b:wk1', 'quiz:upark_l1_plan_b:hvac:2026-08-12T18:00:00Z', 'rep:upark_l1_plan_b:rep.boiler:2026-08-12:0',
  'enroll:upark_l1_plan_b', 'acct:signin', 'hire',
], 'merged order newest first');
assertEq(tl.find((e) => e.id === 'certified:upark_l1_plan_b')!.date, '2026-09-20', 'certified at the mentor signature (no manager one)');
assertEq(tl.find((e) => e.id === 'week:upark_l1_plan_b:wk1')!.date, '2026-08-13', 'week 1 dated at its last item');
assertEq(tl.find((e) => e.id === 'rep:upark_l1_plan_b:rep.boiler:2026-08-12:0')!.title, 'Boiler start', 'rep label from the sheet');
assertEq(tl.find((e) => e.id === 'oncall:2026-09-04')!.title, 'First on-call week (primary)', 'first on-call');
assertEq(tl.find((e) => e.id === 'acct:signin')!.date, '2026-08-04', 'earliest sign-in');
assertEq(tl.filter((e) => e.audience === 'managers').map((e) => e.id), ['ce:e2', 'acct:signin'], 'manager-only rows');
assertEq(tl.filter((e) => e.audience === 'private').map((e) => e.id), ['pto:2026-09-14:2026-09-15'], 'private rows');
assertEq(tl.find((e) => e.id === 'ce:e1')!.editable?.id, 'e1', 'stored rows are editable');

const ms = autoMilestones(src, ctx);
assertEq(ms.map((m) => [m.key, m.earnedOn]), [
  ['certified:upark_l1_plan_b', '2026-09-20'], ['certified:upark_hvac_license_dev', null], ['oncall:first', '2026-09-04'], ['pm:100', null], ['anniv:1', null],
], 'auto milestones');

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('\nall passed');
}
