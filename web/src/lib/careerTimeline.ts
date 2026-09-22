// Career timeline — pure functions (no React, no supabase) that turn a
// person's existing records into one dated, newest-first event stream for
// the engineer profile (/engineer/:id/profile), plus the auto milestones
// shown on the Milestones & certifications card.
//
// Sources (hooks/useCareerTimeline.ts fetches them):
//   users.hiring_date, career_events (0133: admin rows + level/title/
//   discipline trigger rows), certifications (0133), new_hire_enrollments /
//   _checkoffs / _rep_logs / _doc_activity (0128–0132), pm_completions
//   (0007), oncall_rotations (0012, Friday-start weeks), overtime signups,
//   PTO requests, user_account_events (0104).
// Nothing derived here is stored — rebuilt on every load, so a fix to a
// rule fixes every profile.
import type { SignoffSheet } from './signoffSheet.ts';
import { PROGRAMS, programFor } from './programs.ts';

export type CareerEventKind =
  | 'hire' | 'anniversary'
  | 'training' | 'week' | 'rep' | 'quiz' | 'certified'
  | 'pm' | 'level' | 'oncall' | 'overtime' | 'pto' | 'account'
  | 'cert' | 'title' | 'discipline' | 'promotion' | 'award' | 'note' | 'custom';

/** Who may see a row (RLS also enforces the stored ones): everyone who can
 *  open the profile / the person + manager-ish / manager-ish only. */
export type CareerAudience = 'all' | 'private' | 'managers';

export type CareerEvent = {
  id: string;                       // stable `${source}:${key}` for React keys
  kind: CareerEventKind;
  icon: string;
  date: string;                     // YYYY-MM-DD (sort key, year grouping)
  at: string | null;                // full timestamp when known (tie-break)
  title: string;
  detail: string | null;
  link: string | null;
  milestone: boolean;               // rendered large; minor rows hide behind "Show all"
  audience: CareerAudience;
  /** Set on stored career_events rows — the manager form can edit / delete them. */
  editable: CareerEventRow | null;
};

export const KIND_META: Record<CareerEventKind, { icon: string; label: string }> = {
  hire:        { icon: '🏁', label: 'Hired' },
  anniversary: { icon: '🎂', label: 'Anniversary' },
  training:    { icon: '📘', label: 'Training' },
  week:        { icon: '✅', label: 'Week signed off' },
  rep:         { icon: '🔁', label: 'Rep' },
  quiz:        { icon: '📝', label: 'Quiz' },
  certified:   { icon: '🎓', label: 'Program certified' },
  pm:          { icon: '🔧', label: 'PMs' },
  level:       { icon: '⬆️', label: 'Level' },
  oncall:      { icon: '📟', label: 'On-call' },
  overtime:    { icon: '🌙', label: 'Overtime' },
  pto:         { icon: '🌴', label: 'Time off' },
  account:     { icon: '🔑', label: 'Account' },
  cert:        { icon: '📜', label: 'Certification' },
  title:       { icon: '🏷️', label: 'Title' },
  discipline:  { icon: '🧭', label: 'Discipline' },
  promotion:   { icon: '🚀', label: 'Promotion' },
  award:       { icon: '🏅', label: 'Award' },
  note:        { icon: '🗒️', label: 'Note' },
  custom:      { icon: '📌', label: 'Event' },
};

/** Kinds an admin can pick in the "+ Add event" form (the rest are derived). */
export const EDITABLE_KINDS: CareerEventKind[] = ['promotion', 'award', 'title', 'discipline', 'training', 'note', 'custom'];

