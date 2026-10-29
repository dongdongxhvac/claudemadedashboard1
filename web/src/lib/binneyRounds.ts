// Binney St clusters · rounds rotation · weekend plans — pure types + helpers.
// Data lives in site_reference (jsonb docs) and weekend_plans (0154); this
// file is the shape contract + the week-A/B math + the name resolver used to
// put a cluster badge next to the first names the managers write on their
// sheets ("Herb", "Rick", "Harry", "Mike", "Bob"…).
import { addDays } from './dashboard';

export type Cluster = 'east' | 'west';
export type GroupCode = 'E1' | 'E2' | 'EBMS' | 'W1' | 'W2' | 'WBMS';
export type WeekLetter = 'A' | 'B';
export type Crew = 'saturday' | 'sunday' | null;
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};
export const GROUP_CODES: GroupCode[] = ['E1', 'E2', 'EBMS', 'W1', 'W2', 'WBMS'];

export const CLUSTER_LABEL: Record<Cluster, string> = { east: 'East', west: 'West' };

/** Badge / header tints per cluster (light theme; matches FocusBoardBanner's palette). */
export const CLUSTER_STYLE: Record<Cluster, { letter: string; bg: string; fg: string; border: string }> = {
  east: { letter: 'E', bg: '#dbeafe', fg: '#1e40af', border: '#bfdbfe' },
  west: { letter: 'W', bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
};

/** Form control border/background used across the Binney ops section. */
export const inputStyle = { borderColor: 'var(--color-border)', background: 'var(--color-card)' } as const;

export type RoundsRotation = {
  anchor_sunday: string;                               // a Sunday whose week is anchor_week
  anchor_week: WeekLetter;
  wednesday_rule: Record<WeekLetter, 'saturday' | 'sunday'>; // which crew walks the Wednesday round
  groups: { code: GroupCode; label: string; cluster: Cluster }[];
  weeks: Record<WeekLetter, Record<DayKey, Record<GroupCode, string>>>;
  trainees?: Partial<Record<GroupCode, string>>;
  group_stats?: Partial<Record<GroupCode, { points: number; hours: number }>>;
  cluster_stats?: Partial<Record<Cluster, { points: number; hours: number }>>;
  roles?: { role: string; duty: string }[];
  weekend_staffing?: Record<'saturday' | 'sunday', { floaters: number; leads: number }>;
  note?: string;
};

export type PmPlanGroup = {
  key: string;
  label: string;
  manager: string | null;
  saturday: string[];
  sunday: string[];
  pm_hours: number;      // PM hours per engineer per month
  month_hours: number;   // group total per month (= pm_hours × headcount)
};
export type PmPlan = {
  groups: PmPlanGroup[];
  totals: { month_hours: number; days_per_week: number; weeks: number; hours_per_day: number; hours_per_month: number };
};

export type PlanLevel = 'info' | 'alert' | 'warning';
export type PlanItem = { text: string; level?: PlanLevel };
export type WeekendRounds = Partial<Record<'saturday' | 'sunday', Partial<Record<GroupCode, string>>>>;
export type WeekendPlan = {
  id: string;
  site_code: string;
  weekend_start: string;         // the Saturday, YYYY-MM-DD
  manager_on_call: string | null;
  notes: PlanItem[];
  rounds: WeekendRounds;
  saturday_items: PlanItem[];
  sunday_items: PlanItem[];
  reminders: PlanItem[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function otherWeek(w: WeekLetter): WeekLetter {
  return w === 'A' ? 'B' : 'A';
}

/** Local-midnight Sunday on/before d. */
export function sundayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/** Saturday on/after d (today if d is a Saturday). */
export function saturdayOnOrAfter(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + ((6 - x.getDay() + 7) % 7));
  return x;
}

/** Which rotation week (A/B) the Sun–Sat week containing d is. */
export function weekLetterFor(d: Date, rot: Pick<RoundsRotation, 'anchor_sunday' | 'anchor_week'>): WeekLetter {
  const anchor = new Date(rot.anchor_sunday + 'T00:00:00');
  const weeks = Math.round((sundayOf(d).getTime() - anchor.getTime()) / (7 * 86_400_000));
  const even = ((weeks % 2) + 2) % 2 === 0;
  return even ? rot.anchor_week : otherWeek(rot.anchor_week);
}

/** This week's Wednesday and the next n−1, each with its week letter and the
 *  crew that walks the Wednesday round (the sheet's DATE / Rounds table). */
export function upcomingWednesdays(from: Date, n: number, rot: RoundsRotation) {
  const wed = addDays(sundayOf(from), 3);
  const out: { date: Date; week: WeekLetter; crew: 'saturday' | 'sunday' }[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(wed, 7 * i);
    const week = weekLetterFor(date, rot);
    out.push({ date, week, crew: rot.wednesday_rule[week] });
  }
  return out;
}

export function dayKeyOf(d: Date): DayKey {
  return DAY_KEYS[d.getDay()];
}

// ── name resolution ────────────────────────────────────────────────────────

/** Nicknames the sheets use → first names in users.full_name. */
const NICKNAMES: Record<string, string[]> = {
  herb: ['herbert'],
  rick: ['richard'], ricky: ['richard'], rich: ['richard'], dick: ['richard'],
  harry: ['herayre', 'heryare'],
  mike: ['michael'],
  bob: ['robert'], bobby: ['robert'], rob: ['robert'],
  ed: ['edward'], eddie: ['edward'],
  joe: ['jose', 'joseph'],
  tommy: ['thomas'], tom: ['thomas'],
  danny: ['danjel', 'daniel'],
  kev: ['kevin'],
  pete: ['peter'],
};

export type NameTarget = {
  user_id: string;
  full_name: string;
  role: string;
  cmms_assignee_name?: string | null;
  crew?: Crew;
};

const NON_NAMES = new Set(['', '-', '—', 'floater', 'floaters', 'tbd', 'open', 'n/a', 'na']);

/** Split a sheet cell ("Kevin/Gary", "Herb & Kyle", "Alberto, Mike") into tokens. */
export function splitNames(cell: string | null | undefined): string[] {
  if (!cell) return [];
  return cell.split(/\s*[/,&+]\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
}

/** Resolve one token to a person. Exact full name → nickname/first-name
 *  match (engineers preferred over managers; a crew hint narrows further) →
 *  "First Last-prefix". Null when unknown or ambiguous. */
export function resolveName<T extends NameTarget>(token: string, people: T[], crewHint?: Crew): T | null {
  const t = token.trim().toLowerCase();
  if (NON_NAMES.has(t)) return null;
  const exact = people.find((p) => p.full_name.toLowerCase() === t || (p.cmms_assignee_name ?? '').toLowerCase() === t);
  if (exact) return exact;
  const [first, ...rest] = t.split(/\s+/);
  const firsts = new Set([first, ...(NICKNAMES[first] ?? [])]);
  let cands = people.filter((p) => {
    const f = p.full_name.toLowerCase().split(/\s+/)[0];
    return firsts.has(f) || (first.length >= 3 && f.startsWith(first));
  });
  if (rest.length) {
    const lastPrefix = rest.join(' ').replace(/\./g, '');
    const narrowed = cands.filter((p) => p.full_name.toLowerCase().split(/\s+/).slice(1).join(' ').startsWith(lastPrefix));
    if (narrowed.length) cands = narrowed;
  }
  if (cands.length > 1) {
    const eng = cands.filter((p) => p.role === 'engineer');
    if (eng.length) cands = eng;
  }
  if (cands.length > 1 && crewHint) {
    const crewed = cands.filter((p) => p.crew === crewHint);
    if (crewed.length) cands = crewed;
  }
  return cands.length === 1 ? cands[0] : null;
}

/** "First L." */
export function shortName(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function fmtMd(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtIsoMd(iso: string): string {
  return fmtMd(new Date(iso + 'T00:00:00'));
}

/** Parse a textarea into plan items: one per line; "!" prefix = alert
 *  (red), "!!" = warning (red, bold). Blank lines dropped. */
export function parsePlanItems(text: string): PlanItem[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    if (l.startsWith('!!')) return { text: l.slice(2).trim(), level: 'warning' as const };
    if (l.startsWith('!')) return { text: l.slice(1).trim(), level: 'alert' as const };
    return { text: l, level: 'info' as const };
  });
}

export function planItemsToText(items: PlanItem[] | null | undefined): string {
  return (items ?? []).map((it) => (it.level === 'warning' ? '!! ' : it.level === 'alert' ? '! ' : '') + it.text).join('\n');
}
