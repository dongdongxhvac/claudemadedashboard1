// /tv — Shop-floor TV view. Static 3x2 grid, large fonts, no nav chrome.
// Six panels visible at once for the morning huddle / glanceable read.
//
// Layout (3 cols × 2 rows):
//   ┌── header ──────────────────────────────────────────────────────────┐
//   │ COVE · MEP Operations · date · time · snapshot freshness           │
//   ├──────────────────┬──────────────────┬──────────────────────────────┤
//   │ ON-CALL          │ FOCUS BOARD      │ CREW · LAST 7d               │
//   ├──────────────────┼──────────────────┼──────────────────────────────┤
//   │ DUE TODAY        │ BUILDINGS        │ UPCOMING · NEXT 7 DAYS       │
//   │                  │ (rounds + assign)│                              │
//   └──────────────────┴──────────────────┴──────────────────────────────┘
import { useEffect, useMemo, useState } from 'react';
import { useUpcomingOncall, useOncallRealtime } from '../../hooks/useOncall';
import { useActiveFocusItems, useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { useCurrentPmRows, useCurrentLaborRows } from '../../hooks/useCurrentSnapshots';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { useRounds, useRoundsRealtime } from '../../hooks/useRounds';
import { useShifts, useShiftsRealtime } from '../../hooks/useShifts';
import { useBuildings, useBuildingsRealtime, type Building } from '../../hooks/useBuildings';
import { useCurrentBuildingAssignments, useBuildingAssignmentsRealtime, type BuildingAssignment } from '../../hooks/useBuildingAssignments';
import { useEngineers, type EngineerRow } from '../../hooks/useEngineers';
import { isClosed, isCompletedStatus, addDays, localISODate } from '../../lib/dashboard';

/** "Edwin Sepulveda" → "Edwin S." — TV-wide compact engineer name. */
function shortName(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return fullName;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export default function TvView() {
  // Live data
  useSnapshotRealtime();
  useOncallRealtime();
  useFocusBoardRealtime();
  useRoundsRealtime();
  useShiftsRealtime();
  useBuildingsRealtime();
  useBuildingAssignmentsRealtime();

  const oncallQ      = useUpcomingOncall(3);
  const focusQ       = useActiveFocusItems();
  const pmQ          = useCurrentPmRows();
  const laborQ       = useCurrentLaborRows();
  const roundsQ      = useRounds();
  const shiftsQ      = useShifts();
  const buildingsQ   = useBuildings();
  const assignmentsQ = useCurrentBuildingAssignments();
  const engineersQ   = useEngineers();

  // Tick once a minute so the header clock + freshness stay live.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="tv-root">
      <TvStyles />
      <Header now={now} snapshotTakenAt={pmQ.data?.[0]?.snapshot_taken_at ?? null} />
      <main className="tv-grid">
        {/* Top row: glanceable signals */}
        <OncallPanel oncall={oncallQ.data} />
        <FocusBoardPanel items={focusQ.data ?? []} />
        <CrewPanel pmRows={pmQ.data ?? []} laborRows={laborQ.data ?? []} now={now} />
        {/* Bottom row: today's work */}
        <TodayPanel pmRows={pmQ.data ?? []} now={now} />
        <BuildingsPanel
          engineers={engineersQ.data ?? []}
          buildings={buildingsQ.data ?? []}
          assignments={assignmentsQ.data ?? []}
          rounds={roundsQ.data ?? []}
          shifts={shiftsQ.data ?? []}
        />
        <UpcomingPmsPanel pmRows={pmQ.data ?? []} now={now} />
      </main>
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

function Header({ now, snapshotTakenAt }: { now: Date; snapshotTakenAt: string | null }) {
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const snapStr = snapshotTakenAt
    ? new Date(snapshotTakenAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
  return (
    <header className="tv-header">
      <div className="tv-h-title">COVE · MEP Operations</div>
      <div className="tv-h-meta">
        <span>{dateStr}</span>
        <span className="tv-h-time">{timeStr}</span>
        <span className="tv-h-snap">data as of {snapStr}</span>
      </div>
    </header>
  );
}

// ============================================================================
// Panels
// ============================================================================

function Panel({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <section className="tv-panel" style={accent ? { borderTopColor: accent } : undefined}>
      <h2 className="tv-panel-title">{title}</h2>
      <div className="tv-panel-body">{children}</div>
    </section>
  );
}

function OncallPanel({ oncall }: { oncall: ReturnType<typeof useUpcomingOncall>['data'] }) {
  const list = oncall ?? [];
  const fmt = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  if (list.length === 0) {
    return (
      <Panel title="On-call · this week + next 2" accent="#dc2626">
        <p className="tv-muted">No rotation set.</p>
      </Panel>
    );
  }

  const current = list[0].is_current ? list[0] : null;
  const upcoming = current ? list.slice(1) : list;

  return (
    <Panel title="On-call · this week + next 2" accent="#dc2626">
      {current ? (
        <div className="tv-oncall-current">
          <div className="tv-bigname">{shortName(current.primary)}</div>
          {current.secondary && <div className="tv-sub">backup · {shortName(current.secondary)}</div>}
          <div className="tv-sub" style={{ marginTop: '0.2vw', fontSize: '0.95vw' }}>
            from {fmt(current.week_start)}
          </div>
        </div>
      ) : (
        <div className="tv-oncall-current">
          <div className="tv-sub" style={{ fontSize: '1.2vw' }}>No rotation set for this week</div>
          {upcoming[0] && (
            <div className="tv-sub" style={{ marginTop: '0.2vw', fontSize: '0.95vw' }}>
              next starts {fmt(upcoming[0].week_start)}
            </div>
          )}
        </div>
      )}
      {upcoming.length > 0 && (
        <ul className="tv-oncall-upcoming">
          {upcoming.map((w) => (
            <li key={w.week_start}>
              <span className="tv-oncall-week">{fmt(w.week_start)}</span>
              <span className="tv-oncall-name">{shortName(w.primary)}</span>
              {w.secondary && <span className="tv-oncall-backup">backup {shortName(w.secondary)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FocusBoardPanel({ items }: { items: ReturnType<typeof useActiveFocusItems>['data'] }) {
  const list = (items ?? []).slice(0, 5);
  const levelColor: Record<string, string> = {
    info: '#0ea5e9', warn: '#f59e0b', urgent: '#dc2626', critical: '#7f1d1d',
  };
  return (
    <Panel title="Focus board" accent="#0ea5e9">
      {list.length === 0 ? (
        <p className="tv-muted">No announcements.</p>
      ) : (
        <ul className="tv-focus-list">
          {list.map((it) => (
            <li key={it.id}>
              <span className="tv-focus-dot" style={{ background: levelColor[it.level] ?? '#94a3b8' }} />
              {it.title && <strong>{it.title} · </strong>}
              {it.body}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CrewPanel({ pmRows, laborRows, now }: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  laborRows: NonNullable<ReturnType<typeof useCurrentLaborRows>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const winEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const winStart = addDays(winEnd, -7);

    const byTech = new Map<string, { pms: number; hours: number }>();
    for (const r of pmRows) {
      if (!isCompletedStatus(r.status)) continue;
      const ts = r.updated_at_cmms;
      if (!ts) continue;
      const d = new Date(ts);
      if (d < winStart || d >= winEnd) continue;
      const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
      const cur = byTech.get(a) ?? { pms: 0, hours: 0 };
      cur.pms++;
      byTech.set(a, cur);
    }
    for (const l of laborRows) {
      if (!l.week_start) continue;
      const ws = new Date(l.week_start + 'T00:00:00');
      const we = addDays(ws, 7);
      if (ws >= winEnd || we <= winStart) continue;
      const a = (l.assigned_to_name ?? '').trim() || 'Unassigned';
      const cur = byTech.get(a) ?? { pms: 0, hours: 0 };
      cur.hours += l.labor_hours ?? 0;
      byTech.set(a, cur);
    }
    return Array.from(byTech.entries())
      .map(([name, v]) => ({ name, pms: v.pms, hours: v.hours }))
      .sort((a, b) => b.hours - a.hours || b.pms - a.pms)
      .slice(0, 6);
  }, [pmRows, laborRows, now]);

  const maxHours = data.reduce((m, d) => Math.max(m, d.hours), 0) || 1;

  return (
    <Panel title="Crew · last 7 days" accent="#8b5cf6">
      {data.length === 0 ? (
        <p className="tv-muted">No data.</p>
      ) : (
        <ul className="tv-crew-list">
          {data.map((c) => (
            <li key={c.name}>
              <div className="tv-bar-bg">
                <div className="tv-bar-fill" style={{ width: `${(c.hours / maxHours) * 100}%` }} />
              </div>
              <span className="tv-crew-name">{shortName(c.name)}</span>
              <span className="tv-crew-stat">{c.pms} PM</span>
              <span className="tv-crew-stat">{c.hours.toFixed(1)}h</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TodayPanel({ pmRows, now }: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const todayStr = localISODate(now);
    const byTech = new Map<string, number>();
    let overdue = 0;
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) {
        overdue++;
        const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
        byTech.set(a, (byTech.get(a) ?? 0) + 1);
      } else if (r.due_date === todayStr) {
        const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
        byTech.set(a, (byTech.get(a) ?? 0) + 1);
      }
    }
    return {
      cards: Array.from(byTech.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 8),
      overdue,
    };
  }, [pmRows, now]);

  return (
    <Panel title="Due today + overdue" accent="#f59e0b">
      {data.cards.length === 0 ? (
        <p className="tv-muted">Nothing on the board for today.</p>
      ) : (
        <>
          {data.overdue > 0 && (
            <div className="tv-warn">⚠ {data.overdue} overdue PM{data.overdue === 1 ? '' : 's'} on the team</div>
          )}
          <ul className="tv-today-list">
            {data.cards.map((c) => (
              <li key={c.name}>
                <span className="tv-today-count">{c.count}</span>
                <span className="tv-today-name">{shortName(c.name)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function BuildingsPanel({ engineers, buildings, assignments, rounds, shifts }: {
  engineers: EngineerRow[];
  buildings: Building[];
  assignments: BuildingAssignment[];
  rounds: NonNullable<ReturnType<typeof useRounds>['data']>;
  shifts: NonNullable<ReturnType<typeof useShifts>['data']>;
}) {
  const data = useMemo(() => {
    const bldById = new Map(buildings.map((b) => [b.id, b]));

    // Per-user primary/coverage assignments
    const primaryByUser  = new Map<string, Building[]>();
    const coverageByUser = new Map<string, Building[]>();
    for (const a of assignments) {
      const b = bldById.get(a.building_id);
      if (!b) continue;
      const map = a.role_in_building === 'primary' ? primaryByUser
                : a.role_in_building === 'backup'  ? coverageByUser
                : null;
      if (!map) continue;
      const list = map.get(a.user_id) ?? [];
      list.push(b);
      map.set(a.user_id, list);
    }
    const sortBld = (list: Building[]) =>
      list.sort((x, y) =>
        (x.short_code ?? x.code).localeCompare(y.short_code ?? y.code, undefined, { numeric: true }),
      );

    // Round currently assigned to each user (latest single open assignment).
    const roundByUser = new Map<string, NonNullable<ReturnType<typeof useRounds>['data']>[number]>();
    for (const r of rounds) {
      if (r.current) roundByUser.set(r.current.user_id, r);
    }

    // Group engineers (non-lead) by shift in shift sort_order.
    const orderedShifts = shifts.slice().sort((a, b) => a.sort_order - b.sort_order);
    const shiftGroups = orderedShifts.map((s, idx) => ({
      shift: s,
      bandLabel: idx === 0 ? 'AM' : idx === 1 ? 'PM' : s.name,
      engineers: engineers
        .filter((e) => e.active && e.role === 'engineer' && !e.is_lead && e.shift_id === s.id)
        .map((e) => ({
          user_id: e.user_id,
          name: e.full_name,
          primary: sortBld(primaryByUser.get(e.user_id) ?? []),
          round:   roundByUser.get(e.user_id) ?? null,
        }))
        .filter((e) => e.primary.length > 0 || e.round)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.engineers.length > 0);

    // Leads: full-coverage row at the bottom.
    const leads = engineers
      .filter((e) => e.active && e.role === 'engineer' && e.is_lead)
      .map((e) => ({
        user_id: e.user_id,
        name: e.full_name,
        coverage: sortBld(coverageByUser.get(e.user_id) ?? []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { shiftGroups, leads };
  }, [engineers, buildings, assignments, rounds, shifts]);

  const fmtCodes = (list: Building[]) =>
    list.map((b) => b.short_code ?? b.code).join(' · ');

  return (
    <Panel title="Buildings · rounds + assignments" accent="#3b82f6">
      <div className="tv-bldgs">
        <div className="tv-bldgs-headerrow">
          <div className="tv-bldgs-colhead">Rounds</div>
          <div className="tv-bldgs-colhead">Assignments</div>
        </div>
        {data.shiftGroups.length === 0 ? (
          <p className="tv-muted">No assignments.</p>
        ) : (
          data.shiftGroups.map((g) => (
            <div key={g.shift.id} className="tv-bldgs-band">
              <div className="tv-bldgs-band-label">{g.bandLabel} shift</div>
              <div className="tv-bldgs-cols">
                {/* Rounds (left) */}
                <ul className="tv-bldgs-col">
                  {g.engineers.map((e) => (
                    <li key={`r-${e.user_id}`}>
                      <span className="tv-bldgs-eng">{shortName(e.name)}</span>
                      <span className="tv-bldgs-codes">
                        {e.round ? e.round.stops.map((s) => s.short_code ?? s.code).join(' · ') : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                {/* Assignments (right) */}
                <ul className="tv-bldgs-col">
                  {g.engineers.map((e) => (
                    <li key={`a-${e.user_id}`}>
                      <span className="tv-bldgs-eng">{shortName(e.name)}</span>
                      <span className="tv-bldgs-codes">
                        {e.primary.length > 0 ? fmtCodes(e.primary) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))
        )}
        {data.leads.length > 0 && (
          <div className="tv-bldgs-leads">
            {data.leads.map((l) => (
              <div key={l.user_id} className="tv-bldgs-lead-row">
                <span className="tv-bldgs-lead-name">★ {shortName(l.name)}</span>
                <span className="tv-bldgs-lead-codes">
                  {l.coverage.length > 0 ? fmtCodes(l.coverage) : 'no coverage set'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function UpcomingPmsPanel({ pmRows, now }: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const todayD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = localISODate(todayD);
    const days: { iso: string; label: string; count: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayD); d.setDate(todayD.getDate() + i);
      const iso = localISODate(d);
      const label =
        i === 0 ? 'Today'
        : i === 1 ? 'Tomorrow'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      days.push({ iso, label, count: 0 });
    }
    const dayMap = new Map(days.map((d) => [d.iso, d]));

    let total = 0;
    const techs = new Set<string>();
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!r.due_date) continue;
      if (r.due_date < todayStr) continue;
      const slot = dayMap.get(r.due_date);
      if (!slot) continue;
      slot.count++;
      total++;
      const a = (r.assigned_to_name ?? '').trim();
      if (a) techs.add(a);
    }
    const maxCount = days.reduce((m, d) => Math.max(m, d.count), 0) || 1;
    return { days, total, techs: techs.size, maxCount };
  }, [pmRows, now]);

  return (
    <Panel title="Upcoming · next 7 days" accent="#10b981">
      <div className="tv-upcoming-head">
        <span className="tv-bignum">{data.total}</span>
        <span className="tv-sub">PMs · {data.techs} tech{data.techs === 1 ? '' : 's'}</span>
      </div>
      <ul className="tv-upcoming-list">
        {data.days.map((d) => (
          <li key={d.iso}>
            <span className="tv-upcoming-day">{d.label}</span>
            <div className="tv-upcoming-bar-bg">
              <div
                className="tv-upcoming-bar-fill"
                style={{ width: `${(d.count / data.maxCount) * 100}%` }}
              />
            </div>
            <span className="tv-upcoming-count">{d.count}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}


// ============================================================================
// Styles
// ============================================================================

function TvStyles() {
  return (
    <style>{`
      .tv-root {
        min-height: 100vh;
        background: #0b1220;
        color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        padding: 1.2vw;
        display: flex;
        flex-direction: column;
        gap: 1vw;
      }
      .tv-header {
        display: flex; align-items: baseline; justify-content: space-between;
        padding: 0.4vw 0.8vw;
        border-bottom: 2px solid #1e293b;
      }
      .tv-h-title { font-size: 2.0vw; font-weight: 700; letter-spacing: 0.02em; }
      .tv-h-meta { display: flex; gap: 1.4vw; align-items: baseline; font-size: 1.2vw; color: #94a3b8; }
      .tv-h-time { color: #f8fafc; font-weight: 600; font-variant-numeric: tabular-nums; }
      .tv-h-snap { font-size: 0.95vw; color: #64748b; }

      .tv-grid {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: 1vw;
        min-height: 0;
      }
      .tv-panel {
        background: #111827;
        border: 1px solid #1e293b;
        border-top: 4px solid #334155;
        border-radius: 8px;
        padding: 1vw 1.2vw;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .tv-panel-title {
        font-size: 1.0vw;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin: 0 0 0.6vw;
      }
      .tv-panel-body { flex: 1; min-height: 0; overflow: hidden; }
      .tv-muted { color: #64748b; font-size: 1.3vw; font-style: italic; }

      .tv-bigname { font-size: 3.2vw; font-weight: 700; line-height: 1.1; color: #f8fafc; }
      .tv-bignum  { font-size: 4.0vw; font-weight: 700; color: #f8fafc; line-height: 1; }
      .tv-sub     { color: #94a3b8; font-size: 1.2vw; margin-left: 0.4em; }
      .tv-warn    { color: #f59e0b; font-size: 1.2vw; font-weight: 600; margin-bottom: 0.4em; }

      .tv-oncall-current { padding-bottom: 0.6vw; border-bottom: 1px solid #1e293b; margin-bottom: 0.6vw; }
      .tv-oncall-upcoming { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4vw; }
      .tv-oncall-upcoming li {
        display: grid;
        grid-template-columns: 4.5vw 1fr;
        gap: 0.5vw;
        font-size: 1.0vw;
        align-items: baseline;
      }
      .tv-oncall-week { color: #64748b; font-variant-numeric: tabular-nums; }
      .tv-oncall-name { color: #f8fafc; font-weight: 600; }
      .tv-oncall-backup { color: #64748b; font-size: 0.85vw; margin-left: 0.4em; }

      .tv-focus-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.6vw; }
      .tv-focus-list li { font-size: 1.25vw; line-height: 1.35; display: flex; align-items: baseline; gap: 0.5vw; }
      .tv-focus-dot { width: 0.7vw; height: 0.7vw; border-radius: 50%; flex: 0 0 auto; display: inline-block; }

      .tv-crew-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4vw; }
      .tv-crew-list li { display: grid; grid-template-columns: 1fr 7.5vw 3.2vw 3.6vw; align-items: center; gap: 0.5vw; font-size: 1.0vw; }
      .tv-bar-bg { background: #1e293b; height: 1.3vw; border-radius: 4px; overflow: hidden; }
      .tv-bar-fill { background: linear-gradient(90deg, #8b5cf6, #a78bfa); height: 100%; }
      .tv-crew-name { font-weight: 500; }
      .tv-crew-stat { color: #94a3b8; text-align: right; font-variant-numeric: tabular-nums; }

      .tv-today-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4vw; }
      .tv-today-list li { display: flex; align-items: baseline; gap: 0.6vw; font-size: 1.3vw; }
      .tv-today-count { font-weight: 700; color: #f59e0b; font-size: 1.7vw; min-width: 2.4vw; text-align: right; font-variant-numeric: tabular-nums; }
      .tv-today-name { color: #e2e8f0; }

      /* Combined Buildings panel */
      .tv-bldgs { display: flex; flex-direction: column; gap: 0.5vw; }
      .tv-bldgs-headerrow {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6vw;
        font-size: 0.75vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
        padding-bottom: 0.2vw;
        border-bottom: 1px solid #1e293b;
      }
      .tv-bldgs-colhead { padding: 0 0.2vw; }
      .tv-bldgs-band { }
      .tv-bldgs-band-label {
        font-size: 0.8vw;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #94a3b8;
        margin: 0.3vw 0 0.2vw;
      }
      .tv-bldgs-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6vw; }
      .tv-bldgs-col { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2vw; }
      .tv-bldgs-col li {
        display: flex;
        flex-direction: column;
        font-size: 0.85vw;
        line-height: 1.25;
      }
      .tv-bldgs-eng { font-weight: 600; color: #f8fafc; }
      .tv-bldgs-codes { color: #e2e8f0; font-variant-numeric: tabular-nums; }
      .tv-bldgs-leads {
        margin-top: 0.3vw;
        padding-top: 0.4vw;
        border-top: 1px dashed #334155;
        display: flex;
        flex-direction: column;
        gap: 0.2vw;
      }
      .tv-bldgs-lead-row { display: flex; gap: 0.6vw; align-items: baseline; font-size: 0.7vw; }
      .tv-bldgs-lead-name { color: #d4a017; font-weight: 600; flex: 0 0 auto; min-width: 5.5vw; }
      .tv-bldgs-lead-codes { color: #94a3b8; font-variant-numeric: tabular-nums; flex: 1; }

      /* Upcoming PMs panel */
      .tv-upcoming-head { display: flex; align-items: baseline; gap: 0.6vw; margin-bottom: 0.4vw; }
      .tv-upcoming-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3vw; }
      .tv-upcoming-list li {
        display: grid;
        grid-template-columns: 6vw 1fr 2vw;
        gap: 0.5vw;
        align-items: center;
        font-size: 1.0vw;
      }
      .tv-upcoming-day { color: #94a3b8; }
      .tv-upcoming-bar-bg { background: #1e293b; height: 1.1vw; border-radius: 4px; overflow: hidden; }
      .tv-upcoming-bar-fill { background: linear-gradient(90deg, #10b981, #34d399); height: 100%; }
      .tv-upcoming-count { color: #e2e8f0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
    `}</style>
  );
}
