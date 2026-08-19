// UPark New-Hire 8-Week Program — Plan B (Level 1), as data.
//
// Transcribed from the printed packet (2026-08-19): the interleaved schedule
// and the mentor's sign-off sheet inside
//   /training/new-hire/new_hire_8_week_plan.html
// The sign-off sheet is the source of truth for the VERIFIED ITEMS (what the
// mentor initials), the schedule supplies each week's plan blocks and which
// handout goes with them. Progress is stored against the stable `key`s below
// (new_hire_checkoffs.item_key / new_hire_rep_logs.rep_key, migration 0128)
// — renaming a key orphans recorded progress, so treat keys as permanent
// and change only labels.
//
// Program key 'upark_l1_plan_b' is stamped on each enrollment so a future
// Plan C (or Binney's program) can coexist.

export const NH_PROGRAM_KEY = 'upark_l1_plan_b';
export const NH_PROGRAM_TITLE = 'UPark New-Hire — 8-Week Program (Plan B · Level 1)';
export const NH_WEEKS = 8;

/** All handouts are served as static files from web/public/training/new-hire. */
export const NH_DOC_BASE = '/training/new-hire';

export type NhDocKey =
  | 'plan' | 'site_map' | 'building_check' | 'glossary' | 'terminology'
  | 'hvac' | 'plumbing' | 'electrical' | 'life_safety' | 'bms' | 'overviews_all'
  | 'chiller' | 'tower' | 'ahu' | 'boiler'
  | 'find_on_screen_example' | 'find_on_screen' | 'find_it_tag_it'
  | 'answer_key' | 'level2' | 'phase_tracker';

export type NhDoc = { key: NhDocKey; label: string; file: string; group: 'program' | 'reference' | 'overview' | 'equipment' | 'field' | 'mentor' };

export const NH_DOCS: NhDoc[] = [
  { key: 'plan',            label: '8-Week Schedule + Sign-Off Sheet',      file: 'new_hire_8_week_plan.html',                   group: 'program' },
  { key: 'phase_tracker',   label: 'Phase tracker (print handout)',         file: 'new_hire_phase_tracker.html',                 group: 'program' },
  { key: 'site_map',        label: 'UPark Site Map',                        file: 'upark_site_map.html',                         group: 'field' },
  { key: 'building_check',  label: 'Building Check (access · BMS · remote)',file: 'new_hire_building_check.html',                group: 'field' },
  { key: 'glossary',        label: 'Equipment Glossary',                    file: 'new_hire_equipment_glossary.html',            group: 'reference' },
  { key: 'terminology',     label: 'Terminology',                           file: 'new_hire_terminology_spa.html',               group: 'reference' },
  { key: 'hvac',            label: 'How HVAC Works',                        file: 'overviews/new_hire_hvac_overview.html',       group: 'overview' },
  { key: 'plumbing',        label: 'How Plumbing Works',                    file: 'overviews/new_hire_plumbing_overview.html',   group: 'overview' },
  { key: 'electrical',      label: 'How Electrical Works',                  file: 'overviews/new_hire_electrical_overview.html', group: 'overview' },
  { key: 'life_safety',     label: 'How Life Safety Works',                 file: 'overviews/new_hire_life_safety_overview.html',group: 'overview' },
  { key: 'bms',             label: 'How the BMS Works',                     file: 'overviews/new_hire_bms_overview.html',        group: 'overview' },
  { key: 'overviews_all',   label: 'All overviews (tabbed)',                file: 'new_hire_overviews_all.html',                 group: 'overview' },
  { key: 'chiller',         label: 'Chiller Plant — overview + Find It & Tag It (36)', file: 'equipment/new_hire_chiller_plant.html', group: 'equipment' },
  { key: 'tower',           label: 'Cooling Tower — overview + tag sheet (18)',        file: 'equipment/new_hire_cooling_tower.html', group: 'equipment' },
  { key: 'ahu',             label: 'Air Handling Unit — overview + tag sheet (17)',    file: 'equipment/new_hire_ahu.html',           group: 'equipment' },
  { key: 'boiler',          label: 'Boiler Plant — overview + tag sheet (24)',         file: 'equipment/new_hire_boiler_plant.html',  group: 'equipment' },
  { key: 'find_on_screen_example', label: 'Find It On Screen — worked example', file: 'new_hire_find_it_on_screen_EXAMPLE.html', group: 'field' },
  { key: 'find_on_screen',  label: 'Find It On Screen (BMS, six systems)',   file: 'new_hire_find_it_on_screen.html',             group: 'field' },
  { key: 'find_it_tag_it',  label: 'Portfolio Find It & Tag It (117 items)', file: 'new_hire_find_it_tag_it.html',                group: 'field' },
  { key: 'answer_key',      label: 'Quiz answer key (mentor copy)',         file: 'new_hire_quiz_answer_key.html',               group: 'mentor' },
  { key: 'level2',          label: 'Level-2 curriculum (48 modules)',       file: 'training_level2_curriculum.html',             group: 'reference' },
];

