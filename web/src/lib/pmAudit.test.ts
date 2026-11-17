// Ad-hoc test for pmAudit.ts — no test framework; run:
//   node --experimental-strip-types web/src/lib/pmAudit.test.ts

declare const process: { exitCode?: number };

import {
  addDays, weekLabel, weeksEnding, fmtHours, shortName, fmtClosed, coveTaskUrl, flagChip, joinQueue, filterQueue, nextOpen,
  weekStats, ratesOf, buildScorecard, buildTimeline, noteSourceLabel,
  type FlagRow, type QueueEntry, type Review, type ScoreClose, type ScoreRow,
} from './pmAudit.ts';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${name}\n   got  ${g}\n   want ${w}`); }
}

const base: FlagRow = {
  task_no: 'PM-A-1', site_code: 'upark', building_code: '40LS', equipment: 'CT-1', task_name: 'Cooling Tower Annual PM',
  assigned_to_name: 'Austin Myette', completed_on: '2026-11-12T18:36:37.452+00:00', week_start: '2026-11-09', pm_type: 'Major',
  labor_hours: 0.0833, est_labor_hours: 1, tech_week_hours: 28, has_details: true, cove_task_id: 'abc',
  started_at: '2026-11-12T18:35:50Z', completed_at: '2026-11-12T18:36:37Z', close_note: 'ok', note_count: 1, note_chars: 2,
  note_boilerplate: true, steps_total: 6, steps_checked: 4, photo_count: 0, attachment_count: 0, min_photos: 3,
  min_note_chars: 40, note_must_match: null, closes_within_5m: 4,
  flags: ['low_photos', 'steps_incomplete', 'thin_note', 'desk_close', 'low_labor', 'batch_close'], flag_count: 6,
};
const row = (over: Partial<FlagRow>): FlagRow => ({ ...base, ...over });

// dates
eq('addDays across month', addDays('2026-10-27', 7), '2026-11-03');
eq('weekLabel same month', weekLabel('2026-11-09'), 'Nov 9 – 15');
eq('weekLabel across month', weekLabel('2026-10-26'), 'Oct 26 – Nov 1');
eq('weeksEnding', weeksEnding('2026-11-09', 3), ['2026-10-26', '2026-11-02', '2026-11-09']);
eq('fmtClosed is Eastern', fmtClosed('2026-11-12T18:36:37.452+00:00'), 'Thu 1:36 PM');

// formatters
eq('fmtHours', [fmtHours(0.0833), fmtHours(0.5), fmtHours(1), fmtHours(6.3333), fmtHours(null)], ['0.08', '0.5', '1.0', '6.33', '—']);
eq('shortName', [shortName('Justin Mcgaffigan'), shortName('Cher'), shortName(null)], ['Justin M.', 'Cher', '—']);
eq('cove url', coveTaskUrl('binney', 'gfWILxU0Wx'), 'https://manage.cove.is/networks/moBABfC2ZR/pm-tasks/gfWILxU0Wx?tab=task_steps');
eq('cove url without id', coveTaskUrl('upark', null), 'https://manage.cove.is/networks/OoxMP8BZJF/pm-tasks');

// chips
eq('no photos is red', flagChip('low_photos', base), { key: 'low_photos', label: 'No photos 0 / 3', tone: 'red' });
eq('some photos is orange', flagChip('low_photos', row({ photo_count: 1 })), { key: 'low_photos', label: 'Low photos 1 / 3', tone: 'orange' });
eq('steps chip', flagChip('steps_incomplete', base).label, 'Steps 4 / 6');
eq('boilerplate chip', flagChip('thin_note', base).label, 'Boilerplate note');
eq('thin chip', flagChip('thin_note', row({ note_boilerplate: false, note_chars: 33 })).label, 'Thin note 33 / 40');
eq('desk close chip', flagChip('desk_close', base), { key: 'desk_close', label: 'Desk close · under 1 min', tone: 'red' });
eq('low labor chip', flagChip('low_labor', base).label, 'Low labor 8%');
eq('batch chip', flagChip('batch_close', base).label, 'Batch close · 5 in 5 min');
eq('chip without a row', flagChip('low_labor', null).label, 'Low labor');

// queue
const entries: QueueEntry[] = [
  { week_start: '2026-11-09', task_no: 'PM-A-1', site_code: 'upark', reason: 'flagged', flags: ['low_labor'] },
  { week_start: '2026-11-09', task_no: 'PM-A-2', site_code: 'upark', reason: 'random', flags: [] },
  { week_start: '2026-11-09', task_no: 'PM-A-3', site_code: 'upark', reason: 'flagged', flags: ['low_labor'] },
  { week_start: '2026-11-09', task_no: 'PM-A-4', site_code: 'upark', reason: 'flagged', flags: ['low_labor'] },
];
const flags: FlagRow[] = [
  row({ task_no: 'PM-A-1', assigned_to_name: 'Zed', flags: ['low_labor'] }),
  row({ task_no: 'PM-A-1', assigned_to_name: 'Zed', completed_on: '2026-11-13T10:00:00+00:00', flags: ['low_photos'] }),
  row({ task_no: 'PM-A-2', assigned_to_name: 'Amy', flags: [] }),
  row({ task_no: 'PM-A-3', assigned_to_name: 'Amy', flags: ['low_labor'] }),
];
const reviews: Review[] = [{ id: 'r1', week_start: '2026-11-09', task_no: 'PM-A-3', reviewer_id: 'u', verdict: 'pass', reason_tags: [], note: null, reviewed_at: null }];
const q = joinQueue(entries, flags, reviews);
eq('order: open first, flagged before random, tech, then reviewed', q.map((r) => r.task_no), ['PM-A-4', 'PM-A-1', 'PM-A-2', 'PM-A-3']);
eq('later close wins + live flags', q.find((r) => r.task_no === 'PM-A-1')!.flags, ['low_photos']);
eq('missing flags row keeps the frozen flags', q.find((r) => r.task_no === 'PM-A-4')!.flags, ['low_labor']);
eq('pill open', filterQueue(q, { pill: 'open', tech: '', flag: '' }).map((r) => r.task_no), ['PM-A-4', 'PM-A-1', 'PM-A-2']);
eq('pill random', filterQueue(q, { pill: 'random', tech: '', flag: '' }).map((r) => r.task_no), ['PM-A-2']);
eq('tech + flag', filterQueue(q, { pill: 'all', tech: 'Zed', flag: 'low_photos' }).map((r) => r.task_no), ['PM-A-1']);
eq('next open below', nextOpen(q, 'PM-A-1')?.task_no, 'PM-A-2');
eq('next open wraps', nextOpen(q, 'PM-A-2')?.task_no, 'PM-A-4');
eq('next open none', nextOpen(q.filter((r) => r.task_no === 'PM-A-3'), 'PM-A-3'), null);

// week tiles
eq('week stats', weekStats([
  { task_no: 'a', site_code: 'upark', assigned_to_name: 'A', has_details: true, min_photos: 1, photo_count: 1 },
  { task_no: 'b', site_code: 'binney', assigned_to_name: 'B', has_details: true, min_photos: 3, photo_count: 1 },
  { task_no: 'c', site_code: 'binney', assigned_to_name: 'B', has_details: true, min_photos: 0, photo_count: 0 },
  { task_no: 'd', site_code: 'binney', assigned_to_name: null, has_details: false, min_photos: 1, photo_count: null },
]), { closed: 4, bySite: { upark: 1, binney: 3 }, techs: 2, withDetails: 3, photoRate: 50 });
eq('photo rate is null with no details', weekStats([{ task_no: 'd', site_code: 'upark', assigned_to_name: 'A', has_details: false, min_photos: 1, photo_count: null }]).photoRate, null);

// scorecard
const sc = (over: Partial<ScoreClose>): ScoreClose => ({
  task_no: 't', site_code: 'upark', assigned_to_name: 'A', week_start: '2026-11-09', pm_type: 'Minor', has_details: true,
  min_photos: 1, photo_count: 1, steps_total: 2, steps_checked: 2, flags: [], flag_count: 0, f_thin_note: false, ...over,
});
const closes: ScoreClose[] = [
  sc({}),
  sc({ photo_count: 0, flags: ['low_photos'], flag_count: 1 }),
  sc({ week_start: '2026-11-02', steps_checked: 1, f_thin_note: true, flags: ['steps_incomplete', 'thin_note'], flag_count: 2 }),
  sc({ assigned_to_name: 'B', pm_type: 'Major', min_photos: 3, photo_count: 3 }),
  sc({ assigned_to_name: 'B', has_details: false, photo_count: null, steps_total: null, steps_checked: null }),
  sc({ week_start: '2026-08-03' }),
];
eq('rates', ratesOf(closes.slice(0, 3)), { closed: 3, withDetails: 3, flagged: 2, photoRate: 67, stepsRate: 67, noteRate: 67, flagRate: 67 });
const view = (over: Partial<ScoreRow>): ScoreRow => ({
  site_code: 'upark', tech: 'A', week_start: '2026-11-09', closed: 2, with_details: 2, flagged: 1, photo_rate_pct: 50,
  steps_rate_pct: 100, note_rate_pct: 100, week_hours: 30, reviewed: 2, pass: 1, coach: 1, fail: 0, pass_rate_pct: 50, top_flag: 'low_photos', ...over,
});
const card = buildScorecard(
  [view({}), view({ week_start: '2026-11-02', closed: 1, with_details: 1, photo_rate_pct: 100, week_hours: 20, reviewed: 0, pass: 0, coach: 0 })],
  closes, ['2026-11-02', '2026-11-09'], ['2026-10-26', '2026-11-02', '2026-11-09'],
);
eq('window drops old weeks', card.team.closed, 5);
eq('team reviewed / pass', [card.team.reviewed, card.team.passRate], [2, 50]);
eq('tech order + numbers', card.techs.map((t) => [t.tech, t.closed, t.photoRate, t.weekHours, t.topFlag]), [['A', 3, 67, 25, 'low_photos'], ['B', 2, 100, null, null]]);
eq('spark', card.techs[0].spark, [null, 100, 50]);
eq('flags by reason', card.flagsByReason.filter((f) => f.count > 0), [{ flag: 'low_photos', count: 1 }, { flag: 'steps_incomplete', count: 1 }, { flag: 'thin_note', count: 1 }]);
eq('photo by type', card.photoByType.map((p) => [p.pmType, p.minPhotos, p.rate]), [['Major', 3, 100], ['Filter Swap', 0, null], ['Minor', 1, 67], ['Test/Record', 0, null]]);

// timeline
const tl = buildTimeline([
  { id: '4', eventType: 'status_changed', createdAt: '2026-11-13T21:52:10Z', status: 'completed', invokedBy: { firstName: 'Justin', lastName: 'Mcgaffigan' } },
  { id: '1', eventType: 'opened', createdAt: '2026-10-01T23:00:00Z' },
  { id: '2', eventType: 'attachment_added', createdAt: '2026-11-13T21:50:00Z', attachments: [{ name: 'a.jpg' }, { name: 'b.pdf' }] },
  { id: '3', eventType: 'status_changed', createdAt: '2026-11-13T21:50:40Z', status: 'in_progress' },
  { id: '5', eventType: 'labor_item_added', createdAt: '2026-11-13T21:52:00Z', laborItem: { hours: 0.75 } },
], '2026-12-31');
eq('timeline order + words', tl.map((t) => `${t.strong ?? ''}${t.text}`), [
  'Opened · due Dec 31', '1 photo + 1 file added', 'Started (in progress)', 'Labor 0.75 h logged', 'Completed · 2 min after start · Justin M.',
]);
eq('quick close pair is toned', tl.map((t) => t.tone), ['plain', 'photo', 'warn', 'plain', 'warn']);
eq('note sources', [noteSourceLabel('note_added'), noteSourceLabel('completed'), noteSourceLabel('step:Important Notes')], ['Note', 'Close box', 'Step · Important Notes']);

if (failures) { console.error(`${failures} failed`); process.exitCode = 1; } else console.log('all passed');
