// Binney St — Assign PMs · Cove (0156).
//
// Open Binney PMs from the latest pm12 snapshot, each with a picker of the
// Binney roster (people with a Cove ID) and an Assign button. The button
// queues a pm_assign_requests row; the VM's pm_assign_watcher.py runs Cove's
// UpdatePMTask within a minute and stamps the row, and the status chip next
// to the PM follows it (queued → writing → done / error). On done the
// watcher also patches the snapshot row, so the assignee column updates
// without waiting for the next poll.
//
// Bulk (month start, ~300 new PMs landing unassigned): tick rows (or "all
// shown"), pick one person, "Assign N" — one insert of N requests; the VM
// drains them 60 a minute. The poller pulls unassigned Binney PMs since
// cove_sites.fetch_unassigned, so "unassigned only" + a building search is
// the usual starting point.
//
// Managers only (manageScopeFor !== 'none') — the DB policy says the same.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useMe, manageScopeFor } from '../../hooks/useMe';
import { useQueryClient } from '@tanstack/react-query';
import { useAllUsers, type EngineerRow } from './hooks/useBinneyEngineers';
import { useBinneyPmRows, useBinneySnapshotAges, type BinneyPmRow } from './hooks/useBinneySnapshots';
import { usePmAssignRequests, useRequestPmAssign, useRequestPmAssignMany, type PmAssignInput, type PmAssignRequest } from './hooks/useBinneyPmAssign';
import { isClosed, addDays, localISODate } from '../../lib/dashboard';
import { inputStyle } from '../../lib/binneyRounds';
import { SmallBtn } from './BinneyUi';
import { useBinneyBuildings } from './hooks/useBinneyOps';
import { makeBuildingClusterLookup } from '../../lib/binneyBuildingMatch';
import { CLUSTER_STYLE, type Cluster } from '../../lib/binneyRounds';

const DEFAULT_AHEAD_DAYS = 14;
/** 'start within N days' filter: |open_date − today| ≤ N (user 2026-11-13).
 *  Start = Cove createdAt, the day the PM landed in the open list — Cove's
 *  PM task has no separate start date (its PMTaskBase fragment: createdAt /
 *  dueDate / completedOn / updatedAt only). */
const START_WINDOW_DAYS = 5;

