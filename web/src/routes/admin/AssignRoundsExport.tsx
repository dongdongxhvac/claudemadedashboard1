// Shared "⤓ Excel" button for the Bldg Assign + Rounds admin tabs.
//
// Exports the LIVE (published) state in the shop's familiar one-sheet layout
// (modeled on Sean's "Building & Round Assignments" workbook):
//   Block 1: Engineer | Start Time | Lunch Out | Lunch In | End Time |
//            Assigned Buildings | Phone Number   — grouped by shift,
//            leads first; building numbers as a comma list.
//   Block 2+: one "<SHIFT> ROUNDS" block per shift:
//            Engineer | Buildings (in walk order), one row per round.
//
// Self-contained on purpose: it loads its own data via the same read hooks +
// UPark scoping both tabs use (react-query dedupes the fetches), so either
// tab can drop it in its header without prop threading. Always exports LIVE
// data — never a half-composed draft.
import { useMemo } from 'react';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { useShifts, type Shift } from '../../hooks/useShifts';
import { useBuildings, type Building } from '../../hooks/useBuildings';
import { useCurrentBuildingAssignments } from '../../hooks/useBuildingAssignments';
import { useRounds, type Round } from '../../hooks/useRounds';
import { useUparkUserIds, useUparkBuildingIds } from '../../hooks/useSiteScope';