export const NH_DOC_BY_KEY: Record<NhDocKey, NhDoc> = Object.fromEntries(NH_DOCS.map((d) => [d.key, d])) as Record<NhDocKey, NhDoc>;
export function nhDocHref(key: NhDocKey): string {
  return `${NH_DOC_BASE}/${NH_DOC_BY_KEY[key].file}`;
}

/** Category tags borrowed from the phase tracker (Safety / Ops / Orientation /
 *  Controls / PM / Theory) — colour + grouping only, no logic. */
export type NhCat = 'safety' | 'ops' | 'orient' | 'controls' | 'pm' | 'theory';
export const NH_CAT_META: Record<NhCat, { label: string; color: string }> = {
  safety:   { label: 'Safety',      color: '#dc2626' },
  ops:      { label: 'Operations',  color: '#0891b2' },
  orient:   { label: 'Orientation', color: '#2563eb' },
  controls: { label: 'Controls',    color: '#7c3aed' },
  pm:       { label: 'PM',          color: '#d97706' },
  theory:   { label: 'Theory',      color: '#15803d' },
};

export type NhItem = {
  /** Permanent. Progress is keyed on this. */
  key: string;
  label: string;
  cat: NhCat;
  docs?: NhDocKey[];
  /** A gate: later work depends on it (LOTO eval #2 before any MEP PM). */
  gate?: boolean;
};

export type NhPlanBlock = { title: string; text: string; docs?: NhDocKey[] };

export type NhWeek = {
  n: number;
  title: string;       // "Onboarding, Admin & Site"
  short: string;       // chip text: "Onboarding & Site"
  accent: string;      // discipline accent from the packet
  plan: NhPlanBlock[]; // the schedule's blocks for the week
  items: NhItem[];     // the sign-off sheet's verified items
  friday: string;      // the Friday line
};

