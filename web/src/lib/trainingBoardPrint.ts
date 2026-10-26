// Print the 8-Week Tracker with the saved state on it: take the real
// print-station document (key `tracker`), write the ticks, hours, notes,
// dates, the weekly log rows and the invite body into its markup, and hand
// back the HTML for a new tab → browser print. The printout IS the
// print-station page, filled in.
import {
  currentOf, hoursOf, roundOf, notesOf, weekTicked, weekLog, inviteText, boardProgress, WEEKS, META_FIRST, ROUND_META,
  type TrainingBoardDef, type BoardRow, type BoardLogRow, type QuizPass,
} from './trainingBoard.ts';

const FILL_CSS = `
.box.on{background:#1a1f2b;position:relative}
.box.on::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.box.half{background:repeating-linear-gradient(45deg,#1a1f2b 0 2px,#fff 2px 5px)}
.wk.txt,.wk.long.txt,.ln2.txt,.note.txt{height:auto;min-height:1em;font-family:'IBM Plex Mono',monospace;font-size:.8rem;font-weight:600;color:#1a1f2b;padding:0 2px;white-space:normal}
.ln2.txt{width:auto;min-width:34px;text-align:center}
.idrow .v.txt{height:auto;min-height:1.4em;padding:0 2px}
td.fill{font-size:.84rem;line-height:1.35;white-space:pre-wrap}
.fi.st-done .t{color:#047857}.fi.st-more_work .t{color:#b45309}.fi.st-next_week .t{color:#1d4ed8}
`;

