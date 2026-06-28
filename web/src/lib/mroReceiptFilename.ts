// Parse receipt tags out of an upload's file name so the staging form
// prefills. Order-independent: a token that matches a building short-code
// becomes the building, "upark" → site-wide, a category keyword becomes
// the category, and whatever's left is the item label.
//   "26_HVAC_actuator.jpg"        → 26 · HVAC · "actuator"
//   "upark wifi router.jpg"       → UPark · — · "wifi router"
//   "300-plumbing-pressure switch"→ 300 · Plumbing · "pressure switch"
import type { ReceiptCategory } from '../hooks/useMroBilling';

const CATEGORY_PATTERNS: [RegExp, ReceiptCategory][] = [
  [/^hvac$/i, 'HVAC'],
  [/^plumb(ing)?$/i, 'Plumbing'],
  [/^elec(t|trical)?$/i, 'Electrical'],
  [/^(control|controls|ctrl|bms)$/i, 'Control'],
  [/^other$/i, 'Other'],
];

export type ParsedFilename = {
  buildingCode: string | null;   // matched building short_code
  siteWide: boolean;             // "UPark"
  category: ReceiptCategory | null;
  item: string | null;
};

export function parseReceiptFilename(fileName: string, buildingCodes: string[]): ParsedFilename {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const tokens = base.split(/[\s_\-.]+/).filter(Boolean);
  const codeByLower = new Map(buildingCodes.map((c) => [c.toLowerCase(), c]));

  let buildingCode: string | null = null;
  let siteWide = false;
  let category: ReceiptCategory | null = null;
  const rest: string[] = [];

  for (const t of tokens) {
    const tl = t.toLowerCase();
    if (!buildingCode && !siteWide && (tl === 'upark' || tl === 'up')) { siteWide = true; continue; }
    if (!buildingCode && !siteWide && codeByLower.has(tl)) { buildingCode = codeByLower.get(tl)!; continue; }
    if (!category) {
      const hit = CATEGORY_PATTERNS.find(([re]) => re.test(t));
      if (hit) { category = hit[1]; continue; }
    }
    rest.push(t);
  }
  return { buildingCode, siteWide, category, item: rest.join(' ').trim() || null };
}