export const NH_WEEKS_DEF: NhWeek[] = [
  {
    n: 1, title: 'Onboarding, Admin & Site', short: 'Onboarding & Site', accent: '#475569',
    plan: [
      { title: 'Admin / onboarding (Mon–Tue)', text: 'Four different systems, four different jobs — COVE = document labor hours & work · UKG = timesheet/punches · On The Clock = PTO · Workday = assigned trainings. HR onboarding, badge, parking, phone/email/Teams. Added to the team text group, shared calendar, email distributions. Workday trainings complete. First UKG timesheet, mentor-checked. Accounts created + first logins verified: COVE, PlantLog, BMS (view), Workday, UKG, On The Clock. Safety orientation + LOTO / PPE / Meter lab — intro & eval #1; own PPE + LOTO set issued.' },
      { title: 'Site (Wed–Fri)', text: 'Site map printable day 1, blank tab filled from memory by Friday. Building check — physical access rows only: main entry, loading dock, main mechanical room for all 14 buildings + 3 garages; try every credential in person. PlantLog shadow: 2 days with a non-lead engineer. COVE — learn to document your day, mentor beside: 7 h documented from day 1.', docs: ['site_map', 'building_check'] },
    ],
    items: [
      { key: 'w1.workday',     label: 'All assigned Workday trainings complete (onboarding, safety, DEI, …)', cat: 'orient' },
      { key: 'w1.ukg',         label: 'First UKG timesheet submitted and accepted', cat: 'orient' },
      { key: 'w1.accounts',    label: 'Accounts live and first login verified: COVE · PlantLog · BMS (view) · Workday · UKG · On The Clock', cat: 'orient' },
      { key: 'w1.otc_pto',     label: 'Added to On The Clock (PTO) — on the engineering PTO calendar, request flow demonstrated', cat: 'orient' },
      { key: 'w1.channels',    label: 'On team text group, shared calendar, email distributions — checking all three daily', cat: 'ops' },
      { key: 'w1.cove_solo',   label: 'COVE day documented solo: hours + PM/WO closed + one self-created non-schedule PM + one self-created WO', cat: 'ops' },
      { key: 'w1.loto_eval_1', label: 'LOTO / PPE / Meter lab — intro & eval #1; own PPE + LOTO set issued', cat: 'safety' },
      { key: 'w1.site_map',    label: 'Blank site map from memory; every building + garage entered', cat: 'orient', docs: ['site_map'] },
      { key: 'w1.access_rows', label: 'Building check — physical access rows complete, all buildings', cat: 'orient', docs: ['building_check'] },
    ],
    friday: 'Initial Week 1 — access rows, map, Workday, LOTO eval #1. COVE audit: 7 h/day since day 1, ≥35 h.',
  },
  {
    n: 2, title: 'HVAC ↔ Chiller Plant', short: 'HVAC ↔ Chiller', accent: '#0891b2',
    plan: [
      { title: 'Theory', text: 'HVAC overview — all sections + quiz. End-of-week review #1 of all Week-1/2 handouts.', docs: ['hvac', 'answer_key'] },
      { title: 'Equipment', text: 'Chiller plant — Overview tab, then Find It & Tag It, 36 items in the plant. Every row: access badge respected, purpose stated aloud, IF IT IS WRONG read, proof captured.', docs: ['chiller'] },
      { title: 'Building check', text: 'BMS on-site rows (vendor/product, workstation location, own login, view/full) for every building entered this week.', docs: ['building_check'] },
      { title: 'Ops & PM', text: 'First solo PlantLog circuit. Non-MEP rep 1: water treatment (coupon/chemical round with mentor).' },
    ],
    items: [
      { key: 'w2.hvac_quiz',     label: 'HVAC quiz passed · review #1 held', cat: 'theory', docs: ['hvac', 'answer_key'] },
      { key: 'w2.chiller_36',    label: 'Chiller Find It & Tag It 36/36, proof on every row', cat: 'orient', docs: ['chiller'] },
      { key: 'w2.plantlog_solo', label: 'First solo PlantLog circuit · water treatment rep 1 logged', cat: 'ops' },
      { key: 'w2.bms_rows',      label: 'Building check BMS rows for buildings visited', cat: 'controls', docs: ['building_check'] },
    ],
    friday: 'Initial Week 2. COVE audit: 7 h/day, ≥35 h this week.',
  },
  {
    n: 3, title: 'Plumbing ↔ Cooling Tower', short: 'Plumbing ↔ Tower', accent: '#2563eb',
    plan: [
      { title: 'Theory', text: 'Plumbing overview — all sections + quiz.', docs: ['plumbing'] },
      { title: 'Equipment', text: 'Cooling tower — Overview + field sheet, 18 items. Trace make-up water from the plumbing systems just learned to the tower.', docs: ['tower'] },
      { title: 'Safety gate', text: 'LOTO / PPE / Meter lab — eval #2 GATE: must pass before any MEP PM in Week 4+. Hands-on: BMS check → locate disconnect/VFD → LOTO → meter power verification → enable check → restore → BMS confirm.' },
      { title: 'Building check', text: 'BMS rows continue for buildings visited.', docs: ['building_check'] },
      { title: 'Ops & PM', text: 'Non-MEP reps: drum-drip and fire pump test (support role).' },
    ],
    items: [
      { key: 'w3.plumbing_quiz_tower_18', label: 'Plumbing quiz passed · tower sheet 18/18', cat: 'theory', docs: ['plumbing', 'tower'] },
      { key: 'w3.loto_eval_2',            label: 'LOTO eval #2 passed (gate for MEP PMs)', cat: 'safety', gate: true },
      { key: 'w3.drumdrip_firepump_reps', label: 'Drum-drip + fire pump test reps logged', cat: 'pm' },
    ],
    friday: 'Initial Week 3. COVE audit: 7 h/day, ≥35 h this week.',
  },
  {
    n: 4, title: 'Electrical ↔ AHU', short: 'Electrical ↔ AHU', accent: '#d97706',
    plan: [
      { title: 'Theory', text: 'Electrical overview — all sections + quiz. End-of-week review #2: HVAC / Plumbing / Electrical quizzes re-checked against answer key.', docs: ['electrical', 'answer_key'] },
      { title: 'Equipment', text: 'AHU — Overview + Find It & Tag It, 17 items on a running unit. Narrate air path intake → discharge.', docs: ['ahu'] },
      { title: 'Building check', text: 'BMS rows continue. Read arc-flash labels aloud at gear located this week — open nothing.', docs: ['building_check'] },
      { title: 'Ops & PM', text: 'First MEP rep (LOTO gate passed): exhaust fan PM. SCHWP / CWP full names, locations, systems — quizzed on rounds.' },
    ],
    items: [
      { key: 'w4.electrical_quiz_review_2', label: 'Electrical quiz passed · review #2 held (HVAC/Plumbing/Electrical)', cat: 'theory', docs: ['electrical', 'answer_key'] },
      { key: 'w4.ahu_17',                   label: 'AHU sheet 17/17 on a running unit', cat: 'orient', docs: ['ahu'] },
      { key: 'w4.exhaust_fan_first_mep',    label: 'Exhaust fan PM rep 1 (first MEP PM) · SCHWP/CWP names + locations verbal', cat: 'pm' },
    ],
    friday: 'Initial Week 4. COVE audit: 7 h/day, ≥35 h this week.',
  },
  {
    n: 5, title: 'Life Safety ↔ Boiler Plant', short: 'Life Safety ↔ Boiler', accent: '#dc2626',
    plan: [
      { title: 'Theory', text: 'Life Safety overview — all sections + quiz. Scenario sort: act vs. escalate, three cases.', docs: ['life_safety'] },
      { title: 'Equipment', text: 'Boiler plant — Overview + Find It & Tag It, 24 items at 75SS Boiler 1 (Cleaver-Brooks CB-700) and the Patterson-Kelley N-2000. Offline in summer: tag cold and note it. Verbal: P-K return >130°F, lo-hi-lo staging, flow-switch LWCO.', docs: ['boiler'] },
      { title: 'Building check', text: 'BMS rows finish — all buildings covered by end of week.', docs: ['building_check'] },
      { title: 'Ops & PM', text: 'Non-MEP rep: generator test (support). MEP rep: UH/CUH PM.' },
    ],
    items: [
      { key: 'w5.ls_quiz_scenarios',  label: 'Life Safety quiz passed · scenario sort 3/3', cat: 'theory', docs: ['life_safety'] },
      { key: 'w5.boiler_24_verbals',  label: 'Boiler sheet 24/24 · P-K >130°F / lo-hi-lo / flow-switch LWCO verbals', cat: 'orient', docs: ['boiler'] },
      { key: 'w5.generator_uhcuh_reps', label: 'Generator test + UH/CUH PM reps logged', cat: 'pm' },
      { key: 'w5.bms_rows_complete',  label: 'Building check BMS rows complete, all buildings', cat: 'controls', docs: ['building_check'] },
    ],
    friday: 'Initial Week 5. COVE audit: 7 h/day, ≥35 h this week.',
  },
  {
    n: 6, title: 'BMS ↔ Find It On Screen', short: 'BMS ↔ On Screen', accent: '#7c3aed',
    plan: [
      { title: 'Theory', text: 'BMS overview — all sections + quiz.', docs: ['bms'] },
      { title: 'Screen work', text: 'Worked example first, then Find It On Screen — six systems, navigate cold after mentor blanks the screen.', docs: ['find_on_screen_example', 'find_on_screen'] },
      { title: 'Building check — technical tail', text: 'Remote-access rows completed for every building. Off-site login proven, not assumed — this is the one everybody skips and the one that matters at 2 AM. Building check sheet now 100%.', docs: ['building_check'] },
      { title: 'Ops & PM', text: 'MEP rep: minor pump/motor PM (check PM forecast with manager). Non-MEP rep: roof PM.' },
    ],
    items: [
      { key: 'w6.bms_quiz_six_finds',   label: 'BMS quiz passed · six on-screen finds unaided', cat: 'controls', docs: ['bms', 'find_on_screen'] },
      { key: 'w6.building_check_100',   label: 'Building check 100% — remote-access rows proven off-site', cat: 'controls', docs: ['building_check'] },
      { key: 'w6.pump_motor_roof_reps', label: 'Pump/motor PM + roof PM reps logged', cat: 'pm' },
    ],
    friday: 'Initial Week 6. COVE audit: 7 h/day, ≥35 h this week.',
  },
  {
    n: 7, title: 'Consolidation', short: 'Consolidation', accent: '#1a1f2b',
    plan: [
      { title: 'Field capstone', text: 'Portfolio-wide Find It & Tag It — 117 items across 8 systems, no location prompting. Target ≥60 by Friday.', docs: ['find_it_tag_it'] },
      { title: 'Reps', text: 'Second reps for every PM still under target (2×): water treatment, drum-drip, fire pump, generator, roof, exhaust fan, UH/CUH, pump/motor as the calendar allows. Vendor escorts closed out.' },
      { title: 'Re-tag', text: 'Weak areas from Weeks 2–5 tag sheets re-walked.', docs: ['chiller', 'tower', 'ahu', 'boiler'] },
    ],
    items: [
      { key: 'w7.capstone_60',  label: 'Portfolio capstone ≥60/117', cat: 'orient', docs: ['find_it_tag_it'] },
      { key: 'w7.second_reps_escorts', label: 'Second reps under way; vendor escorts ×2 closed', cat: 'pm' },
      { key: 'w7.retag',        label: 'Weak-area re-tags done', cat: 'orient' },
    ],
    friday: 'Initial Week 7. COVE audit: 7 h/day, ≥35 h this week.',
  },
  {
    n: 8, title: 'Capstone Finish & Sign-Off', short: 'Capstone & Sign-Off', accent: '#15803d',
    plan: [
      { title: 'Close out', text: 'Finish capstone — 117/117 (Mon–Wed). Answer-key review of every missed quiz question, all five disciplines; re-test to pass (Thu). All PM reps at target 2/2; COVE 7 h/day across all 8 weeks. Pick first three Level-2 modules from this program\'s weak spots (Fri).', docs: ['find_it_tag_it', 'answer_key', 'level2'] },
      { title: 'Final walk-through (Fri)', text: 'Mentor picks three faults from the capstone fault index. Walk to it, identify tags, state IF IT IS WRONG, name escalation. Pass = 3/3, no coaching.', docs: ['find_it_tag_it'] },
    ],
    items: [
      { key: 'w8.capstone_117_quizzes', label: 'Capstone 117/117 · all quizzes passed after re-test', cat: 'orient', docs: ['find_it_tag_it', 'answer_key'] },
      { key: 'w8.reps_2of2_cove',       label: 'All PM reps at 2/2 · COVE 7 h/day all 8 weeks, ≥35 h every week', cat: 'pm' },
      { key: 'w8.walkthrough_3of3',     label: 'Final walk-through 3/3 faults, no coaching', cat: 'orient' },
      { key: 'w8.level2_picks',         label: 'First three Level-2 modules selected', cat: 'theory', docs: ['level2'] },
    ],
    friday: 'Sign-off: new hire, mentor, manager sign the certification block. File tag sheets, building check, site map, and the phase-tracker print handout with the record.',
  },
];

