// Ad-hoc test for the DOM-free parts of trainingBoard.ts — no test framework; run:
//   node --experimental-strip-types web/src/lib/trainingBoard.test.ts
// (parseTrainingBoard needs DOMParser and is exercised in the browser harness.)

declare const process: { exitCode?: number };

import {
  currentOf, itemProgress, boardProgress, weekLog, inviteText, weekOfDate,
  type TrainingBoardDef, type BoardRow,
} from './trainingBoard.ts';

let failures = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

const def: TrainingBoardDef = {
  title: 'New-Hire 8-Week Board', total: 5,
  sections: [
    { num: 1, key: 'cove', title: 'COVE', total: 3, items: [
      { num: 1, key: 'week_hours', text: 'Week at ≥35 h in COVE — write hours', hint: null, section: 'cove', control: { kind: 'hours8' } },
      { num: 2, key: 'week_summary', text: 'Week — activity summary logged', hint: null, section: 'cove', control: { kind: 'weeks8' } },
      { num: 3, key: 'pm_closed', text: 'PM closed with update', hint: null, section: 'cove', control: { kind: 'count', n: 3 } },
    ] },
    { num: 3, key: 'overview', title: 'Overview + quiz', total: 2, items: [
      { num: 10, key: 'hvac', text: 'HVAC', hint: null, section: 'overview', control: { kind: 'note', box: true } },
      { num: 11, key: 'plumbing', text: 'Plumbing', hint: null, section: 'overview', control: { kind: 'note', box: true } },
    ] },
  ],
  items: [], logColumns: [], tallies: [{ label: 'COVE', hours: true, section: 'cove' }, { label: 'Overview', hours: false, section: 'overview' }],
  firstMeeting: [], inviteFields: ['Title', 'When', 'Focus', 'To do', 'Review with Jie', 'Done'], reportLines: [], signers: [],
};
def.items = def.sections.flatMap((s) => s.items);
const row = (item_key: string, week: number, status: BoardRow['status'], note: string | null = null, value: Record<string, unknown> = {}): BoardRow =>
  ({ user_id: 'u', program_key: 'p', item_key, week, status, note, value, entered_on: '2026-10-01', updated_by: null, updated_at: '' });

const rows: BoardRow[] = [
  row('week_hours', 1, null, null, { hours: 38 }),
  row('week_hours', 2, null, null, { hours: 40 }),
  row('week_summary', 1, 'done'), row('week_summary', 2, 'done'),
  row('pm_closed', 2, null, null, { n: 2 }),
  row('hvac', 1, 'more_work', 'missed low static switch'),
  row('hvac', 2, 'done', 'retest ok'),
  row('plumbing', 2, 'next_week'),
];

// current state carries the last non-null status / note forward
assertEq(currentOf(rows, 'hvac').status, 'done', 'hvac latest status');
assertEq(currentOf(rows, 'hvac').statusWeek, 2, 'hvac status week');
assertEq(currentOf(rows, 'hvac').note, 'retest ok', 'hvac latest note');
assertEq(currentOf(rows, 'pm_closed').value, { n: 2 }, 'count value');
assertEq(currentOf(rows, 'nothing').status, null, 'unknown item');

// per-item progress
assertEq(itemProgress(def.items[0], rows), 2 / 8, 'hours: 2 of 8 weeks');
assertEq(itemProgress(def.items[1], rows), 2 / 8, 'week boxes: 2 of 8');
assertEq(itemProgress(def.items[2], rows), 2 / 3, 'count 2 of 3');
assertEq(itemProgress(def.items[3], rows), 1, 'done = 1');
assertEq(itemProgress(def.items[4], rows), 0, 'next week = 0');

// board progress: explicit done, or all 8 weeks for the per-week controls
const allWeeks = [1,2,3,4,5,6,7,8].map((w) => row('week_summary', w, 'done'));
assertEq(boardProgress(def, [...rows, ...allWeeks]).done, 2, '8 week ticks = item 2 done');
const p = boardProgress(def, rows);
assertEq([p.done, p.total, p.pct, p.moreWork, p.nextWeek], [1, 5, 20, 0, 1], 'totals (week ticks do not make item 2 done)');
assertEq(p.sections.get('cove'), { done: 0, total: 3 }, 'cove section');
assertEq(p.sections.get('overview'), { done: 1, total: 2 }, 'overview section');

// weekly log rows
const w1 = weekLog(def, rows, 1, [{ week: 1, title: 'How HVAC Works', score: 15, total: 16 }]);
assertEq(w1.tallies, [{ label: 'COVE', value: '38 h' }, { label: 'Overview', value: '' }], 'W1 tallies');
assertEq(w1.review, ['10 HVAC — missed low static switch', 'quiz passed: How HVAC Works 15/16'], 'W1 review');
assertEq(w1.done, ['2 Week — activity summary logged'], 'W1 done lists the week tick');
const w2 = weekLog(def, rows, 2);
assertEq(w2.tallies, [{ label: 'COVE', value: '40 h' }, { label: 'Overview', value: '1' }], 'W2 tallies');
assertEq(w2.done, ['2 Week — activity summary logged', '10 HVAC'], 'W2 done');
assertEq(w2.focus, ['11 Plumbing'], 'W2 focus');
assertEq(w2.review, ['10 HVAC — retest ok'], 'W2 review');

// invite body
const inv = inviteText(def, rows, 2, 'Evan');
assertEq(inv.split('\n')[0], 'Title: 8-Week Review · W2 · Evan', 'invite title');
assertEq(inv.includes('Focus:\n  • 11 Plumbing') || inv.includes('Focus: 11 Plumbing'), true, 'invite focus');
assertEq(inv.includes('• 10 HVAC — retest ok'), true, 'invite review');
assertEq(inv.includes('Done: 1 / 5 on the board'), true, 'invite done');
const inv1 = inviteText(def, [...rows, row('meta.invite', 1, null, null, { when: 'Fri 2pm', title: 'Kickoff' })], 1, 'Evan');
assertEq(inv1.startsWith('Title: Kickoff\n\nWhen: Fri 2pm'), true, 'invite meta');

// week of a timestamp
assertEq(weekOfDate('2026-10-01T12:00:00Z', '2026-09-28'), 1, 'week 1');
assertEq(weekOfDate('2026-10-05T12:00:00Z', '2026-09-28'), 2, 'week 2');
assertEq(weekOfDate('2026-09-01T12:00:00Z', '2026-09-28'), 0, 'before start');
assertEq(weekOfDate('2026-12-30T12:00:00Z', '2026-09-28'), 9, 'after week 8');

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log('\nall passed');
}
