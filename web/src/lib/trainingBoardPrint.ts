// Print the 8-Week Tracker with the saved state on it: take the real
// print-station document (key `tracker`), write the ticks, hours, notes,
// dates, the weekly log rows and the invite body into its markup, and hand
// back the HTML for a new tab → browser print. The printout IS the
// print-station page, filled in.
import {
  currentOf, hoursOf, roundOf, notesOf, allNotes, weekTicked, weekLog, inviteText, boardProgress, splitReviewLine, splitLogLine, compactDate, WEEKS, META_FIRST, ROUND_META, MARK_META, weekCount, weeksUpTo,
  type TrainingBoardDef, type BoardRow, type BoardLogRow, type QuizPass,
} from './trainingBoard.ts';

const FILL_CSS = `
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.box.on{background:#1a1f2b;position:relative}
.box.on::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.box.half{background:repeating-linear-gradient(45deg,#1a1f2b 0 2px,#fff 2px 5px)}
.wk.txt,.wk.long.txt,.ln2.txt,.note.txt{height:auto;min-height:1em;font-family:'IBM Plex Mono',monospace;font-size:.8rem;font-weight:600;color:#1a1f2b;padding:0 2px;white-space:normal}
.ln2.txt{width:auto;min-width:34px;text-align:center}
.ln2.txt .big{font-size:1.05rem;font-weight:700}.ln2.txt .of{font-size:.7rem;font-weight:600;color:#555}
.ln2.txt .dl{font-size:.68rem;font-weight:700;color:#047857;margin-left:3px}.ln2.txt .dl.neg{color:#b91c1c}
.ln2.txt.wide{display:block;margin:0 0 2px;text-align:left;font-size:.74rem;white-space:normal;line-height:1.2}
.idrow .v.txt{height:auto;min-height:1.4em;padding:0 2px}
.note.txt,.fi .t small.notes{display:block;font-family:'Space Grotesk',sans-serif;font-size:.78rem;font-weight:500;line-height:1.2;color:#1a1f2b;margin-top:1px;padding:0;white-space:normal}
.note.txt div,.fi .t small.notes div{white-space:normal}
.fi .t .pt{font-weight:700;margin-top:1px}
.fi .t .pt .st{font-weight:600;color:#555}
.fi .t .nt{padding-left:1.9em;text-indent:-1.9em}
.fi .t .nt .w{font-family:'IBM Plex Mono',monospace;font-size:.66rem;color:#555}
.fi .t .mk{font-weight:700}
td.fill{font-size:.84rem;line-height:1.35}
td.fill .rl{margin:1px 0;white-space:pre-wrap}
td.fill .rl .dt{font-family:'IBM Plex Mono',monospace;font-size:.62rem;color:#555;letter-spacing:-.02em}
td.fill .rl .nm{font-size:.92rem;font-weight:700}
td.fill .rl.nt{background:#fdf3e0;border-radius:3px;padding:0 3px}
td.fill .rl.nt u{font-weight:600;text-underline-offset:2px}
td.fill .rl .mk{font-weight:700}
.fi.st-done .t{color:#047857}.fi.st-more_work .t{color:#b45309}.fi.st-next_week .t{color:#1d4ed8}
`;