/** PM rep tally — tick each completed rep (target 2×). Order as printed. */
export type NhRep = { key: string; label: string; target: number; mep: boolean; weekHint: string };
export const NH_REPS: NhRep[] = [
  { key: 'rep.water_treatment', label: 'Water treatment',  target: 2, mep: false, weekHint: 'Wk 2' },
  { key: 'rep.generator_test',  label: 'Generator test',   target: 2, mep: false, weekHint: 'Wk 5' },
  { key: 'rep.drum_drip',       label: 'Drum-drip',        target: 2, mep: false, weekHint: 'Wk 3' },
  { key: 'rep.roof_pm',         label: 'Roof PM',          target: 2, mep: false, weekHint: 'Wk 6' },
  { key: 'rep.fire_pump_test',  label: 'Fire pump test',   target: 2, mep: false, weekHint: 'Wk 3' },
  { key: 'rep.exhaust_fan_pm',  label: 'Exhaust fan PM',   target: 2, mep: true,  weekHint: 'Wk 4 · first MEP' },
  { key: 'rep.uh_cuh_pm',       label: 'UH/CUH PM',        target: 2, mep: true,  weekHint: 'Wk 5' },
  { key: 'rep.pump_motor_pm',   label: 'Pump/motor PM',    target: 2, mep: true,  weekHint: 'Wk 6' },
  { key: 'rep.vendor_escort',   label: 'Vendor escort',    target: 2, mep: false, weekHint: 'any week' },
];
export const NH_EVALS: NhRep[] = [
  { key: 'eval.loto', label: 'LOTO / PPE / Meter lab eval', target: 2, mep: false, weekHint: '#1 Wk 1 · #2 Wk 3 (MEP gate)' },
];

