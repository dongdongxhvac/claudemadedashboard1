// 8-Week Tracker board — pure functions over the print-station document
// (key `tracker`: page 1 board, pages 2–3 weekly log, page 4 first meeting +
// invite). The document defines the board: sections, items and what each
// item records (hours per week, week boxes, count boxes, a date, a note,
// labelled boxes, area lines). Keys come from the item text, like the
// sign-off sheet — rewording an item makes a new key.
//
// State lives in training_board rows (migration 0152): one row per
// (item, week). The board shows the latest week's status/note per item; the
// weekly log row W is exactly the rows of week W.
import { slug } from './signoffSheet.ts';

export type BoardControl =
  | { kind: 'hours8' }                       // 8 blanks "1 __ 2 __ …" — hours per week
  | { kind: 'weeks8' }                       // 8 boxes labelled 1..8 — one tick per week
  | { kind: 'count'; n: number }             // n boxes + a date line — how many times
  | { kind: 'labels'; labels: string[] }     // boxes with labels (COVE · PlantLog · …)
  | { kind: 'areas'; n: number }             // n box+line pairs — named areas
  | { kind: 'note'; box: boolean }           // a note line (+ a done box and date line)
  | { kind: 'check' }                        // one box + date line
  | { kind: 'date' }                         // a date line only
  | { kind: 'none' };

export type BoardItem = { num: number; key: string; text: string; hint: string | null; section: string; control: BoardControl };
export type BoardSection = { num: number; key: string; title: string; total: number; items: BoardItem[] };
export type BoardTally = { label: string; hours: boolean; section: string | null };
export type TrainingBoardDef = {
  title: string;
  sections: BoardSection[];
  items: BoardItem[];
  total: number;                       // "____ / 35"
  logColumns: string[];                // page 2–3 table headers
  tallies: BoardTally[];               // per-week category lines (COVE h · PlantLog · …)
  firstMeeting: string[];              // page 4 checklist
  inviteFields: string[];              // Title · When · Focus · To do · Review with Jie · Done
  reportLines: string[];               // Mid-term … / 8th wk final …
  signers: string[];                   // date lines on page 4
};

export type BoardStatus = 'done' | 'more_work' | 'next_week';
export const STATUS_META: Record<BoardStatus, { label: string; short: string; color: string; bg: string }> = {
  done:      { label: 'Done',      short: '✓', color: '#047857', bg: 'rgba(16,185,129,0.14)' },
  more_work: { label: 'More work', short: '⟳', color: '#b45309', bg: 'rgba(245,158,11,0.16)' },
  next_week: { label: 'Next week', short: '→', color: '#1d4ed8', bg: 'rgba(59,130,246,0.14)' },
};
export const STATUS_CYCLE: (BoardStatus | null)[] = [null, 'done', 'more_work', 'next_week'];

/** One stored row (training_board). `value` per control: hours8 {hours:number}
 *  (that week's hours) · count {n} · labels {ticks:string[]} · areas {areas:string[]}
 *  · date/check/note {on?:string} · meta.invite {when,title} · meta.first_meeting {covered:string[], dates:{[signer]:string}}. */
export type BoardRow = {
  user_id: string; program_key: string; item_key: string; week: number;
  status: BoardStatus | null; note: string | null; value: Record<string, unknown>;
  entered_on: string; updated_by: string | null; updated_at: string;
};
export const META_INVITE = 'meta.invite';
export const META_FIRST = 'meta.first_meeting';
export const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// ── parsing ────────────────────────────────────────────────────────────────
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Own text nodes of an element (not its child elements). */
const ownText = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim();

