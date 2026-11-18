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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: AUDIT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const dow = parseDay(day).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
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
