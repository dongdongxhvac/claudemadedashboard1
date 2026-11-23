// §05 PM Audit — pure helpers shared by the queue, the review card and the
// scorecard (docs/pm-audit.md). No Supabase, no DOM: everything here runs
// under `node --experimental-strip-types` (pmAudit.test.ts).
//
// The database decides what is flagged (v_pm_audit_flags); this file only
// words it, colours it, filters it and adds it up.

export type AuditSite = 'upark' | 'binney';
export type SiteFilter = AuditSite | 'both';
export type FlagKey = 'no_photos' | 'steps_unexplained' | 'low_labor' | 'batch_close';
export type Verdict = 'pass' | 'coach' | 'fail';
export type QueuePill = 'all' | 'flagged' | 'good' | 'random' | 'open';
export type QueueReason = 'flagged' | 'good' | 'random';

/** One close event as v_pm_audit_flags returns it. Photo / steps / note
 *  columns are null until the task's pm_task_details row is loaded
 *  (has_details = false). */
export type FlagRow = {
  task_no: string;
  site_code: string;
  building_code: string | null;
  equipment: string | null;
  task_name: string | null;
  assigned_to_name: string | null;
  completed_on: string;
  week_start: string;
  pm_type: string | null;
  labor_hours: number | null;
  est_labor_hours: number | null;
  tech_week_hours: number | null;
  has_details: boolean;
  cove_task_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  close_note: string | null;
  note_count: number | null;
  note_chars: number | null;
  note_boilerplate: boolean | null;
  steps_total: number | null;
  steps_checked: number | null;
  photo_count: number | null;
  attachment_count: number | null;
  min_photos: number;
  min_note_chars: number;
  note_must_match: string | null;
  closes_within_5m: number | null;
  /** At least one photo attached. */
  has_photo: boolean | null;
  /** THICK_NOTE_CHARS or more across every note on the task. */
  note_thick: boolean | null;
  /** Under the PM's own note minimum, boilerplate, or missing its reading. Not a flag by itself. */
  note_thin: boolean | null;
  /** Some step left unchecked (flagged only when the note doesn't say why). */
  steps_open: boolean | null;
  flags: string[] | null;
  flag_count: number | null;
  /** A photo or a thick note, and no flag — queued for recognition. */
  good: boolean | null;
};

export type QueueEntry = {
  week_start: string;
  task_no: string;
  site_code: string;
  reason: QueueReason;
  flags: string[] | null;
};

export type Review = {
  id: string;
  week_start: string;
  task_no: string;
  reviewer_id: string | null;
  verdict: Verdict;
  reason_tags: string[] | null;
  note: string | null;
  reviewed_at: string | null;
};

/** A queued task: the queue entry, its (live) flags row and its review. */
export type QueueRow = {
  task_no: string;
  week_start: string;
  site_code: string;
  reason: QueueReason;
  /** Missing only if the close event is no longer visible to this viewer. */
  f: FlagRow | null;
  /** Live flags from the view; the queue's frozen list when the row is gone. */
  flags: FlagKey[];
  review: Review | null;
};

export const AUDIT_TZ = 'America/New_York';

/** Cove network per site, for the "Open in Cove" link (docs/pm-audit.md §6). */
export const COVE_NETWORK: Record<AuditSite, string> = { upark: 'OoxMP8BZJF', binney: 'moBABfC2ZR' };

export const SITE_LABEL: Record<SiteFilter, string> = { upark: 'UPark', binney: 'Binney', both: 'Both' };

/** Flag rules v2 (migration 0163, manager's call 2026-11-17):
 *    no_photos          a PM that expects photos has none AND no thick note
 *    steps_unexplained  steps left unchecked AND the note doesn't say why
 *    low_labor          under 25 % of the estimate in a light week
 *    batch_close        5+ closes within minutes, with no photo and no thick note
 *  Desk close is gone (nobody runs the Cove timer); a thin note alone and
 *  unchecked steps with a real note no longer flag. */
export const FLAG_KEYS: FlagKey[] = ['no_photos', 'steps_unexplained', 'low_labor', 'batch_close'];

export const FLAG_LABEL: Record<FlagKey, string> = {
  no_photos: 'No photos',
  steps_unexplained: 'Steps unexplained',
  low_labor: 'Low labor',
  batch_close: 'Batch close',
};

/** A note this long is evidence on its own (same number as the view). */
export const THICK_NOTE_CHARS = 100;

export const REASON_TAGS: { key: string; label: string }[] = [
  { key: 'missing_photos', label: 'Missing photos' },
  { key: 'wrong_photo', label: 'Wrong photo' },
  { key: 'note_too_thin', label: 'Note too thin' },
  { key: 'steps_skipped', label: 'Steps skipped' },
  { key: 'timing', label: 'Timing' },
  { key: 'follow_up_wo', label: 'Follow-up WO' },
  { key: 'good_example', label: 'Good example' },
];

export const VERDICT_LABEL: Record<Verdict, string> = { pass: 'Pass', coach: 'Coach', fail: 'Fail' };

export const PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.heic', '.webp'];

export function isPhotoName(name: string | null | undefined): boolean {
  const n = (name ?? '').toLowerCase();
  return PHOTO_EXT.some((e) => n.endsWith(e));
}

function isFlagKey(s: string): s is FlagKey {
  return (FLAG_KEYS as string[]).includes(s);
}

export function asFlagKeys(list: string[] | null | undefined): FlagKey[] {
  return (list ?? []).filter(isFlagKey);
}

// ---------- dates (week_start is a plain YYYY-MM-DD Monday) ----------

