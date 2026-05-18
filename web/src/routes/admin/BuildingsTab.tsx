// Admin → Buildings tab (Phase 2: read-mode + print).
//
// Mirrors the UPark `uparkba.html` screenshot: engineers grouped by shift,
// each row shows shift times + phone + assigned building chips (primary solid,
// backup dashed). Lead engineers (is_lead) get a gold star.
//
// Edit mode (click chip → popover with engineer dropdown) lands in Phase 3.
import { useMemo } from 'react';
import { useEngineers } from '../../hooks/useEngineers';
import { useShifts, useShiftsRealtime, fmtShiftTime, type Shift } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import {
  useCurrentBuildingAssignments,
  useBuildingAssignmentsRealtime,
  type BuildingAssignment,
} from '../../hooks/useBuildingAssignments';

type EngineerCard = {
  user_id: string;
  full_name: string;
  phone: string | null;
  is_lead: boolean;
  shift_id: string | null;
  primary: Building[];
  backup: Building[];
};

type ShiftGroup = {
  key: string;
  label: string;          // "7am shift", "Unassigned"
  times: string | null;   // "7:00am – 3:30pm · lunch 12:00–12:30"
  engineers: EngineerCard[];
};

export function BuildingsTab() {
  useShiftsRealtime();
  useBuildingsRealtime();
  useBuildingAssignmentsRealtime();

  const engineersQ = useEngineers();
  const shiftsQ = useShifts();
  const buildingsQ = useBuildings();
  const assignmentsQ = useCurrentBuildingAssignments();

  const loading = engineersQ.isLoading || shiftsQ.isLoading || buildingsQ.isLoading || assignmentsQ.isLoading;
  const error = engineersQ.error ?? shiftsQ.error ?? buildingsQ.error ?? assignmentsQ.error;

  const groups: ShiftGroup[] = useMemo(() => {
    if (!engineersQ.data || !shiftsQ.data || !buildingsQ.data || !assignmentsQ.data) return [];
    return buildGroups(engineersQ.data, shiftsQ.data, buildingsQ.data, assignmentsQ.data);
  }, [engineersQ.data, shiftsQ.data, buildingsQ.data, assignmentsQ.data]);

  const totals = useMemo(() => {
    let p = 0, s = 0;
    for (const g of groups) for (const e of g.engineers) { p += e.primary.length; s += e.backup.length; }
    return { engineers: groups.reduce((a, g) => a + g.engineers.length, 0), primary: p, backup: s };
  }, [groups]);

  const unassignedBuildings: Building[] = useMemo(() => {
    if (!buildingsQ.data || !assignmentsQ.data) return [];
    const covered = new Set(
      assignmentsQ.data
        .filter((a) => a.role_in_building === 'primary')
        .map((a) => a.building_id),
    );
    return buildingsQ.data.filter((b) => !covered.has(b.id));
  }, [buildingsQ.data, assignmentsQ.data]);

  if (loading) return <p className="t-text t-muted">Loading building assignments…</p>;
  if (error) return <p className="t-text t-danger">Error: {(error as Error).message}</p>;

  return (
    <div className="space-y-3 buildings-root">
      <style>{`
        @page { size: letter landscape; margin: 0.4in; }
        @media print {
          body * { visibility: hidden !important; }
          .buildings-root, .buildings-root * { visibility: visible !important; }
          .buildings-root {
            position: absolute !important;
            top: 0; left: 0;
            width: 100%;
            padding: 12px !important;
            background: white !important;
          }
          .buildings-no-print { display: none !important; }
          .buildings-card { box-shadow: none !important; border: none !important; padding: 0 !important; }
          body { background: white !important; }
          .bld-chip, .lead-star {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          tr, .eng-row { page-break-inside: avoid; }
        }
        .bld-chip {
          display: inline-block;
          padding: 2px 8px;
          margin: 2px 3px 2px 0;
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          line-height: 1.4;
          white-space: nowrap;
        }
        .bld-chip.primary {
          background: var(--color-accent);
          color: white;
          border: 1px solid var(--color-accent);
        }
        .bld-chip.backup {
          background: rgba(148, 163, 184, 0.12);
          color: #64748b;
          border: 1.5px dashed #94a3b8;
        }
        .lead-star {
          display: inline-block;
          color: #d4a017;
          margin-right: 4px;
          font-size: 14px;
        }
        .shift-band {
          background: var(--color-bg);
          border-top: 2px solid var(--color-border);
          padding: 8px 10px;
        }
      `}</style>

      <div className="t-card buildings-card" style={{ padding: '0.75rem 1rem' }}>
        <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
          <div>
            <h2 className="t-section-title">Building assignments</h2>
            <p className="t-small t-muted">
              <b>{totals.engineers}</b> engineer{totals.engineers === 1 ? '' : 's'} ·{' '}
              <b>{totals.primary}</b> primary · <b>{totals.backup}</b> coverage
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="t-small t-muted text-right">
              <span className="bld-chip primary" style={{ marginRight: 6 }}>40</span> primary · day-to-day owner &nbsp;
              <span className="bld-chip backup" style={{ marginRight: 6 }}>40</span> coverage · alarm + high-level repair &nbsp;
              <span className="lead-star">★</span> lead engineer
            </p>
            <div className="flex items-center gap-2 buildings-no-print">
              <button
                onClick={() => window.print()}
                className="t-small px-3 py-1 rounded border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                title="Print landscape, ready to post in the shop"
              >
                ⎙ Print
              </button>
            </div>
          </div>
        </div>

        <table className="min-w-full t-text border-collapse">
          <colgroup>
            <col style={{ width: '220px' }} />
            <col style={{ width: '140px' }} />
            <col />
          </colgroup>
          <thead>
            <tr className="text-left t-text t-muted uppercase tracking-wider border-b" style={{ borderColor: 'var(--color-border)' }}>
              <th className="py-1 pr-2">Engineer</th>
              <th className="py-1 px-2">Phone</th>
              <th className="py-1 px-2">Assigned buildings</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <ShiftBlock key={g.key} group={g} />
            ))}
          </tbody>
        </table>

        {unassignedBuildings.length > 0 && (
          <div className="mt-4 p-3 rounded border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="t-small t-muted uppercase tracking-wider mb-1">
              Unassigned buildings ({unassignedBuildings.length})
            </p>
            <div>
              {unassignedBuildings.map((b) => (
                <span key={b.id} className="bld-chip backup" title={b.name}>
                  {b.short_code ?? b.code}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShiftBlock({ group }: { group: ShiftGroup }) {
  return (
    <>
      <tr>
        <td colSpan={3} className="shift-band">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-3">
              <span className="t-section-title" style={{ fontSize: 14 }}>{group.label}</span>
              <span className="t-small t-muted">
                · {group.engineers.length} engineer{group.engineers.length === 1 ? '' : 's'}
              </span>
            </div>
            {group.times && <span className="t-small t-muted t-mono">{group.times}</span>}
          </div>
        </td>
      </tr>
      {group.engineers.length === 0 ? (
        <tr>
          <td colSpan={3} className="py-3 px-2 t-small t-muted italic">No engineers in this shift yet.</td>
        </tr>
      ) : (
        group.engineers.map((e) => <EngineerRow key={e.user_id} eng={e} />)
      )}
    </>
  );
}

function EngineerRow({ eng }: { eng: EngineerCard }) {
  return (
    <tr className="border-b eng-row" style={{ borderColor: 'var(--color-border-soft)' }}>
      <td className="py-2 pr-2">
        <div className="flex items-center">
          {eng.is_lead && <span className="lead-star" title="Lead engineer">★</span>}
          <span className="font-medium t-text">{eng.full_name}</span>
        </div>
      </td>
      <td className="py-2 px-2 t-small t-mono">{eng.phone ?? <span className="t-muted">—</span>}</td>
      <td className="py-2 px-2">
        {eng.primary.length === 0 && eng.backup.length === 0 ? (
          <span className="t-small t-muted italic">No buildings assigned</span>
        ) : (
          <>
            {eng.primary.map((b) => (
              <span key={`p-${b.id}`} className="bld-chip primary" title={b.name}>
                {b.short_code ?? b.code}
              </span>
            ))}
            {eng.backup.map((b) => (
              <span key={`b-${b.id}`} className="bld-chip backup" title={`${b.name} (coverage)`}>
                {b.short_code ?? b.code}
              </span>
            ))}
          </>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// data shaping
// ============================================================================

function buildGroups(
  engineers: ReturnType<typeof useEngineers>['data'] extends infer T ? T extends undefined ? never : NonNullable<T> : never,
  shifts: Shift[],
  buildings: Building[],
  assignments: BuildingAssignment[],
): ShiftGroup[] {
  const bldById = new Map(buildings.map((b) => [b.id, b]));
  const primaryByUser = new Map<string, Building[]>();
  const backupByUser  = new Map<string, Building[]>();
  for (const a of assignments) {
    const b = bldById.get(a.building_id);
    if (!b) continue;
    const map = a.role_in_building === 'primary' ? primaryByUser
              : a.role_in_building === 'backup'  ? backupByUser
              : null;
    if (!map) continue;
    const list = map.get(a.user_id) ?? [];
    list.push(b);
    map.set(a.user_id, list);
  }

  const sortChips = (list: Building[]) => {
    list.sort((x, y) => (x.short_code ?? x.code).localeCompare(y.short_code ?? y.code, undefined, { numeric: true }));
    return list;
  };

  const cards: EngineerCard[] = (engineers ?? [])
    .filter((e) => e.active && e.role === 'engineer')
    .map((e) => ({
      user_id: e.user_id,
      full_name: e.full_name,
      phone: e.phone,
      is_lead: e.is_lead,
      shift_id: e.shift_id,
      primary: sortChips(primaryByUser.get(e.user_id) ?? []),
      backup:  sortChips(backupByUser.get(e.user_id)  ?? []),
    }));

  const groups: ShiftGroup[] = shifts
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({
      key: s.id,
      label: `${s.name} shift`,
      times: shiftTimesLabel(s),
      engineers: cards
        .filter((c) => c.shift_id === s.id)
        .sort(byLeadThenName),
    }));

  const unassigned = cards.filter((c) => c.shift_id == null);
  if (unassigned.length > 0) {
    groups.push({
      key: '_unassigned',
      label: 'No shift assigned',
      times: null,
      engineers: unassigned.sort(byLeadThenName),
    });
  }

  return groups;
}

function byLeadThenName(a: EngineerCard, b: EngineerCard): number {
  if (a.is_lead !== b.is_lead) return a.is_lead ? -1 : 1;
  return a.full_name.localeCompare(b.full_name);
}

function shiftTimesLabel(s: Shift): string {
  const start = fmtShiftTime(s.start_time);
  const end = fmtShiftTime(s.end_time);
  const lo = fmtShiftTime(s.lunch_out);
  const li = fmtShiftTime(s.lunch_in);
  const lunch = lo && li ? ` · lunch ${lo}–${li}` : '';
  return `${start} – ${end}${lunch}`;
}
