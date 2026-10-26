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

export type BoardItem = {
  num: number; key: string; text: string; hint: string | null; section: string; control: BoardControl;
  /** index of the printed row inside its section (several parts can share one printed row) */
  docIdx: number;
  /** major equipment rows split in two (user 2026-10-26): overview + quiz · find it / tag it */
  part?: 'overview' | 'tagit';
};
/** Items in the "Find It & Tag It" section that are a major piece of equipment get the two parts. */
const EQUIPMENT_RE = /^(boiler|cooling tower|ahu|chiller|bms)\b/i;
export const PART_LABEL = { overview: 'overview + quiz', tagit: 'find it / tag it' } as const;
export const itemNum = (it: BoardItem) => `${it.num}${it.part === 'overview' ? 'a' : it.part === 'tagit' ? 'b' : ''}`;
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
/** The pill cycles none → done → next week (user 2026-10-26: no "more work"; old rows that carry it still display). */
export const STATUS_CYCLE: (BoardStatus | null)[] = [null, 'done', 'next_week'];

/** Each note carries its own mark (user 2026-10-26): missed · good ('checked' kept for old rows). */
export type BoardMark = 'missed' | 'checked' | 'good';
export const MARKS: BoardMark[] = ['missed', 'good'];
/** A note on an item for one week — several per week (value.notes). */
export type BoardNote = { text: string; mark: BoardMark | null };
const isMark = (v: unknown): v is BoardMark => v === 'missed' || v === 'checked' || v === 'good';
/** Notes of a row: value.notes, else the legacy single `note` column. */
export function notesOf(r: Pick<BoardRow, 'note' | 'value'> | null | undefined, keepEmpty = false): BoardNote[] {
  if (!r) return [];
  const raw = r.value?.notes;
  if (Array.isArray(raw)) return raw.map((n) => ({ text: keepEmpty ? String((n as BoardNote)?.text ?? '') : String((n as BoardNote)?.text ?? '').trim(), mark: isMark((n as BoardNote)?.mark) ? (n as BoardNote).mark : null })).filter((n) => keepEmpty || n.text);
  const t = (r.note ?? '').trim();
  return t ? [{ text: t, mark: isMark(r.value?.mark) ? (r.value.mark as BoardMark) : null }] : [];
}
export const noteLine = (n: BoardNote) => `${n.mark ? MARK_META[n.mark].short + ' ' : ''}${n.text}`;
/** Every note on an item, newest week last, with its week. */
export const allNotes = (rows: BoardRow[], itemKey: string) => rows.filter((r) => r.item_key === itemKey).sort((a, b) => a.week - b.week).flatMap((r) => notesOf(r).map((n) => ({ ...n, week: r.week })));
export const MARK_META: Record<BoardMark, { label: string; short: string; color: string; bg: string }> = {
  missed:  { label: 'Missed',  short: '✗', color: '#b91c1c', bg: 'rgba(239,68,68,0.14)' },
  checked: { label: 'Checked', short: '✓', color: '#1d4ed8', bg: 'rgba(59,130,246,0.14)' },
  good:    { label: 'Good',    short: '★', color: '#047857', bg: 'rgba(16,185,129,0.14)' },
};
/** Score 1–4 per item (value.score). Sections 1 · 2 · 6 (COVE, PlantLog / site /
 *  buildings, Setup) are activity lists, not skills — no score there (user 2026-10-26). */
export const SCORES = [1, 2, 3, 4] as const;
export const SCORE_LABELS: Record<number, string> = { 1: 'needs work', 2: 'developing', 3: 'solid', 4: 'strong' };
export const NO_SCORE_SECTIONS = [1, 2, 6];
export const isScorable = (sectionNum: number) => !NO_SCORE_SECTIONS.includes(sectionNum);
/** Scoring sets the status: 1–3 stays on the board as "next week" for review, 4 = done. */
export const statusForScore = (score: number): BoardStatus => (score >= 4 ? 'done' : 'next_week');

