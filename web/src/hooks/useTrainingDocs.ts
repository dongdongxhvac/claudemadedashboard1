// New-hire training — every handout comes from ONE file: the Print Station.
//
// Per user 2026-09-21: "just go by new_hire_print_station file only for all
// 8 week training content". new_hire_print_station.html embeds all the
// program's documents as base64 (`const DOCS=[…]`, index-aligned with
// `const TITLES=[…]`) and lists them under group headings (`.row[data-g]`
// / `data-i`). This hook fetches that file, parses the three, decodes each
// document and hands the app a doc list. To UPDATE TRAINING: overwrite the
// print station and push — nothing else to edit. To move it: change
// NH_PRINT_STATION_URL.
//
// Keys are what progress hangs on (quiz runs → new_hire_doc_activity.doc_key;
// mentor ticks → new_hire_checkoffs 'doc.<key>.reviewed' / '.quiz'; the
// program's weeks link handouts by key), so they must survive a rebuild of
// the print station. They come from the document TITLE through the alias
// rules below (order matters; first match wins); a title no rule knows gets
// a slug of itself. Renaming a title in the print station therefore keeps
// the key as long as the rule still matches — extend the rules when a new
// kind of document appears.
//
// Documents open in the viewer via iframe.srcdoc (same origin → the quiz
// watcher can see inside) and in a new tab via a blob: URL.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export const NH_PACKAGE_BASE = '/training/new hire 8 weeks training package';
export const NH_PRINT_STATION_URL = `${NH_PACKAGE_BASE}/new_hire_print_station.html`;

export type NhDoc = {
  /** Permanent — see the alias rules. */
  key: string;
  /** The print station's title for the document. */
  label: string;
  /** Group heading in the print station ('Program', 'Site', 'Overviews', 'Equipment', 'Exercises', 'Mentor only'). */
  group: string;
  /** Position in the print station (its print order). */
  index: number;
  /** The full document, decoded. */
  html: string;
  /** Has a tap-to-answer quiz the dashboard records (ids qDone/qTot/qRight). */
  quiz: boolean;
  /** false → no per-handout mentor ticks (print sheets, mentor copies, reference maps). */
  signoff: boolean;
};

export type NhDocGroup = { key: string; label: string };

/** title → key. Tested against the lower-cased title, in order. */
const ALIAS_RULES: [RegExp, string][] = [
  [/^8-?week schedule/, 'plan'],
  [/sign-?off sheet/, 'signoff_sheet'],
  [/^week 1 guide/, 'week1_guide'],
  [/^week 1 checklist/, 'week1_checklist'],
  [/^week 2 guide/, 'week2_guide'],
  [/^week 2 checklist/, 'week2_checklist'],
  [/^upark site map/, 'site_map'],
  [/^binney site map/, 'binney_site_map'],
  [/^building check/, 'building_check'],
  [/^hvac overview/, 'hvac'],
  [/^plumbing overview/, 'plumbing'],
  [/^electrical overview/, 'electrical'],
  [/^life safety overview/, 'life_safety'],
  [/^bms overview/, 'bms'],
  [/^boiler.*find it/, 'boiler_tagit'],
  [/^boiler/, 'boiler'],
  [/^chiller.*find it/, 'chiller_tagit'],
  [/^chiller/, 'chiller'],
  [/^cooling tower.*find it/, 'tower_tagit'],
  [/^cooling tower/, 'tower'],
  [/^ahu.*find it/, 'ahu_tagit'],
  [/^ahu/, 'ahu'],
  [/^find it on screen.*example/, 'find_on_screen_example'],
  [/^find it on screen/, 'find_on_screen'],
  [/find it.*tag it.*portfolio|^portfolio.*find it/, 'find_it_tag_it'],
  [/^equipment glossary|^glossary/, 'glossary'],
  [/^terminology/, 'terminology'],
  [/level.?2/, 'level2'],
  [/answer key/, 'answer_key'],
  [/manager sop/, 'manager_sop'],
];

