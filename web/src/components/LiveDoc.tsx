// Live documents — the printouts from the Print Station rendered as-is in a
// same-origin iframe (srcdoc), with the dashboard's record drawn INTO them.
//
//   <LiveSignoffSheet>  the Master Sign-Off Sheet: initials + date filled per
//                       item, notes under items, rep tally / COVE boxes ticked,
//                       signature lines signed. Editable (mentor) or read-only
//                       (engineer's record).
//   <LiveSchedule>      the 8-Week Schedule: file chips open the matching
//                       document; the "Check off" ticks mirror the mentor's
//                       sign-offs (matched to sheet items by text).
//
// Both grow to their content height (ResizeObserver on the inner body) so
// they scroll with the page around them. Decoration runs after the iframe
// loads and again whenever the record changes; it is idempotent (elements
// remember what they represent in data-* attributes and are re-styled, not
// re-created). Click handlers read the latest props through a ref.
import { useCallback, useEffect, useRef } from 'react';
import type { SignoffSheet } from '../lib/signoffSheet';
import { coveKey, docKeyForFile, quizDocForItem, tickTarget } from '../lib/signoffSheet';
import { noteKeyFor } from '../lib/newHireProgram';
import type { NhCheckoff, NhDocActivity, NhRepLog } from '../hooks/useNewHire';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const initialsOf = (name: string) => name.replace(/\s*\(you\)$/, '').split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '—';

const LIVE_CSS = `
  .lv-on{background:#1a1f2b!important;position:relative}
  .lv-on::after{content:'✓';color:#fff;font-size:10px;line-height:1;position:absolute;left:1.5px;top:0.5px}
  .lv-init{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:700;font-size:.85rem;letter-spacing:.04em;color:#1a1f2b}
  .lv-date{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.72rem;color:#1a1f2b}
  .lv-note{font-size:.78rem;color:#1a1f2b;margin-left:8px}
  .lv-note-by{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.62rem;color:#9aa3b0;margin-left:6px}
  .lv-chip{display:inline-block;margin-left:6px;padding:0 5px;border-radius:3px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.62rem;font-weight:600;vertical-align:middle}
  .lv-chip.ok{background:#e6f4ea;color:#1e6b3a}.lv-chip.warn{background:#fff4d6;color:#8a5a00}
  .lv-edit td.init,.lv-edit td.date,.lv-edit .box,.lv-edit .sigline,.lv-edit tr.noter td{cursor:pointer}
  .lv-edit td.init:hover,.lv-edit td.date:hover,.lv-edit tr.noter td:hover{background:#eef6ff}
  .lv-edit .box:hover,.lv-edit .sigline:hover{outline:2px solid #5e6ad2;outline-offset:1px}
  .lv-sig{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.8rem;font-weight:700;color:#1a1f2b;padding:2px 4px}
  .lv-tick-on{background:#1a1f2b!important;position:relative}
  .lv-tick-on::after{content:'✓';color:#fff;font-size:9px;line-height:1;position:absolute;left:1.5px;top:0}
  .lv-file{cursor:pointer;color:#0f6f8f!important;text-decoration:underline dotted}
  .lv-file:hover{background:#e0f2fe!important}
  .lv-file-extra{margin-left:4px}
  .lv-idv{font-size:.9rem;color:#1a1f2b;padding:2px 0;height:auto!important}
`;

function ensureCss(doc: Document) {
  if (doc.getElementById('lv-css')) return;
  const st = doc.createElement('style'); st.id = 'lv-css'; st.textContent = LIVE_CSS;
  doc.head.appendChild(st);
}

