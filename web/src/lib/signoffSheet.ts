// The Master Sign-Off Sheet document IS the program definition.
//
// Per user 2026-09-21 the admin works from the sign-off sheet exactly as
// printed, and the engineer from the schedule printout; both live inside
// the Print Station (hooks/useTrainingDocs.ts). So nothing about the
// program is transcribed into code any more: this module parses the sheet
// document into groups → items, the rep tally, the COVE audit and the
// certification signers, and derives the PERMANENT KEY every record hangs
// on (new_hire_checkoffs.item_key / new_hire_rep_logs.rep_key):
//
//   item   <groupKey>.<slug of the item text, 40 chars>   e.g. wk1.all_assigned_workday_trainings_complete
//          groupKey = wk<n> for week groups, else a slug of the heading (admin_first_day_on_site)
//   rep    rep.<slug of the rep label>                    e.g. rep.water_treatment
//   cove   cove.<n>                                       (WK n box in the COVE audit)
//   cert   cert.new_hire | cert.mentor | cert.manager
//
// Consequence: rewording an item in the print station changes its key and
// the mentor re-ticks it (the old tick stays in the DB, harmless). Reordering
// or regrouping does not. Adding an item just adds a row.
//
// Markup the parser relies on (the sheet as built 2026-09-21):
//   .idrow .f  > .k (label) + .v (blank line)          header strip
//   table > tbody.wkgrp > tr.wkhead > td               group heading (+ .wkeys)
//           tbody.pair  > tr > td, td.init, td.date    one item
//                         tr.noter > td > .nlab        its NOTES line
//   .reps table tr > td label, td (.lv letter)? .box×N rep tally (P/D/S or plain boxes)
//   .reps "COVE hours audit" table td.wkcell "WK n" + td .box
//   .cert .sig > .sigline + .sigk "New hire — …"
// If a rebuild of the print station changes this markup, parseSignoffSheet
// throws and both pages show the message instead of a blank record.

export type SheetItem = { key: string; text: string; group: string; index: number };
export type SheetGroup = { key: string; title: string; hint: string; week: number | null; items: SheetItem[] };
export type SheetRep = { key: string; label: string; levels: string[]; target: number };
export type SheetSigner = { key: string; label: string };
export type SignoffSheet = {
  html: string;
  title: string;
  groups: SheetGroup[];
  items: SheetItem[];        // flat, document order
  reps: SheetRep[];
  coveWeeks: number[];       // e.g. [1..8]
  signers: SheetSigner[];
  fields: string[];          // header strip labels, e.g. ['New hire','Mentor','Manager','Start date']
};

export const slug = (s: string, max = 40) =>
  s.toLowerCase().normalize('NFKD').replace(/[^ -~]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max).replace(/_+$/, '') || 'x';

export function groupKeyFor(title: string): string {
  const m = /^\s*wk\s*(\d+)/i.exec(title);
  if (m) return `wk${m[1]}`;
  return slug(title.split(/\(|:/)[0], 40);   // "ADMIN — First Day On Site (manager initials)" → admin_first_day_on_site
}
export const itemKey = (groupKey: string, text: string) => `${groupKey}.${slug(text, 40)}`;
export const repKey = (label: string) => `rep.${slug(label, 30)}`;
export const coveKey = (n: number) => `cove.${n}`;
export function signerKey(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith('new hire')) return 'cert.new_hire';
  if (l.startsWith('mentor')) return 'cert.mentor';
  if (l.startsWith('manager')) return 'cert.manager';
  return `cert.${slug(label.split(/—|-/)[0], 20)}`;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

export function parseSignoffSheet(html: string): SignoffSheet {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = text(doc.querySelector('h1')) || 'Sign-Off Sheet';
  const fields = Array.from(doc.querySelectorAll('.idrow .f .k')).map(text);

  const groups: SheetGroup[] = [];
  let cur: SheetGroup | null = null;
  let index = 0;
  for (const tb of Array.from(doc.querySelectorAll('table tbody'))) {
    if (tb.classList.contains('wkgrp')) {
      const td = tb.querySelector('td');
      const hint = text(td?.querySelector('.wkeys'));
      const full = text(td);
      const t = hint && full.endsWith(hint) ? full.slice(0, full.length - hint.length).trim() : full;
      const m = /^\s*wk\s*(\d+)/i.exec(t);
      cur = { key: groupKeyFor(t), title: t, hint, week: m ? Number(m[1]) : null, items: [] };
      if (groups.some((g) => g.key === cur!.key)) cur.key = `${cur.key}_${groups.length}`;
      groups.push(cur);
    } else if (tb.classList.contains('pair')) {
      const td = tb.querySelector('tr:first-child td');
      const t = text(td);
      if (!t) continue;
      if (!cur) { cur = { key: 'items', title: 'Items', hint: '', week: null, items: [] }; groups.push(cur); }
      let key = itemKey(cur.key, t);
      while (cur.items.some((i) => i.key === key)) key += '_' + cur.items.length;
      cur.items.push({ key, text: t, group: cur.key, index: index++ });
    }
  }
  if (!groups.length) throw new Error('sign-off sheet: no verified-item table found (expected tbody.wkgrp / tbody.pair)');

  const reps: SheetRep[] = [];
  const coveWeeks: number[] = [];
  for (const table of Array.from(doc.querySelectorAll('.reps table'))) {
    const isCove = /cove hours audit/i.test(text(table.parentElement?.querySelector('h2')));
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const tds = Array.from(tr.querySelectorAll('td'));
      for (let i = 0; i + 1 < tds.length; i += 2) {
        const label = text(tds[i]);
        const boxes = tds[i + 1].querySelectorAll('.box').length;
        if (!label || !boxes) continue;
        if (isCove) { const m = /wk\s*(\d+)/i.exec(label); if (m) coveWeeks.push(Number(m[1])); continue; }
        const levels = Array.from(tds[i + 1].querySelectorAll('.lv')).map(text);
        reps.push({ key: repKey(label), label, levels, target: boxes });
      }
    }
  }

  const signers: SheetSigner[] = Array.from(doc.querySelectorAll('.cert .sig .sigk')).map((el) => {
    const label = text(el);
    return { key: signerKey(label), label };
  });

  return { html, title, groups, items: groups.flatMap((g) => g.items), reps, coveWeeks, signers, fields };
}

