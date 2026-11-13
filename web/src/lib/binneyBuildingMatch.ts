// Cove building name → dashboard building (and so its East/West cluster).
//
// Cove spells buildings as postal addresses ("650 East Kendall Street",
// "215 First Street"); the dashboard's buildings.code is the managers'
// shorthand ("650 Kendall", "215 First St"). Both reduce to the same key:
// the street number plus the first street word, with direction words and
// "Street / St / Avenue" dropped. Cove names with no dashboard row at all
// (the garages, the Assembly Park addresses, the small Moulton lots) fall
// to COVE_ALIASES, which names the cluster directly — from the rounds
// sheet geography: Kendall / Assembly = East, Moulton / Rogers = West.
import type { Cluster } from './binneyRounds';

const DROP = new Set(['street', 'st', 'avenue', 'ave', 'drive', 'dr', 'east', 'west', 'north', 'south', 'fresh', 'pond', 'the']);

/** "650 East Kendall Street" → "650 kendall"; "Fresh Pond 45 Moulton" → "45 moulton". */
export function buildingKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name.toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').split(/\s+/).filter(Boolean);
  const num = words.find((w) => /^\d+(\/\d+)?$/.test(w));
  const street = words.find((w) => !/^\d/.test(w) && !DROP.has(w));
  if (!num && !street) return null;
  return [num, street].filter(Boolean).join(' ');
}

/** Cove names (lower-cased key or substring) that have no dashboard building row. */
const COVE_ALIASES: { test: (lower: string) => boolean; cluster: Cluster; note: string }[] = [
  { test: (s) => s.includes('assembly'), cluster: 'east', note: 'Assembly Innovation Park (122 / 188 Assembly Park Drive)' },
  { test: (s) => s.includes('kendall'),  cluster: 'east', note: 'Kendall Square (garage, Kendall Crossing)' },
  { test: (s) => s.includes('moulton'),  cluster: 'west', note: 'Moulton Street lots' },
  { test: (s) => s.includes('rogers'),   cluster: 'west', note: 'Rogers Street garage (301 Binney site)' },
];

export type BuildingClusterLookup = {
  /** Cluster for a Cove building name; null when nothing matches. */
  clusterOf: (coveName: string | null | undefined) => Cluster | null;
};

/** Build the lookup once from the dashboard's building rows. */
export function makeBuildingClusterLookup(
  buildings: { code: string; name: string | null; short_code: string | null; cluster: Cluster | null }[],
): BuildingClusterLookup {
  const byKey = new Map<string, Cluster | null>();
  for (const b of buildings) {
    for (const label of [b.code, b.name, b.short_code]) {
      const k = buildingKey(label);
      if (k && !byKey.has(k)) byKey.set(k, b.cluster);
    }
  }
  const cache = new Map<string, Cluster | null>();
  return {
    clusterOf: (coveName) => {
      if (!coveName) return null;
      const hit = cache.get(coveName);
      if (hit !== undefined) return hit;
      const k = buildingKey(coveName);
      let c: Cluster | null = (k ? byKey.get(k) : null) ?? null;
      if (!c) {
        const lower = coveName.toLowerCase();
        c = COVE_ALIASES.find((a) => a.test(lower))?.cluster ?? null;
      }
      cache.set(coveName, c);
      return c;
    },
  };
}