/** Certification signatures (sign-off sheet footer). */
export const NH_CERT_SIGNERS = [
  { key: 'cert.new_hire', label: 'New hire' },
  { key: 'cert.mentor',   label: 'Mentor' },
  { key: 'cert.manager',  label: 'Manager' },
] as const;

export const NH_CERT_TEXT =
  'All eight weeks verified. The new hire has demonstrated site and access literacy, discipline fundamentals, ' +
  'field identification across eight systems, BMS navigation including remote access, PM participation at target reps, ' +
  'daily COVE labor-hour documentation sustained across all 8 weeks, and correct escalation judgment for the UPark portfolio.';

export const NH_STANDING_DAILY = [
  'Engagement: check email, calendar and the team text group through the day — escorts, emergencies, overtime and alarms all move there.',
  'COVE — the hours rule: 7 labor hours documented every day, training and classroom time included. Every week closes at ≥35 h in correct NPM / PM / WO format. Mentor audits every Friday.',
  'PlantLog: rounds daily — shadow through Week 1, own circuit from Week 2.',
  'Building access card: record access used every day until the card is full.',
  'Vendor escort: ride two escorts whenever vendors are on site, any week.',
  'One glossary/terminology section per day. Escalation: senior engineer → lead → manager, never the vendor.',
];