function controlFor(fi: Element): BoardControl {
  const t = fi.querySelector(':scope > .t');
  const bx = fi.querySelector(':scope > .bx');
  if (t?.querySelector('.under .hw')) return { kind: 'hours8' };
  const labs = t ? Array.from(t.querySelectorAll('.under .wkb.lab em')).map(txt).filter(Boolean) : [];
  if (labs.length) return { kind: 'labels', labels: labs };
  if (t?.querySelector('.under .wkb')) return { kind: 'weeks8' };
  const areas = t ? t.querySelectorAll('.lines .ln').length : 0;
  if (areas) return { kind: 'areas', n: areas };
  if (t?.querySelector(':scope > .note')) return { kind: 'note', box: !!bx?.querySelector('.box') };
  const boxes = bx ? bx.querySelectorAll('.box').length : 0;
  if (boxes >= 2) return { kind: 'count', n: boxes };
  if (boxes === 1) return { kind: 'check' };
  if (bx?.querySelector('.wk')) return { kind: 'date' };
  return { kind: 'none' };
}

export function parseTrainingBoard(html: string): TrainingBoardDef {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = txt(doc.querySelector('h1')) || 'New-Hire 8-Week Board';
  const sections: BoardSection[] = [];
  for (const fg of Array.from(doc.querySelectorAll('.board .fg'))) {
    const fgh = fg.querySelector('.fgh');
    const cnt = txt(fgh?.querySelector('.cnt'));
    const head = txt(fgh).replace(cnt, '').trim();                      // "1 · COVE"
    const m = /^(\d+)\s*·\s*(.+)$/.exec(head);
    const num = m ? Number(m[1]) : sections.length + 1;
    const stitle = (m ? m[2] : head).trim();
    const total = Number(/\/\s*(\d+)/.exec(cnt)?.[1] ?? 0);
    const sec: BoardSection = { num, key: slug(stitle, 30), title: stitle, total, items: [] };
    for (const fi of Array.from(fg.querySelectorAll(':scope > .fi'))) {
      const t = fi.querySelector(':scope > .t');
      if (!t) continue;
      const text = ownText(t);
      const hint = txt(t.querySelector(':scope > small')) || null;
      sec.items.push({ num: Number(txt(fi.querySelector('.num'))) || sec.items.length + 1, key: slug(text, 40), text, hint, section: sec.key, control: controlFor(fi) });
    }
    if (!sec.total) sec.total = sec.items.length;
    sections.push(sec);
  }
  const items = sections.flatMap((s) => s.items);
  const total = Number(/\/\s*(\d+)/.exec(txt(doc.querySelector('.idrow .v.prog')))?.[1] ?? items.length);
  const logColumns = Array.from(doc.querySelectorAll('table thead th')).slice(0, 4).map(txt);
  const tallies: BoardTally[] = Array.from(doc.querySelectorAll('td.c .hab div')).slice(0, 12).map((d, i) => {
    const label = ownText(d).replace(/\bh$/, '').trim();
    return { label, hours: /\bh$/.test(ownText(d)), section: sections[i]?.key ?? null };
  }).filter((t, i, arr) => arr.findIndex((x) => x.label === t.label) === i);
  const firstMeeting = Array.from(doc.querySelectorAll('ul.c li')).map(txt);
  const mails = Array.from(doc.querySelectorAll('.mail'));
  const inviteFields = mails[0] ? Array.from(mails[0].querySelectorAll('b')).map((b) => txt(b).replace(/:$/, '')) : [];
  const reportLines = mails[1] ? txt(mails[1]).split(/(?=Mid-term|8th wk)/).map((s) => s.trim()).filter(Boolean) : [];
  const signers = Array.from(doc.querySelectorAll('.sigk')).map(txt);
  return { title, sections, items, total, logColumns, tallies, firstMeeting, inviteFields, reportLines, signers };
}

// ── state helpers ──────────────────────────────────────────────────────────
export const rowKey = (itemKey: string, week: number) => `${itemKey}:${week}`;

/** The board's current view of an item: last non-null status / note by week,
 *  and the latest row's value (cumulative controls). */