function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 9 – 15", or "Oct 27 – Nov 2" across a month end. */
export function weekLabel(weekStart: string): string {
  const a = parseDay(weekStart);
  const b = parseDay(addDays(weekStart, 6));
  const left = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}`;
  const right = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
  return `${left} – ${right}`;
}

/** "Nov 9" */
export function dayLabel(iso: string): string {
  const d = parseDay(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The Monday (Eastern) of the week an instant falls in, as YYYY-MM-DD — the
 *  same week the database's date_trunc('week', … at time zone) gives. */
export function weekStartOf(iso: string): string | null {
  const day = easternDay(iso);
  if (!day) return null;
  const dow = parseDay(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** The Eastern calendar day an instant falls on, as YYYY-MM-DD. */
export function easternDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: AUDIT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// ---------- a site's week ----------
//
// `week_start` is the section's week KEY and is always a Monday, at both
// sites: in the address, the queue, the reviews and every view. What differs
// is which days fall under a key (migration 0167, SQL audit_week_key):
//
//     UPark   key 2026-11-09  =  Mon Nov 9 … Sun Nov 15
//     Binney  key 2026-11-09  =  Sun Nov 8 … Sat Nov 14
//
// Binney works Sun–Wed and Wed–Sat shifts, so its week starts on the Sunday
// BEFORE the key (user 2026-11-23). The database decides which key a close or
// a labor entry gets; the client only has to label and lay out the days.

/** The first day of the week a key stands for at a site. */
export function weekFirstDay(weekStart: string, site: string | null | undefined): string {
  return site === 'binney' ? addDays(weekStart, -1) : weekStart;
}

/** "Nov 9 – 15" as the site counts the week; with both sites, both ranges. */
export function auditWeekLabel(weekStart: string, site: string | null | undefined): string {
  if (site === 'binney') return weekLabel(addDays(weekStart, -1));
  if (site === 'both') return `${weekLabel(weekStart)} · Binney ${weekLabel(addDays(weekStart, -1))}`;
  return weekLabel(weekStart);
}

const MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUN_FIRST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The Week tab's day columns: where they start and what they are called.
 *  One site: its own seven days. Both together: eight, Sunday to Sunday, so a
 *  weekday is one column for everyone — the first Sunday is Binney's, the
 *  last is UPark's. */
export function weekDays(weekStart: string, site: SiteFilter): { first: string; names: string[] } {
  if (site === 'binney') return { first: addDays(weekStart, -1), names: SUN_FIRST };
  if (site === 'both') return { first: addDays(weekStart, -1), names: [...SUN_FIRST, 'Sun'] };
  return { first: weekStart, names: MON_FIRST };
}

/** The key of the week an instant falls in at a site (JS twin of SQL
 *  audit_week_key). 'both' answers for Binney, whose week turns over first. */
export function auditWeekKeyOf(iso: string, site: string | null | undefined): string | null {
  const day = easternDay(iso);
  if (!day) return null;
  const d = site === 'binney' || site === 'both' ? addDays(day, 1) : day;
  return addDays(d, -((parseDay(d).getUTCDay() + 6) % 7));
}

export function isWeekStart(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDay(s).getTime());
}

function fmt(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: AUDIT_TZ }).format(d);
}

/** "Thu 2:54 PM" — site-local (both sites are Eastern). */
export function fmtClosed(iso: string | null | undefined): string {
  return fmt(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');
}

/** "Nov 13, 4:50 PM" */
export function fmtStamp(iso: string | null | undefined): string {
  return fmt(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Aug 14" (with the year when it is not `yearOf`'s). */
export function fmtDay(iso: string | null | undefined, yearOf?: string | null): string {
  if (!iso) return '—';
  const sameYear = !yearOf || fmt(iso, { year: 'numeric' }) === fmt(yearOf, { year: 'numeric' });
  return fmt(iso, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------- small formatters ----------

/** 0.0833 → "0.08", 0.5 → "0.5", 1 → "1.0", 6.333 → "6.33" */
export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) return '—';
  const r = Math.round(Number(h) * 100) / 100;
  const s = r.toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** "Justin Mcgaffigan" → "Justin M." */
export function shortName(full: string | null | undefined): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function pct(num: number, den: number): number | null {
  return den > 0 ? Math.round((100 * num) / den) : null;
}

export function fmtPct(p: number | null | undefined): string {
  return p === null || p === undefined ? '—' : `${p}%`;
}

/** Cove's task page. Without a loaded detail row there is no Cove id yet, so
 *  the link goes to the site's PM list instead. */
export function coveTaskUrl(site: string, coveTaskId: string | null | undefined): string {
  const net = site === 'binney' || site === 'upark' ? COVE_NETWORK[site] : null;
  if (!net) return 'https://manage.cove.is/';
  return coveTaskId
    ? `https://manage.cove.is/networks/${net}/pm-tasks/${coveTaskId}?tab=task_steps`
    : `https://manage.cove.is/networks/${net}/pm-tasks`;
}

// ---------- flag chips ----------

export type ChipTone = 'red' | 'orange' | 'blue' | 'green' | 'grey';
export type Chip = { key: string; label: string; tone: ChipTone };

/** One chip per flag, worded with the number behind it. Red = no evidence
 *  at all (no photo, no thick note); orange = the rest. */
export function flagChip(flag: FlagKey, f: FlagRow | null): Chip {
  switch (flag) {
    case 'no_photos':
      return { key: flag, label: 'No photos', tone: 'red' };
    case 'steps_unexplained':
      return { key: flag, label: f ? `Steps ${f.steps_checked ?? 0} / ${f.steps_total ?? 0} · no explanation` : FLAG_LABEL[flag], tone: 'orange' };
    case 'low_labor': {
      const p = f && f.labor_hours !== null && f.est_labor_hours ? pct(Number(f.labor_hours), Number(f.est_labor_hours)) : null;
      return { key: flag, label: p === null ? FLAG_LABEL[flag] : `Low labor ${p}%`, tone: 'orange' };
    }
    case 'batch_close': {
      const n = f?.closes_within_5m;
      return { key: flag, label: n ? `Batch close · ${Number(n) + 1} in 5 min` : FLAG_LABEL[flag], tone: 'orange' };
    }
  }
}

/** "Good PM · 3 photos + 499-char note" — what earned it. Null when the close isn't a good one. */
export function goodChip(f: FlagRow | null): Chip | null {
  if (!f?.good) return null;
  const parts: string[] = [];
  const n = f.photo_count ?? 0;
  if (f.has_photo) parts.push(`${n} photo${n === 1 ? '' : 's'}`);
  if (f.note_thick) parts.push(`${f.note_chars ?? 0}-char note`);
  return { key: 'good', label: `Good PM · ${parts.join(' + ')}`, tone: 'green' };
}

export function rowChips(row: QueueRow): Chip[] {
  const chips = row.flags.map((k) => flagChip(k, row.f));
  const good = goodChip(row.f);
  if (good) chips.push(good);
  else if (row.reason === 'good') chips.push({ key: 'good', label: 'Queued as good', tone: 'grey' });
  if (row.reason === 'random') chips.push({ key: 'random', label: 'Random sample', tone: 'blue' });
  return chips;
}

// ---------- queue: join, sort, filter ----------

/** Join the queue to its flags rows and reviews. A task closed twice in one
 *  week (reopen + reclose) has two flags rows; the later close wins. */
export function joinQueue(entries: QueueEntry[], flags: FlagRow[], reviews: Review[]): QueueRow[] {
  const fBy = new Map<string, FlagRow>();
  for (const f of flags) {
    const cur = fBy.get(f.task_no);
    if (!cur || f.completed_on > cur.completed_on) fBy.set(f.task_no, f);
  }
  const rBy = new Map(reviews.map((r) => [r.task_no, r]));
  const rows = entries.map((q): QueueRow => {
    const f = fBy.get(q.task_no) ?? null;
    return {
      task_no: q.task_no,
      week_start: q.week_start,
      site_code: q.site_code,
      reason: q.reason,
      f,
      flags: asFlagKeys(f ? f.flags : q.flags),
      review: rBy.get(q.task_no) ?? null,
    };
  });
  return sortQueue(rows);
}

/** Spec order: unreviewed first, flagged then good then random, by tech, newest close first. */
export function sortQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) => {
    const open = Number(!!a.review) - Number(!!b.review);
    if (open) return open;
    if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
    const tech = (a.f?.assigned_to_name ?? '').localeCompare(b.f?.assigned_to_name ?? '');
    if (tech) return tech;
    const ca = a.f?.completed_on ?? '';
    const cb = b.f?.completed_on ?? '';
    if (ca !== cb) return ca < cb ? 1 : -1;
    return a.task_no.localeCompare(b.task_no);
  });
}