export const NH_SEASONAL_NOTE =
  'Seasonal swap: default assumes a cooling-season start. For heating-season starts (Nov–Mar), swap the equipment halves of Week 2 ↔ Week 5 (boiler first, chiller later). Overviews stay put.';

// ── key helpers ───────────────────────────────────────────────────────────
export const weekKey = (n: number) => `week.${n}`;   // mentor's weekly initials
export const coveKey = (n: number) => `cove.${n}`;   // weekly COVE ≥35 h audit

/** Every check-off key that counts toward "program complete". */
export const NH_ALL_ITEM_KEYS: string[] = NH_WEEKS_DEF.flatMap((w) => w.items.map((i) => i.key));
export const NH_TOTAL_ITEMS = NH_ALL_ITEM_KEYS.length;

/** Which program week "should" be in progress for a start date (1..8, or
 *  9 = past the program, 0 = not started). Weeks roll on Mondays relative
 *  to the start date. */
export function nhWeekFor(startDate: string | null | undefined, today = new Date()): number {
  if (!startDate) return 0;
  const start = new Date(startDate + 'T00:00:00');
  const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return 0;
  return Math.min(NH_WEEKS + 1, Math.floor(days / 7) + 1);
}

export type NhProgress = {
  itemsDone: number;        // of NH_TOTAL_ITEMS
  weeksSigned: number;      // week.N initials
  coveSigned: number;       // cove.N audits
  repsDone: number;         // reps at/over target
  repsTotal: number;        // NH_REPS.length + NH_EVALS.length
  certSigned: number;       // of 3
  pct: number;              // items + reps blended, 0..100
};

export function nhProgress(
  checked: Set<string>,
  repCounts: Map<string, number>,
): NhProgress {
  const itemsDone = NH_ALL_ITEM_KEYS.filter((k) => checked.has(k)).length;
  let weeksSigned = 0, coveSigned = 0;
  for (let n = 1; n <= NH_WEEKS; n++) {
    if (checked.has(weekKey(n))) weeksSigned++;
    if (checked.has(coveKey(n))) coveSigned++;
  }
  const allReps = [...NH_REPS, ...NH_EVALS];
  const repsDone = allReps.filter((r) => (repCounts.get(r.key) ?? 0) >= r.target).length;
  const certSigned = NH_CERT_SIGNERS.filter((s) => checked.has(s.key)).length;
  const units = NH_TOTAL_ITEMS + allReps.length;
  const done = itemsDone + repsDone;
  return {
    itemsDone, weeksSigned, coveSigned, repsDone, repsTotal: allReps.length, certSigned,
    pct: units ? Math.round((done / units) * 100) : 0,
  };
}
