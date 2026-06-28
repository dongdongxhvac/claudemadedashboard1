// MRO card-charge CSV parsing + column auto-detection.
//
// Card portals export different headers; this sniffs the date / merchant /
// amount / cardholder / card / reference columns by header name, then
// parses each row into a normalized charge. Pure + dependency-free so the
// import preview and the actual insert share one source of truth.
//
// Tuned against a real export (headers: Document, Account ID, Sign Off,
// Date Posted, Date Purchased, Primary Accountholder, Purchase Amount,
// Vendor, Comp, Val, Auth) but pattern-based so other portals map too.

export type MroChargeField =
  | 'external_ref' | 'txn_date' | 'post_date' | 'cardholder'
  | 'amount' | 'merchant' | 'card_last4';

export type ColumnMapping = Partial<Record<MroChargeField, number>>; // field → column index

export type ParsedCharge = {
  external_ref: string | null;
  txn_date: string | null;     // YYYY-MM-DD
  post_date: string | null;    // YYYY-MM-DD
  merchant: string | null;
  amount: number | null;
  cardholder: string | null;
  card_last4: string | null;
  rowWarnings: string[];       // per-row issues (e.g. unparseable amount)
};

// ── RFC-4180-ish CSV parse (handles quoted commas like "Lao, Jie") ──
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ── column detection ──
// Ordered: each header is claimed by the first field that matches, so
// "Primary Accountholder" → cardholder before "Account ID" → card_last4.
const DETECTORS: { field: MroChargeField; patterns: RegExp[] }[] = [
  { field: 'external_ref', patterns: [/^document$/i, /reference/i, /\btxn\b/i, /trans.*id/i, /\bref\b/i] },
  { field: 'txn_date',     patterns: [/date\s*purchas/i, /purchase\s*date/i, /transaction\s*date/i, /txn\s*date/i, /trans\s*date/i] },
  { field: 'post_date',    patterns: [/date\s*posted/i, /post(ing)?\s*date/i, /settle/i] },
  { field: 'cardholder',   patterns: [/accountholder/i, /account\s*holder/i, /cardholder/i, /employee/i, /\bholder\b/i] },
  { field: 'amount',       patterns: [/purchase\s*amount/i, /\bamount\b/i, /charge\s*amount/i, /\btotal\b/i] },
  { field: 'merchant',     patterns: [/vendor/i, /merchant/i, /payee/i, /supplier/i, /description/i] },
  { field: 'card_last4',   patterns: [/account\s*id/i, /last\s*4/i, /card.*number/i, /card.*id/i] },
];

export function detectColumns(headers: string[]): ColumnMapping {
  const map: ColumnMapping = {};
  const used = new Set<number>();
  for (const { field, patterns } of DETECTORS) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].trim();
      if (patterns.some((p) => p.test(h))) { map[field] = i; used.add(i); break; }
    }
  }
  return map;
}

// ── value parsers ──
/** MM/DD/YYYY, M/D/YYYY, or YYYY-MM-DD → YYYY-MM-DD. Null if unparseable. */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return null;
}

/** "$1,265.13" / "1265.13" → 1265.13. Null if not a finite number. */
export function parseAmount(raw: string | undefined): number | null {
  const s = (raw ?? '').replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "Lao, Jie" → "Jie Lao"; otherwise as-is trimmed. */
export function normalizeCardholder(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : s;
}

function digitsOnly4(raw: string | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length >= 3 && d.length <= 4 ? d.slice(-4) : null;
}

export function mapRow(cells: string[], cols: ColumnMapping): ParsedCharge {
  const at = (f: MroChargeField) => (cols[f] !== undefined ? cells[cols[f]!] : undefined);
  const warnings: string[] = [];

  const amount = parseAmount(at('amount'));
  if (cols.amount !== undefined && amount === null) warnings.push('unparseable amount');
  const txn_date = parseDate(at('txn_date'));
  if (cols.txn_date !== undefined && txn_date === null) warnings.push('unparseable purchase date');

  return {
    external_ref: (at('external_ref') ?? '').trim() || null,
    txn_date,
    post_date: parseDate(at('post_date')),
    merchant: (at('merchant') ?? '').trim() || null,
    amount,
    cardholder: normalizeCardholder(at('cardholder')),
    card_last4: digitsOnly4(at('card_last4')),
    rowWarnings: warnings,
  };
}

export type ParsedCsv = {
  headers: string[];
  mapping: ColumnMapping;
  charges: ParsedCharge[];
  missingFields: MroChargeField[];   // expected-but-undetected
  periodStart: string | null;
  periodEnd: string | null;
};

const REQUIRED: MroChargeField[] = ['amount', 'merchant', 'txn_date'];

export function parseChargeCsv(text: string): ParsedCsv {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { headers: [], mapping: {}, charges: [], missingFields: REQUIRED, periodStart: null, periodEnd: null };
  }
  const headers = rows[0].map((h) => h.trim());
  const mapping = detectColumns(headers);
  const charges = rows.slice(1).map((r) => mapRow(r, mapping));
  const missingFields = REQUIRED.filter((f) => mapping[f] === undefined);

  const dates = charges.map((c) => c.txn_date).filter((d): d is string => !!d).sort();
  return {
    headers, mapping, charges, missingFields,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}