export type QueueFilter = { pill: QueuePill; tech: string; flag: FlagKey | '' };

export function filterQueue(rows: QueueRow[], q: QueueFilter): QueueRow[] {
  return rows.filter((r) => {
    if (q.pill === 'flagged' && r.reason !== 'flagged') return false;
    if (q.pill === 'good' && r.reason !== 'good') return false;
    if (q.pill === 'random' && r.reason !== 'random') return false;
    if (q.pill === 'open' && r.review) return false;
    if (q.tech && (r.f?.assigned_to_name ?? '') !== q.tech) return false;
    if (q.flag && !r.flags.includes(q.flag)) return false;
    return true;
  });
}

export function parsePill(s: string | null): QueuePill {
  return s === 'flagged' || s === 'good' || s === 'random' || s === 'open' ? s : 'all';
}

export function parseFlag(s: string | null): FlagKey | '' {
  return s && isFlagKey(s) ? s : '';
}

/** The task to open after `current` is saved: the next unreviewed row below
 *  it in `rows`, else the first unreviewed one above it; null when none. */
export function nextOpen(rows: QueueRow[], current: string): QueueRow | null {
  const i = rows.findIndex((r) => r.task_no === current);
  const after = rows.slice(i + 1).find((r) => !r.review && r.task_no !== current);
  if (after) return after;
  return rows.slice(0, Math.max(i, 0)).find((r) => !r.review && r.task_no !== current) ?? null;
}

// ---------- week stats (queue tiles) ----------

/** The slice of a flags row the week tiles need — every close, queued or not. */
export type WeekClose = Pick<FlagRow, 'task_no' | 'site_code' | 'assigned_to_name' | 'has_details' | 'min_photos' | 'has_photo' | 'good'>;

export type WeekStats = {
  closed: number;
  bySite: Record<string, number>;
  techs: number;
  withDetails: number;
  /** Good PMs that week (a photo or a thick note, no flag), queued or not. */
  good: number;
  /** Closes with a photo over closes that expect one; null until details load. */
  photoRate: number | null;
};

export function weekStats(closes: WeekClose[]): WeekStats {
  const bySite: Record<string, number> = {};
  const techs = new Set<string>();
  let withDetails = 0;
  let good = 0;
  let need = 0;
  let ok = 0;
  for (const c of closes) {
    bySite[c.site_code] = (bySite[c.site_code] ?? 0) + 1;
    if (c.assigned_to_name) techs.add(c.assigned_to_name);
    if (!c.has_details) continue;
    withDetails++;
    if (c.good) good++;
    if (c.min_photos > 0) {
      need++;
      if (c.has_photo) ok++;
    }
  }
  return { closed: closes.length, bySite, techs: techs.size, withDetails, good, photoRate: withDetails === 0 ? null : pct(ok, need) };
}

// ---------- scorecard ----------

/** v_pm_audit_scorecard: one row per site × tech × week. */
export type ScoreRow = {
  site_code: string;
  tech: string | null;
  week_start: string;
  closed: number;
  with_details: number;
  flagged: number;
  good: number;
  photo_rate_pct: number | null;
  steps_rate_pct: number | null;
  note_rate_pct: number | null;
  week_hours: number | null;
  reviewed: number;
  pass: number;
  coach: number;
  fail: number;
  pass_rate_pct: number | null;
  top_flag: string | null;
};

/** The slice of a flags row the scorecard needs to add rates up exactly
 *  (the view only carries rounded per-week percentages). */
export type ScoreClose = Pick<FlagRow,
  'task_no' | 'site_code' | 'assigned_to_name' | 'week_start' | 'pm_type' | 'has_details'
  | 'min_photos' | 'has_photo' | 'steps_total' | 'steps_checked' | 'note_thin' | 'flags' | 'flag_count' | 'good'
>;

export type Rates = {
  closed: number;
  withDetails: number;
  flagged: number;
  good: number;
  /** Share with a photo, of closes that expect one. */
  photoRate: number | null;
  stepsRate: number | null;
  /** Share whose note is not thin. */
  noteRate: number | null;
  flagRate: number | null;
  goodRate: number | null;
};

export function ratesOf(closes: ScoreClose[]): Rates {
  let withDetails = 0, flagged = 0, good = 0, pNeed = 0, pOk = 0, sNeed = 0, sOk = 0, nOk = 0;
  for (const c of closes) {
    if ((c.flag_count ?? 0) > 0) flagged++;
    if (!c.has_details) continue;
    withDetails++;
    if (c.good) good++;
    if (c.min_photos > 0) { pNeed++; if (c.has_photo) pOk++; }
    if ((c.steps_total ?? 0) > 0) { sNeed++; if (c.steps_checked === c.steps_total) sOk++; }
    if (!c.note_thin) nOk++;
  }
  const none = withDetails === 0;
  return {
    closed: closes.length,
    withDetails,
    flagged,
    good,
    photoRate: none ? null : pct(pOk, pNeed),
    stepsRate: none ? null : pct(sOk, sNeed),
    noteRate: none ? null : pct(nOk, withDetails),
    flagRate: pct(flagged, closes.length),
    goodRate: none ? null : pct(good, withDetails),
  };
}

export type TechScore = Rates & {
  tech: string;
  site_code: string;
  /** Average of the weeks that have a labor total. */
  weekHours: number | null;
  reviewed: number;
  pass: number;
  passRate: number | null;
  /** photo_rate_pct per week of `sparkWeeks`, null where the tech closed nothing with details. */
  spark: (number | null)[];
  topFlag: FlagKey | null;
};

export type Scorecard = {
  weeks: string[];
  team: Rates & { reviewed: number; pass: number; coach: number; fail: number; passRate: number | null; firstWeekPhotoRate: number | null; firstWeekFlagRate: number | null };
  techs: TechScore[];
  flagsByReason: { flag: FlagKey; count: number }[];
  flagTotal: number;
  /** `expects` = this PM type is expected to carry a photo at all. */
  photoByType: { pmType: string; expects: boolean; rate: number | null; n: number }[];
};

function topFlagOf(closes: ScoreClose[]): FlagKey | null {
  const n = new Map<FlagKey, number>();
  for (const c of closes) for (const k of asFlagKeys(c.flags)) n.set(k, (n.get(k) ?? 0) + 1);
  let best: FlagKey | null = null;
  for (const k of FLAG_KEYS) if ((n.get(k) ?? 0) > (best ? n.get(best)! : 0)) best = k;
  return best;
}

const PM_TYPES = ['Major', 'Filter Swap', 'Minor', 'Test/Record'];

/** `weeks` = the window (ascending Mondays); `sparkWeeks` = the weeks the
 *  per-tech trend line covers (the last 8, whatever the window). */