/** One change-log line (training_board_log, migration 0153). */
export type BoardLogField = 'status' | 'score' | 'mark' | 'note' | 'hours' | 'value' | 'reset';
export type BoardLogRow = {
  id: string; user_id: string; program_key: string; item_key: string; week: number;
  field: BoardLogField; old: string | null; new: string | null; changed_on: string; changed_by: string | null; created_at: string;
};
export type BoardLogInput = Pick<BoardLogRow, 'item_key' | 'week' | 'field' | 'old' | 'new'>;

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
/** Week chips are review sessions, not calendar weeks (user 2026-10-26): clicking W1 stamps today
 *  as that session's date. Stored once, week 0, value {dates: {'1': 'YYYY-MM-DD', …}}. */
export const META_WEEKS = 'meta.weeks';
export function weekDates(rows: Pick<BoardRow, 'item_key' | 'week' | 'value'>[]): Record<number, string> {
  const v = rows.find((r) => r.item_key === META_WEEKS && r.week === 0)?.value?.dates;
  const out: Record<number, string> = {};
  if (v && typeof v === 'object') for (const [k, d] of Object.entries(v as Record<string, unknown>)) if (typeof d === 'string' && d) out[Number(k)] = d;
  return out;
}
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
    const fis = Array.from(fg.querySelectorAll(':scope > .fi'));
    let split = false;
    fis.forEach((fi, docIdx) => {
      const t = fi.querySelector(':scope > .t');
      if (!t) return;
      const text = ownText(t);
      const hint = txt(t.querySelector(':scope > small')) || null;
      const base: BoardItem = { num: Number(txt(fi.querySelector('.num'))) || sec.items.length + 1, key: slug(text, 40), text, hint, section: sec.key, control: controlFor(fi), docIdx };
      if (/find it/i.test(stitle) && EQUIPMENT_RE.test(text)) {
        split = true;
        // the overview part keeps the row's own key (earlier records stay attached to it)
        sec.items.push({ ...base, part: 'overview', text: `${text} · ${PART_LABEL.overview}` });
        sec.items.push({ ...base, key: `${base.key}.tagit`, part: 'tagit', text: `${text} · ${PART_LABEL.tagit}` });
      } else {
        sec.items.push(base);
      }
    });
    if (!sec.total || split) sec.total = sec.items.length;
    sections.push(sec);
  }
  const items = sections.flatMap((s) => s.items);
  const printed = Number(/\/\s*(\d+)/.exec(txt(doc.querySelector('.idrow .v.prog')))?.[1] ?? 0);
  const total = items.length > printed ? items.length : (printed || items.length);
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
export function currentOf(rows: BoardRow[], itemKey: string): { status: BoardStatus | null; statusWeek: number; note: string | null; value: Record<string, unknown>; week: number; score: number | null; mark: BoardMark | null } {
  const mine = rows.filter((r) => r.item_key === itemKey).sort((a, b) => a.week - b.week);
  let status: BoardStatus | null = null, statusWeek = 0, note: string | null = null, value: Record<string, unknown> = {}, week = 0;
  for (const r of mine) {
    if (r.status) { status = r.status; statusWeek = r.week; }
    const ns = notesOf(r); if (ns.length) note = ns.map(noteLine).join(' · ');
    if (r.value && Object.keys(r.value).length) value = r.value;
    week = r.week;
  }
  const score = typeof value.score === 'number' ? value.score : null;
  const mark = (MARKS as string[]).includes(String(value.mark)) ? (value.mark as BoardMark) : null;
  return { status, statusWeek, note, value, week, score, mark };
}

