// Training programs — the list the dashboard knows about.
//
// A program is a Print Station file (a self-contained SPA that embeds every
// document of the program as base64 — see hooks/useTrainingDocs.ts) whose
// documents include a "Master Sign-Off Sheet" in the sheet markup that
// lib/signoffSheet.ts parses; an "…Schedule" document is optional (the
// engineer's first tab). Adding a program = one entry here + the file at
// its path. Assignments and every record are keyed by `key`
// (new_hire_enrollments / _checkoffs / _rep_logs / _doc_activity.program_key,
// migration 0132) — never change a key once anyone is assigned.
export type TrainingProgram = {
  key: string;
  title: string;
  /** Roster pill / tab label. */
  short: string;
  /** URL of the program's Print Station under web/public (spaces allowed; encodeURI is applied). */
  printStation: string;
  /** false → listed as "coming", cannot be assigned yet. */
  available: boolean;
};

export const PROGRAMS: TrainingProgram[] = [
  {
    key: 'upark_l1_plan_b',
    title: 'UPark New-Hire — 8-Week Program (Plan B · Level 1)',
    short: 'New-hire 8-week',
    printStation: '/training/new hire 8 weeks training package/new_hire_print_station.html',
    available: true,
  },
  {
    key: 'upark_hvac_license_dev',
    title: 'Licensed HVAC Development Program',
    short: 'Licensed HVAC',
    printStation: '/training/licensed hvac development program/print_station.html',
    available: true,
  },
  {
    key: 'upark_categories_5',
    title: '5 category training (refrigeration · electrical · building knowledge · …) — coming',
    short: '5 categories',
    printStation: '',
    available: false,
  },
];

export const DEFAULT_PROGRAM = PROGRAMS[0];
export const PROGRAM_BY_KEY: Record<string, TrainingProgram> = Object.fromEntries(PROGRAMS.map((p) => [p.key, p]));
export const programFor = (key: string | null | undefined): TrainingProgram => (key && PROGRAM_BY_KEY[key]) || { key: key ?? '?', title: key ?? 'Unknown program', short: key ?? '?', printStation: '', available: false };