export function buildScorecard(views: ScoreRow[], closes: ScoreClose[], weeks: string[], sparkWeeks: string[]): Scorecard {
  const inWin = new Set(weeks);
  const v = views.filter((r) => inWin.has(r.week_start));
  const c = closes.filter((r) => inWin.has(r.week_start));
  const sum = (rows: ScoreRow[], k: 'reviewed' | 'pass' | 'coach' | 'fail') => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  const first = weeks.length > 1 ? ratesOf(c.filter((r) => r.week_start === weeks[0])) : null;
  const team = {
    ...ratesOf(c),
    reviewed: sum(v, 'reviewed'), pass: sum(v, 'pass'), coach: sum(v, 'coach'), fail: sum(v, 'fail'),
    passRate: pct(sum(v, 'pass'), sum(v, 'reviewed')),
    // A first week with no details loaded has no photo/steps/note flags at
    // all, so comparing against it would show a fake swing.
    firstWeekPhotoRate: first && first.withDetails > 0 ? first.photoRate : null,
    firstWeekFlagRate: first && first.withDetails > 0 ? first.flagRate : null,
  };

  const keyOf = (site: string, tech: string | null) => `${site}|${tech ?? ''}`;
  const closesBy = new Map<string, ScoreClose[]>();
  for (const r of c) {
    const k = keyOf(r.site_code, r.assigned_to_name);
    const list = closesBy.get(k);
    if (list) list.push(r); else closesBy.set(k, [r]);
  }
  const viewsBy = new Map<string, ScoreRow[]>();
  for (const r of views) {
    const k = keyOf(r.site_code, r.tech);
    const list = viewsBy.get(k);
    if (list) list.push(r); else viewsBy.set(k, [r]);
  }
  const techs: TechScore[] = [];
  for (const [k, list] of closesBy) {
    const [site_code, tech] = k.split('|');
    const mine = viewsBy.get(k) ?? [];
    const win = mine.filter((r) => inWin.has(r.week_start));
    const hours = win.map((r) => r.week_hours).filter((h): h is number => h !== null && h !== undefined).map(Number);
    const byWeek = new Map(mine.map((r) => [r.week_start, r]));
    techs.push({
      ...ratesOf(list),
      tech: tech || 'Unassigned',
      site_code,
      weekHours: hours.length ? Math.round((10 * hours.reduce((a, h) => a + h, 0)) / hours.length) / 10 : null,
      reviewed: sum(win, 'reviewed'),
      pass: sum(win, 'pass'),
      passRate: pct(sum(win, 'pass'), sum(win, 'reviewed')),
      spark: sparkWeeks.map((w) => {
        const r = byWeek.get(w);
        return r && r.photo_rate_pct !== null && r.photo_rate_pct !== undefined ? Number(r.photo_rate_pct) : null;
      }),
      topFlag: topFlagOf(list),
    });
  }
  techs.sort((a, b) => b.closed - a.closed || a.tech.localeCompare(b.tech));

  const counts = new Map<FlagKey, number>();
  for (const r of c) for (const k of asFlagKeys(r.flags)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const flagsByReason = FLAG_KEYS.map((flag) => ({ flag, count: counts.get(flag) ?? 0 })).sort((a, b) => b.count - a.count);

  const photoByType = PM_TYPES.map((pmType) => {
    const rows = c.filter((r) => (r.pm_type ?? 'Minor') === pmType && r.has_details);
    const need = rows.filter((r) => r.min_photos > 0);
    return { pmType, expects: need.length > 0, n: need.length, rate: pct(need.filter((r) => r.has_photo).length, need.length) };
  });

  return { weeks, team, techs, flagsByReason, flagTotal: flagsByReason.reduce((a, r) => a + r.count, 0), photoByType };
}

/** The `n` Mondays ending at `lastWeek`, ascending. */
export function weeksEnding(lastWeek: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(lastWeek, -7 * (n - 1 - i)));
}

// ---------- how the week was spent ----------

/** What kind of work a labor entry is. The database names the task's kind
 *  from its name (v_audit_labor_items.bucket); the page folds the small ones
 *  together so the bar has six parts, not eight. */
export type Bucket = 'pm' | 'rounds' | 'on_demand' | 'bms' | 'work_order' | 'other';

export const BUCKETS: { key: Bucket; label: string; short: string }[] = [
  { key: 'pm', label: 'Scheduled PMs', short: 'PMs' },
  { key: 'rounds', label: 'Building rounds', short: 'Rounds' },
  { key: 'on_demand', label: 'On-demand and unscheduled tasks', short: 'On-demand' },
  { key: 'bms', label: 'BMS checks', short: 'BMS' },
  { key: 'work_order', label: 'Work orders', short: 'WOs' },
  { key: 'other', label: 'Escort, meetings, training, coverage', short: 'Other' },
];

/** The database's task kind → the page's bucket. */
export function bucketOf(raw: string | null | undefined): Bucket {
  switch (raw) {
    case 'pm': case 'rounds': case 'bms': case 'work_order': return raw;
    case 'escort': case 'meeting': return 'other';
    default: return 'on_demand'; // on_demand, unscheduled, anything new
  }
}

/** The finer name shown on each entry in the expanded list. */
export const KIND_LABEL: Record<string, string> = {
  pm: 'Scheduled PM', rounds: 'Building rounds', bms: 'BMS', work_order: 'Work order',
  escort: 'Vendor escort', meeting: 'Meeting · training · coverage', unscheduled: 'Unscheduled tasks', on_demand: 'On-demand task',
};

/** v_audit_labor_items: one labor entry on a PM task (by the person who did
 *  the work, on the day it was done), or one closed work order. */
export type LaborItem = {
  kind: 'pm' | 'wo';
  site_code: string | null;
  task_no: string;
  task_name: string | null;
  cmms_type: string | null;
  building: string | null;
  assignee_name: string | null;
  task_closed: boolean | null;
  performer: string;
  hours: number;
  performed_at: string;
  day_local: string;
  week_start: string;
  bucket: string;
};

/** v_tech_week_site_hours: the labor report's weekly total per person and site. */
export type WeekHours = { site_code: string; assigned_to_name: string | null; week_start: string; week_hours: number | null; as_of: string | null };

/** Cove's labor report for one person on one Eastern calendar day (audit_day_hours, migration 0169). */
export type DayHours = { site_code: string; day: string; assigned_to_name: string | null; hours: number | null };

/** The slice of a flags row the Week page needs for its "PMs closed" column. */
export type WeekTimeClose = Pick<FlagRow, 'task_no' | 'site_code' | 'assigned_to_name' | 'flag_count' | 'good'>;

export type TechWeek = {
  tech: string;
  site_code: string;
  /** Total hours the labor report shows for the week (the weekly poll, or its daily rows where they add up to more); null if the person is not on it. */
  logged: number | null;
  /** Hours we can put on a named task. */
  placed: number;
  /** logged − placed, never below zero: time on tasks we have not pulled yet. */
  unplaced: number;
  byBucket: Record<Bucket, number>;
  /** Hours per day column (weekDays): Monday first at UPark, Sunday first at
   *  Binney. Cove's labor report for that day where we have it — every hour by
   *  the day it was worked, work orders still open included — else what the
   *  entries on the tasks we hold add up to. */
  byDay: number[];
  /** What the entries on the tasks we hold add up to per day (the old byDay). */
  entryByDay: number[];
  /** Hours logged on a PM task assigned to someone else. */
  onOthers: number;
  /** Double-booked: this person's extra entries on a task they already have an
   *  entry on that day (the largest stands). Still inside placed / byBucket /
   *  byDay — Cove has them. */
  double: number;
  doubleByDay: number[];
  doubleItems: LaborItem[];
  tasks: number;
  closed: number;
  flagged: number;
  good: number;
  items: LaborItem[];
};

