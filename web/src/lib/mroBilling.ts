// MRO billing model — group verified charges by building → MEP category
// and apply the cost-plus markup. Pure so the on-screen statement, the CSV,
// and the printable packet share one set of numbers (and they're testable).
//
// Core rule 1: billable = cost × (1 + markup_pct/100), on the FULL charged
// amount incl tax (charge.amount). Default 5%, configurable.
// Billing gate: only 'verified' charges are billed; 'exception' charges are
// surfaced separately (flagged, not summed) so nothing unsubstantiated
// silently hits the client total.
import type { MroCharge } from '../hooks/useMroBilling';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BillingLine {
  charge: MroCharge;
  cost: number;
  markup: number;
  billable: number;
  hasReceipt: boolean;
}
export interface MepGroup { mep: string; lines: BillingLine[]; cost: number; billable: number; }
export interface BuildingGroup {
  buildingKey: string;
  buildingLabel: string;
  meps: MepGroup[];
  cost: number;
  billable: number;
  count: number;
}
export interface BillingModel {
  markupPct: number;
  buildings: BuildingGroup[];
  grand: { cost: number; markup: number; billable: number; count: number };
  flagged: MroCharge[];          // status='exception' — surfaced, not billed
  missingReceiptCount: number;   // verified lines somehow without a receipt
}

const UNASSIGNED_BLDG = '(Unassigned building)';
const UNCATEGORIZED = '(Uncategorized)';

function buildingLabel(c: MroCharge): string {
  if (!c.building) return UNASSIGNED_BLDG;
  const code = c.building.short_code;
  return code ? `${code} — ${c.building.name}` : c.building.name;
}

export function buildBillingModel(charges: MroCharge[], markupPct: number): BillingModel {
  const verified = charges.filter((c) => c.status === 'verified');
  const flagged = charges.filter((c) => c.status === 'exception');
  const factor = 1 + markupPct / 100;

  // building → mep → lines
  const byBuilding = new Map<string, Map<string, BillingLine[]>>();
  let missingReceiptCount = 0;

  for (const c of verified) {
    const bKey = c.building?.short_code ?? (c.building ? c.building.name : UNASSIGNED_BLDG);
    const mep = c.mep_category ?? UNCATEGORIZED;
    const billable = round2(c.amount * factor);
    const line: BillingLine = {
      charge: c, cost: c.amount, billable, markup: round2(billable - c.amount),
      hasReceipt: !!c.receipt_id,
    };
    if (!line.hasReceipt) missingReceiptCount++;
    let mm = byBuilding.get(bKey);
    if (!mm) { mm = new Map(); byBuilding.set(bKey, mm); }
    const arr = mm.get(mep) ?? [];
    arr.push(line);
    mm.set(mep, arr);
  }

  const buildings: BuildingGroup[] = [];
  for (const [bKey, mm] of byBuilding) {
    const meps: MepGroup[] = [];
    let bCost = 0, bBill = 0, bCount = 0;
    for (const [mep, lines] of mm) {
      const cost = round2(lines.reduce((s, l) => s + l.cost, 0));
      const bill = round2(lines.reduce((s, l) => s + l.billable, 0));
      meps.push({ mep, lines, cost, billable: bill });
      bCost += cost; bBill += bill; bCount += lines.length;
    }
    meps.sort((a, b) => a.mep.localeCompare(b.mep));
    buildings.push({
      buildingKey: bKey,
      buildingLabel: buildingLabel(mm.values().next().value![0].charge),
      meps, cost: round2(bCost), billable: round2(bBill), count: bCount,
    });
  }
  buildings.sort((a, b) => a.buildingLabel.localeCompare(b.buildingLabel, undefined, { numeric: true }));

  const grandCost = round2(buildings.reduce((s, b) => s + b.cost, 0));
  const grandBill = round2(buildings.reduce((s, b) => s + b.billable, 0));
  return {
    markupPct,
    buildings,
    grand: { cost: grandCost, markup: round2(grandBill - grandCost), billable: grandBill,
             count: buildings.reduce((s, b) => s + b.count, 0) },
    flagged,
    missingReceiptCount,
  };
}

// ── CSV ──
export function billingCsv(model: BillingModel): string {
  const head = ['Date', 'Vendor', 'Cardholder', 'Building', 'MEP', 'Cost', 'Markup%', 'Billable', 'Receipt', 'Note'];
  const rows: (string | number)[][] = [head];
  for (const b of model.buildings) {
    for (const m of b.meps) {
      for (const l of m.lines) {
        rows.push([
          l.charge.txn_date ?? '',
          l.charge.merchant ?? '',
          l.charge.cardholder ?? '',
          b.buildingLabel,
          m.mep,
          l.cost.toFixed(2),
          model.markupPct,
          l.billable.toFixed(2),
          l.hasReceipt ? 'attached' : 'MISSING',
          l.charge.note ?? '',
        ]);
      }
    }
  }
  return rows
    .map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c)).join(','))
    .join('\n');
}