function fmtDue(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function StatusChip({ req }: { req: PmAssignRequest }) {
  const map: Record<PmAssignRequest['status'], { label: string; color: string; title?: string }> = {
    pending: { label: 'queued', color: 'var(--color-warn)', title: 'The VM picks this up within a minute' },
    running: { label: 'writing to Cove…', color: 'var(--color-warn)' },
    done:    { label: 'done', color: 'var(--color-ok)', title: req.finished_at ? fmtWhen(req.finished_at) : undefined },
    error:   { label: 'failed', color: 'var(--color-danger)', title: req.detail ?? undefined },
  };
  const s = map[req.status];
  return (
    <span className="t-small" style={{ color: s.color, fontWeight: 600, whiteSpace: 'nowrap' }} title={s.title}>
      {s.label}
    </span>
  );
}

export function BinneyPmAssignPanel() {
  const me = useMe().data;
  const canAssign = manageScopeFor(me) !== 'none';
  const { session } = useAuth();
  const qc = useQueryClient();
  const pmQ = useBinneyPmRows();
  const agesQ = useBinneySnapshotAges();
  const usersQ = useAllUsers();
  const reqQ = usePmAssignRequests();
  const request = useRequestPmAssign();
  const requestMany = useRequestPmAssignMany();

  const [showAll, setShowAll] = useState(true);  // default on (user 2026-11-06): the unassigned pile is any age
  const [selected, setSelected] = useState<Set<string>>(() => new Set()); // cove_task_id
  const [bulkPick, setBulkPick] = useState('');                             // user_id
  const [unassignedOnly, setUnassignedOnly] = useState(true); // default on (user 2026-11-06): the panel's job is the unassigned pile
  const [search, setSearch] = useState('');
  const [startSoon, setStartSoon] = useState(false); // open_date within ±START_WINDOW_DAYS of today
  const [clusterPick, setClusterPick] = useState<'all' | Cluster | 'none'>('all'); // East / West by the PM's building
  const buildingsQ = useBinneyBuildings();
  const clusters = useMemo(() => makeBuildingClusterLookup(buildingsQ.data ?? []), [buildingsQ.data]);
  const [picks, setPicks] = useState<Record<string, string>>({}); // cove_task_id → user_id

  // Roster = active Binney people with a Cove ID. Engineers and managers
  // both carry PMs there (cove_sites.py polls both roles).
  const roster = useMemo(() => {
    const all = (usersQ.data ?? []).filter((u) => u.active && u.cove_user_id && (u.role === 'engineer' || u.role === 'manager'));
    const byName = (a: EngineerRow, b: EngineerRow) => a.full_name.localeCompare(b.full_name);
    return {
      engineers: all.filter((u) => u.role === 'engineer').sort(byName),
      managers: all.filter((u) => u.role === 'manager').sort(byName),
      byId: new Map(all.map((u) => [u.user_id, u])),
      /** CMMS spelling or full name → profile, to tell "already assigned to this person". */
      byCmms: new Map(all.flatMap((u) => [[u.full_name, u], ...(u.cmms_assignee_name ? [[u.cmms_assignee_name, u] as const] : [])] as [string, EngineerRow][])),
    };
  }, [usersQ.data]);

  // Latest request per PM (the list is newest-first).
  const latestReq = useMemo(() => {
    const m = new Map<string, PmAssignRequest>();
    for (const r of reqQ.data ?? []) if (!m.has(r.cove_task_id)) m.set(r.cove_task_id, r);
    return m;
  }, [reqQ.data]);

  // When a request finishes, pull the snapshot again (the watcher patched
  // the row) so the Assigned column catches up.
  const doneCount = (reqQ.data ?? []).filter((r) => r.status === 'done' || r.status === 'error').length;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount !== prevDone.current) qc.invalidateQueries({ queryKey: ['binney_pm_snapshot'] });
    prevDone.current = doneCount;
  }, [doneCount, qc]);

  const todayIso = localISODate(new Date());
  const rows = useMemo(() => {
    const aheadIso = localISODate(addDays(new Date(), DEFAULT_AHEAD_DAYS));
    const startFrom = localISODate(addDays(new Date(), -START_WINDOW_DAYS));
    const startTo = localISODate(addDays(new Date(), START_WINDOW_DAYS));
    const q = search.trim().toLowerCase();
    return ((pmQ.data ?? []) as BinneyPmRow[])
      .filter((r) => !isClosed(r.status))
      .filter((r) => showAll || !r.due_date || r.due_date <= aheadIso)
      .filter((r) => !unassignedOnly || !(r.assigned_to_name ?? '').trim())
      .filter((r) => !startSoon || (!!r.open_date && r.open_date >= startFrom && r.open_date <= startTo))
      .filter((r) => clusterPick === 'all' || (clusters.clusterOf(r.building_code) ?? 'none') === clusterPick)
      .filter((r) => !q || [r.task_no, r.name, r.building_code, r.equipment, r.assigned_to_name].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.task_no ?? '').localeCompare(b.task_no ?? ''));
  }, [pmQ.data, showAll, unassignedOnly, startSoon, clusterPick, clusters, search]);

  const missingIds = useMemo(() => ((pmQ.data ?? []) as BinneyPmRow[]).some((r) => !r.cove_task_id), [pmQ.data]);

  const assign = (r: BinneyPmRow) => {
    const uid = picks[r.cove_task_id ?? ''];
    const u = uid ? roster.byId.get(uid) : undefined;
    if (!r.cove_task_id || !u || !u.cove_user_id) return;
    request.mutate({
      cove_task_id: r.cove_task_id,
      task_no: r.task_no,
      task_name: r.name,
      assignee_user_id: u.user_id,
      assignee_cove_id: u.cove_user_id,
      // Readable name for the log; the watcher overwrites it with Cove's own
      // spelling ("Ed Nardone") from the mutation reply once the write lands.
      assignee_name: u.full_name,
      previous_assignee_name: r.assigned_to_name,
      requested_by: session?.user.email ?? null,
    }, {
      onSuccess: () => setPicks((p) => { const n = { ...p }; delete n[r.cove_task_id!]; return n; }),
    });
  };

  const rosterOptions = (
    <>
      <option value="">—</option>
      {roster.engineers.length > 0 && (
        <optgroup label="Engineers">
          {roster.engineers.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.full_name}{u.cluster ? ` · ${u.cluster === 'east' ? 'E' : 'W'}` : ''}
            </option>
          ))}
        </optgroup>
      )}
      {roster.managers.length > 0 && (
        <optgroup label="Managers">
          {roster.managers.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
        </optgroup>
      )}
    </>
  );

  // Selection is by cove_task_id; rows without one can't be selected.
  const selectable = rows.filter((r) => !!r.cove_task_id);
  const allShownSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.cove_task_id!));
  const toggleAllShown = () => setSelected((prev) => {
    const n = new Set(prev);
    if (allShownSelected) selectable.forEach((r) => n.delete(r.cove_task_id!));
    else selectable.forEach((r) => n.add(r.cove_task_id!));
    return n;
  });
  const toggleOne = (id: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const bulkTarget = bulkPick ? roster.byId.get(bulkPick) : undefined;
  // What "Assign N" will actually send: selected rows that have an id, are
  // not already on that person, and have no request in flight.
  const bulkRows = useMemo(() => {
    if (!bulkTarget) return [] as BinneyPmRow[];
    const all = (pmQ.data ?? []) as BinneyPmRow[];
    return all.filter((r) => {
      if (!r.cove_task_id || !selected.has(r.cove_task_id)) return false;
      const req = latestReq.get(r.cove_task_id);
      if (req?.status === 'pending' || req?.status === 'running') return false;
      const cur = roster.byCmms.get((r.assigned_to_name ?? '').trim());
      return cur?.user_id !== bulkTarget.user_id;
    });
  }, [pmQ.data, selected, bulkTarget, latestReq, roster.byCmms]);

  const assignMany = () => {
    if (!bulkTarget || !bulkTarget.cove_user_id || bulkRows.length === 0) return;
    const inputs: PmAssignInput[] = bulkRows.map((r) => ({
      cove_task_id: r.cove_task_id!,
      task_no: r.task_no,
      task_name: r.name,
      assignee_user_id: bulkTarget.user_id,
      assignee_cove_id: bulkTarget.cove_user_id!,
      assignee_name: bulkTarget.full_name,
      previous_assignee_name: r.assigned_to_name,
      requested_by: session?.user.email ?? null,
    }));
    requestMany.mutate(inputs, {
      onSuccess: () => { setSelected(new Set()); setBulkPick(''); },
    });
  };

  // All hooks are above this line (rules-of-hooks).
  if (!canAssign) return null;

  const recent = (reqQ.data ?? []).slice(0, 8);
  const pmAge = agesQ.data?.pm12 ? fmtWhen(agesQ.data.pm12) : 'never';

  return (
    <section className="t-card" style={{ padding: '1rem 1.25rem', borderTop: '3px solid var(--color-accent)' }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="t-section-title" style={{ letterSpacing: '0.04em' }}>Assign PMs · Cove</h2>
          <span className="t-small t-muted">
            pick a person, Assign — the VM writes it to Cove within a minute
          </span>
        </div>
        <span className="t-small t-muted">PM snapshot <b className="t-text">{pmAge}</b></span>
      </div>

      <div className="flex items-center gap-4 flex-wrap mb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search PM no · task · building · assignee"
          className="border rounded px-2 py-0.5 t-small t-text"
          style={{ ...inputStyle, width: 280 }}
        />
        <label className="t-small t-text inline-flex items-center gap-1">
          <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
          unassigned only
        </label>
        <label className="t-small t-text inline-flex items-center gap-1">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          all open PMs (not just due within {DEFAULT_AHEAD_DAYS} days)
        </label>
        <label className="t-small t-text inline-flex items-center gap-1" title={`PM created in Cove between ${START_WINDOW_DAYS} days ago and ${START_WINDOW_DAYS} days from now`}>
          <input type="checkbox" checked={startSoon} onChange={(e) => setStartSoon(e.target.checked)} />
          start within {START_WINDOW_DAYS} days
        </label>
        <label className="t-small t-text inline-flex items-center gap-1" title="by the PM's building — East = Kendall side (Ed Nardone), West = 301 side (Andrew Balbo)">
          cluster
          <select value={clusterPick} onChange={(e) => setClusterPick(e.target.value as 'all' | Cluster | 'none')}
            className="border rounded px-1 t-small t-text" style={{ ...inputStyle, fontSize: 11 }}>
            <option value="all">all</option>
            <option value="east">East</option>
            <option value="west">West</option>
            <option value="none">no cluster</option>
          </select>
        </label>
        <span className="t-small t-muted">{rows.length} shown</span>
      </div>

      {/* Bulk bar — appears once something is ticked. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-2 rounded px-3 py-1.5"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <span className="t-small t-text" style={{ fontWeight: 600 }}>{selected.size} selected</span>
          <span className="t-small t-muted">→ assign all to</span>
          <select value={bulkPick} onChange={(e) => setBulkPick(e.target.value)}
            className="border rounded px-1 t-small t-text" style={{ ...inputStyle, minWidth: 180, fontSize: 11 }}>
            {rosterOptions}
          </select>
          <SmallBtn primary disabled={!bulkTarget || bulkRows.length === 0 || requestMany.isPending} onClick={assignMany}
            title={bulkTarget && bulkRows.length < selected.size ? `${selected.size - bulkRows.length} skipped: already on ${bulkTarget.full_name} or in flight` : undefined}>
            Assign {bulkTarget ? bulkRows.length : selected.size}
          </SmallBtn>
          {bulkTarget && bulkRows.length < selected.size && (
            <span className="t-small t-muted">{selected.size - bulkRows.length} skipped (already theirs / in flight)</span>
          )}
          <button type="button" className="t-small t-accent hover:underline" onClick={() => { setSelected(new Set()); setBulkPick(''); }}>clear</button>
          {requestMany.error && <span className="t-small t-danger">{(requestMany.error as Error).message}</span>}
        </div>
      )}

      {pmQ.error && <p className="t-small t-danger mb-2">Couldn't load PMs: {(pmQ.error as Error).message}</p>}
      {reqQ.error && <p className="t-small t-danger mb-2">Couldn't load assign requests: {(reqQ.error as Error).message}</p>}
      {request.error && <p className="t-small t-danger mb-2">Couldn't queue the assignment: {(request.error as Error).message}</p>}
      {missingIds && (
        <p className="t-small t-warn mb-2">
          Some PMs have no Cove task id yet — they get one on the next pm12 poll (the poller was updated for this). Those rows can't be assigned until then.
        </p>
      )}
      {roster.engineers.length + roster.managers.length === 0 && usersQ.data && (
        <p className="t-small t-warn mb-2">Nobody on the Binney roster has a Cove ID — add them in Binney Admin › User Profiles.</p>
      )}

      {pmQ.isLoading ? (
        <p className="t-small t-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="t-small t-muted">No open PMs match.</p>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="w-full t-small" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="t-muted uppercase tracking-wider text-left" style={{ fontSize: 10 }}>
                <th className="py-1 pr-2">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown}
                    disabled={selectable.length === 0} title="select all shown" />
                </th>
                <th className="py-1 pr-3">PM</th>
                <th className="py-1 pr-3" title="the day the PM was created in Cove (Cove has no separate start date)">Start</th>
                <th className="py-1 pr-3">Due</th>
                <th className="py-1 pr-3">Bldg</th>
                <th className="py-1 pr-3">Task</th>
                <th className="py-1 pr-3">Assigned</th>
                <th className="py-1 pr-3">Assign to</th>
                <th className="py-1 pr-3"></th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = r.cove_task_id ?? r.task_no ?? r.object_id ?? '';
                const req = r.cove_task_id ? latestReq.get(r.cove_task_id) : undefined;
                const inFlight = req?.status === 'pending' || req?.status === 'running';
                const overdue = !!r.due_date && r.due_date < todayIso;
                const startsSoon = !!r.open_date && Math.abs((new Date(r.open_date + 'T00:00:00').getTime() - new Date(todayIso + 'T00:00:00').getTime()) / 86_400_000) <= START_WINDOW_DAYS;
                const pick = picks[r.cove_task_id ?? ''] ?? '';
                const current = roster.byCmms.get((r.assigned_to_name ?? '').trim());
                const samePerson = !!pick && current?.user_id === pick;
                return (
                  <tr key={key} style={{ borderTop: '1px solid var(--color-border)', ...(r.cove_task_id && selected.has(r.cove_task_id) ? { background: 'var(--color-bg)' } : {}) }}>
                    <td className="py-1 pr-2">
                      <input type="checkbox" disabled={!r.cove_task_id}
                        checked={!!r.cove_task_id && selected.has(r.cove_task_id)}
                        onChange={() => r.cove_task_id && toggleOne(r.cove_task_id)} />
                    </td>
                    <td className="py-1 pr-3 t-mono whitespace-nowrap">{r.task_no ?? '—'}</td>
                    <td className="py-1 pr-3 whitespace-nowrap" style={startsSoon ? { fontWeight: 600 } : undefined}
                      title={r.open_date ? `created in Cove ${r.open_date}` : 'no created date'}>
                      {fmtDue(r.open_date)}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap" style={overdue ? { color: 'var(--color-danger)', fontWeight: 600 } : undefined}>
                      {fmtDue(r.due_date)}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {(() => {
                        const c = clusters.clusterOf(r.building_code);
                        return c ? (
                          <span className="t-mono mr-1 rounded px-1" style={{ fontSize: 10, fontWeight: 700, background: CLUSTER_STYLE[c].bg, color: CLUSTER_STYLE[c].fg, border: `1px solid ${CLUSTER_STYLE[c].border}` }}
                            title={c === 'east' ? 'East cluster' : 'West cluster'}>
                            {CLUSTER_STYLE[c].letter}
                          </span>
                        ) : null;
                      })()}
                      {r.building_code ?? '—'}
                    </td>
                    <td className="py-1 pr-3" style={{ maxWidth: 360 }} title={r.equipment ?? undefined}>
                      <span className="t-text">{r.name ?? '—'}</span>
                      {r.equipment && <span className="t-muted"> · {r.equipment}</span>}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">{(r.assigned_to_name ?? '').trim() || <span className="t-muted">unassigned</span>}</td>
                    <td className="py-1 pr-3">
                      {r.cove_task_id ? (
                        <select
                          value={pick}
                          disabled={inFlight}
                          onChange={(e) => setPicks((p) => ({ ...p, [r.cove_task_id!]: e.target.value }))}
                          className="border rounded px-1 t-small t-text"
                          style={{ ...inputStyle, minWidth: 160, fontSize: 11 }}
                        >
                          {rosterOptions}
                        </select>
                      ) : (
                        <span className="t-muted" title="pm_rows.cove_task_id is empty for this row — it fills on the next poll">id on next poll</span>
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      <SmallBtn
                        primary
                        disabled={!pick || samePerson || inFlight || request.isPending}
                        onClick={() => assign(r)}
                        title={samePerson ? 'Already assigned to this person' : undefined}
                      >
                        Assign
                      </SmallBtn>
                    </td>
                    <td className="py-1">{req ? <StatusChip req={req} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-3">
          <div className="t-small t-muted uppercase tracking-wider" style={{ fontSize: 10 }}>Recent (48 h)</div>
          <ul className="list-none p-0 m-0 mt-1 space-y-0.5">
            {recent.map((r) => (
              <li key={r.id} className="t-small flex items-baseline gap-2 flex-wrap">
                <span className="t-muted t-mono" style={{ fontSize: 10 }}>{fmtWhen(r.requested_at)}</span>
                <span className="t-mono">{r.task_no ?? r.cove_task_id}</span>
                <span className="t-muted">{r.previous_assignee_name?.trim() || 'unassigned'} →</span>
                <span className="t-text">{r.assignee_name ?? r.assignee_cove_id}</span>
                <StatusChip req={r} />
                {r.status === 'error' && r.detail && <span className="t-danger">{r.detail}</span>}
                {r.requested_by && <span className="t-muted">by {r.requested_by}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