/** iframe that renders `html`, calls `decorate` after load and on each change of `deps`, and sizes itself to its content. */
function useLiveFrame(html: string, decorate: (doc: Document) => void, deps: unknown[]) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const decorateRef = useRef(decorate);
  useEffect(() => { decorateRef.current = decorate; });
  const loadedRef = useRef(false);

  const fit = useCallback(() => {
    const f = ref.current; const d = f?.contentDocument;
    if (!f || !d?.body) return;
    f.style.height = Math.max(200, d.documentElement.scrollHeight) + 'px';
  }, []);

  useEffect(() => {
    const f = ref.current; if (!f) return;
    loadedRef.current = false;
    let ro: ResizeObserver | null = null;
    const onLoad = () => {
      const d = f.contentDocument; if (!d) return;
      loadedRef.current = true;
      ensureCss(d);
      try { decorateRef.current(d); } catch (e) { console.warn('[live doc] decorate failed', e); }
      fit();
      ro = new ResizeObserver(fit); ro.observe(d.documentElement);
    };
    f.addEventListener('load', onLoad);
    f.srcdoc = html;
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [html, fit]);

  useEffect(() => {
    const d = ref.current?.contentDocument;
    if (!loadedRef.current || !d?.body) return;
    try { decorateRef.current(d); } catch (e) { console.warn('[live doc] decorate failed', e); }
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's change list
  }, deps);

  return ref;
}

// ── sign-off sheet ────────────────────────────────────────────────────────

export type SheetActions = {
  toggleItem: (key: string, on: boolean) => void;
  setNote: (key: string, note: string | null) => void;
  toggleRep: (repKey: string, boxIndex: number, on: boolean, level: string | null) => void;
  toggleCove: (n: number, on: boolean) => void;
  toggleSigner: (key: string, on: boolean) => void;
};

