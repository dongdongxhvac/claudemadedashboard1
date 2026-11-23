// Ad-hoc test for pmAudit.ts — no test framework; run:
//   node --experimental-strip-types web/src/lib/pmAudit.test.ts

declare const process: { exitCode?: number };

import {
  addDays, weekLabel, weeksEnding, fmtHours, shortName, fmtClosed, coveTaskUrl, flagChip, goodChip, rowChips, joinQueue, filterQueue, nextOpen,
  weekStats, ratesOf, buildScorecard, buildTimeline, noteSourceLabel, parsePill, weekStartOf, bucketOf, buildWeekTime, engineerKeys, rosterKey, easternDay, weekFirstDay, weekDays, auditWeekLabel, auditWeekKeyOf, rosterPeople, worksOn, dayMarks, fmtH, workTypeOf, sumTypeHours, buildHoursSplit,
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
eq('week: no roster given, nobody left off', wt.others, []);

// engineers only
const roster = new Set(engineerKeys(
  [{ id: 'u1', full_name: 'Ann  Lee' }, { id: 'u2', full_name: 'Robert Roy' }],
  [{ user_id: 'u2', cmms_assignee_name: ' bob roy ' }, { user_id: 'u9', cmms_assignee_name: 'Cy Doe' }, { user_id: 'u1', cmms_assignee_name: null }],
));
eq('roster: full name and Cove name, engineers only', [...roster], ['ann lee', 'bob roy', 'robert roy']);
eq('roster key', [rosterKey('  Bob   ROY '), rosterKey(null)], ['bob roy', '']);
const wtEng = buildWeekTime([
  li({}),
  li({ performer: 'Bob Roy', assignee_name: 'Bob Roy', task_no: 'PM-3', bucket: 'escort', hours: 4, day_local: '2026-11-11', performed_at: '2026-11-11T15:00:00Z' }),
  li({ performer: 'Pat Porter', assignee_name: 'Pat Porter', task_no: 'PM-4', hours: 0.5, day_local: '2026-11-11', performed_at: '2026-11-11T16:00:00Z' }),
], [
  { site_code: 'binney', assigned_to_name: 'Ann Lee', week_start: '2026-11-09', week_hours: 40, as_of: null },
  { site_code: 'binney', assigned_to_name: 'Cy Doe', week_start: '2026-11-09', week_hours: 12, as_of: null },
  { site_code: 'binney', assigned_to_name: 'Pat Porter', week_start: '2026-11-09', week_hours: 3.2, as_of: null },
], [
  { task_no: 'PM-8', site_code: 'binney', assigned_to_name: 'Max Manager', flag_count: 0, good: false },
], '2026-11-09', roster);
eq('engineers only: rows', wtEng.techs.map((t) => t.tech), ['Ann Lee', 'Bob Roy']);
eq('engineers only: left off, biggest first', wtEng.others, [
  { tech: 'Cy Doe', site_code: 'binney', logged: 12, placed: 0, closed: 0 },
  { tech: 'Pat Porter', site_code: 'binney', logged: 3.2, placed: 0.5, closed: 0 },
  { tech: 'Max Manager', site_code: 'binney', logged: 0, placed: 0, closed: 1 },
]);
eq('engineers only: team counts engineers', [wtEng.team.logged, wtEng.team.placed, wtEng.team.people], [40, 5, 2]);

// a site's week: the key is always a Monday; Binney's days start the Sunday before it
eq('first day of a week', [weekFirstDay('2026-11-09', 'binney'), weekFirstDay('2026-11-09', 'upark'), weekFirstDay('2026-11-09', 'both')], ['2026-11-08', '2026-11-09', '2026-11-09']);
eq('week label by site', [auditWeekLabel('2026-11-09', 'upark'), auditWeekLabel('2026-11-09', 'binney'), auditWeekLabel('2026-11-09', 'both')],
  ['Nov 9 – 15', 'Nov 8 – 14', 'Nov 9 – 15 · Binney Nov 8 – 14']);
eq('day columns', [weekDays('2026-11-09', 'upark'), weekDays('2026-11-09', 'binney').first, weekDays('2026-11-09', 'binney').names.join(' '), weekDays('2026-11-09', 'both').names.join(' ')],
  [{ first: '2026-11-09', names: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }, '2026-11-08', 'Sun Mon Tue Wed Thu Fri Sat', 'Sun Mon Tue Wed Thu Fri Sat Sun']);
eq('eastern day', [easternDay('2026-11-09T03:30:00Z'), easternDay('2026-11-09T05:00:00Z'), easternDay('nope')], ['2026-11-08', '2026-11-09', null]);
eq('week key of an instant: Saturday, Sunday, Monday', [
  ['2026-11-21T15:00:00Z', '2026-11-22T15:00:00Z', '2026-11-23T15:00:00Z'].map((t) => auditWeekKeyOf(t, 'upark')),
  ['2026-11-21T15:00:00Z', '2026-11-22T15:00:00Z', '2026-11-23T15:00:00Z'].map((t) => auditWeekKeyOf(t, 'binney')),
  auditWeekKeyOf('2026-11-22T15:00:00Z', 'both'),
], [['2026-11-16', '2026-11-16', '2026-11-23'], ['2026-11-16', '2026-11-23', '2026-11-23'], '2026-11-23']);
// Binney: the database keys the prior Sunday to this week and the Sunday that ends the Monday week to the next
const sunItems = [
  li({ task_no: 'PM-S', hours: 7.5, day_local: '2026-11-08', performed_at: '2026-11-08T15:00:00Z' }),
  li({}),
  li({ task_no: 'PM-L', hours: 9, day_local: '2026-11-15', performed_at: '2026-11-15T15:00:00Z', week_start: '2026-11-16' }),
];
const sunHours = [{ site_code: 'binney', assigned_to_name: 'Ann Lee', week_start: '2026-11-09', week_hours: 20, as_of: null }];
const wtSun = buildWeekTime(sunItems, sunHours, [], '2026-11-09', null, '2026-11-08');
eq('binney week: Sunday first', [wtSun.techs[0].placed, wtSun.techs[0].byDay, wtSun.techs[0].unplaced], [8.5, [7.5, 1, 0, 0, 0, 0, 0], 11.5]);
// both sites: eight columns, Sunday to Sunday — Binney's Sunday first, UPark's last
const wtBoth = buildWeekTime([
  ...sunItems,
  li({ site_code: 'upark', performer: 'Bob Roy', assignee_name: 'Bob Roy', task_no: 'PM-U', hours: 6, day_local: '2026-11-15', performed_at: '2026-11-15T15:00:00Z' }),
], sunHours, [], '2026-11-09', null, '2026-11-08', 8);
eq('both sites: eight day columns', wtBoth.techs.map((t) => [t.tech, t.byDay]), [['Ann Lee', [7.5, 1, 0, 0, 0, 0, 0, 0]], ['Bob Roy', [0, 0, 0, 0, 0, 0, 0, 6]]]);
// double-booked: a second entry on the same task the same day
const wtDbl = buildWeekTime([
  li({ task_no: 'PM-R', task_name: 'Building Rounds', bucket: 'rounds', hours: 1.5, day_local: '2026-11-09', performed_at: '2026-11-09T13:59:00Z' }),
  li({ task_no: 'PM-R', task_name: 'Building Rounds', bucket: 'rounds', hours: 1.5, day_local: '2026-11-09', performed_at: '2026-11-09T22:20:00Z' }),
  li({ task_no: 'PM-R', task_name: 'Building Rounds', bucket: 'rounds', hours: 2, day_local: '2026-11-10', performed_at: '2026-11-10T22:20:00Z' }),
  li({ task_no: 'PM-U', task_name: 'Unscheduled Tasks November', bucket: 'unscheduled', hours: 0.5, day_local: '2026-11-09', performed_at: '2026-11-09T15:00:00Z' }),
  li({ task_no: 'PM-U', task_name: 'Unscheduled Tasks November', bucket: 'unscheduled', hours: 0.5, day_local: '2026-11-09', performed_at: '2026-11-09T16:00:00Z' }),
  li({ performer: 'Bob Roy', task_no: 'PM-R', task_name: 'Building Rounds', bucket: 'rounds', hours: 1.5, day_local: '2026-11-09', performed_at: '2026-11-09T22:21:00Z' }),
], [], [], '2026-11-09');
const dAnn = wtDbl.techs.find((t) => t.tech === 'Ann Lee')!;
eq('double-booked: later entry on the same task that day, catch-all tasks left out', [dAnn.placed, dAnn.double, dAnn.doubleByDay, dAnn.doubleItems.map((i) => i.performed_at)], [6, 1.5, [1.5, 0, 0, 0, 0, 0, 0], ['2026-11-09T22:20:00Z']]);
const wtBig = buildWeekTime([
  li({ task_no: 'PM-R', hours: 0.25, day_local: '2026-11-09', performed_at: '2026-11-09T17:00:00Z' }),
  li({ task_no: 'PM-R', hours: 6, day_local: '2026-11-09', performed_at: '2026-11-09T17:00:00Z' }),
  li({ task_no: 'PM-R', hours: 0.5, day_local: '2026-11-09', performed_at: '2026-11-09T18:00:00Z' }),
], [], [], '2026-11-09');
eq('double-booked: the largest entry stands, whatever order they were typed in', [wtBig.techs[0].double, wtBig.techs[0].doubleItems.map((i) => i.hours)], [0.75, [0.25, 0.5]]);
eq('double-booked: another person on the same task is not a repeat', [wtDbl.techs.find((t) => t.tech === 'Bob Roy')!.double, wtDbl.team.double, wtDbl.team.doublePeople], [0, 1.5, 1]);

// roster with crews, and days against the PTO calendar
const people = rosterPeople(
  [{ id: 'u1', full_name: 'Ann Lee' }, { id: 'u2', full_name: 'Robert Roy' }],
  [{ user_id: 'u1', cmms_assignee_name: null, shift_id: 's1' }, { user_id: 'u2', cmms_assignee_name: 'Bob Roy', shift_id: 's9' }],
  [{ id: 's1', crew: 'sunday' }, { id: 's9', crew: null }],
);
eq('roster people', people, [{ key: 'ann lee', user_id: 'u1', crew: 'sunday' }, { key: 'bob roy', user_id: 'u2', crew: null }, { key: 'robert roy', user_id: 'u2', crew: null }]);
eq('crew days: Sun–Wed, Wed–Sat, Mon–Fri', ['2026-11-08', '2026-11-11', '2026-11-12', '2026-11-14'].map((d) => [worksOn('sunday', d), worksOn('saturday', d), worksOn(null, d)]),
  [[true, false, false], [true, true, true], [false, true, true], [false, true, false]]);
const pto = (over: Partial<{ type: string; status: string; starts_on: string; ends_on: string; hours: number | null }>) =>
  ({ user_id: 'u1', type: 'vacation', status: 'approved', starts_on: '2026-11-11', ends_on: '2026-11-11', hours: 10, ...over });
// Sun–Wed crew, week Sun Nov 8 … Sat Nov 14: worked Sun/Mon/Tue, nothing Wed
const marksOf = (byDay: number[], rows: ReturnType<typeof pto>[], today = '2026-11-16') =>
  dayMarks(byDay, '2026-11-08', { weekFirst: '2026-11-08', crew: 'sunday', pto: rows, today }).map((m) => (m ? `${m.tone}:${m.label}` : null));
eq('day marks: PTO explains the empty day', marksOf([7, 8, 8.8, 0, 0, 0, 0], [pto({})]), [null, null, null, 'green:Vac', null, null, null]);
eq('day marks: nothing explains it', marksOf([7, 8, 8.8, 0, 0, 0, 0], []), [null, null, null, 'red:0', null, null, null]);
eq('day marks: denied, pending and part-day PTO do not cover a day', [
  marksOf([7, 8, 8.8, 0, 0, 0, 0], [pto({ status: 'denied' })])[3],
  marksOf([7, 8, 8.8, 0, 0, 0, 0], [pto({ status: 'pending' })])[3],
  marksOf([7, 8, 8.8, 0, 0, 0, 0], [pto({ type: 'sick', hours: 3.5 })])[3],
], ['red:0', 'red:0', 'red:0']);
eq('day marks: hours logged on a full PTO day; a holiday worked is fine; part-day PTO is fine', [
  marksOf([7, 8, 8.8, 9, 0, 0, 0], [pto({})])[3],
  marksOf([7, 8, 8.8, 9, 0, 0, 0], [pto({ type: 'holiday' })])[3],
  marksOf([7, 8, 8.8, 6.5, 0, 0, 0], [pto({ type: 'sick', hours: 3.5 })])[3],
], ['red:9.0', null, null]);
eq('day marks: a multi-day request, and PTO on a day off', marksOf([0, 0, 0, 0, 0, 0, 0], [pto({ starts_on: '2026-11-08', ends_on: '2026-11-10', hours: 30 }), pto({ starts_on: '2026-11-13', ends_on: '2026-11-13' })]),
  ['green:Vac', 'green:Vac', 'green:Vac', 'red:0', null, 'green:Vac', null]);
eq('day marks: today and later are not judged', marksOf([7, 0, 0, 0, 0, 0, 0], [], '2026-11-10'), [null, 'red:0', null, null, null, null, null]);
eq('day marks: both sites, a column outside the person\'s own week', dayMarks([0, 0, 0, 0, 0, 0, 0, 0], '2026-11-08', { weekFirst: '2026-11-09', crew: null, pto: [], today: '2026-11-20' }).map((m) => m?.label ?? null),
  [null, '0', '0', '0', '0', '0', null, null]);

eq('fmtH', [fmtH(6.333), fmtH(0.04), fmtH(0), fmtH(0, false), fmtH(12)], ['6.3', '<0.1', '', '0', '12.0']);

// scorecard: PM / ODT / WO
eq('work type', [workTypeOf({ kind: 'pm', cmms_type: 'recurring' }), workTypeOf({ kind: 'pm', cmms_type: 'on_demand' }), workTypeOf({ kind: 'pm', cmms_type: null }), workTypeOf({ kind: 'wo', cmms_type: 'work_order' })],
  ['pm', 'odt', 'odt', 'wo']);
const th = sumTypeHours([
  { kind: 'pm', site_code: 'upark', performer: 'Ann Lee', week_start: '2026-11-09', cmms_type: 'recurring', hours: 6 },
  { kind: 'pm', site_code: 'upark', performer: 'Ann Lee', week_start: '2026-11-09', cmms_type: 'on_demand', hours: 3 },
  { kind: 'wo', site_code: 'upark', performer: 'Ann Lee', week_start: '2026-11-02', cmms_type: 'work_order', hours: 1 },
  { kind: 'pm', site_code: 'upark', performer: 'Bob Roy', week_start: '2026-11-09', cmms_type: 'recurring', hours: 20 },
  { kind: 'pm', site_code: 'upark', performer: 'Ann Lee', week_start: '2026-08-03', cmms_type: 'recurring', hours: 50 },
]);
eq('sum by person, site, week', th.find((r) => r.performer === 'Ann Lee' && r.week_start === '2026-11-09'), { site_code: 'upark', performer: 'Ann Lee', week_start: '2026-11-09', pm: 6, odt: 3, wo: 0 });
const hs = buildHoursSplit(th, ['2026-11-02', '2026-11-09']);
eq('hours split: order + numbers', hs.techs.map((x) => [x.tech, x.pm, x.odt, x.wo, x.total, x.weeks, x.perWeek]), [['Bob Roy', 20, 0, 0, 20, 1, 20], ['Ann Lee', 6, 3, 1, 10, 2, 5]]);
eq('hours split: team', hs.team, { pm: 26, odt: 3, wo: 1, total: 30 });
eq('hours split: no roster, nobody left off', hs.others, { people: 0, hours: 0 });
const hsEng = buildHoursSplit(th, ['2026-11-02', '2026-11-09'], new Set(['ann lee']));
eq('hours split, engineers only', [hsEng.techs.map((x) => x.tech), hsEng.team.total, hsEng.others], [['Ann Lee'], 10, { people: 1, hours: 20 }]);

if (failures) { console.error(`${failures} failed`); process.exitCode = 1; } else console.log('all passed');
