// §12 — UPark PTO Excel export.
//
// Builds the same workbook the manager asked for by hand on 2026-09-15
// (UPark-only PTO with a per-engineer detail log), straight from the data
// the PtoPanel already holds — no extra queries. Triggered from the
// "Export .xlsx" link in the Balances title line.
//
// Sheets:
//   UPark Summary   — allotted / used / remaining per engineer (remaining +
//                     entry counts are live formulas over the log sheet)
//   UPark PTO Log   — every entry for the year, one row each
//   <Engineer name> — that engineer's chronological detail log with running
//                     vacation / sick / floating-holiday balances (formulas;
//                     allotments sit in input cells at the top of the tab)
//
// SheetJS community edition: formulas, number formats, column widths and
// autofilter are supported; cell colours / fonts are not (Pro only).
import type * as XLSXNS from 'xlsx';
import {
  ptoTypeLabel,
  PTO_REQUEST_SOURCE_LABELS,
  type PtoRequest,
  type PtoSummary,
} from '../hooks/usePto';

type XLSX = typeof XLSXNS;
type Cell = XLSXNS.CellObject;

export type PtoExportEngineer = { user_id: string; full_name: string; active: boolean };

export type PtoExportInput = {
  year: number;
  summaries: PtoSummary[];
  requests: PtoRequest[];
  engineers: PtoExportEngineer[];
  /** Overrides the "today" stamp in the footers — tests only. */
  exportedOn?: string;
};

const DATE_FMT = 'm/d/yyyy';
const STAMP_FMT = 'm/d/yyyy h:mm AM/PM';
const HRS_FMT = '0.##';

const LOG_HEADS = [
  'Dates', 'Type', 'Hours', 'Status', 'Start', 'End', 'Days', 'Out from', 'Out until',
  'Requested via', 'Source detail', 'Reason', 'Submitted by', 'Submitted', 'Reviewed by',
  'Reviewed', 'Review note', 'Cap override',
];
const LOG_WIDTHS = [22, 15, 7, 10, 11, 11, 6, 9, 9, 16, 18, 30, 18, 17, 18, 17, 30, 9];

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function ymd(s: string): Date { return new Date(s + 'T00:00:00'); }

function md(s: string): string {
  const d = ymd(s);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
}

function range(starts: string, ends: string): string {
  return starts === ends ? md(starts) : `${md(starts)} – ${md(ends)}`;
}

/** 'HH:MM:SS' (Postgres time) → '7:00 AM'. */
function clock(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ap}`;
}

function stamp(iso: string | null): Cell | null {
  return iso ? { t: 'd', v: new Date(iso), z: STAMP_FMT } : null;
}

function date(s: string): Cell { return { t: 'd', v: ymd(s), z: DATE_FMT }; }
function num(v: number, z = HRS_FMT): Cell { return { t: 'n', v, z }; }
function fx(f: string, z = HRS_FMT): Cell { return { t: 'n', f, z }; }

/** Plain value / null / pre-built cell → cell object (null → empty). */
function toCell(v: unknown): Cell | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object' && v !== null && 't' in (v as object)) return v as Cell;
  if (typeof v === 'number') return { t: 'n', v };
  if (typeof v === 'boolean') return { t: 's', v: v ? 'Yes' : 'No' };
  if (v instanceof Date) return { t: 'd', v, z: DATE_FMT };
  return { t: 's', v: String(v) };
}

/** Write a grid of cells/values into a fresh sheet; returns the sheet. */
function grid(X: XLSX, rows: unknown[][], widths?: number[]): XLSXNS.WorkSheet {
  const ws: XLSXNS.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => {
    row.forEach((v, c) => {
      const cell = toCell(v);
      if (!cell) return;
      ws[X.utils.encode_cell({ r, c })] = cell;
      if (c > maxC) maxC = c;
    });
  });
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: maxC } });
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

/** Excel sheet names: ≤31 chars, none of []:*?/\ . */
function sheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, '').trim().slice(0, 31) || 'Engineer';
  let out = base;
  let i = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${i++})`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(out.toLowerCase());
  return out;
}

