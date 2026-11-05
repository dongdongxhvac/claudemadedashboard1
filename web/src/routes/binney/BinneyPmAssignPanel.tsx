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
// Managers only (manageScopeFor !== 'none') — the DB policy says the same.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useMe, manageScopeFor } from '../../hooks/useMe';
import { useQueryClient } from '@tanstack/react-query';
import { useAllUsers, type EngineerRow } from './hooks/useBinneyEngineers';
import { useBinneyPmRows, useBinneySnapshotAges, type BinneyPmRow } from './hooks/useBinneySnapshots';
import { usePmAssignRequests, useRequestPmAssign, type PmAssignRequest } from './hooks/useBinneyPmAssign';
import { isClosed, addDays, localISODate } from '../../lib/dashboard';
import { inputStyle } from '../../lib/binneyRounds';
import { SmallBtn } from './BinneyUi';

const DEFAULT_AHEAD_DAYS = 14;

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

  const [showAll, setShowAll] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [search, setSearch] = useState('');
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
    const q = search.trim().toLowerCase();
    return ((pmQ.data ?? []) as BinneyPmRow[])
      .filter((r) => !isClosed(r.status))
      .filter((r) => showAll || !r.due_date || r.due_date <= aheadIso)
      .filter((r) => !unassignedOnly || !(r.assigned_to_name ?? '').trim())
      .filter((r) => !q || [r.task_no, r.name, r.building_code, r.equipment, r.assigned_to_name].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.task_no ?? '').localeCompare(b.task_no ?? ''));
  }, [pmQ.data, showAll, unassignedOnly, search]);

  const missingIds = useMemo(() => ((pmQ.data ?? []) as BinneyPmRow[]).some((r) => !r.cove_task_id), [pmQ.data]);

  if (!canAssign) return null;

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
      // Cove's own spelling, so the patched snapshot row reads like a polled one.
      assignee_name: u.cmms_assignee_name ?? u.full_name,
      previous_assignee_name: r.assigned_to_name,
      requested_by: session?.user.email ?? null,
    }, {
      onSuccess: () => setPicks((p) => { const n = { ...p }; delete n[r.cove_task_id!]; return n; }),
    });
  };

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
        <span className="t-small t-muted">{rows.length} shown</span>
      </div>

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
                <th className="py-1 pr-3">PM</th>
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
                const pick = picks[r.cove_task_id ?? ''] ?? '';
                const current = roster.byCmms.get((r.assigned_to_name ?? '').trim());
                const samePerson = !!pick && current?.user_id === pick;
                return (
                  <tr key={key} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="py-1 pr-3 t-mono whitespace-nowrap">{r.task_no ?? '—'}</td>
                    <td className="py-1 pr-3 whitespace-nowrap" style={overdue ? { color: 'var(--color-danger)', fontWeight: 600 } : undefined}>
                      {fmtDue(r.due_date)}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">{r.building_code ?? '—'}</td>
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