/** Someone with hours or closes that week who is not an engineer on the roster. */
export type OtherPerson = { tech: string; site_code: string; logged: number; placed: number; closed: number };

export type WeekTime = {
  techs: TechWeek[];
  /** Left off the page when a roster is given: porters, managers, vendors. */
  others: OtherPerson[];
  team: { logged: number; placed: number; unplaced: number; byBucket: Record<Bucket, number>; onOthers: number; pmTaskHours: number; people: number; double: number; doublePeople: number; noHours: number };
  /** Latest labor-report poll behind the week's totals. */
  asOf: string | null;
};

/** How a name is matched against the roster: case and spacing do not count. */
export function rosterKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The names an engineer can appear under in Cove: the profile's Cove name
 *  and the full name (some profiles have no Cove name filled in). */
export function engineerKeys(
  users: { id: string; full_name: string | null }[],
  profiles: { user_id: string; cmms_assignee_name: string | null }[],
): string[] {
  const ids = new Set(users.map((u) => u.id));
  const keys = new Set<string>();
  for (const u of users) { const k = rosterKey(u.full_name); if (k) keys.add(k); }
  for (const p of profiles) { const k = rosterKey(p.cmms_assignee_name); if (k && ids.has(p.user_id)) keys.add(k); }
  return [...keys].sort();
}

/** Which crew a shift belongs to (shifts.crew): the Sun–Wed crew, the Wed–Sat
 *  crew, or neither (a Monday–Friday shift, every UPark shift). */
export type Crew = 'sunday' | 'saturday' | null;

/** One name an engineer can appear under in Cove, with who it is: their own
 *  name, home site, whether they still work here and since when. */
export type RosterPerson = { key: string; user_id: string; crew: Crew; name: string; site: string | null; active: boolean; hired: string | null };