function logRow(r: PtoRequest): unknown[] {
  return [
    range(r.starts_on, r.ends_on),
    ptoTypeLabel(r.type),
    num(Number(r.hours)),
    cap(r.status),
    date(r.starts_on),
    date(r.ends_on),
    num(Number(r.days)),
    clock(r.out_from),
    clock(r.out_until),
    r.request_source ? PTO_REQUEST_SOURCE_LABELS[r.request_source] : null,
    r.request_source_detail,
    r.reason,
    r.submitted_by_name,
    stamp(r.submitted_at),
    r.reviewed_by_name,
    stamp(r.reviewed_at),
    r.review_note,
    r.cap_override ? 'Yes' : 'No',
  ];
}

export function buildUparkPtoWorkbook(X: XLSX, input: PtoExportInput): XLSXNS.WorkBook {
  const { year, engineers } = input;
  const yr = String(year);
  const exportedOn = input.exportedOn ?? new Date().toLocaleDateString('en-CA');
  const isTest = (n: string) => /test/i.test(n);

  // Everyone with a balance row or a request this year, plus active
  // engineers with neither (they show as "not set", like the grid).
  const nameById = new Map<string, string>();
  for (const e of engineers) if (e.active && !isTest(e.full_name)) nameById.set(e.user_id, e.full_name);
  const summaries = input.summaries.filter((s) => s.year === year && !isTest(s.user_full_name ?? ''));
  for (const s of summaries) if (!nameById.has(s.user_id)) nameById.set(s.user_id, s.user_full_name ?? s.user_id);
  const requests = input.requests
    .filter((r) => r.starts_on.startsWith(yr) && !isTest(r.user_full_name ?? ''))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.ends_on.localeCompare(b.ends_on));
  for (const r of requests) if (!nameById.has(r.user_id)) nameById.set(r.user_id, r.user_full_name ?? r.user_id);

  const activeById = new Map(engineers.map((e) => [e.user_id, e.active]));
  const balById = new Map(summaries.map((s) => [s.user_id, s]));
  const people = [...nameById.entries()]
    .map(([user_id, name]) => ({ user_id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const wb = X.utils.book_new();
  const LOG = "'UPark PTO Log'!";

  // ---------------- UPark Summary ----------------
  const sumRows: unknown[][] = [[
    'Engineer', 'Active', 'Vacation allotted', 'Vacation used', 'Vacation remaining',
    'Sick allotted', 'Sick used', 'Sick remaining',
    'Floating Holiday allotted', 'Floating Holiday used', 'Floating Holiday remaining',
    'Approved entries', 'Pending entries', 'Cancelled/denied', 'Balance notes',
  ]];
  people.forEach((p, i) => {
    const r = i + 2;                       // 1-based sheet row
    const b = balById.get(p.user_id);
    const active = activeById.get(p.user_id);
    sumRows.push([
      p.name,
      active === undefined ? '?' : active ? 'Yes' : 'No',
      b ? num(b.vacation_alloted) : null, b ? num(b.vacation_used) : null, fx(`C${r}-D${r}`),
      b ? num(b.sick_alloted) : null,     b ? num(b.sick_used) : null,     fx(`F${r}-G${r}`),
      b ? num(b.holiday_alloted) : null,  b ? num(b.holiday_used) : null,  fx(`I${r}-J${r}`),
      fx(`COUNTIFS(${LOG}$A:$A,$A${r},${LOG}$E:$E,"Approved")`, '0'),
      fx(`COUNTIFS(${LOG}$A:$A,$A${r},${LOG}$E:$E,"Pending")`, '0'),
      fx(`COUNTIFS(${LOG}$A:$A,$A${r},${LOG}$E:$E,"Cancelled")+COUNTIFS(${LOG}$A:$A,$A${r},${LOG}$E:$E,"Denied")`, '0'),
      b?.notes ?? null,
    ]);
  });
  const last = people.length + 1;
  if (people.length > 0) {
    sumRows.push([
      'Total', '',
      ...['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((c) => fx(`SUM(${c}2:${c}${last})`)),
      ...['L', 'M', 'N'].map((c) => fx(`SUM(${c}2:${c}${last})`, '0')),
      '',
    ]);
  }
  sumRows.push([]);
  sumRows.push([
    `Hours. Allotted/used come from the dashboard balance table; "remaining" and the entry counts are live formulas. ` +
    `Each engineer also has a detail-log tab. Exported ${exportedOn}; UPark engineers only, ${year}.`,
  ]);
  const wsSum = grid(X, sumRows, [20, 7, 10, 10, 11, 10, 10, 11, 11, 11, 11, 9, 9, 10, 50]);
  if (people.length > 0) wsSum['!autofilter'] = { ref: `A1:O${last}` };
  X.utils.book_append_sheet(wb, wsSum, 'UPark Summary');

  // ---------------- UPark PTO Log ----------------
  const logRows: unknown[][] = [['Engineer', ...LOG_HEADS]];
  const byPerson = [...requests].sort((a, b) =>
    (nameById.get(a.user_id) ?? '').localeCompare(nameById.get(b.user_id) ?? '') ||
    a.starts_on.localeCompare(b.starts_on));
  for (const r of byPerson) logRows.push([nameById.get(r.user_id) ?? r.user_full_name, ...logRow(r)]);
  const wsLog = grid(X, logRows, [20, ...LOG_WIDTHS]);
  if (byPerson.length > 0) wsLog['!autofilter'] = { ref: `A1:S${byPerson.length + 1}` };
  X.utils.book_append_sheet(wb, wsLog, 'UPark PTO Log');

  // ---------------- One detail-log tab per engineer ----------------
  const taken = new Set(['upark summary', 'upark pto log']);
  for (const p of people) {
    const mine = requests.filter((r) => r.user_id === p.user_id);
    const b = balById.get(p.user_id);
    const rows: unknown[][] = [];
    // Row 1-2: title + allotment inputs feeding the running balances.
    rows.push([p.name, null, null, null, 'Vacation allotted', 'Sick allotted', 'Floating Holiday allotted', null,
      'Allotted hours come from the dashboard balance table — change them here and the running balances follow. Running balances count Approved + Pending entries, like the dashboard.']);
    rows.push([`UPark · ${year} PTO detail log`, null, null, null,
      num(b?.vacation_alloted ?? 0), num(b?.sick_alloted ?? 0), num(b?.holiday_alloted ?? 0)]);
    rows.push([]);
    const HDR = 4;                                   // 1-based header row
    rows.push([...LOG_HEADS, 'Vacation remaining', 'Sick remaining', 'Floating Holiday remaining']);
    mine.forEach((r, i) => {
      const row = HDR + 1 + i;
      const prevV = i === 0 ? '$E$2' : `S${row - 1}`;
      const prevS = i === 0 ? '$F$2' : `T${row - 1}`;
      const prevH = i === 0 ? '$G$2' : `U${row - 1}`;
      const live = `OR($D${row}="Approved",$D${row}="Pending")`;
      rows.push([
        ...logRow(r),
        fx(`IF(AND($B${row}="Vacation",${live}),${prevV}-$C${row},${prevV})`),
        fx(`IF(AND($B${row}="Sick",${live}),${prevS}-$C${row},${prevS})`),
        fx(`IF(AND($B${row}="Floating Holiday",${live}),${prevH}-$C${row},${prevH})`),
      ]);
    });
    if (mine.length === 0) {
      rows.push([`No PTO entries in ${year}.`]);
    } else {
      const first = HDR + 1;
      const lastRow = HDR + mine.length;
      rows.push([
        'Totals (Approved + Pending)', null,
        fx(`SUMIFS(C${first}:C${lastRow},D${first}:D${lastRow},"Approved")+SUMIFS(C${first}:C${lastRow},D${first}:D${lastRow},"Pending")`),
      ]);
      rows.push(['Vacation used', null, fx(`$E$2-S${lastRow}`)]);
      rows.push(['Sick used', null, fx(`$F$2-T${lastRow}`)]);
      rows.push(['Floating Holiday used', null, fx(`$G$2-U${lastRow}`)]);
    }
    const ws = grid(X, rows, [...LOG_WIDTHS, 11, 11, 12]);
    if (mine.length > 0) ws['!autofilter'] = { ref: `A${HDR}:U${HDR + mine.length}` };
    X.utils.book_append_sheet(wb, ws, sheetName(p.name, taken));
  }

  return wb;
}

/** Build + download. Lazy-loads SheetJS so the ~400 kB library stays out of
 *  the main bundle until someone actually clicks Export. */
export async function downloadUparkPtoWorkbook(input: PtoExportInput): Promise<void> {
  const X = await import('xlsx');
  const wb = buildUparkPtoWorkbook(X, input);
  const day = new Date().toLocaleDateString('en-CA');
  X.writeFile(wb, `UPark_PTO_${input.year}_${day}.xlsx`, { compression: true });
}