export function LiveSignoffSheet({ sheet, checkoffs, repLogs, bestQuizByDoc, fields, canEdit, nameOf, actions, title }: {
  sheet: SignoffSheet;
  checkoffs: Map<string, NhCheckoff>;
  repLogs: NhRepLog[];
  bestQuizByDoc: Map<string, NhDocActivity>;
  /** Header strip values by field label ('New hire', 'Mentor', 'Manager', 'Start date'). */
  fields: Record<string, string>;
  canEdit: boolean;
  nameOf: (id: string | null | undefined) => string;
  actions?: SheetActions;
  title?: string;
}) {
  const propsRef = useRef({ checkoffs, repLogs, canEdit, actions });
  useEffect(() => { propsRef.current = { checkoffs, repLogs, canEdit, actions }; });

  const decorate = (doc: Document) => {
    const { checkoffs, repLogs, canEdit, actions } = propsRef.current;
    doc.body.classList.toggle('lv-edit', canEdit && !!actions);

    // header strip
    for (const f of Array.from(doc.querySelectorAll('.idrow .f'))) {
      const k = (f.querySelector('.k')?.textContent ?? '').trim();
      const v = f.querySelector('.v'); if (!v) continue;
      v.classList.add('lv-idv'); v.textContent = fields[k] ?? '';
    }

    // items: tbody.pair rows in document order ↔ sheet.items in the same order
    const pairs = Array.from(doc.querySelectorAll('table tbody.pair'));
    pairs.forEach((tb, i) => {
      const item = sheet.items[i]; if (!item) return;
      const tr = tb.querySelector('tr:first-child'); const init = tr?.querySelector('td.init'); const date = tr?.querySelector('td.date');
      const noter = tb.querySelector('tr.noter td');
      if (!tr || !init || !date) return;
      const row = checkoffs.get(item.key);
      init.className = 'init lv-init'; init.textContent = row ? initialsOf(nameOf(row.verified_by)) : '';
      date.className = 'date lv-date'; date.textContent = row ? fmtDate(row.done_at) : '';
      (init as HTMLElement).title = row ? `${nameOf(row.verified_by)} · ${fmtDate(row.done_at)}${canEdit ? ' — click to un-verify' : ''}` : canEdit ? 'Click to initial (verified)' : '';
      // quiz chip
      const td = tr.querySelector('td'); if (td) {
        let chip = td.querySelector('.lv-chip') as HTMLElement | null;
        const q = quizDocForItem(item.text); const best = q ? bestQuizByDoc.get(q) : undefined;
        if (best && best.score != null && best.total != null) {
          if (!chip) { chip = doc.createElement('span'); td.appendChild(chip); }
          const ok = best.score / best.total >= 0.8;
          chip.className = 'lv-chip ' + (ok ? 'ok' : 'warn'); chip.textContent = `engineer's quiz ${best.score}/${best.total} · ${fmtDate(best.at)}`;
        } else chip?.remove();
      }
      // note — its own row (note.<key>), independent of the initials; a note
      // saved on the verified row itself (older data) still shows.
      const noteRow = checkoffs.get(noteKeyFor(item.key)) ?? (row?.note ? row : undefined);
      if (noter) {
        let n = noter.querySelector('.lv-note') as HTMLElement | null;
        if (!n) { n = doc.createElement('span'); n.className = 'lv-note'; noter.appendChild(n); }
        n.textContent = noteRow?.note ?? '';
        let by = noter.querySelector('.lv-note-by') as HTMLElement | null;
        if (!by) { by = doc.createElement('span'); by.className = 'lv-note-by'; noter.appendChild(by); }
        by.textContent = noteRow?.note ? `${initialsOf(nameOf(noteRow.verified_by))} · ${fmtDate(noteRow.done_at)}` : '';
        (noter as HTMLElement).title = canEdit ? (noteRow?.note ? 'Click to edit the note' : 'Click to add a note') : '';
      }
      if (!(tb as HTMLElement).dataset.lvBound) {
        (tb as HTMLElement).dataset.lvBound = '1';
        const toggle = () => { const p = propsRef.current; if (!p.canEdit || !p.actions) return; p.actions.toggleItem(item.key, !p.checkoffs.has(item.key)); };
        init.addEventListener('click', toggle); date.addEventListener('click', toggle);
        noter?.addEventListener('click', () => {
          const p = propsRef.current; if (!p.canEdit || !p.actions) return;
          const cur = p.checkoffs.get(noteKeyFor(item.key))?.note ?? p.checkoffs.get(item.key)?.note ?? '';
          const v = window.prompt('Note for: ' + item.text, cur); if (v === null) return;
          p.actions.setNote(item.key, v.trim() || null);
        });
      }
    });

    // rep tally + COVE audit
    const counts = new Map<string, number>();
    for (const l of repLogs) counts.set(l.rep_key, (counts.get(l.rep_key) ?? 0) + 1);
    for (const table of Array.from(doc.querySelectorAll('.reps table'))) {
      const isCove = /cove hours audit/i.test(table.parentElement?.querySelector('h2')?.textContent ?? '');
      for (const tr of Array.from(table.querySelectorAll('tr'))) {
        const tds = Array.from(tr.querySelectorAll('td'));
        for (let i = 0; i + 1 < tds.length; i += 2) {
          const label = (tds[i].textContent ?? '').replace(/\s+/g, ' ').trim();
          const boxes = Array.from(tds[i + 1].querySelectorAll('.box')) as HTMLElement[];
          if (!label || !boxes.length) continue;
          if (isCove) {
            const m = /wk\s*(\d+)/i.exec(label); if (!m) continue;
            const n = Number(m[1]); const row = checkoffs.get(coveKey(n)); const b = boxes[0];
            b.classList.toggle('lv-on', !!row);
            b.title = row ? `${nameOf(row.verified_by)} · ${fmtDate(row.done_at)}` : canEdit ? 'Click to initial the COVE audit' : '';
            if (!b.dataset.lvBound) { b.dataset.lvBound = '1'; b.addEventListener('click', () => { const p = propsRef.current; if (!p.canEdit || !p.actions) return; p.actions.toggleCove(n, !p.checkoffs.has(coveKey(n))); }); }
            continue;
          }
          const rep = sheet.reps.find((r) => r.label === label); if (!rep) continue;
          const n = counts.get(rep.key) ?? 0;
          boxes.forEach((b, bi) => {
            b.classList.toggle('lv-on', bi < n);
            const lvl = rep.levels[bi] ?? null;
            b.title = (bi < n ? 'done' : 'not yet') + (lvl ? ` · ${lvl}` : '') + (canEdit ? ' — click to toggle' : '');
            if (!b.dataset.lvBound) {
              b.dataset.lvBound = '1';
              b.addEventListener('click', () => {
                const p = propsRef.current; if (!p.canEdit || !p.actions) return;
                const cur = p.repLogs.filter((l) => l.rep_key === rep.key).length;
                if (bi < cur) p.actions.toggleRep(rep.key, bi, false, lvl);        // un-tick (removes the latest log)
                else if (bi === cur) p.actions.toggleRep(rep.key, bi, true, lvl);  // tick the next box
                else window.alert('Tick the boxes in order.');
              });
            }
          });
        }
      }
    }

    // certification
    const sigs = Array.from(doc.querySelectorAll('.cert .sig'));
    sigs.forEach((sig, i) => {
      const signer = sheet.signers[i]; if (!signer) return;
      const line = sig.querySelector('.sigline') as HTMLElement | null; if (!line) return;
      const row = checkoffs.get(signer.key);
      line.className = 'sigline' + (row ? ' lv-sig' : '');
      line.textContent = row ? `${nameOf(row.verified_by)} · ${fmtDate(row.done_at)}` : '';
      line.title = row ? 'Signed' + (canEdit ? ' — click to remove the signature' : '') : canEdit ? 'Click to sign' : '';
      if (!line.dataset.lvBound) { line.dataset.lvBound = '1'; line.addEventListener('click', () => { const p = propsRef.current; if (!p.canEdit || !p.actions) return; p.actions.toggleSigner(signer.key, !p.checkoffs.has(signer.key)); }); }
    });
  };

  const ref = useLiveFrame(sheet.html, decorate, [checkoffs, repLogs, bestQuizByDoc, fields, canEdit, nameOf]);
  return <iframe ref={ref} title={title ?? sheet.title} style={{ width: '100%', border: 0, background: '#fff', display: 'block', height: 400 }} />;
}