// ── change log ─────────────────────────────────────────────────────────────
const num = (v: unknown) => (typeof v === 'number' ? v : null);
/** "n: 2 · ticks: COVE, UKG" for the control part of a value (score / mark / hours aside). */
export function summarizeValue(v: Record<string, unknown> | null | undefined): string | null {
  if (!v) return null;
  const parts: string[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (k === 'score' || k === 'mark' || k === 'hours' || k === 'notes' || x == null || x === '') continue;
    if (Array.isArray(x)) { const arr = x.filter(Boolean); if (arr.length) parts.push(`${k}: ${arr.join(', ')}`); }
    else if (typeof x === 'object') parts.push(`${k}: ${JSON.stringify(x)}`);
    else parts.push(`${k}: ${String(x)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
/** What a Save changed, per field — the lines written to training_board_log. */
export function diffRows(base: BoardRow[], saved: Pick<BoardRow, 'item_key' | 'week' | 'status' | 'note' | 'value'>[]): BoardLogInput[] {
  const out: BoardLogInput[] = [];
  for (const r of saved) {
    if (r.item_key.startsWith('meta.')) continue;   // invite / first-meeting / week dates: not a change on an item
    const b = base.find((x) => x.item_key === r.item_key && x.week === r.week) ?? null;
    const bv = b?.value ?? {}; const nv = r.value ?? {};
    const notes = notesOf(r); const bnotes = notesOf(b);
    const empty = !r.status && !notes.length && !Object.keys(nv).filter((k) => k !== 'notes').length;
    const line = (field: BoardLogField, o: string | null, n: string | null) => { if (o !== n) out.push({ item_key: r.item_key, week: r.week, field, old: o, new: n }); };
    if (empty) { if (b) line('reset', [b.status, bnotes.map(noteLine).join(' | ') || null, summarizeValue(bv)].filter(Boolean).join(' · ') || null, null); continue; }
    line('status', b?.status ?? null, r.status ?? null);
    for (let i = 0; i < Math.max(notes.length, bnotes.length); i++) line('note', bnotes[i] ? noteLine(bnotes[i]) : null, notes[i] ? noteLine(notes[i]) : null);
    line('score', num(bv.score)?.toString() ?? null, num(nv.score)?.toString() ?? null);
    line('mark', typeof bv.mark === 'string' ? bv.mark : null, typeof nv.mark === 'string' ? nv.mark : null);
    line('hours', num(bv.hours)?.toString() ?? null, num(nv.hours)?.toString() ?? null);
    line('value', summarizeValue(bv), summarizeValue(nv));
  }
  return out;
}
/** "score 2 → 3", "mark: good", "status: done", "note: …", "hours 38", "reset". */
export function describeChange(l: Pick<BoardLogRow, 'field' | 'old' | 'new'>): string {
  const label = (v: string | null) => (v == null ? '—' : v === 'more_work' ? 'more work' : v === 'next_week' ? 'next week' : v);
  switch (l.field) {
    case 'status': return l.old ? `status: ${label(l.old)} → ${label(l.new)}` : `status: ${label(l.new)}`;
    case 'score': return l.old ? `score ${l.old} → ${l.new ?? '—'}` : `score ${l.new ?? '—'}`;
    case 'mark': return l.old ? `mark: ${l.old} → ${l.new ?? '—'}` : `mark: ${l.new ?? '—'}`;
    case 'note': return l.new ? `note: ${l.new}` : `note cleared${l.old ? ` (was "${l.old}")` : ''}`;
    case 'hours': return l.new ? `hours ${l.new}${l.old ? ` (was ${l.old})` : ''}` : `hours cleared`;
    case 'value': return l.new ?? `cleared${l.old ? ` (was ${l.old})` : ''}`;
    case 'reset': return `reset${l.old ? ` (was ${l.old})` : ''}`;
  }
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

/** "Oct 24" for a YYYY-MM-DD (empty when missing). */
export const fmtDay = (ymd: string | null | undefined) => (ymd ? new Date(ymd.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

// ── weekly log (pages 2–3) ─────────────────────────────────────────────────
export type QuizPass = { week: number; title: string; score: number; total: number };
export type WeekLog = {
  week: number;
  tallies: { label: string; value: string }[];
  review: string[];     // "18 AHU (17) — X missed low static switch", "quiz passed: HVAC 15/16"
  done: string[];       // "10 HVAC"
  focus: string[];      // next-week items
};
export function weekLog(def: TrainingBoardDef, rows: BoardRow[], week: number, quizzes: QuizPass[] = [], log: BoardLogRow[] = []): WeekLog {
  const wk = rows.filter((r) => r.week === week);
  const byKey = new Map(def.items.map((it) => [it.key, it]));
  const itemName = (key: string) => { const it = byKey.get(key); return it ? `${itemNum(it)} ${it.text}` : key; };
  // every change logged this week (user 2026-10-26) — "Oct 26 · 10 HVAC — score 2 → 3"; resets live on the Reset log tab
  const changes = log.filter((l) => l.week === week && l.field !== 'reset' && byKey.has(l.item_key)).sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((l) => `${fmtDay(l.changed_on)} · ${itemName(l.item_key)} — ${describeChange(l)}`);
  const noteLogged = new Set(log.filter((l) => l.week === week && l.field === 'note').map((l) => l.item_key));
  // every line carries the date it was saved ("Oct 24 · 10 HVAC — solo")
  const name = (r: BoardRow) => { const it = byKey.get(r.item_key); return `${fmtDay(r.entered_on)} · ${it ? `${itemNum(it)} ${it.text}` : r.item_key}`; };
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
    // notes saved before the change log existed (no logged note line for them)
    ...wk.filter((r) => byKey.has(r.item_key) && !noteLogged.has(r.item_key)).sort((a, b) => (byKey.get(a.item_key)!.num - byKey.get(b.item_key)!.num)).flatMap((r) => notesOf(r).map((n) => `${name(r)} — ${noteLine(n)}`)),
    ...changes,
    ...quizzes.filter((q) => q.week === week).map((q) => `quiz passed: ${q.title} ${q.score}/${q.total}`),
  ];
  const list = (st: BoardStatus) => wk.filter((r) => r.status === st && byKey.has(r.item_key)).sort((a, b) => byKey.get(a.item_key)!.num - byKey.get(b.item_key)!.num).map(name);
  return { week, tallies, review, done: list('done'), focus: list('next_week') };
}

// ── invite (page 4) ────────────────────────────────────────────────────────
export function inviteText(def: TrainingBoardDef, rows: BoardRow[], week: number, personName: string, changes: BoardLogRow[] = []): string {
  const log = weekLog(def, rows, week, [], changes);
  const wk = rows.filter((r) => r.week === week);
  const byKey = new Map(def.items.map((it) => [it.key, it]));
  const meta = rows.find((r) => r.item_key === META_INVITE && r.week === week)?.value ?? {};
  const when = typeof meta.when === 'string' ? meta.when : '';
  const title = typeof meta.title === 'string' && meta.title ? meta.title : `8-Week Review · W${week} · ${personName}`;
  const moreWork = wk.filter((r) => r.status === 'more_work' && byKey.has(r.item_key)).map((r) => { const it = byKey.get(r.item_key)!; const n = notesOf(r).map(noteLine).join(' · '); return `${fmtDay(r.entered_on)} · ${itemNum(it)} ${it.text}${n ? ` — ${n}` : ''}`; });
  const doneCum = boardProgress(def, rows.filter((r) => r.week <= week));
  const fields = def.inviteFields.length ? def.inviteFields : ['Title', 'When', 'Focus', 'To do', 'Review with Jie', 'Done'];
  const body: Record<string, string[]> = {
    [fields[0] ?? 'Title']: [title],
    [fields[1] ?? 'When']: [when],
    [fields[2] ?? 'Focus']: log.focus,
    [fields[3] ?? 'To do']: moreWork,
    [fields[4] ?? 'Review with Jie']: [...log.done.map((d) => { const r = wk.find((x) => byKey.get(x.item_key) && `${fmtDay(x.entered_on)} · ${itemNum(byKey.get(x.item_key)!)} ${byKey.get(x.item_key)!.text}` === d); const n = r ? notesOf(r).map(noteLine).join(' · ') : ''; return n ? `${d} — ${n}` : d; }), ...log.review.filter((r) => r.startsWith('quiz passed'))],
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