// ── source row shapes ──────────────────────────────────────────────────────
export type CareerEventRow = {
  id: string; user_id: string; kind: string; occurred_on: string; title: string; detail: string | null;
  meta: Record<string, unknown>; visibility: 'public' | 'managers'; created_by: string | null; created_at: string;
};
export type CertificationRow = {
  id: string; user_id: string; name: string; issuer: string | null; number: string | null; issued_on: string | null;
  expires_on: string | null; file_path: string | null; note: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type TimelineSources = {
  hiringDate: string | null;
  careerEvents: CareerEventRow[];
  certifications: Pick<CertificationRow, 'id' | 'name' | 'issuer' | 'issued_on' | 'expires_on'>[];
  enrollments: { program_key: string; start_date: string | null; status: string; created_at: string; updated_at: string }[];
  checkoffs: { program_key: string; item_key: string; done_at: string }[];
  repLogs: { program_key: string; rep_key: string; occurred_on: string }[];
  quizzes: { program_key: string; doc_key: string; quiz_title: string; score: number | null; total: number | null; at: string }[];
  oncall: { week_start: string; primary_user_id: string | null; secondary_user_id: string | null }[];
  /** This person's signups on finished posts (completed / closed), any order. */
  overtime: { starts_at: string; status: string }[];
  pto: { starts_on: string; ends_on: string; days: number; status: string }[];
  accountEvents: { event: string; created_at: string }[];
  /** All PM completions, ascending by first_seen_at. */
  pms: { first_seen_at: string; labor_hours: number | null }[];
};
export type TimelineContext = {
  userId: string;
  /** program key → parsed sign-off sheet (week titles, rep labels); null while loading / missing. */
  sheets: Map<string, SignoffSheet | null>;
  today: Date;
};

// ── date helpers ───────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
export const localISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** YYYY-MM-DD of a date-only string (kept as is) or a timestamp (local day). */
export function dayOf(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return localISODate(new Date(iso));
}
const addYears = (ymd: string, n: number) => {
  const d = new Date(ymd + 'T00:00:00');
  d.setFullYear(d.getFullYear() + n);
  return localISODate(d);
};
export function daysUntil(ymd: string, today: Date): number {
  const t = new Date(localISODate(today) + 'T00:00:00').getTime();
  const d = new Date(ymd + 'T00:00:00').getTime();
  return Math.round((d - t) / 86_400_000);
}

// ── XP rules (mirror supabase/migrations/0007) ─────────────────────────────
export const xpForPm = (hours: number | null | undefined) => Math.min(50, Math.max(10, 10 + Math.round((hours ?? 0) * 2)));
export const levelFromXp = (xp: number) => Math.min(10, Math.floor(Math.sqrt(xp / 100)) + 1);

export const PM_MILESTONES = [1, 50, 100, 500, 1000] as const;
const ANNIVERSARIES = [1, 2, 3, 5, 10] as const;
const ONCALL_EVERY = 10;
const OT_MILESTONES = [10, 25, 50] as const;

function ev(p: Omit<CareerEvent, 'icon' | 'editable'> & { editable?: CareerEventRow | null }): CareerEvent {
  return { icon: KIND_META[p.kind].icon, editable: null, ...p };
}

// ── derivations ────────────────────────────────────────────────────────────
/** PM count milestones + level-ups from cumulative XP (rows ascending). */
export function pmMilestones(pms: TimelineSources['pms'], opts: { levelUpsBefore?: string | null } = {}): CareerEvent[] {
  const out: CareerEvent[] = [];
  let xp = 0;
  let level = 1;
  pms.forEach((r, i) => {
    const n = i + 1;
    const date = dayOf(r.first_seen_at);
    if ((PM_MILESTONES as readonly number[]).includes(n)) {
      out.push(ev({ id: `pm:${n}`, kind: 'pm', date, at: r.first_seen_at, title: n === 1 ? 'First PM completed' : `${n} PMs completed`, detail: null, link: null, milestone: true, audience: 'all' }));
    }
    xp += xpForPm(r.labor_hours);
    const l = levelFromXp(xp);
    if (l > level) {
      level = l;
      if (!opts.levelUpsBefore || date < opts.levelUpsBefore) {
        out.push(ev({ id: `pmlevel:${l}`, kind: 'level', date, at: r.first_seen_at, title: `Reached level ${l}`, detail: `${xp.toLocaleString()} XP from PMs`, link: null, milestone: true, audience: 'all' }));
      }
    }
  });
  return out;
}

export function anniversaries(hiringDate: string | null, today: Date): CareerEvent[] {
  if (!hiringDate) return [];
  const t = localISODate(today);
  return ANNIVERSARIES.map((n) => ({ n, date: addYears(hiringDate, n) }))
    .filter((a) => a.date <= t)
    .map((a) => ev({ id: `anniv:${a.n}`, kind: 'anniversary', date: a.date, at: null, title: `${a.n} year${a.n === 1 ? '' : 's'} at UPark`, detail: null, link: null, milestone: true, audience: 'all' }));
}

export type CertExpiryState = 'none' | 'ok' | 'soon' | 'expired';
export const CERT_SOON_DAYS = 90;
export function certExpiryState(expiresOn: string | null | undefined, today: Date): CertExpiryState {
  if (!expiresOn) return 'none';
  const d = daysUntil(expiresOn, today);
  if (d < 0) return 'expired';
  if (d < CERT_SOON_DAYS) return 'soon';
  return 'ok';
}

/** Program certified date: manager signature → mentor signature → enrollment updated_at. */
function certifiedAt(programKey: string, enr: TimelineSources['enrollments'][number], checkoffs: TimelineSources['checkoffs']): string {
  const mine = checkoffs.filter((c) => c.program_key === programKey);
  return mine.find((c) => c.item_key === 'cert.manager')?.done_at
    ?? mine.find((c) => c.item_key === 'cert.mentor')?.done_at
    ?? enr.updated_at;
}

function trainingEvents(src: TimelineSources, ctx: TimelineContext): CareerEvent[] {
  const out: CareerEvent[] = [];
  for (const enr of src.enrollments) {
    const prog = programFor(enr.program_key);
    const pk = enr.program_key;
    out.push(ev({ id: `enroll:${pk}`, kind: 'training', date: dayOf(enr.start_date ?? enr.created_at), at: enr.start_date ? null : enr.created_at, title: `Enrolled: ${prog.short}`, detail: prog.title, link: '/upark/training/new-hire', milestone: false, audience: 'all' }));
    if (enr.status === 'completed') {
      const at = certifiedAt(pk, enr, src.checkoffs);
      out.push(ev({ id: `certified:${pk}`, kind: 'certified', date: dayOf(at), at, title: `${prog.short} certified`, detail: prog.title, link: '/upark/training/new-hire', milestone: true, audience: 'all' }));
    }
    const sheet = ctx.sheets.get(pk);
    const checked = new Map(src.checkoffs.filter((c) => c.program_key === pk).map((c) => [c.item_key, c.done_at]));
    if (sheet) {
      for (const g of sheet.groups) {
        if (g.week === null || g.items.length === 0) continue;
        const dates = g.items.map((it) => checked.get(it.key));
        if (dates.some((d) => !d)) continue;
        const last = dates.reduce((a, b) => (a! > b! ? a : b))!;
        out.push(ev({ id: `week:${pk}:${g.key}`, kind: 'week', date: dayOf(last), at: last, title: `Week ${g.week} signed off`, detail: `${prog.short} · ${g.title}`, link: '/upark/training/new-hire', milestone: false, audience: 'all' }));
      }
    }
    const repLabel = new Map((sheet?.reps ?? []).map((r) => [r.key, r.label]));
    src.repLogs.filter((r) => r.program_key === pk).forEach((r, i) => {
      out.push(ev({ id: `rep:${pk}:${r.rep_key}:${r.occurred_on}:${i}`, kind: 'rep', date: r.occurred_on, at: null, title: repLabel.get(r.rep_key) ?? r.rep_key.replace(/^rep\./, '').replace(/_/g, ' '), detail: `${prog.short} · rep logged`, link: null, milestone: false, audience: 'all' }));
    });
  }
  for (const q of src.quizzes) {
    if (q.score == null || !q.total || q.score / q.total < 0.8) continue;
    const prog = programFor(q.program_key);
    out.push(ev({ id: `quiz:${q.program_key}:${q.doc_key}:${q.at}`, kind: 'quiz', date: dayOf(q.at), at: q.at, title: `Quiz passed: ${q.quiz_title || q.doc_key}`, detail: `${q.score}/${q.total} · ${prog.short}`, link: '/upark/training/new-hire', milestone: false, audience: 'all' }));
  }
  return out;
}

function oncallEvents(src: TimelineSources, ctx: TimelineContext): CareerEvent[] {
  const weeks = src.oncall
    .filter((w) => w.primary_user_id === ctx.userId || w.secondary_user_id === ctx.userId)
    .filter((w) => w.week_start <= localISODate(ctx.today))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
  return weeks.map((w, i) => {
    const n = i + 1;
    const role = w.primary_user_id === ctx.userId ? 'primary' : 'secondary';
    const first = n === 1;
    const tenth = n % ONCALL_EVERY === 0;
    return ev({
      id: `oncall:${w.week_start}`, kind: 'oncall', date: w.week_start, at: null,
      title: first ? `First on-call week (${role})` : tenth ? `${n}th on-call week` : `On-call week (${role})`,
      detail: `week of ${w.week_start}`, link: '/manager#oncall', milestone: first || tenth, audience: 'all',
    });
  });
}

function overtimeEvents(src: TimelineSources): CareerEvent[] {
  const rows = src.overtime.filter((o) => o.status === 'completed' || o.status === 'closed').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return rows.map((o, i) => {
    const n = i + 1;
    const ms = (OT_MILESTONES as readonly number[]).includes(n);
    return ev({ id: `ot:${o.starts_at}:${i}`, kind: 'overtime', date: dayOf(o.starts_at), at: o.starts_at, title: ms ? `${n} overtime shifts` : 'Overtime shift', detail: null, link: '/manager#overtime', milestone: ms, audience: 'all' });
  });
}

function ptoEvents(src: TimelineSources): CareerEvent[] {
  return src.pto.filter((p) => p.status === 'approved').map((p) => ev({
    id: `pto:${p.starts_on}:${p.ends_on}`, kind: 'pto', date: p.starts_on, at: null,
    title: `Time off · ${p.days} d`, detail: p.starts_on === p.ends_on ? null : `${p.starts_on} → ${p.ends_on}`, link: null, milestone: false, audience: 'private',
  }));
}

function accountEvents(src: TimelineSources): CareerEvent[] {
  const out: CareerEvent[] = [];
  const firstOf = (event: string) => src.accountEvents.filter((e) => e.event === event).map((e) => e.created_at).sort()[0];
  const created = firstOf('auth_account_created');
  const signedIn = firstOf('signed_in');
  const pw = firstOf('password_set');
  if (created) out.push(ev({ id: 'acct:created', kind: 'account', date: dayOf(created), at: created, title: 'Account created', detail: null, link: null, milestone: false, audience: 'managers' }));
  if (pw) out.push(ev({ id: 'acct:password', kind: 'account', date: dayOf(pw), at: pw, title: 'Password set', detail: null, link: null, milestone: false, audience: 'managers' }));
  if (signedIn) out.push(ev({ id: 'acct:signin', kind: 'account', date: dayOf(signedIn), at: signedIn, title: 'First sign-in', detail: null, link: null, milestone: false, audience: 'managers' }));
  return out;
}

function storedEvents(src: TimelineSources): CareerEvent[] {
  return src.careerEvents.map((r) => {
    const kind = (r.kind in KIND_META ? r.kind : 'custom') as CareerEventKind;
    return ev({
      id: `ce:${r.id}`, kind, date: r.occurred_on, at: r.created_at, title: r.title, detail: r.detail, link: null,
      milestone: kind !== 'note', audience: r.visibility === 'managers' ? 'managers' : 'all', editable: r,
    });
  });
}

function certEvents(src: TimelineSources): CareerEvent[] {
  return src.certifications.filter((c) => c.issued_on).map((c) => ev({
    id: `cert:${c.id}`, kind: 'cert', date: c.issued_on!, at: null, title: `Certified: ${c.name}`, detail: c.issuer, link: null, milestone: true, audience: 'all',
  }));
}

/** Merge every source, newest first (date desc, timestamp desc, then id). */
export function buildCareerTimeline(src: TimelineSources, ctx: TimelineContext): CareerEvent[] {
  const stored = storedEvents(src);
  const firstStoredLevel = stored.filter((e) => e.kind === 'level').map((e) => e.date).sort()[0] ?? null;
  const all: CareerEvent[] = [
    ...(src.hiringDate ? [ev({ id: 'hire', kind: 'hire', date: src.hiringDate, at: null, title: 'Joined UPark', detail: null, link: null, milestone: true, audience: 'all' })] : []),
    ...anniversaries(src.hiringDate, ctx.today),
    ...trainingEvents(src, ctx),
    ...pmMilestones(src.pms, { levelUpsBefore: firstStoredLevel }),
    ...oncallEvents(src, ctx),
    ...overtimeEvents(src),
    ...ptoEvents(src),
    ...accountEvents(src),
    ...certEvents(src),
    ...stored,
  ];
  return all.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id));
}