export function currentOf(rows: BoardRow[], itemKey: string): { status: BoardStatus | null; statusWeek: number; note: string | null; value: Record<string, unknown>; week: number } {
  const mine = rows.filter((r) => r.item_key === itemKey).sort((a, b) => a.week - b.week);
  let status: BoardStatus | null = null, statusWeek = 0, note: string | null = null, value: Record<string, unknown> = {}, week = 0;
  for (const r of mine) {
    if (r.status) { status = r.status; statusWeek = r.week; }
    if (r.note) note = r.note;
    if (r.value && Object.keys(r.value).length) value = r.value;
    week = r.week;
  }
  return { status, statusWeek, note, value, week };
}

export const hoursOf = (rows: BoardRow[], itemKey: string, week: number): number | null => {
  const r = rows.find((x) => x.item_key === itemKey && x.week === week);
  const h = r?.value?.hours;
  return typeof h === 'number' ? h : null;
};
export const weekTicked = (rows: BoardRow[], itemKey: string, week: number) => rows.some((r) => r.item_key === itemKey && r.week === week && r.status === 'done');

/** 0..1 for the item's own control (how much of it is filled) — the bar under each item. */
export function itemProgress(item: BoardItem, rows: BoardRow[]): number {
  const cur = currentOf(rows, item.key);
  const c = item.control;
  switch (c.kind) {
    case 'hours8': return WEEKS.filter((w) => (hoursOf(rows, item.key, w) ?? 0) > 0).length / 8;
    case 'weeks8': return WEEKS.filter((w) => weekTicked(rows, item.key, w)).length / 8;
    case 'count': return Math.min(1, (Number(cur.value.n) || 0) / c.n);
    case 'labels': return Math.min(1, ((cur.value.ticks as string[] | undefined)?.length ?? 0) / c.labels.length);
    case 'areas': return Math.min(1, ((cur.value.areas as string[] | undefined)?.filter(Boolean).length ?? 0) / c.n);
    default: return cur.status === 'done' ? 1 : cur.status === 'more_work' ? 0.5 : 0;
  }
}
/** Done on the board: the mentor's ✓ — except the per-week controls, which
 *  are done when all 8 weeks are filled (a week tick is that week's status). */
export const itemDone = (item: BoardItem, rows: BoardRow[]) => {
  const k = item.control.kind;
  if (k === 'weeks8') return itemProgress(item, rows) >= 1;
  if (k === 'hours8') return currentOf(rows, item.key).status === 'done' || itemProgress(item, rows) >= 1;
  return currentOf(rows, item.key).status === 'done';
};

export type BoardProgress = { done: number; total: number; pct: number; moreWork: number; nextWeek: number; sections: Map<string, { done: number; total: number }> };
export function boardProgress(def: TrainingBoardDef, rows: BoardRow[]): BoardProgress {
  const sections = new Map<string, { done: number; total: number }>();
  let done = 0, moreWork = 0, nextWeek = 0;
  for (const s of def.sections) {
    const d = s.items.filter((it) => itemDone(it, rows)).length;
    sections.set(s.key, { done: d, total: s.total || s.items.length });
    done += d;
  }
  for (const it of def.items) {
    const st = currentOf(rows, it.key).status;
    if (st === 'more_work') moreWork++;
    if (st === 'next_week') nextWeek++;
  }
  const total = def.total || def.items.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, moreWork, nextWeek, sections };
}

