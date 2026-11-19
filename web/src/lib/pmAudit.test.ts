// Ad-hoc test for pmAudit.ts — no test framework; run:
//   node --experimental-strip-types web/src/lib/pmAudit.test.ts

declare const process: { exitCode?: number };

import {
  addDays, weekLabel, weeksEnding, fmtHours, shortName, fmtClosed, coveTaskUrl, flagChip, goodChip, rowChips, joinQueue, filterQueue, nextOpen,
  weekStats, ratesOf, buildScorecard, buildTimeline, noteSourceLabel, parsePill, weekStartOf, bucketOf, buildWeekTime, fmtH,
  type FlagRow, type QueueEntry, type Review, type ScoreClose, type ScoreRow, type LaborItem,
} from './pmAudit.ts';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${name}\n   got  ${g}\n   want ${w}`); }
}

// A bad one: no photo, a boilerplate note, steps left unchecked.
const base: FlagRow = {
  task_no: 'PM-A-1', site_code: 'upark', building_code: '40LS', equipment: 'CT-1', task_name: 'Cooling Tower Annual PM',
  assigned_to_name: 'Austin Myette', completed_on: '2026-11-12T18:36:37.452+00:00', week_start: '2026-11-09', pm_type: 'Major',
  labor_hours: 0.0833, est_labor_hours: 1, tech_week_hours: 28, has_details: true, cove_task_id: 'abc',
  started_at: '2026-11-12T18:35:50Z', completed_at: '2026-11-12T18:36:37Z', close_note: 'ok', note_count: 1, note_chars: 2,
  note_boilerplate: true, steps_total: 6, steps_checked: 4, photo_count: 0, attachment_count: 0, min_photos: 3,
  min_note_chars: 40, note_must_match: null, closes_within_5m: 4,
  has_photo: false, note_thick: false, note_thin: true, steps_open: true,
  flags: ['no_photos', 'steps_unexplained', 'low_labor', 'batch_close'], flag_count: 4, good: false,
};
const row = (over: Partial<FlagRow>): FlagRow => ({ ...base, ...over });
// The manager's model good PM (PM-UNP-23356): no photos, 7 of 8 steps, a 499-character note.
const model = row({
  task_no: 'PM-UNP-23356', photo_count: 0, steps_total: 8, steps_checked: 7, note_chars: 499, note_boilerplate: false,
  has_photo: false, note_thick: true, note_thin: false, steps_open: true, flags: [], flag_count: 0, good: true,
});

// dates
eq('addDays across month', addDays('2026-10-27', 7), '2026-11-03');
eq('weekLabel same month', weekLabel('2026-11-09'), 'Nov 9 – 15');
eq('weekLabel across month', weekLabel('2026-10-26'), 'Oct 26 – Nov 1');
eq('weeksEnding', weeksEnding('2026-11-09', 3), ['2026-10-26', '2026-11-02', '2026-11-09']);
eq('weekStartOf: midweek', weekStartOf('2026-11-12T18:36:37Z'), '2026-11-09');
eq('weekStartOf: Sunday night Eastern is still the old week', weekStartOf('2026-11-16T03:30:00Z'), '2026-11-09');
eq('weekStartOf: Monday morning Eastern', weekStartOf('2026-11-16T13:00:00Z'), '2026-11-16');
eq('fmtClosed is Eastern', fmtClosed('2026-11-12T18:36:37.452+00:00'), 'Thu 1:36 PM');

// formatters
eq('fmtHours', [fmtHours(0.0833), fmtHours(0.5), fmtHours(1), fmtHours(6.3333), fmtHours(null)], ['0.08', '0.5', '1.0', '6.33', '—']);
eq('shortName', [shortName('Justin Mcgaffigan'), shortName('Cher'), shortName(null)], ['Justin M.', 'Cher', '—']);
eq('cove url', coveTaskUrl('binney', 'gfWILxU0Wx'), 'https://manage.cove.is/networks/moBABfC2ZR/pm-tasks/gfWILxU0Wx?tab=task_steps');
eq('cove url without id', coveTaskUrl('upark', null), 'https://manage.cove.is/networks/OoxMP8BZJF/pm-tasks');

// chips
eq('no photos is red', flagChip('no_photos', base), { key: 'no_photos', label: 'No photos', tone: 'red' });
eq('steps chip', flagChip('steps_unexplained', base), { key: 'steps_unexplained', label: 'Steps 4 / 6 · no explanation', tone: 'orange' });
eq('low labor chip', flagChip('low_labor', base).label, 'Low labor 8%');
eq('batch chip', flagChip('batch_close', base).label, 'Batch close · 5 in 5 min');
eq('chip without a row', flagChip('low_labor', null).label, 'Low labor');
eq('good chip: thick note only', goodChip(model), { key: 'good', label: 'Good PM · 499-char note', tone: 'green' });
eq('good chip: photos + note', goodChip(row({ good: true, has_photo: true, photo_count: 3, note_thick: true, note_chars: 120 }))?.label, 'Good PM · 3 photos + 120-char note');
eq('good chip: one photo', goodChip(row({ good: true, has_photo: true, photo_count: 1 }))?.label, 'Good PM · 1 photo');
eq('no good chip on a flagged close', goodChip(base), null);

// queue
const entries: QueueEntry[] = [
  { week_start: '2026-11-09', task_no: 'PM-A-1', site_code: 'upark', reason: 'flagged', flags: ['low_labor'] },
  { week_start: '2026-11-09', task_no: 'PM-A-2', site_code: 'upark', reason: 'random', flags: [] },
  { week_start: '2026-11-09', task_no: 'PM-A-3', site_code: 'upark', reason: 'flagged', flags: ['low_labor'] },
  { week_start: '2026-11-09', task_no: 'PM-A-4', site_code: 'upark', reason: 'flagged', flags: ['low_labor', 'desk_close'] },
  { week_start: '2026-11-09', task_no: 'PM-UNP-23356', site_code: 'upark', reason: 'good', flags: [] },
];
const flags: FlagRow[] = [
  row({ task_no: 'PM-A-1', assigned_to_name: 'Zed', flags: ['low_labor'] }),
  row({ task_no: 'PM-A-1', assigned_to_name: 'Zed', completed_on: '2026-11-13T10:00:00+00:00', flags: ['no_photos'] }),
  row({ task_no: 'PM-A-2', assigned_to_name: 'Amy', flags: [], flag_count: 0 }),
  row({ task_no: 'PM-A-3', assigned_to_name: 'Amy', flags: ['low_labor'] }),
  model,
];
const reviews: Review[] = [{ id: 'r1', week_start: '2026-11-09', task_no: 'PM-A-3', reviewer_id: 'u', verdict: 'pass', reason_tags: [], note: null, reviewed_at: null }];
const q = joinQueue(entries, flags, reviews);
eq('order: open first; flagged, good, random; tech; then reviewed', q.map((r) => r.task_no), ['PM-A-4', 'PM-A-1', 'PM-UNP-23356', 'PM-A-2', 'PM-A-3']);
eq('later close wins + live flags', q.find((r) => r.task_no === 'PM-A-1')!.flags, ['no_photos']);
eq('frozen flags from before the rule change are dropped', q.find((r) => r.task_no === 'PM-A-4')!.flags, ['low_labor']);
eq('good row chips', rowChips(q.find((r) => r.task_no === 'PM-UNP-23356')!).map((c) => c.label), ['Good PM · 499-char note']);
eq('random row chips', rowChips(q.find((r) => r.task_no === 'PM-A-2')!).map((c) => c.label), ['Random sample']);
eq('queued as good, no longer good', rowChips({ ...q[2], f: row({ good: false, flags: [] }), flags: [] }).map((c) => c.label), ['Queued as good']);
eq('pill open', filterQueue(q, { pill: 'open', tech: '', flag: '' }).map((r) => r.task_no), ['PM-A-4', 'PM-A-1', 'PM-UNP-23356', 'PM-A-2']);
eq('pill good', filterQueue(q, { pill: 'good', tech: '', flag: '' }).map((r) => r.task_no), ['PM-UNP-23356']);
eq('pill random', filterQueue(q, { pill: 'random', tech: '', flag: '' }).map((r) => r.task_no), ['PM-A-2']);
eq('tech + flag', filterQueue(q, { pill: 'all', tech: 'Zed', flag: 'no_photos' }).map((r) => r.task_no), ['PM-A-1']);
eq('parsePill', [parsePill('good'), parsePill('nope'), parsePill(null)], ['good', 'all', 'all']);
eq('next open below', nextOpen(q, 'PM-A-1')?.task_no, 'PM-UNP-23356');
eq('next open wraps', nextOpen(q, 'PM-A-2')?.task_no, 'PM-A-4');
eq('next open none', nextOpen(q.filter((r) => r.task_no === 'PM-A-3'), 'PM-A-3'), null);

// week tiles
eq('week stats', weekStats([
  { task_no: 'a', site_code: 'upark', assigned_to_name: 'A', has_details: true, min_photos: 1, has_photo: true, good: true },
  { task_no: 'b', site_code: 'binney', assigned_to_name: 'B', has_details: true, min_photos: 3, has_photo: false, good: false },
  { task_no: 'c', site_code: 'binney', assigned_to_name: 'B', has_details: true, min_photos: 0, has_photo: false, good: false },
  { task_no: 'd', site_code: 'binney', assigned_to_name: null, has_details: false, min_photos: 1, has_photo: null, good: null },
]), { closed: 4, bySite: { upark: 1, binney: 3 }, techs: 2, withDetails: 3, good: 1, photoRate: 50 });
eq('photo rate is null with no details', weekStats([{ task_no: 'd', site_code: 'upark', assigned_to_name: 'A', has_details: false, min_photos: 1, has_photo: null, good: null }]).photoRate, null);

// scorecard
const sc = (over: Partial<ScoreClose>): ScoreClose => ({
  task_no: 't', site_code: 'upark', assigned_to_name: 'A', week_start: '2026-11-09', pm_type: 'Minor', has_details: true,
  min_photos: 1, has_photo: true, steps_total: 2, steps_checked: 2, note_thin: false, flags: [], flag_count: 0, good: true, ...over,
});
const closes: ScoreClose[] = [
  sc({}),
  sc({ has_photo: false, flags: ['no_photos'], flag_count: 1, good: false }),
  sc({ week_start: '2026-11-02', steps_checked: 1, note_thin: true, flags: ['steps_unexplained'], flag_count: 1, good: false }),
  sc({ assigned_to_name: 'B', pm_type: 'Major', min_photos: 3, has_photo: true }),
  sc({ assigned_to_name: 'B', has_details: false, has_photo: null, steps_total: null, steps_checked: null, note_thin: null, good: null }),
  sc({ week_start: '2026-08-03' }),
];
eq('rates', ratesOf(closes.slice(0, 3)), { closed: 3, withDetails: 3, flagged: 2, good: 1, photoRate: 67, stepsRate: 67, noteRate: 67, flagRate: 67, goodRate: 33 });
const view = (over: Partial<ScoreRow>): ScoreRow => ({
  site_code: 'upark', tech: 'A', week_start: '2026-11-09', closed: 2, with_details: 2, flagged: 1, good: 1, photo_rate_pct: 50,
  steps_rate_pct: 100, note_rate_pct: 100, week_hours: 30, reviewed: 2, pass: 1, coach: 1, fail: 0, pass_rate_pct: 50, top_flag: 'no_photos', ...over,
});
const card = buildScorecard(
  [view({}), view({ week_start: '2026-11-02', closed: 1, with_details: 1, good: 0, photo_rate_pct: 100, week_hours: 20, reviewed: 0, pass: 0, coach: 0 })],
  closes, ['2026-11-02', '2026-11-09'], ['2026-10-26', '2026-11-02', '2026-11-09'],
);
eq('window drops old weeks', card.team.closed, 5);
eq('team reviewed / pass / good', [card.team.reviewed, card.team.passRate, card.team.good], [2, 50, 2]);
eq('tech order + numbers', card.techs.map((t) => [t.tech, t.closed, t.photoRate, t.good, t.weekHours, t.topFlag]), [['A', 3, 67, 1, 25, 'no_photos'], ['B', 2, 100, 1, null, null]]);
eq('spark', card.techs[0].spark, [null, 100, 50]);
eq('flags by reason', card.flagsByReason.filter((f) => f.count > 0), [{ flag: 'no_photos', count: 1 }, { flag: 'steps_unexplained', count: 1 }]);
eq('photo by type', card.photoByType.map((p) => [p.pmType, p.expects, p.rate]), [['Major', true, 100], ['Filter Swap', false, null], ['Minor', true, 67], ['Test/Record', false, null]]);

// timeline — start/complete are shown plainly (nobody runs the timer)
const tl = buildTimeline([
  { id: '4', eventType: 'status_changed', createdAt: '2026-11-13T21:52:10Z', status: 'completed', invokedBy: { firstName: 'Justin', lastName: 'Mcgaffigan' } },
  { id: '1', eventType: 'opened', createdAt: '2026-10-01T23:00:00Z' },
  { id: '2', eventType: 'attachment_added', createdAt: '2026-11-13T21:50:00Z', attachments: [{ name: 'a.jpg' }, { name: 'b.pdf' }] },
  { id: '3', eventType: 'status_changed', createdAt: '2026-11-13T21:50:40Z', status: 'in_progress' },
  { id: '5', eventType: 'labor_item_added', createdAt: '2026-11-13T21:52:00Z', laborItem: { hours: 0.75 } },
], '2026-12-31');
eq('timeline order + words', tl.map((t) => `${t.strong ?? ''}${t.text}`), [
  'Opened · due Dec 31', '1 photo + 1 file added', 'Started (in progress)', 'Labor 0.75 h logged', 'Completed · Justin M.',
]);
eq('timeline tones', tl.map((t) => t.tone), ['plain', 'photo', 'plain', 'plain', 'plain']);
eq('note sources', [noteSourceLabel('note_added'), noteSourceLabel('completed'), noteSourceLabel('step:Important Notes')], ['Note', 'Close box', 'Step · Important Notes']);

// how the week was spent
eq('bucketOf folds the small kinds', ['pm', 'rounds', 'bms', 'work_order', 'escort', 'meeting', 'unscheduled', 'on_demand', 'new'].map(bucketOf),
  ['pm', 'rounds', 'bms', 'work_order', 'other', 'other', 'on_demand', 'on_demand', 'on_demand']);
const li = (over: Partial<LaborItem>): LaborItem => ({
  kind: 'pm', site_code: 'binney', task_no: 'PM-1', task_name: 'AHU Quarterly', cmms_type: 'recurring', building: '301 Binney',
  assignee_name: 'Ann Lee', task_closed: true, performer: 'Ann Lee', hours: 1, performed_at: '2026-11-09T17:00:00Z',
  day_local: '2026-11-09', week_start: '2026-11-09', bucket: 'pm', ...over,
});
const wt = buildWeekTime([
  li({}),
  li({ task_no: 'PM-2', task_name: 'Building Rounds', bucket: 'rounds', hours: 2, day_local: '2026-11-10', performed_at: '2026-11-10T17:00:00Z', assignee_name: 'Bob Roy', task_closed: false }),
  li({ task_no: 'PM-2', task_name: 'Building Rounds', bucket: 'rounds', hours: 2.5, day_local: '2026-11-15', performed_at: '2026-11-15T17:00:00Z', assignee_name: 'Bob Roy', task_closed: false }),
  li({ kind: 'wo', task_no: 'W-9', task_name: 'Leak', bucket: 'work_order', hours: 3, day_local: '2026-11-12', performed_at: '2026-11-12T20:00:00Z' }),
  li({ performer: 'Bob Roy', assignee_name: 'Bob Roy', task_no: 'PM-3', bucket: 'escort', hours: 4, day_local: '2026-11-11', performed_at: '2026-11-11T15:00:00Z' }),
  li({ week_start: '2026-11-02', day_local: '2026-11-06', hours: 9 }),
], [
  { site_code: 'binney', assigned_to_name: 'Ann Lee', week_start: '2026-11-09', week_hours: 40, as_of: '2026-11-14T23:00:00Z' },
  { site_code: 'binney', assigned_to_name: 'Cy Doe', week_start: '2026-11-09', week_hours: 12, as_of: '2026-11-15T00:00:00Z' },
  { site_code: 'binney', assigned_to_name: 'Ann Lee', week_start: '2026-11-02', week_hours: 99, as_of: null },
], [
  { task_no: 'PM-1', site_code: 'binney', assigned_to_name: 'Ann Lee', flag_count: 1, good: false },
  { task_no: 'PM-7', site_code: 'binney', assigned_to_name: 'Ann Lee', flag_count: 0, good: true },
], '2026-11-09');
eq('week: order by biggest week', wt.techs.map((t) => t.tech), ['Ann Lee', 'Cy Doe', 'Bob Roy']);
const ann = wt.techs[0];
eq('week: logged / placed / unplaced', [ann.logged, ann.placed, ann.unplaced], [40, 8.5, 31.5]);
eq('week: by bucket', ann.byBucket, { pm: 1, rounds: 4.5, on_demand: 0, bms: 0, work_order: 3, other: 0 });
eq('week: by day, Monday first', ann.byDay, [1, 2, 0, 3, 0, 0, 2.5]);
eq('week: hours on someone else\'s task', ann.onOthers, 4.5);
eq('week: tasks / closed / flagged / good', [ann.tasks, ann.closed, ann.flagged, ann.good], [3, 2, 1, 1]);
eq('week: no labor report row', [wt.techs[2].logged, wt.techs[2].placed, wt.techs[2].unplaced, wt.techs[2].byBucket.other], [null, 4, 0, 4]);
eq('week: team', [wt.team.logged, wt.team.placed, wt.team.unplaced, wt.team.onOthers, wt.team.pmTaskHours, wt.team.people], [52, 12.5, 43.5, 4.5, 9.5, 3]);
eq('week: as of the latest poll', wt.asOf, '2026-11-15T00:00:00Z');
eq('fmtH', [fmtH(6.333), fmtH(0.04), fmtH(0), fmtH(0, false), fmtH(12)], ['6.3', '<0.1', '', '0', '12.0']);

if (failures) { console.error(`${failures} failed`); process.exitCode = 1; } else console.log('all passed');