export function rosterPeople(
  users: { id: string; full_name: string | null; active?: boolean | null; hiring_date?: string | null }[],
  profiles: { user_id: string; cmms_assignee_name: string | null; shift_id?: string | null; home_site_id?: string | null }[],
  shifts: { id: string; crew: string | null }[],
  sites: { id: string; code: string }[] = [],
): RosterPerson[] {
  const crewOf = new Map(shifts.map((x) => [x.id, x.crew === 'sunday' || x.crew === 'saturday' ? x.crew : null] as const));
  const siteOf = new Map(sites.map((x) => [x.id, x.code] as const));
  const profile = new Map(profiles.map((x) => [x.user_id, x] as const));
  const out = new Map<string, RosterPerson>();
  for (const u of users) {
    const pr = profile.get(u.id);
    const crew: Crew = (pr?.shift_id ? crewOf.get(pr.shift_id) : null) ?? null;
    const site = (pr?.home_site_id ? siteOf.get(pr.home_site_id) : null) ?? null;
    for (const name of [u.full_name, pr?.cmms_assignee_name]) {
      const key = rosterKey(name);
      if (key && !out.has(key)) out.set(key, { key, user_id: u.id, crew, name: (u.full_name ?? name ?? '').trim(), site, active: u.active !== false, hired: u.hiring_date ?? null });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Who must have a row on the Week tab even with nothing logged (manager
 *  2026-11-23: "still show someone who doesn't document any hrs"): every
 *  active engineer whose home site is on the page and who was hired by the end
 *  of the week. One entry per person, with every name Cove may use for them. */
export type ExpectedPerson = { site: string; name: string; keys: string[] };

export function expectedEngineers(people: RosterPerson[], site: SiteFilter, lastDay: string): ExpectedPerson[] {
  const byUser = new Map<string, ExpectedPerson>();
  for (const p of people) {
    if (!p.active || !p.site || (site !== 'both' && p.site !== site)) continue;
    if (p.hired && p.hired > lastDay) continue;
    const e = byUser.get(p.user_id);
    if (e) e.keys.push(p.key); else byUser.set(p.user_id, { site: p.site, name: p.name, keys: [p.key] });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Is this a day the crew is scheduled? Same rule as the PTO panel's crew
 *  calendar: Sun–Wed crew, Wed–Sat crew, otherwise Monday to Friday. */
export function worksOn(crew: Crew | undefined, day: string): boolean {
  const dow = parseDay(day).getUTCDay(); // 0 = Sunday
  if (crew === 'sunday') return dow <= 3;
  if (crew === 'saturday') return dow >= 3;
  return dow >= 1 && dow <= 5;
}

// ---------- week tab: days against the PTO calendar ----------

export type PtoRow = { user_id: string; type: string; status: string; starts_on: string; ends_on: string; hours: number | null };

/** Green: the day agrees with the PTO calendar. Red: it does not. */
export type DayMark = { tone: 'green' | 'red'; label: string; why: string };

const PTO_SHORT: Record<string, string> = { vacation: 'Vac', sick: 'Sick', personal: 'Pers', bereavement: 'Brv', holiday: 'Hol', unpaid: 'Unpd', leave: 'Lv', short_term: 'STD', jury_duty: 'Jury' };
const PTO_WORD: Record<string, string> = { vacation: 'vacation', sick: 'sick', personal: 'personal', bereavement: 'bereavement', holiday: 'holiday', unpaid: 'unpaid', leave: 'leave', short_term: 'short-term leave', jury_duty: 'jury duty' };

/** A one-day request for under 7 hours is part of a day (late in, early out);
 *  everything else takes the whole day. Full days are 8 h at UPark, 10 h at Binney. */
function partialDay(r: PtoRow): boolean {
  return r.starts_on === r.ends_on && r.hours !== null && Number(r.hours) < 7;
}

/** One mark per day column for one person, or null where there is nothing to say.
 *
 *    no hours, whole-day approved PTO          green  (the calendar explains it)
 *    no hours on a scheduled day, no such PTO  red    (nothing explains it)
 *    hours logged on a whole-day PTO day       red    (calendar and Cove disagree; holidays excepted —
 *                                                      the crew on shift works them)
 *
 *  Only days before `today` are judged (today's hours may not be typed yet),
 *  and only the person's own week (`weekFirst` … +6): with both sites on the
 *  page there is a column outside it. */
export function dayMarks(
  byDay: number[], firstDay: string,
  o: { weekFirst: string; crew: Crew; pto: PtoRow[]; today: string },
): (DayMark | null)[] {
  const weekLast = addDays(o.weekFirst, 6);
  return byDay.map((hours, i) => {
    const day = addDays(firstDay, i);
    if (day < o.weekFirst || day > weekLast || day >= o.today) return null;
    const on = o.pto.filter((r) => r.starts_on <= day && r.ends_on >= day);
    const approved = on.filter((r) => r.status === 'approved');
    const whole = approved.find((r) => !partialDay(r));
    if (hours <= 0) {
      if (whole) return { tone: 'green', label: PTO_SHORT[whole.type] ?? 'PTO', why: `No hours logged — ${PTO_WORD[whole.type] ?? whole.type} on the PTO calendar` };
      if (!worksOn(o.crew, day)) return null;
      const part = approved.reduce((a, r) => a + Number(r.hours ?? 0), 0);
      const why = part > 0 ? `only ${fmtH(part, false)} h of PTO on the calendar`
        : on.some((r) => r.status === 'pending') ? 'the PTO request is still pending'
        : 'nothing on the PTO calendar';
      return { tone: 'red', label: '0', why: `Scheduled day, no hours logged — ${why}` };
    }
    if (whole && whole.type !== 'holiday') {
      return { tone: 'red', label: fmtH(hours), why: `${fmtH(hours, false)} h logged, but the PTO calendar has a full day of ${PTO_WORD[whole.type] ?? whole.type}` };
    }
    return null;
  });
}

function emptyBuckets(): Record<Bucket, number> {
  return { pm: 0, rounds: 0, on_demand: 0, bms: 0, work_order: 0, other: 0 };
}

function dayIndex(weekStart: string, day: string): number {
  return Math.round((parseDay(day).getTime() - parseDay(weekStart).getTime()) / 86_400_000);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per person: what the labor report says they logged, where those hours
 *  went (by the kind of task), which days, and how their closed PMs audited.
 *  One row per person and site, biggest week first. With `engineers` (roster
 *  keys) only those people get a row and count in the team totals; everyone
 *  else is listed in `others`. Which entries belong to the week is the
 *  database's call (their week_start); `firstDay` and `nDays` only say which
 *  day columns `byDay` has (weekDays). `expected` people (expectedEngineers)
 *  get a row even when they logged and closed nothing. `dayHours` is Cove's
 *  labor report per person per day: where it has a site's day, that is what
 *  the day column shows; a day it does not have falls back to the entries. */
export function buildWeekTime(
  items: LaborItem[], hours: WeekHours[], closes: WeekTimeClose[], weekStart: string,
  engineers?: ReadonlySet<string> | null, firstDay: string = weekStart, nDays = 7, expected: ExpectedPerson[] = [],
  dayHours: DayHours[] = [],
): WeekTime {
  const rows = new Map<string, TechWeek>();
  const row = (site: string | null, tech: string | null): TechWeek => {
    const k = `${site ?? ''}|${tech ?? ''}`;
    let r = rows.get(k);
    if (!r) {
      r = { tech: tech || 'Unassigned', site_code: site ?? '', logged: null, placed: 0, unplaced: 0, byBucket: emptyBuckets(), byDay: new Array<number>(nDays).fill(0), entryByDay: new Array<number>(nDays).fill(0), onOthers: 0, double: 0, doubleByDay: new Array<number>(nDays).fill(0), doubleItems: [], tasks: 0, closed: 0, flagged: 0, good: 0, items: [] };
      rows.set(k, r);
    }
    return r;
  };
  let asOf: string | null = null;
  for (const h of hours) {
    if (h.week_start !== weekStart || !h.assigned_to_name) continue;
    const r = row(h.site_code, h.assigned_to_name);
    r.logged = (r.logged ?? 0) + Number(h.week_hours ?? 0);
    if (h.as_of && (!asOf || h.as_of > asOf)) asOf = h.as_of;
  }
  for (const it of items) {
    if (it.week_start !== weekStart) continue;
    const r = row(it.site_code, it.performer);
    const hrs = Number(it.hours ?? 0);
    r.placed += hrs;
    r.byBucket[bucketOf(it.bucket)] += hrs;
    const d = dayIndex(firstDay, it.day_local);
    if (d >= 0 && d < nDays) r.byDay[d] += hrs;
    if (it.kind === 'pm' && it.assignee_name && it.assignee_name !== it.performer) r.onOthers += hrs;
    r.items.push(it);
  }
  for (const c of closes) {
    const r = row(c.site_code, c.assigned_to_name);
    r.closed++;
    if ((c.flag_count ?? 0) > 0) r.flagged++;
    if (c.good) r.good++;
  }
  // Cove's labor report by day. A site's day is "reported" once the table has
  // any row for it; then a person with no row that day worked no hours.
  const reported = new Set<string>();
  const reportHours = new Map<string, number>();
  const hasDayHours = new Set<TechWeek>();
  const lastDay = addDays(firstDay, nDays - 1);
  for (const h of dayHours) {
    if (h.day < firstDay || h.day > lastDay) continue;
    const own = weekFirstDay(weekStart, h.site_code);
    if (h.day < own || h.day > addDays(own, 6)) continue;      // both sites on the page: a column outside this site's week
    reported.add(`${h.site_code}|${h.day}`);
    const hrs = Number(h.hours ?? 0);
    if (!h.assigned_to_name || hrs <= 0) continue;
    const k = `${h.site_code}|${h.assigned_to_name}|${h.day}`;
    reportHours.set(k, (reportHours.get(k) ?? 0) + hrs);
    hasDayHours.add(row(h.site_code, h.assigned_to_name));
  }
  const team = { logged: 0, placed: 0, unplaced: 0, byBucket: emptyBuckets(), onOthers: 0, pmTaskHours: 0, people: 0, double: 0, doublePeople: 0, noHours: 0 };
  const present = [...rows.values()].filter((r) => r.logged !== null || r.placed > 0 || r.closed > 0 || hasDayHours.has(r));
  // everyone on the roster who has no row of their own at their site gets an empty one
  for (const e of expected) {
    const keys = new Set(e.keys);
    if (present.some((r) => r.site_code === e.site && keys.has(rosterKey(r.tech)))) continue;
    present.push(row(e.site, e.name));
    team.noHours++;
  }
  const isEngineer = (r: TechWeek) => !engineers || engineers.has(rosterKey(r.tech));
  const techs = present.filter(isEngineer);
  const others: OtherPerson[] = present.filter((r) => !isEngineer(r))
    .map((r) => ({ tech: r.tech, site_code: r.site_code, logged: r2(r.logged ?? 0), placed: r2(r.placed), closed: r.closed }))
    .sort((a, b) => Math.max(b.logged, b.placed) - Math.max(a.logged, a.placed) || b.closed - a.closed || a.tech.localeCompare(b.tech));
  for (const r of techs) {
    r.placed = r2(r.placed);
    r.onOthers = r2(r.onOthers);
    r.entryByDay = r.byDay.map(r2);
    r.byDay = r.entryByDay.map((h, i) => {
      const day = addDays(firstDay, i);
      return reported.has(`${r.site_code}|${day}`) ? r2(reportHours.get(`${r.site_code}|${r.tech}|${day}`) ?? 0) : h;
    });
    // The weekly figure is the report as of that week's last poll; the daily
    // rows are the same report read again since. Where they add up to more
    // (hours entered late), they are the week's total.
    const own = weekFirstDay(weekStart, r.site_code);
    let daily = 0;
    for (let i = 0; i < 7; i++) daily += reportHours.get(`${r.site_code}|${r.tech}|${addDays(own, i)}`) ?? 0;
    if (daily > (r.logged ?? 0)) r.logged = r2(daily);
    for (const b of BUCKETS) r.byBucket[b.key] = r2(r.byBucket[b.key]);
    r.unplaced = r.logged === null ? 0 : r2(Math.max(0, r.logged - r.placed));
    r.tasks = new Set(r.items.map((i) => `${i.kind}|${i.task_no}`)).size;
    r.items.sort((a, b) => a.performed_at.localeCompare(b.performed_at) || a.task_no.localeCompare(b.task_no));
    // Double-booked: of one person's entries on a task on one day, the largest
    // stands (the earliest of equals) and every other one is set apart. Which
    // came first cannot decide it: entries typed together carry the same time.
    // The catch-all "unscheduled tasks" tasks are left out — they take one
    // entry per small job, many a day, by design. Work orders carry a single
    // total, so they cannot repeat.
    const groups = new Map<string, LaborItem[]>();
    for (const it of r.items) {
      if (it.kind !== 'pm' || it.bucket === 'unscheduled') continue;
      const k = `${it.task_no}|${it.day_local}`;
      const g = groups.get(k);
      if (g) g.push(it); else groups.set(k, [it]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const keep = g.reduce((a, b) => (Number(b.hours ?? 0) > Number(a.hours ?? 0) ? b : a));
      for (const it of g) {
        if (it === keep) continue;
        const hrs = Number(it.hours ?? 0);
        r.double += hrs;
        r.doubleItems.push(it);
        const d = dayIndex(firstDay, it.day_local);
        if (d >= 0 && d < nDays) r.doubleByDay[d] += hrs;
      }
    }
    r.double = r2(r.double);
    r.doubleByDay = r.doubleByDay.map(r2);
    team.double += r.double;
    if (r.double > 0) team.doublePeople++;
    team.logged += r.logged ?? 0;
    team.placed += r.placed;
    team.unplaced += r.unplaced;
    team.onOthers += r.onOthers;
    team.pmTaskHours += r.placed - r.byBucket.work_order;
    for (const b of BUCKETS) team.byBucket[b.key] += r.byBucket[b.key];
    if ((r.logged ?? 0) > 0 || r.placed > 0) team.people++;
  }
  // biggest week first, by the number the Logged column shows (double-booked hours taken out)
  techs.sort((a, b) => netTotal(b) - netTotal(a) || a.tech.localeCompare(b.tech));
  return { techs, others, team, asOf };
}

/** A week's total under this many hours is highlighted (manager 2026-11-23). */
export const LOW_WEEK_HOURS = 32;

/** One person's hours for the week: the labor report's total, or what the
 *  entries add up to where that is more (or the report has no row). The
 *  report also counts hours on work orders still open, which no day shows. */
export function weekTotal(t: Pick<TechWeek, 'logged' | 'placed'>): number {
  return Math.max(t.logged ?? 0, t.placed);
}

/** Approved PTO hours that fall in a person's week (`weekFirst` … +6). A
 *  request that runs past the week counts in proportion: its hours are spread
 *  over the days of it the crew is scheduled (over every day of it, if none
 *  is). Any kind of approved time off counts; pending and denied do not. */
export function ptoHoursInWeek(pto: PtoRow[], weekFirst: string, crew: Crew): number {
  const weekLast = addDays(weekFirst, 6);
  let sum = 0;
  for (const r of pto) {
    if (r.status !== 'approved' || r.starts_on > weekLast || r.ends_on < weekFirst) continue;
    const hours = Number(r.hours ?? 0);
    if (r.starts_on >= weekFirst && r.ends_on <= weekLast) { sum += hours; continue; }
    let all = 0, allIn = 0, worked = 0, workedIn = 0;
    for (let d = r.starts_on; d <= r.ends_on && all < 400; d = addDays(d, 1)) {
      const inWeek = d >= weekFirst && d <= weekLast;
      all++; if (inWeek) allIn++;
      if (worksOn(crew, d)) { worked++; if (inWeek) workedIn++; }
    }
    sum += worked > 0 ? (hours * workedIn) / worked : all > 0 ? (hours * allIn) / all : 0;
  }
  return r2(sum);
}

/** The week's hours with the double-booked ones taken out — what the Week
 *  tab's Logged column and the print sheet's Total show (manager 2026-11-23:
 *  "total hrs - double hrs"). */
export function netTotal(t: Pick<TechWeek, 'logged' | 'placed' | 'double'>): number {
  return r2(Math.max(0, weekTotal(t) - t.double));
}

/** Highlight a total? Net hours plus approved PTO under the line — and not
 *  while the week is still running, when everyone is low. */
export function lowWeek(t: Pick<TechWeek, 'logged' | 'placed' | 'double'>, inProgress: boolean, ptoHours = 0): boolean {
  return !inProgress && netTotal(t) + ptoHours < LOW_WEEK_HOURS;
}

/** Scheduled days with nothing logged and no approved time off — the red 0s. */
export function missingDays(byDay: number[], marks: (DayMark | null)[] | null): number {
  return marks ? marks.filter((m, i) => m?.tone === 'red' && (byDay[i] ?? 0) <= 0).length : 0;
}

/** Whose name gets a yellow highlight, and how strong (manager 2026-11-23):
 *    'strong'  the week's total is flagged
 *    'light'   the total is fine, but a scheduled day has no hours documented */
export type Attention = 'strong' | 'light' | null;

export function attentionOf(
  t: Pick<TechWeek, 'logged' | 'placed' | 'double' | 'byDay'>, marks: (DayMark | null)[] | null, inProgress: boolean, ptoHours = 0,
): Attention {
  if (lowWeek(t, inProgress, ptoHours)) return 'strong';
  return missingDays(t.byDay, marks) > 0 ? 'light' : null;
}

export function needsAttention(
  t: Pick<TechWeek, 'logged' | 'placed' | 'double' | 'byDay'>, marks: (DayMark | null)[] | null, inProgress: boolean, ptoHours = 0,
): boolean {
  return attentionOf(t, marks, inProgress, ptoHours) !== null;
}

/** 6.333 → "6.3", 0.08 → "0.1", 0 → "" (an empty cell reads better than a zero). */
export function fmtH(h: number, blankZero = true): string {
  if (!h) return blankZero ? '' : '0';
  const r = Math.round(h * 10) / 10;
  return r === 0 ? '<0.1' : r.toFixed(1);
}

// ---------- scorecard: hours split PM / ODT / WO ----------

/** The shop's three-way split of where an engineer's hours go:
 *    PM   scheduled PM tasks (Cove type "recurring" — the monthly building-rounds tasks included)
 *    ODT  on-demand tasks, the non-scheduled PMs the shop calls NPM (Cove type "on_demand")
 *    WO   work orders, at the hours they closed with */
export type WorkType = 'pm' | 'odt' | 'wo';

export const WORK_TYPES: { key: WorkType; label: string; long: string }[] = [
  { key: 'pm', label: 'PM', long: 'Scheduled PMs' },
  { key: 'odt', label: 'ODT', long: 'On-demand tasks (NPM)' },
  { key: 'wo', label: 'WO', long: 'Work orders' },
];

export type TypeEntry = Pick<LaborItem, 'kind' | 'site_code' | 'performer' | 'week_start' | 'cmms_type' | 'hours'>;

export function workTypeOf(it: Pick<LaborItem, 'kind' | 'cmms_type'>): WorkType {
  if (it.kind === 'wo') return 'wo';
  return it.cmms_type === 'recurring' ? 'pm' : 'odt';
}

/** Hours per person, site and week, by work type. */
export type TypeHours = { site_code: string; performer: string; week_start: string; pm: number; odt: number; wo: number };

export function sumTypeHours(items: TypeEntry[]): TypeHours[] {
  const m = new Map<string, TypeHours>();
  for (const it of items) {
    const k = `${it.site_code ?? ''}|${it.performer}|${it.week_start}`;
    let r = m.get(k);
    if (!r) { r = { site_code: it.site_code ?? '', performer: it.performer, week_start: it.week_start, pm: 0, odt: 0, wo: 0 }; m.set(k, r); }
    r[workTypeOf(it)] += Number(it.hours ?? 0);
  }
  return [...m.values()];
}

export type TechHours = {
  tech: string;
  site_code: string;
  pm: number;
  odt: number;
  wo: number;
  total: number;
  /** Weeks in the window with any hours, and the average over those weeks. */
  weeks: number;
  perWeek: number;
};

export type HoursSplit = {
  techs: TechHours[];
  team: { pm: number; odt: number; wo: number; total: number };
  /** People with hours who are not engineers on the roster, and their hours. */
  others: { people: number; hours: number };
};

/** Each engineer's hours over the window, split PM / ODT / WO, biggest first.
 *  With `engineers` (roster keys) everyone else is only counted in `others`. */
export function buildHoursSplit(rows: TypeHours[], weeks: string[], engineers?: ReadonlySet<string> | null): HoursSplit {
  const inWin = new Set(weeks);
  const m = new Map<string, TechHours & { seen: Set<string> }>();
  for (const r of rows) {
    if (!inWin.has(r.week_start)) continue;
    const k = `${r.site_code}|${r.performer}`;
    let t = m.get(k);
    if (!t) { t = { tech: r.performer || 'Unassigned', site_code: r.site_code, pm: 0, odt: 0, wo: 0, total: 0, weeks: 0, perWeek: 0, seen: new Set() }; m.set(k, t); }
    t.pm += r.pm; t.odt += r.odt; t.wo += r.wo;
    if (r.pm + r.odt + r.wo > 0) t.seen.add(r.week_start);
  }
  const team = { pm: 0, odt: 0, wo: 0, total: 0 };
  const others = { people: 0, hours: 0 };
  const techs: TechHours[] = [];
  for (const { seen, ...t } of m.values()) {
    t.pm = r2(t.pm); t.odt = r2(t.odt); t.wo = r2(t.wo);
    t.total = r2(t.pm + t.odt + t.wo);
    if (t.total <= 0) continue;
    if (engineers && !engineers.has(rosterKey(t.tech))) { others.people++; others.hours = r2(others.hours + t.total); continue; }
    t.weeks = seen.size;
    t.perWeek = seen.size ? r2(t.total / seen.size) : 0;
    team.pm += t.pm; team.odt += t.odt; team.wo += t.wo; team.total += t.total;
    techs.push(t);
  }
  techs.sort((a, b) => b.total - a.total || a.tech.localeCompare(b.tech));
  return { techs, team, others };
}

// ---------- review card: timeline + notes ----------

export type HistoryEvent = {
  id?: string;
  eventType?: string;
  createdAt?: string;
  status?: string | null;
  note?: string | null;
  invokedBy?: { firstName?: string; lastName?: string } | null;
  attachments?: { name?: string; url?: string }[] | null;
  laborItem?: { hours?: number | null; performedBy?: { firstName?: string; lastName?: string } | null } | null;
};

export type TimelineItem = { key: string; at: string | null; text: string; strong?: string; tone: 'plain' | 'photo' };

function person(u: { firstName?: string; lastName?: string } | null | undefined): string {
  return shortName(`${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || null);
}

const STATUS_WORD: Record<string, string> = { in_progress: 'Started', completed: 'Completed', on_hold: 'On hold', to_do: 'Back to To do', cancelled: 'Cancelled' };

/** Cove history → the lines the review card shows, oldest first. Start and
 *  complete times are shown as they are: nobody runs the Cove timer, so the
 *  gap between them says nothing about the work. */
export function buildTimeline(history: HistoryEvent[] | null | undefined, dueDate: string | null | undefined): TimelineItem[] {
  const hist = [...(history ?? [])].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const out: TimelineItem[] = [];
  hist.forEach((h, i) => {
    const key = h.id ?? `${h.eventType}-${i}`;
    const at = h.createdAt ?? null;
    const by = h.invokedBy ? person(h.invokedBy) : null;
    switch (h.eventType) {
      case 'opened':
        out.push({ key, at, tone: 'plain', text: dueDate ? `Opened · due ${dayLabel(dueDate)}` : 'Opened' });
        break;
      case 'assignee_changed':
        out.push({ key, at, tone: 'plain', text: by ? `Assignee changed by ${by}` : 'Assignee changed' });
        break;
      case 'attachment_added': {
        const list = h.attachments ?? [];
        const photos = list.filter((a) => isPhotoName(a.name)).length;
        const files = list.length - photos;
        const parts = [photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '', files ? `${files} file${files === 1 ? '' : 's'}` : ''].filter(Boolean);
        out.push({ key, at, tone: 'photo', text: `${parts.join(' + ') || 'Attachment'} added${by ? ` by ${by}` : ''}` });
        break;
      }
      case 'status_changed': {
        const word = STATUS_WORD[h.status ?? ''] ?? `Status → ${h.status ?? '?'}`;
        out.push({ key, at, tone: 'plain', strong: word, text: `${h.status === 'in_progress' ? ' (in progress)' : ''}${by ? ` · ${by}` : ''}` });
        break;
      }
      case 'labor_item_added':
      case 'labor_item_updated':
      case 'labor_item_removed': {
        const verb = h.eventType === 'labor_item_added' ? 'logged' : h.eventType === 'labor_item_updated' ? 'changed' : 'removed';
        const hrs = h.laborItem?.hours;
        const who = h.laborItem?.performedBy ? person(h.laborItem.performedBy) : by;
        out.push({ key, at, tone: 'plain', text: `Labor ${hrs === null || hrs === undefined ? '' : `${fmtHours(hrs)} h `}${verb}${who ? ` · ${who}` : ''}` });
        break;
      }
      case 'note_added': {
        const t = (h.note ?? '').trim();
        out.push({ key, at, tone: 'plain', text: `Note added${by ? ` by ${by}` : ''}${t ? ` — “${t.length > 90 ? `${t.slice(0, 90)}…` : t}”` : ''}` });
        break;
      }
      default:
        break;
    }
  });
  return out;
}

export type TaskNote = { at: string | null; by: string | null; text: string; source: string };

/** "note_added" → "Note", "completed" → "Close box", "step:Important Notes" → "Step · Important Notes" */
export function noteSourceLabel(source: string): string {
  if (source === 'note_added') return 'Note';
  if (source === 'completed') return 'Close box';
  if (source.startsWith('step:')) return `Step · ${source.slice(5).trim() || 'text'}`;
  return source;
}
