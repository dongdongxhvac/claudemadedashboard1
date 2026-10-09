// Tracker — constants for the per-engineer tracker (migration 0139).
//
// Three things are tracked per person:
//   1. A dated LOG of what they did (shop / reading / WO / problem / PM /
//      event), each marked by the manager as done "straight" (the assigned
//      job, no more) or as "helped the team" (stepped up, volunteered).
//   2. The PROFESSIONAL scorecard — what makes a licensed tech a
//      professional, 0-4 per trait.
//   3. The SKILLS checklist — the hands-on list, some with an SOP write-up.
// Keys are stored in the DB — never rename one once anyone has a row.

export const TRACK_KINDS = ['shop', 'reading', 'wo', 'problem', 'pm', 'event'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];
export const TRACK_KIND_LABELS: Record<TrackKind, string> = {
  shop:    'Shop',
  reading: 'Reading',
  wo:      'WO',
  problem: 'Problem',
  pm:      'PM',
  event:   'Event',
};
export const TRACK_KIND_HINTS: Record<TrackKind, string> = {
  shop:    'shop work, housekeeping, tools, stock',
  reading: 'meter / gauge readings, rounds readings, log sheets',
  wo:      'a work order worked or closed',
  problem: 'a problem found, chased or solved',
  pm:      'a preventive-maintenance task',
  event:   'an event: outage, alarm response, cold weather, client request…',
};

export const SPIRITS = ['straight', 'help_team'] as const;
export type Spirit = (typeof SPIRITS)[number];
export const SPIRIT_LABELS: Record<Spirit, string> = {
  straight:  'Straight',
  help_team: 'Helped the team',
};
export const SPIRIT_HINTS: Record<Spirit, string> = {
  straight:  'did the assigned job, as told',
  help_team: 'stepped up — volunteered, covered, helped someone else finish',
};

/** The "licensed tech is a professional" scorecard. */
export type TraitDef = { key: string; label: string; hint: string };
export const TRAITS: TraitDef[] = [
  { key: 'learning',        label: 'Learning ability',            hint: 'picks up a new system / task and keeps it' },
  { key: 'follow_direction', label: 'Reading / following direction', hint: 'reads the SOP, the print, the WO — and follows it' },
  { key: 'reliable',        label: 'Reliable',                    hint: 'shows up, on time, does what was agreed' },
  { key: 'communication',   label: 'Communication / follow-up',   hint: 'reports back, closes the loop, asks when unsure' },
  { key: 'responsibility',  label: 'Responsibility',              hint: 'finishes the task, in quality, owns the result' },
  { key: 'skills',          label: 'Skills',                      hint: 'hands-on ability on the equipment' },
  { key: 'experience',      label: 'Experience',                  hint: 'has seen it before, knows what usually goes wrong' },
  { key: 'knowledge',       label: 'Knowledge',                   hint: 'understands why — theory, sequences, the building' },
];
export const TRAIT_BY_KEY: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((t) => [t.key, t]));

export const SCORE_LABELS = ['—', 'Needs work', 'Developing', 'Solid', 'Strong'] as const; // index = score 0..4

/** The skills checklist. `sop` = the item asks for a written SOP. */
export type SkillDef = { key: string; label: string; group: string; sop?: boolean; hint?: string };
export const SKILLS: SkillDef[] = [
  // Components & electrical
  { key: 'actuator_replacement',   label: 'Actuator replacement',                   group: 'Components & electrical' },
  { key: 'contactor_replacement',  label: 'Contactor replacement',                  group: 'Components & electrical' },
  { key: 'tstat_replacement',      label: 'T-stat replacement',                     group: 'Components & electrical' },
  { key: 'name_components',        label: 'Name all the components and what they do', group: 'Components & electrical' },
  { key: 'read_electrical_diagram', label: 'Read an electrical diagram to solve a problem', group: 'Components & electrical' },
  { key: 'find_component',         label: 'Find a particular component',            group: 'Components & electrical' },
  // Reading & safety
  { key: 'as_built_reading',       label: 'As-built reading experience',            group: 'Reading & safety' },
  { key: 'pace_out',               label: 'Pace-out skill',                         group: 'Reading & safety' },
  { key: 'loto',                   label: 'LOTO experience',                        group: 'Reading & safety' },
  // Belts, sheaves, alignment
  { key: 'belt_tension_sop',       label: 'Belt tension',                           group: 'Belts, sheaves & alignment', sop: true, hint: 'write down the SOP' },
  { key: 'sheave_alignment_sop',   label: 'Sheave alignment',                       group: 'Belts, sheaves & alignment', sop: true, hint: 'write down the SOP' },
  { key: 'alignment_lab_rough',    label: 'Pump & motor alignment lab — rough',     group: 'Belts, sheaves & alignment' },
  { key: 'alignment_lab_precise',  label: 'Pump & motor alignment lab — precise',   group: 'Belts, sheaves & alignment' },
  // Refrigeration & rebuilds
  { key: 'refrigeration_cycle_sop', label: 'Refrigeration',                         group: 'Refrigeration & rebuilds', sop: true, hint: 'write down the refrigeration cycle' },
  { key: 'backflow_rebuild',       label: 'Backflow rebuild',                       group: 'Refrigeration & rebuilds' },
  { key: 'motor_rebuild',          label: 'Motor rebuild',                          group: 'Refrigeration & rebuilds' },
  { key: 'pump_rebuild',           label: 'Pump rebuild',                           group: 'Refrigeration & rebuilds' },
  // Labs
  { key: 'building_knowledge_lab', label: 'Building knowledge lab',                 group: 'Labs', hint: 'mechanical set-up, specify the equipment' },
  { key: 'control_lab',            label: 'Control lab',                            group: 'Labs' },
  { key: 'start_sequence_lab',     label: 'Equipment start sequence lab',           group: 'Labs' },
  { key: 'bms_network_lab',        label: 'BMS network infrastructure lab',         group: 'Labs', hint: 'Siemens · JCI · Delta · Schneider' },
  // Plant operations
  { key: 'cooling_tower_cleaning', label: 'Cooling tower cleaning support',         group: 'Plant operations' },
  { key: 'chiller_open_close',     label: 'Chiller open / close',                   group: 'Plant operations' },
  { key: 'boiler_open_close',      label: 'Boiler open / close',                    group: 'Plant operations' },
  { key: 'water_treatment',        label: 'Water treatment',                        group: 'Plant operations' },
  { key: 'generator_test',         label: 'Generator test',                         group: 'Plant operations' },
  // Pneumatics
  { key: 'pneumatic_knowledge',    label: 'Pneumatic knowledge',                    group: 'Pneumatics' },
  { key: 'pneumatic_experience',   label: 'Pneumatic experience',                   group: 'Pneumatics' },
];
export const SKILL_BY_KEY: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.key, s]));
export const SKILL_GROUPS: string[] = Array.from(new Set(SKILLS.map((s) => s.group)));

export const SKILL_STATUSES = ['not_started', 'learning', 'done', 'verified'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];
export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  not_started: 'Not started',
  learning:    'Learning',
  done:        'Done',
  verified:    'Verified',
};

/** Accounts that see the Tracker header link on the engineer view while the
 *  tracker is in testing (user 2026-10-09). Admin sees it in the Admin tab. */
export const TRACKER_TEST_EMAILS = ['bmrupark55@gmail.com'];
export const canSeeTrackerLink = (email: string | null | undefined): boolean =>
  !!email && TRACKER_TEST_EMAILS.includes(email.toLowerCase());