const fmt = (ymd: string | null | undefined) => (ymd ? new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const setText = (el: Element | null | undefined, text: string) => { if (!el) return; el.textContent = text; if (text) el.classList.add('txt'); };
const tick = (el: Element | null | undefined, on: boolean) => { if (el && on) el.classList.add('on'); };

export function buildTrackerPrintHtml(docHtml: string, def: TrainingBoardDef, rows: BoardRow[], opts: { name: string; startDate: string | null; site?: string; schedule?: string; quizzes?: QuizPass[]; log?: BoardLogRow[] }): string {
  const doc = new DOMParser().parseFromString(docHtml, 'text/html');
  // the printout is the board and the weekly log only (user 2026-11-02): drop page 4 (first meeting · invite)
  for (const sel of ['.cont', '.two']) for (const el of Array.from(doc.querySelectorAll(sel))) { const pb = el.previousElementSibling; el.remove(); if (pb?.classList.contains('pb')) pb.remove(); }
  const badge = doc.querySelector('.badge');
  if (badge) badge.textContent = (badge.textContent ?? '').replace(/\s*·\s*PAGE 4.*$/i, '');
  const style = doc.createElement('style');
  style.textContent = FILL_CSS;
  doc.head.appendChild(style);
  const prog = boardProgress(def, rows);
  const nWeeks = weekCount(rows);
  const extraWeeks = weeksUpTo(nWeeks).filter((w) => w > 8);   // sessions past the printed 8

  // header fields
  const fields = Array.from(doc.querySelectorAll('.idrow .f'));
  for (const f of fields) {
    const lbl = (f.querySelector('.lbl')?.textContent ?? '').toLowerCase();
    const v = f.querySelector('.v');
    if (lbl.startsWith('trainee')) setText(v, opts.name);
    else if (lbl.startsWith('start')) setText(v, opts.startDate ?? '');
    else if (lbl.startsWith('site')) setText(v, opts.site ?? opts.schedule ?? '');
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
      // under the item, like the web board: the score, each part's status on a shared row, and every note of
      // every week ("W3: ✗ jump out safety") with the mark symbol in its colour
      const stText = (st: typeof cur.status, wk: number) => (st ? `${st === 'done' ? '✓' : st === 'next_week' ? '→' : '⟳'} W${wk}` : '—');
      const noteStatusWeek = (st: typeof cur.status, wk: number) => (st && wk ? `${st === 'next_week' ? '→ ' : ''}W${wk}` : '');
      // compact layout (user 2026-11-02): a bold header line per part ("overview ✓ W8 · score 4"), then that
      // part's notes indented under it ("W5 ★ Starting and shutdown Seq"), hanging indent so wraps line up
      const noteLines: { cls: 'pt' | 'nt'; nodes: Node[] }[] = [];
      const noteLine = (n: { week: number; mark: keyof typeof MARK_META | null; text: string }) => {
        const w = doc.createElement('span'); w.className = 'w'; w.textContent = `W${n.week} `;
        const nodes: Node[] = [w];
        if (n.mark) { const b = doc.createElement('b'); b.className = 'mk'; b.style.color = MARK_META[n.mark].color; b.textContent = `${MARK_META[n.mark].short} `; nodes.push(b); }
        nodes.push(doc.createTextNode(n.text));
        return { cls: 'nt' as const, nodes };
      };
      for (const { pt, cur: pc } of curs) {
        const notes = allNotes(rows, pt.key);
        const head: string[] = [];
        if (parts.length > 1) head.push(pt.part === 'tagit' ? 'tag it' : 'overview');
        if (parts.length > 1 && pc.status) head.push(stText(pc.status, pc.statusWeek));
        if (pc.score) head.push(`score ${pc.score}`);
        if (head.length && (parts.length > 1 || pc.score)) noteLines.push({ cls: 'pt', nodes: [doc.createTextNode(head.join(' · '))] });
        for (const n of notes) noteLines.push(noteLine(n));
      }
      if (c.kind === 'hours8' || c.kind === 'rounds8') {
        const hws = t ? Array.from(t.querySelectorAll('.under .hw .wk')) : [];
        WEEKS.forEach((w, i) => { const h = hoursOf(rows, item.key, w); setText(hws[i], h == null ? '' : String(h)); });
        // hours past week 8 have no blank on the paper: they go under the item
        const extraH = extraWeeks.map((w) => { const h = hoursOf(rows, item.key, w); return h == null ? null : `W${w}: ${h} h`; }).filter((x): x is string => !!x);
        if (extraH.length) noteLines.unshift({ cls: 'pt', nodes: [doc.createTextNode(extraH.join(' · '))] });
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
        const extraT = extraWeeks.filter((w) => weekTicked(rows, item.key, w)).map((w) => `W${w} ✓`);
        if (extraT.length) noteLines.unshift({ cls: 'pt', nodes: [doc.createTextNode(extraT.join(' · '))] });
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
        // note / check / date / none — the box is the ✓, the date slot says "W3" (done) or "→ W5" (next week)
        tick(bx?.querySelector('.box'), cur.status === 'done');
        const on = typeof cur.value.on === 'string' ? fmt(cur.value.on) : noteStatusWeek(cur.status, cur.statusWeek);
        setText(bx?.querySelector('.wk'), on);
      }
      if (c.kind !== 'rounds8' && noteLines.length) {
        let target: Element | null = c.kind === 'note' ? t?.querySelector(':scope > .note') ?? null : null;
        if (target) target.classList.add('txt');
        else if (t) { target = doc.createElement('small'); target.className = 'notes'; t.appendChild(target); }
        if (target) for (const { cls, nodes } of noteLines) { const div = doc.createElement('div'); div.className = cls; div.append(...nodes); target.appendChild(div); }
      }
    }
  });

  // weekly log rows (W1..W8 across the two tables) — Done wider, Focus narrower (user 2026-11-02)
  for (const cg of Array.from(doc.querySelectorAll('table colgroup'))) {
    const cs = Array.from(cg.querySelectorAll('col')) as HTMLElement[];
    if (cs.length === 4) { cs[2].style.width = '27%'; cs[3].style.width = '18%'; }
  }
  // sessions past 8: clone the W8 row onto the end of the last table, relabelled
  const trs = Array.from(doc.querySelectorAll('table tbody tr'));
  const last = trs[trs.length - 1];
  for (const w of extraWeeks) {
    if (!last?.parentElement) break;
    const tr = last.cloneNode(true) as Element;
    const c = tr.querySelector(':scope > td');
    if (c) { for (const n of Array.from(c.childNodes)) if (n.nodeType === 3 && /W\d+/.test(n.textContent ?? '')) n.textContent = `W${w}`; }
    last.parentElement.appendChild(tr);
    trs.push(tr);
  }
  weeksUpTo(nWeeks).forEach((w, i) => {
    const tr = trs[i];
    if (!tr) return;
    const log = weekLog(def, rows, w, opts.quizzes ?? [], opts.log ?? []);
    const tds = Array.from(tr.querySelectorAll(':scope > td'));
    const habs = Array.from(tds[0]?.querySelectorAll('.hab div') ?? []);
    // the markup already carries the unit ("COVE __ h") — write the number only
    habs.forEach((d, j) => {
      const t = log.tallies[j]; const el = d.querySelector('.ln2');
      if (!t || !el) return;
      if (t.total != null) {
        // "2/6": the count big, the section total small
        el.textContent = ''; el.classList.add('txt');
        const big = doc.createElement('span'); big.className = 'big'; big.textContent = t.value || '0';
        const of = doc.createElement('span'); of.className = 'of'; of.textContent = `/${t.total}`;
        el.append(big, of);
        if (t.delta) { const dl = doc.createElement('span'); dl.className = `dl${t.delta < 0 ? ' neg' : ''}`; dl.textContent = `${t.delta > 0 ? '+' : ''}${t.delta}`; el.appendChild(dl); }
      } else if (/[a-z]/i.test(t.value.replace(/\s*h$/, ''))) {
        // rounds "10 h · solo": its own line under the label, so it never runs over the next line
        setText(el, t.value); el.classList.add('wide');
      } else {
        setText(el, t.value.replace(/\s*h$/, ''));
      }
    });
    // every line: date + item number small, item name larger; a note line highlighted with its mark coloured and text underlined
    const fill = (td: Element | undefined, lines: string[]) => {
      if (!td) return;
      td.textContent = '';
      if (lines.length) td.classList.add('fill');
      for (const line of lines) {
        const div = doc.createElement('div'); div.className = 'rl';
        const q = splitLogLine(def, line);
        const p = splitReviewLine(line);
        if (q) {
          const dt = doc.createElement('span'); dt.className = 'dt'; dt.textContent = `${compactDate(q.date)}·${q.num} `;
          const nm = doc.createElement('span'); nm.className = 'nm'; nm.textContent = q.name;
          div.append(dt, nm);
        }
        if (!p) { div.append(q ? q.rest : line); td.appendChild(div); continue; }
        div.classList.add('nt');
        const meta = p.word ? MARK_META[p.word] : null;
        if (meta) div.style.background = meta.bg.replace(/[\d.]+\)$/, '0.18)');
        div.append(`${q ? '' : p.head} — ${p.label}`);
        if (meta) { const b = doc.createElement('b'); b.className = 'mk'; b.style.color = meta.color; b.textContent = `${meta.label.toLowerCase()} · `; div.appendChild(b); }
        const u = doc.createElement('u'); u.textContent = p.text; div.appendChild(u);
        td.appendChild(div);
      }
    };
    fill(tds[1], log.review);
    fill(tds[2], log.done);
    fill(tds[3], log.focus);
  });

  // section 0 — the first meeting (user 2026-11-02): on the board itself, in the space under section 2,
  // as a block in the board's own style: the checklist ticked as covered, then the three report dates
  const first = rows.find((r) => r.item_key === META_FIRST && r.week === 0)?.value ?? {};
  const covered = (first.covered as string[] | undefined) ?? [];
  const dates = (first.dates as Record<string, string> | undefined) ?? {};
  const col0 = doc.querySelector('.board .bcol');
  if (col0 && (def.firstMeeting.length || def.signers.length)) {
    const fg = doc.createElement('div'); fg.className = 'fg';
    const fgh = doc.createElement('div'); fgh.className = 'fgh'; fgh.textContent = '0 · First meeting — introduction';
    const cnt = doc.createElement('span'); cnt.className = 'cnt'; cnt.textContent = `${covered.length} / ${def.firstMeeting.length}`;
    fgh.appendChild(cnt); fg.appendChild(fgh);
    const row = (label: string, right: (bx: HTMLElement) => void) => {
      const fi = doc.createElement('div'); fi.className = 'fi';
      const num = doc.createElement('span'); num.className = 'num'; num.textContent = '·';
      const t = doc.createElement('span'); t.className = 't'; t.textContent = label;
      const bx = doc.createElement('span'); bx.className = 'bx'; right(bx);
      fi.append(num, t, bx); fg.appendChild(fi);
    };
    for (const f of def.firstMeeting) row(f, (bx) => { const box = doc.createElement('i'); box.className = 'box'; bx.appendChild(box); tick(box, covered.includes(f)); });
    for (const s of def.signers) row(s, (bx) => { const wk = doc.createElement('i'); wk.className = 'wk long'; bx.appendChild(wk); setText(wk, dates[s] ? fmt(dates[s]) : ''); });
    col0.appendChild(fg);
  }
  void inviteText;   // the invite body is not printed (user 2026-11-02)

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