// ── progress ──────────────────────────────────────────────────────────────

export type SheetProgress = {
  itemsDone: number; itemsTotal: number;
  weekItemsDone: number; weekItemsTotal: number;   // WK n groups only
  repsDone: number; repsTotal: number;
  coveSigned: number; coveTotal: number;
  certSigned: number; certTotal: number;
  pct: number;                                     // week items + reps, 0..100
};

export function sheetProgress(sheet: SignoffSheet | null, checked: Set<string>, repCounts: Map<string, number>): SheetProgress {
  if (!sheet) return { itemsDone: 0, itemsTotal: 0, weekItemsDone: 0, weekItemsTotal: 0, repsDone: 0, repsTotal: 0, coveSigned: 0, coveTotal: 0, certSigned: 0, certTotal: 0, pct: 0 };
  const itemsDone = sheet.items.filter((i) => checked.has(i.key)).length;
  const weekItems = sheet.groups.filter((g) => g.week !== null).flatMap((g) => g.items);
  const weekItemsDone = weekItems.filter((i) => checked.has(i.key)).length;
  const repsDone = sheet.reps.filter((r) => (repCounts.get(r.key) ?? 0) >= r.target).length;
  const coveSigned = sheet.coveWeeks.filter((n) => checked.has(coveKey(n))).length;
  const certSigned = sheet.signers.filter((s) => checked.has(s.key)).length;
  const units = weekItems.length + sheet.reps.length;
  return {
    itemsDone, itemsTotal: sheet.items.length, weekItemsDone, weekItemsTotal: weekItems.length,
    repsDone, repsTotal: sheet.reps.length, coveSigned, coveTotal: sheet.coveWeeks.length,
    certSigned, certTotal: sheet.signers.length,
    pct: units ? Math.round(((weekItemsDone + repsDone) / units) * 100) : 0,
  };
}

// ── schedule ↔ sheet: which sheet item does a schedule "Check off" tick mean? ──

const STOP = new Set(['the', 'and', 'with', 'for', 'all', 'from', 'done', 'held', 'passed', 'rep', 'reps', 'pm', 'in', 'on', 'of', 'to', 'a', 'side', 'first', 'every', 'complete', 'verified']);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 /]+/g, ' ').split(/[\s/]+/).filter((w) => w.length >= 2 && !STOP.has(w)));

/** Best sheet item for a schedule tick, within the same week; null when nothing fits.
 *  'COVE ≥35 h' / 'COVE all 8 weeks' ticks map to the COVE audit box instead. */
export function tickTarget(tickText: string, week: number, sheet: SignoffSheet): { kind: 'item'; key: string } | { kind: 'cove'; key: string } | null {
  const t = tickText.trim();
  if (/^cove\b/i.test(t) && (/35/.test(t) || /all 8/i.test(t))) return { kind: 'cove', key: coveKey(week) };
  const g = sheet.groups.find((x) => x.week === week);
  if (!g) return null;
  const tt = tokens(t);
  if (!tt.size) return null;
  let best: SheetItem | null = null, bestScore = 0;
  for (const it of g.items) {
    const ti = tokens(it.text);
    let hit = 0;
    for (const w of tt) if (ti.has(w) || Array.from(ti).some((x) => x.startsWith(w) || w.startsWith(x))) hit++;
    const score = hit / tt.size;
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return best && bestScore >= 0.5 ? { kind: 'item', key: best.key } : null;
}

/** Quiz handout behind an item ("HVAC quiz passed …" → 'hvac'), for the score chip. */
export function quizDocForItem(itemText: string): string | null {
  const t = itemText.toLowerCase();
  if (!/quiz/.test(t)) return null;
  if (/life safety/.test(t)) return 'life_safety';
  for (const k of ['hvac', 'plumbing', 'electrical', 'bms']) if (t.includes(k)) return k;
  return null;
}

/** Schedule file chip → document key (the print station splits equipment pages into overview + tag sheet). */
export function docKeyForFile(file: string): { key: string; tagit?: string } | null {
  const f = file.toLowerCase().replace(/\.html?$/, '');
  const table: [RegExp, string, string?][] = [
    [/hvac_overview/, 'hvac'], [/plumbing_overview/, 'plumbing'], [/electrical_overview/, 'electrical'], [/life_safety_overview/, 'life_safety'], [/bms_overview/, 'bms'],
    [/boiler/, 'boiler', 'boiler_tagit'], [/chiller/, 'chiller', 'chiller_tagit'], [/cooling_tower/, 'tower', 'tower_tagit'], [/ahu/, 'ahu', 'ahu_tagit'],
    [/site_map/, 'site_map'], [/building_check/, 'building_check'], [/find_it_on_screen_example/, 'find_on_screen_example'], [/find_it_on_screen/, 'find_on_screen'],
    [/find_it_tag_it/, 'find_it_tag_it'], [/glossary/, 'glossary'], [/terminology/, 'terminology'], [/answer_key/, 'answer_key'], [/level2/, 'level2'], [/8_week_plan|schedule/, 'plan'],
  ];
  for (const [re, key, tagit] of table) if (re.test(f)) return tagit ? { key, tagit } : { key };
  return null;
}