// ── weekly log (pages 2–3) ─────────────────────────────────────────────────
export type QuizPass = { week: number; title: string; score: number; total: number };
export type WeekLog = {
  week: number;
  tallies: { label: string; value: string }[];
  review: string[];     // "18 AHU (17) — X missed low static switch", "quiz passed: HVAC 15/16"
  done: string[];       // "10 HVAC"
  focus: string[];      // next-week items
};
export function weekLog(def: TrainingBoardDef, rows: BoardRow[], week: number, quizzes: QuizPass[] = []): WeekLog {
  const wk = rows.filter((r) => r.week === week);
  const byKey = new Map(def.items.map((it) => [it.key, it]));
  const name = (r: BoardRow) => { const it = byKey.get(r.item_key); return it ? `${it.num} ${it.text}` : r.item_key; };
  const tallies = def.tallies.map((t) => {
    const sec = def.sections.find((s) => s.key === t.section);
    if (t.hours) {
      const h = sec?.items.find((it) => it.control.kind === 'hours8');
      const v = h ? hoursOf(rows, h.key, week) : null;
      return { label: t.label, value: v == null ? '' : `${v} h` };
    }
    const n = sec ? sec.items.filter((it) => wk.some((r) => r.item_key === it.key && r.status === 'done')).length : 0;
    return { label: t.label, value: n ? String(n) : '' };
  });
  const review = [
    ...wk.filter((r) => r.note && byKey.has(r.item_key)).sort((a, b) => (byKey.get(a.item_key)!.num - byKey.get(b.item_key)!.num)).map((r) => `${name(r)} — ${r.note}`),
    ...quizzes.filter((q) => q.week === week).map((q) => `quiz passed: ${q.title} ${q.score}/${q.total}`),
  ];
  const list = (st: BoardStatus) => wk.filter((r) => r.status === st && byKey.has(r.item_key)).sort((a, b) => byKey.get(a.item_key)!.num - byKey.get(b.item_key)!.num).map(name);
  return { week, tallies, review, done: list('done'), focus: list('next_week') };
}

// ── invite (page 4) ────────────────────────────────────────────────────────
export function inviteText(def: TrainingBoardDef, rows: BoardRow[], week: number, personName: string): string {
  const log = weekLog(def, rows, week);
  const wk = rows.filter((r) => r.week === week);
  const byKey = new Map(def.items.map((it) => [it.key, it]));
  const meta = rows.find((r) => r.item_key === META_INVITE && r.week === week)?.value ?? {};
  const when = typeof meta.when === 'string' ? meta.when : '';
  const title = typeof meta.title === 'string' && meta.title ? meta.title : `8-Week Review · W${week} · ${personName}`;
  const moreWork = wk.filter((r) => r.status === 'more_work' && byKey.has(r.item_key)).map((r) => { const it = byKey.get(r.item_key)!; return `${it.num} ${it.text}${r.note ? ` — ${r.note}` : ''}`; });
  const doneCum = boardProgress(def, rows.filter((r) => r.week <= week));
  const fields = def.inviteFields.length ? def.inviteFields : ['Title', 'When', 'Focus', 'To do', 'Review with Jie', 'Done'];
  const body: Record<string, string[]> = {
    [fields[0] ?? 'Title']: [title],
    [fields[1] ?? 'When']: [when],
    [fields[2] ?? 'Focus']: log.focus,
    [fields[3] ?? 'To do']: moreWork,
    [fields[4] ?? 'Review with Jie']: [...log.done.map((d) => { const r = wk.find((x) => byKey.get(x.item_key) && `${byKey.get(x.item_key)!.num} ${byKey.get(x.item_key)!.text}` === d); return r?.note ? `${d} — ${r.note}` : d; }), ...log.review.filter((r) => r.startsWith('quiz passed'))],
    [fields[5] ?? 'Done']: [`${doneCum.done} / ${doneCum.total} on the board`],
  };
  return fields.map((f) => {
    const lines = body[f] ?? [];
    if (lines.length <= 1) return `${f}: ${lines[0] ?? ''}`;
    return `${f}:\n${lines.map((l) => `  • ${l}`).join('\n')}`;
  }).join('\n\n');
}

/** Which program week a timestamp falls in (1..8, 0 before start, 9 after). */
export function weekOfDate(iso: string, startDate: string | null): number {
  if (!startDate) return 0;
  const start = new Date(startDate + 'T00:00:00').getTime();
  const d = new Date(iso).getTime();
  const days = Math.floor((d - start) / 86_400_000);
  if (days < 0) return 0;
  return Math.min(9, Math.floor(days / 7) + 1);
}