// ── schedule ──────────────────────────────────────────────────────────────

export function LiveSchedule({ html, sheet, checkoffs, docKeys, onOpen, title }: {
  html: string;
  sheet: SignoffSheet | null;
  checkoffs: Map<string, NhCheckoff>;
  /** Document keys that exist in the print station (so a chip for a missing document stays plain). */
  docKeys: Set<string>;
  onOpen: (docKey: string) => void;
  title?: string;
}) {
  const propsRef = useRef({ sheet, checkoffs, docKeys, onOpen });
  useEffect(() => { propsRef.current = { sheet, checkoffs, docKeys, onOpen }; });

  const decorate = (doc: Document) => {
    const { sheet, checkoffs, docKeys } = propsRef.current;
    // file chips → open the document (equipment files get a second chip for the tag sheet)
    for (const el of Array.from(doc.querySelectorAll('span.file')) as HTMLElement[]) {
      if (el.dataset.lvBound) continue;
      el.dataset.lvBound = '1';
      const map = docKeyForFile(el.textContent ?? ''); if (!map) continue;
      const bind = (node: HTMLElement, key: string) => {
        if (!docKeys.has(key)) { node.title = 'Not in the print station yet'; return; }
        node.classList.add('lv-file'); node.title = 'Open in the viewer';
        node.addEventListener('click', (e) => { e.preventDefault(); propsRef.current.onOpen(key); });
      };
      bind(el, map.key);
      if (map.tagit && docKeys.has(map.tagit)) {
        const extra = doc.createElement('span'); extra.className = 'file lv-file-extra'; extra.textContent = 'tag sheet';
        el.after(extra); bind(extra, map.tagit);
      }
    }
    // check-off ticks ← mentor's sign-offs
    if (!sheet) return;
    for (const sec of Array.from(doc.querySelectorAll('section.week'))) {
      const week = Number((sec.id || '').replace(/\D/g, '')); if (!week) continue;
      for (const tick of Array.from(sec.querySelectorAll('.tick')) as HTMLElement[]) {
        const box = tick.querySelector('.tbox') as HTMLElement | null; if (!box) continue;
        const target = tickTarget(tick.textContent ?? '', week, sheet);
        const row = target ? checkoffs.get(target.key) : undefined;
        box.classList.toggle('lv-tick-on', !!row);
        tick.title = target ? (row ? `Verified by your mentor · ${fmtDate(row.done_at)}` : 'Not yet verified') : 'Not tracked on the sign-off sheet';
      }
    }
  };

  const ref = useLiveFrame(html, decorate, [sheet, checkoffs, docKeys]);
  return <iframe ref={ref} title={title ?? 'Schedule'} style={{ width: '100%', border: 0, background: '#fff', display: 'block', height: 600 }} />;
}