/** "07:00:00" -> "7:00AM" (the sheet's time style). */
function fmtTimeSheet(t: string | null): string {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function bldLabel(b: Pick<Building, 'short_code' | 'code'>): string {
  return b.short_code ?? b.code;
}

function byLeadThenName(a: EngineerRow, b: EngineerRow): number {
  if (a.is_lead !== b.is_lead) return a.is_lead ? -1 : 1;
  return a.full_name.localeCompare(b.full_name);
}

export function AssignRoundsExportButton() {
  const engineersQ = useEngineers();
  const shiftsQ = useShifts();
  const buildingsQ = useBuildings();
  const assignmentsQ = useCurrentBuildingAssignments();
  const roundsQ = useRounds();
  const uparkIds = useUparkUserIds();
  const uparkBldgIds = useUparkBuildingIds();

  // Unlike the tabs' render path (which fails open while scoping loads),
  // an export is a persisted artifact — fail CLOSED until the UPark scope
  // sets are actually here, or a click in the load window would bake Binney
  // rows into the "UPark" workbook.
  const ready = !!(engineersQ.data && shiftsQ.data && buildingsQ.data
    && assignmentsQ.data && roundsQ.data && uparkIds && uparkBldgIds);

  // Same UPark scoping recipe as BuildingsTab/RoundsTab (fails open while
  // the id sets load — matches the tabs' behavior).
  const scoped = useMemo(() => {
    const engineersAll = engineersQ.data ?? [];
    const engineers = engineersAll.filter((e) =>
      e.active && e.role === 'engineer' && (!uparkIds || uparkIds.has(e.user_id)));
    const binneyShiftIds = new Set<string>();
    if (uparkIds) {
      for (const e of engineersAll) {
        if (e.shift_id && !uparkIds.has(e.user_id)) binneyShiftIds.add(e.shift_id);
      }
    }
    const shifts = (shiftsQ.data ?? [])
      .filter((s) => (s.crew ?? null) === null && !binneyShiftIds.has(s.id))
      .sort((a, b) => a.sort_order - b.sort_order);
    const buildings = (buildingsQ.data ?? [])
      .filter((b) => !uparkBldgIds || uparkBldgIds.has(b.id));
    return { engineers, shifts, buildings };
  }, [engineersQ.data, shiftsQ.data, buildingsQ.data, uparkIds, uparkBldgIds]);

  const onExport = async () => {
    if (!ready) return;
    const { engineers, shifts, buildings } = scoped;
    const bldById = new Map(buildings.map((b) => [b.id, b]));

    // Open assignments per engineer: primaries first, then coverage, each
    // sorted numerically by building number — one flat comma list like the
    // paper sheet (leads' lists are their coverage sets).
    const openAssignments = (assignmentsQ.data ?? []).filter((a) =>
      a.ends_on === null && bldById.has(a.building_id));
    const listFor = (userId: string): string => {
      const pick = (role: string) => openAssignments
        .filter((a) => a.user_id === userId && a.role_in_building === role)
        .map((a) => bldLabel(bldById.get(a.building_id)!))
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
      return [...pick('primary'), ...pick('backup')].join(', ');
    };

    const aoa: (string | number)[][] = [];
    aoa.push(['UPark — Building & Round Assignments']);
    aoa.push([`Exported ${new Date().toLocaleDateString()} (live published state)`]);
    aoa.push([]);
    aoa.push(['Engineer', 'Start Time', 'Lunch Out', 'Lunch In', 'End Time', 'Assigned Buildings', 'Phone Number']);

    const engineerRow = (e: EngineerRow, s: Shift | null): (string | number)[] => [
      e.full_name,
      fmtTimeSheet(s?.start_time ?? null),
      fmtTimeSheet(s?.lunch_out ?? null),
      fmtTimeSheet(s?.lunch_in ?? null),
      fmtTimeSheet(s?.end_time ?? null),
      listFor(e.user_id),
      e.phone ?? '',
    ];
    for (const s of shifts) {
      for (const e of engineers.filter((x) => x.shift_id === s.id).sort(byLeadThenName)) {
        aoa.push(engineerRow(e, s));
      }
    }
    const noShift = engineers.filter((e) => e.shift_id == null
      || !shifts.some((s) => s.id === e.shift_id));
    for (const e of noShift.sort(byLeadThenName)) aoa.push(engineerRow(e, null));

    // Rounds blocks, one per shift that has rounds (walk order preserved).
    const rounds = (roundsQ.data ?? []).filter((r) =>
      r.shift_id === null || shifts.some((s) => s.id === r.shift_id));
    const roundBlocks: { label: string; times: string; rounds: Round[] }[] = [];
    for (const s of shifts) {
      const rs = rounds.filter((r) => r.shift_id === s.id);
      if (rs.length > 0) {
        roundBlocks.push({
          label: `${s.name.toUpperCase()} SHIFT ROUNDS`,
          times: `${fmtTimeSheet(s.start_time)} – ${fmtTimeSheet(s.end_time)}`,
          rounds: rs,
        });
      }
    }
    const orphanRounds = rounds.filter((r) => r.shift_id === null);
    if (orphanRounds.length > 0) {
      roundBlocks.push({ label: 'ROUNDS (NO SHIFT)', times: '', rounds: orphanRounds });
    }
    // Rounds rows put the stop list in column F so it lines up under the wide
    // "Assigned Buildings" column instead of overflowing the narrow time cols.
    for (const block of roundBlocks) {
      aoa.push([]);
      aoa.push([block.times ? `${block.label} · ${block.times}` : block.label]);
      aoa.push(['Round', 'Engineer', '', '', '', 'Buildings (in walk order)']);
      for (const r of block.rounds.slice().sort((a, b) => a.sort_order - b.sort_order)) {
        aoa.push([
          r.name,
          r.current?.full_name ?? '—',
          '', '', '',
          r.stops.map((st) => st.short_code ?? st.code).join(', '),
        ]);
      }
    }

    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 46 }, { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Assignments & Rounds');
    const today = new Date().toLocaleDateString('en-CA');
    XLSX.writeFile(wb, `upark-assignments-rounds_${today}.xlsx`);
  };

  return (
    <button
      onClick={onExport}
      disabled={!ready}
      className="t-small px-3 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
      title="Download the live assignments + rounds as an Excel sheet (Sean's format)"
    >
      ⤓ Excel
    </button>
  );
}