/** Documents that are print sheets / mentor copies / reference — no Reviewed / Quiz-passed ticks. */
const NO_SIGNOFF = new Set(['plan', 'signoff_sheet', 'week1_guide', 'week1_checklist', 'week2_guide', 'week2_checklist', 'binney_site_map', 'find_on_screen_example', 'answer_key', 'manager_sop']);

export function keyForTitle(title: string): string {
  const t = title.trim().toLowerCase();
  for (const [re, key] of ALIAS_RULES) if (re.test(t)) return key;
  return t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'doc';
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(u);
}

export function parsePrintStation(src: string): { docs: NhDoc[]; groups: NhDocGroup[] } {
  const mDocs = /const DOCS=(\[[^\]]*\]);/.exec(src);
  const mTitles = /const TITLES=(\[[^\]]*\]);/.exec(src);
  if (!mDocs || !mTitles) throw new Error('print station: DOCS / TITLES arrays not found');
  let blobs: string[], titles: string[];
  try { blobs = JSON.parse(mDocs[1]); titles = JSON.parse(mTitles[1]); }
  catch (e) { throw new Error('print station: DOCS / TITLES are not plain string arrays', { cause: e }); }
  if (blobs.length !== titles.length) throw new Error(`print station: ${blobs.length} documents but ${titles.length} titles`);

  const groupOf = new Map<number, string>();
  const groups: NhDocGroup[] = [];
  const rowRe = /<div class="row[^"]*" data-g="([^"]*)">[\s\S]*?data-i="(\d+)"/g;
  for (let m = rowRe.exec(src); m; m = rowRe.exec(src)) {
    const g = m[1].trim(), i = Number(m[2]);
    groupOf.set(i, g);
    if (!groups.some((x) => x.label === g)) groups.push({ key: g.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: g });
  }
  if (!groups.some((g) => g.label === 'Other')) groups.push({ key: 'other', label: 'Other' });

  const seen = new Set<string>();
  const docs: NhDoc[] = titles.map((title, i) => {
    let key = keyForTitle(title);
    while (seen.has(key)) key = `${key}_${i}`;   // two docs matching one rule: later one gets an index suffix
    seen.add(key);
    const html = b64ToUtf8(blobs[i]);
    const gLabel = groupOf.get(i) ?? 'Other';
    return {
      key, label: title, index: i, html,
      group: groups.find((g) => g.label === gLabel)!.key,
      quiz: html.includes('id="qDone"'),
      signoff: !NO_SIGNOFF.has(key),
    };
  });
  return { docs, groups: groups.filter((g) => docs.some((d) => d.group === g.key)) };
}

// blob: URLs for "open in a new tab" — one per doc, made on first use.
const blobUrls = new Map<string, string>();
export function docBlobUrl(doc: NhDoc): string {
  let u = blobUrls.get(doc.key + ':' + doc.html.length);
  if (!u) {
    u = URL.createObjectURL(new Blob([doc.html], { type: 'text/html;charset=utf-8' }));
    blobUrls.set(doc.key + ':' + doc.html.length, u);
  }
  return u;
}

export const TRAINING_DOCS_KEY = ['training_docs', NH_PRINT_STATION_URL];

export function useTrainingDocs() {
  const q = useQuery({
    queryKey: TRAINING_DOCS_KEY,
    queryFn: async () => {
      const res = await fetch(encodeURI(NH_PRINT_STATION_URL));
      if (!res.ok) throw new Error(`${NH_PRINT_STATION_URL}: HTTP ${res.status}`);
      return parsePrintStation(await res.text());
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const byKey = useMemo(() => new Map((q.data?.docs ?? []).map((d) => [d.key, d])), [q.data]);
  return {
    ...q,
    docs: q.data?.docs ?? [],
    groups: q.data?.groups ?? [],
    byKey,
    /** URL for a new tab (blob:). For the in-page viewer use `doc.html` as iframe srcdoc. */
    href: (doc: NhDoc) => docBlobUrl(doc),
    hrefFor: (key: string) => { const d = byKey.get(key); return d ? docBlobUrl(d) : null; },
  };
}