const fmt = (ymd: string | null | undefined) => (ymd ? new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const setText = (el: Element | null | undefined, text: string) => { if (!el) return; el.textContent = text; if (text) el.classList.add('txt'); };
const tick = (el: Element | null | undefined, on: boolean) => { if (el && on) el.classList.add('on'); };

export function buildTrackerPrintHtml(docHtml: string, def: TrainingBoardDef, rows: BoardRow[], opts: { name: string; startDate: string | null; site?: string; quizzes?: QuizPass[]; log?: BoardLogRow[] }): string {
  const doc = new DOMParser().parseFromString(docHtml, 'text/html');
  const style = doc.createElement('style');
  style.textContent = FILL_CSS;
  doc.head.appendChild(style);
  const prog = boardProgress(def, rows);

  // header fields
  const fields = Array.from(doc.querySelectorAll('.idrow .f'));
  for (const f of fields) {
    const lbl = (f.querySelector('.lbl')?.textContent ?? '').toLowerCase();
    const v = f.querySelector('.v');
    if (lbl.startsWith('trainee')) setText(v, opts.name);
    else if (lbl.startsWith('start')) setText(v, opts.startDate ?? '');
    else if (lbl.startsWith('site')) setText(v, opts.site ?? '');
    else if (lbl.startsWith('progress')) setText(v, `${prog.done} / ${prog.total}`);
  }

  // board — walk the same way the parser did so items line up by order
  const fgs = Array.from(doc.querySelectorAll('.board .fg'));
  def.sections.forEach((sec, si) => {
    const fg = fgs[si];
    if (!fg) return;
    const sp = prog.sections.get(sec.key);
    if (sp) setText(fg.querySelector('.fgh .cnt'), `${sp.done} / ${sp.total}`);
    const fis = Array.from(fg.querySelectorAll(':scope > .fi'));
    // one printed row can hold two parts (overview + quiz · find it / tag it): done when both are, notes labelled
    const byRow = new Map<number, typeof sec.items>();
    for (const it of sec.items) byRow.set(it.docIdx, [...(byRow.get(it.docIdx) ?? []), it]);
    for (const [docIdx, parts] of byRow) {
      const fi = fis[docIdx];
      if (!fi) continue;
      const item = parts[0];
      const curs = parts.map((pt) => ({ pt, cur: currentOf(rows, pt.key) }));
      const cur = parts.length === 1 ? curs[0].cur : {
        ...curs[0].cur,
        // done only when every part is done; otherwise the part still open wins
        status: curs.every((c) => c.cur.status === 'done') ? 'done' as const : (curs.find((c) => c.cur.status && c.cur.status !== 'done')?.cur.status ?? curs.find((c) => c.cur.status)?.cur.status ?? null),
        statusWeek: Math.max(...curs.map((c) => c.cur.statusWeek)),
        note: curs.filter((c) => c.cur.note).map((c) => `${c.pt.part === 'tagit' ? 'tag it' : 'overview'}: ${c.cur.note}`).join(' · ') || null,
      };
      if (cur.status) fi.classList.add(`st-${cur.status}`);
      const t = fi.querySelector(':scope > .t');
      const bx = fi.querySelector(':scope > .bx');
      const c = item.control;
      if (c.kind === 'hours8' || c.kind === 'rounds8') {
        const hws = t ? Array.from(t.querySelectorAll('.under .hw .wk')) : [];
        WEEKS.forEach((w, i) => { const h = hoursOf(rows, item.key, w); setText(hws[i], h == null ? '' : String(h)); });
        // the merged "Building round — each area" row: one line per round, ticked when solo
        const fi2 = item.docIdx2 == null ? null : fis[item.docIdx2];
        if (c.kind === 'rounds8' && fi2) {
          const lns = Array.from(fi2.querySelectorAll(':scope > .t .lines .ln'));
          WEEKS.forEach((w, i) => {
            const ro = roundOf(rows, item.key, w);
            const texts = notesOf(rows.find((r) => r.item_key === item.key && r.week === w)).map((n) => n.text).filter(Boolean);
            setText(lns[i]?.querySelector('.wk'), ro || texts.length ? `${w}${ro ? ` · ${ROUND_META[ro].label.toLowerCase()}` : ''}${texts.length ? ` — ${texts.join(' · ')}` : ''}` : '');
            tick(lns[i]?.querySelector('.box'), ro === 'solo');
          });
        }
      } else if (c.kind === 'weeks8') {
        const boxes = t ? Array.from(t.querySelectorAll('.under .wkb .box')) : [];
        WEEKS.forEach((w, i) => tick(boxes[i], weekTicked(rows, item.key, w)));
      } else if (c.kind === 'labels') {
        const ticks = (cur.value.ticks as string[] | undefined) ?? [];
        const wkbs = t ? Array.from(t.querySelectorAll('.under .wkb.lab')) : [];
        for (const wkb of wkbs) tick(wkb.querySelector('.box'), ticks.includes((wkb.querySelector('em')?.textContent ?? '').trim()));
      } else if (c.kind === 'areas') {
        const areas = (cur.value.areas as string[] | undefined) ?? [];
        const lns = t ? Array.from(t.querySelectorAll('.lines .ln')) : [];
        lns.forEach((ln, i) => { const a = areas[i] ?? ''; setText(ln.querySelector('.wk'), a); tick(ln.querySelector('.box'), !!a); });
      } else if (c.kind === 'count') {
        const n = Number(cur.value.n) || 0;
        const boxes = bx ? Array.from(bx.querySelectorAll('.box')) : [];
        boxes.forEach((b, i) => tick(b, i < n));
        setText(bx?.querySelector('.wk'), typeof cur.value.on === 'string' ? fmt(cur.value.on) : '');
      } else {
        // note / check / date / none
        if (c.kind === 'note') setText(t?.querySelector(':scope > .note'), cur.note ?? '');
        tick(bx?.querySelector('.box'), cur.status === 'done');
        const on = typeof cur.value.on === 'string' ? fmt(cur.value.on) : (cur.status === 'done' && cur.statusWeek ? `W${cur.statusWeek}` : '');
        setText(bx?.querySelector('.wk'), on);
        if (c.kind !== 'note' && cur.note) {
          // no note line on this row: append the note under the text
          const small = doc.createElement('small');
          small.textContent = cur.note;
          t?.appendChild(small);
        }
      }
    }
  });

  // weekly log rows (W1..W8 across the two tables)
  const trs = Array.from(doc.querySelectorAll('table tbody tr'));
  WEEKS.forEach((w, i) => {
    const tr = trs[i];
    if (!tr) return;
    const log = weekLog(def, rows, w, opts.quizzes ?? [], opts.log ?? []);
    const tds = Array.from(tr.querySelectorAll(':scope > td'));
    const habs = Array.from(tds[0]?.querySelectorAll('.hab div') ?? []);
    // the markup already carries the unit ("COVE __ h") — write the number only
    habs.forEach((d, j) => setText(d.querySelector('.ln2'), (log.tallies[j]?.value ?? '').replace(/\s*h$/, '')));
    const fill = (td: Element | undefined, lines: string[]) => { if (!td) return; td.textContent = lines.join('\n'); if (lines.length) td.classList.add('fill'); };
    fill(tds[1], log.review);
    fill(tds[2], log.done);
    fill(tds[3], log.focus);
  });

  // page 4 — first meeting, invite (current week), report dates
  const first = rows.find((r) => r.item_key === META_FIRST && r.week === 0)?.value ?? {};
  const covered = (first.covered as string[] | undefined) ?? [];
  for (const li of Array.from(doc.querySelectorAll('ul.c li'))) tick(li.querySelector('.box'), covered.includes((li.textContent ?? '').trim()));
  const dates = (first.dates as Record<string, string> | undefined) ?? {};
  for (const sig of Array.from(doc.querySelectorAll('.sigrow .sig'))) {
    const k = (sig.querySelector('.sigk')?.textContent ?? '').trim();
    const line = sig.querySelector('.sigline');
    if (line && dates[k]) { line.textContent = fmt(dates[k]); line.classList.add('txt'); (line as HTMLElement).style.height = 'auto'; }
  }
  setText(doc.querySelector('.cont .who i'), opts.name);
  const weekForInvite = Math.max(1, Math.min(8, Math.max(0, ...rows.map((r) => r.week)) || 1));
  const mail = doc.querySelector('.mail');
  if (mail) mail.textContent = inviteText(def, rows, weekForInvite, opts.name, opts.log ?? []);

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