// ── auto milestones for the card (earned / locked chips) ───────────────────
export type AutoMilestone = { key: string; icon: string; label: string; earnedOn: string | null; hint: string };

export function autoMilestones(src: TimelineSources, ctx: TimelineContext): AutoMilestone[] {
  const events = buildCareerTimeline(src, ctx);
  const find = (id: string) => events.find((e) => e.id === id)?.date ?? null;
  const out: AutoMilestone[] = [];
  for (const p of PROGRAMS.filter((p) => p.available)) {
    out.push({ key: `certified:${p.key}`, icon: KIND_META.certified.icon, label: `${p.short} certified`, earnedOn: find(`certified:${p.key}`), hint: `Manager signs the ${p.short} sign-off sheet` });
  }
  const firstOncall = events.filter((e) => e.kind === 'oncall').map((e) => e.date).sort()[0] ?? null;
  out.push({ key: 'oncall:first', icon: KIND_META.oncall.icon, label: 'First on-call week', earnedOn: firstOncall, hint: 'Primary or secondary on the on-call rotation' });
  out.push({ key: 'pm:100', icon: KIND_META.pm.icon, label: '100 PMs', earnedOn: find('pm:100'), hint: `${src.pms.length.toLocaleString()} PMs so far` });
  out.push({ key: 'anniv:1', icon: KIND_META.anniversary.icon, label: '1 year at UPark', earnedOn: find('anniv:1'), hint: src.hiringDate ? `Hired ${src.hiringDate}` : 'No hiring date on file' });
  return out;
}
