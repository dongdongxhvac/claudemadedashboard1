// New-hire training — handout manifest loader.
//
// The list of handouts is DATA, not code: web/public/training/manifest.json
// (served at /training/manifest.json). Adding a handout = drop the HTML in the
// folder + one manifest entry; replacing = overwrite the file; moving the
// folder = change `base`. No TypeScript edit for any of those. The program's
// weeks/items (lib/newHireProgram.ts) refer to handouts by manifest `key`, and
// so do quiz results (new_hire_doc_activity.doc_key) and the per-handout mentor
// ticks (new_hire_checkoffs 'doc.<key>.reviewed' / 'doc.<key>.quiz') — keys are
// permanent.
//
// Validation is deliberately forgiving: a bad entry is dropped with a console
// warning, an unknown group lands in 'reference', and only a missing/unparsable
// file is an error (the UI shows it instead of a blank shelf).
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export const TRAINING_MANIFEST_URL = '/training/manifest.json';

export type NhDoc = {
  key: string;
  label: string;
  file: string;
  group: string;
  /** Program week the handout belongs to (1..8), for the chip. */
  week?: number;
  /** The page has a tap-to-answer quiz the dashboard records (ids qDone/qTot/qRight). */
  quiz?: boolean;
  /** false → no per-handout mentor ticks (answer key, print sheets, duplicates). */
  signoff?: boolean;
  note?: string;
};

export type NhDocGroup = { key: string; label: string };

export type TrainingManifest = {
  program_key: string;
  base: string;
  groups: NhDocGroup[];
  docs: NhDoc[];
};

const DEFAULT_GROUPS: NhDocGroup[] = [
  { key: 'program', label: 'Program' },
  { key: 'overview', label: 'Discipline overviews' },
  { key: 'equipment', label: 'Equipment deep-dives' },
  { key: 'field', label: 'Field exercises' },
  { key: 'reference', label: 'Reference' },
  { key: 'mentor', label: 'Mentor only' },
];

function parseManifest(raw: unknown): TrainingManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest is not an object');
  const r = raw as Record<string, unknown>;
  const base = typeof r.base === 'string' && r.base.trim() ? r.base.trim().replace(/\/+$/, '') : null;
  if (!base) throw new Error('manifest.base is missing');
  const groupsIn = Array.isArray(r.groups) ? r.groups : DEFAULT_GROUPS;
  const groups: NhDocGroup[] = [];
  for (const g of groupsIn as unknown[]) {
    const o = g as Record<string, unknown>;
    if (o && typeof o.key === 'string' && typeof o.label === 'string') groups.push({ key: o.key, label: o.label });
  }
  if (!groups.length) groups.push(...DEFAULT_GROUPS);
  const groupKeys = new Set(groups.map((g) => g.key));
  const fallbackGroup = groupKeys.has('reference') ? 'reference' : groups[0].key;

  if (!Array.isArray(r.docs)) throw new Error('manifest.docs is not an array');
  const seen = new Set<string>();
  const docs: NhDoc[] = [];
  for (const d of r.docs as unknown[]) {
    const o = (d ?? {}) as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    const file = typeof o.file === 'string' ? o.file.trim().replace(/^\/+/, '') : '';
    if (!key || !label || !file) { console.warn('[training manifest] skipped entry missing key/label/file', o); continue; }
    if (seen.has(key)) { console.warn(`[training manifest] duplicate key "${key}" — later entry ignored`); continue; }
    seen.add(key);
    const group = typeof o.group === 'string' && groupKeys.has(o.group) ? o.group : fallbackGroup;
    const week = typeof o.week === 'number' && o.week >= 1 && o.week <= 8 ? Math.floor(o.week) : undefined;
    docs.push({
      key, label, file, group, week,
      quiz: o.quiz === true,
      signoff: o.signoff !== false,
      note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined,
    });
  }
  return {
    program_key: typeof r.program_key === 'string' ? r.program_key : 'upark_l1_plan_b',
    base, groups, docs,
  };
}

export function docHref(manifest: Pick<TrainingManifest, 'base'>, doc: Pick<NhDoc, 'file'>): string {
  return encodeURI(`${manifest.base}/${doc.file}`);
}

export const TRAINING_MANIFEST_KEY = ['training_manifest'];

export function useTrainingManifest() {
  const q = useQuery({
    queryKey: TRAINING_MANIFEST_KEY,
    queryFn: async (): Promise<TrainingManifest> => {
      const res = await fetch(TRAINING_MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${TRAINING_MANIFEST_URL}: HTTP ${res.status}`);
      let json: unknown;
      try { json = await res.json(); }
      catch (e) { throw new Error(`${TRAINING_MANIFEST_URL} is not valid JSON (${(e as Error).message})`, { cause: e }); }
      return parseManifest(json);
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const byKey = useMemo(() => new Map((q.data?.docs ?? []).map((d) => [d.key, d])), [q.data]);
  const href = useMemo(() => (doc: Pick<NhDoc, 'file'>) => (q.data ? docHref(q.data, doc) : '#'), [q.data]);
  const hrefFor = useMemo(() => (key: string) => { const d = byKey.get(key); return d && q.data ? docHref(q.data, d) : null; }, [byKey, q.data]);
  return {
    ...q,
    manifest: q.data ?? null,
    docs: q.data?.docs ?? [],
    groups: q.data?.groups ?? DEFAULT_GROUPS,
    byKey,
    href,
    hrefFor,
  };
}
