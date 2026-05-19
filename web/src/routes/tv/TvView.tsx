// /tv — Shop-floor TV view. Static 3x2 grid, large fonts, no nav chrome.
// Six panels visible at once for the morning huddle / glanceable read.
//
// Layout:
//   ┌── header ──────────────────────────────────────────────────┐
//   │ COVE · MEP Operations · date · time · snapshot freshness   │
//   ├──────────────────────────┬─────────────────────────────────┤
//   │ ON-CALL                  │ FOCUS BOARD                     │
//   ├──────────────────────────┼─────────────────────────────────┤
//   │ CREW · LAST 7 DAYS       │ TODAY'S PMs                     │
//   ├──────────────────────────┼─────────────────────────────────┤
//   │ OPEN NPMs                │ ROUNDS · CURRENT SHIFT          │
//   └──────────────────────────┴─────────────────────────────────┘
import { useEffect, useMemo, useState } from 'react';
import { useCurrentOncall, useOncallRealtime } from '../../hooks/useOncall';
import { useActiveFocusItems, useFocusBoardRealtime } from '../../hooks/useFocusBoard';
import { useCurrentPmRows, useCurrentLaborRows } from '../../hooks/useCurrentSnapshots';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { useRounds, useRoundsRealtime } from '../../hooks/useRounds';
import { useShifts, useShiftsRealtime } from '../../hooks/useShifts';
import { isClosed, isCompletedStatus, isNpm, addDays, localISODate } from '../../lib/dashboard';

export default function TvView() {
  // Live data
  useSnapshotRealtime();
  useOncallRealtime();
  useFocusBoardRealtime();
  useRoundsRealtime();
  useShiftsRealtime();

  const oncallQ = useCurrentOncall();
  const focusQ  = useActiveFocusItems();
  const pmQ     = useCurrentPmRows();
  const laborQ  = useCurrentLaborRows();
  const roundsQ = useRounds();
  const shiftsQ = useShifts();

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
        <OncallPanel oncall={oncallQ.data} />
        <FocusBoardPanel items={focusQ.data ?? []} />
        <CrewPanel pmRows={pmQ.data ?? []} laborRows={laborQ.data ?? []} now={now} />
        <TodayPanel pmRows={pmQ.data ?? []} now={now} />
        <OpenNpmsPanel pmRows={pmQ.data ?? []} now={now} />
        <RoundsPanel rounds={roundsQ.data ?? []} shifts={shiftsQ.data ?? []} now={now} />
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

function OncallPanel({ oncall }: { oncall: ReturnType<typeof useCurrentOncall>['data'] }) {
  return (
    <Panel title="On-call · this week" accent="#dc2626">
      {!oncall || !oncall.primary ? (
        <p className="tv-muted">Not assigned.</p>
      ) : (
        <>
          <div className="tv-bigname">{oncall.primary}</div>
          {oncall.secondary && (
            <div className="tv-sub">backup · {oncall.secondary}</div>
          )}
        </>
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
              <span className="tv-crew-name">{c.name}</span>
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
                <span className="tv-today-name">{c.name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function OpenNpmsPanel({ pmRows, now }: {
  pmRows: NonNullable<ReturnType<typeof useCurrentPmRows>['data']>;
  now: Date;
}) {
  const data = useMemo(() => {
    const todayStr = localISODate(now);
    let count = 0;
    let hours = 0;
    let oldestDays = 0;
    let oldestAssignee = '';
    const byTech = new Map<string, { count: number; hours: number }>();
    for (const r of pmRows) {
      if (isClosed(r.status)) continue;
      if (!isNpm(r)) continue;
      count++;
      hours += r.labor_hours ?? 0;
      const a = (r.assigned_to_name ?? '').trim() || 'Unassigned';
      const cur = byTech.get(a) ?? { count: 0, hours: 0 };
      cur.count++;
      cur.hours += r.labor_hours ?? 0;
      byTech.set(a, cur);

      if (r.due_date && r.due_date < todayStr) {
        const ageDays = Math.floor(
          (new Date(todayStr + 'T00:00:00').getTime() - new Date(r.due_date + 'T00:00:00').getTime()) / 86_400_000,
        );
        if (ageDays > oldestDays) {
          oldestDays = ageDays;
          oldestAssignee = a;
        }
      }
    }
    const top = Array.from(byTech.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([name, v]) => ({ name, count: v.count, hours: v.hours }));
    return { count, hours, oldestDays, oldestAssignee, top };
  }, [pmRows, now]);

  return (
    <Panel title="Open NPMs" accent="#64748b">
      <div className="tv-npm-head">
        <span className="tv-bignum">{data.count}</span>
        <span className="tv-sub">total · {data.hours.toFixed(1)} h</span>
      </div>
      {data.oldestDays > 0 && (
        <div className="tv-sub" style={{ marginBottom: '0.4em' }}>
          oldest <strong>{data.oldestDays}d</strong>{data.oldestAssignee && ` · ${data.oldestAssignee}`}
        </div>
      )}
      {data.top.length > 0 && (
        <ul className="tv-npm-list">
          {data.top.map((t) => (
            <li key={t.name}>
              <span className="tv-npm-name">{t.name}</span>
              <span className="tv-npm-stat">{t.count} · {t.hours.toFixed(1)}h</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RoundsPanel({ rounds, shifts, now }: {
  rounds: NonNullable<ReturnType<typeof useRounds>['data']>;
  shifts: NonNullable<ReturnType<typeof useShifts>['data']>;
  now: Date;
}) {
  // Identify the active shift (currently in progress) so we can mark it.
  const activeShiftId = useMemo(() => {
    if (shifts.length === 0) return null;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const inProgress = shifts.find((s) => toMin(s.start_time) <= nowMin && toMin(s.end_time) > nowMin);
    return inProgress?.id ?? null;
  }, [shifts, now]);

  const groups = useMemo(() => {
    return shifts
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({
        shift: s,
        rounds: rounds
          .filter((r) => r.shift_id === s.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      .filter((g) => g.rounds.length > 0);
  }, [rounds, shifts]);

  return (
    <Panel title="Rounds · all shifts" accent="#10b981">
      {groups.length === 0 ? (
        <p className="tv-muted">No rounds defined.</p>
      ) : (
        <div className="tv-rounds-groups">
          {groups.map((g) => (
            <div key={g.shift.id} className="tv-rounds-group">
              <div className="tv-rounds-shift">
                {g.shift.name} shift
                {g.shift.id === activeShiftId && <span className="tv-rounds-active"> · NOW</span>}
              </div>
              <ul className="tv-rounds-list">
                {g.rounds.map((r) => (
                  <li key={r.id}>
                    <span className="tv-round-eng">{r.current?.full_name ?? '— unassigned —'}</span>
                    <span className="tv-round-stops">
                      {r.stops.map((s) => s.short_code ?? s.code).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
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
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr 1fr;
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

      .tv-focus-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.6vw; }
      .tv-focus-list li { font-size: 1.25vw; line-height: 1.35; display: flex; align-items: baseline; gap: 0.5vw; }
      .tv-focus-dot { width: 0.7vw; height: 0.7vw; border-radius: 50%; flex: 0 0 auto; display: inline-block; }

      .tv-crew-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5vw; }
      .tv-crew-list li { display: grid; grid-template-columns: 1fr 12vw 6vw 6vw; align-items: center; gap: 0.6vw; font-size: 1.2vw; }
      .tv-bar-bg { background: #1e293b; height: 1.6vw; border-radius: 4px; overflow: hidden; }
      .tv-bar-fill { background: linear-gradient(90deg, #8b5cf6, #a78bfa); height: 100%; }
      .tv-crew-name { font-weight: 500; }
      .tv-crew-stat { color: #94a3b8; text-align: right; font-variant-numeric: tabular-nums; }

      .tv-today-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4vw 1vw; }
      .tv-today-list li { display: flex; align-items: baseline; gap: 0.6vw; font-size: 1.4vw; }
      .tv-today-count { font-weight: 700; color: #f59e0b; font-size: 1.8vw; min-width: 2.2vw; text-align: right; font-variant-numeric: tabular-nums; }
      .tv-today-name { color: #e2e8f0; }

      .tv-npm-head { display: flex; align-items: baseline; gap: 0.6vw; margin-bottom: 0.4em; }
      .tv-npm-list { list-style: none; padding: 0; margin: 0.6vw 0 0; display: flex; flex-direction: column; gap: 0.3vw; }
      .tv-npm-list li { display: flex; justify-content: space-between; font-size: 1.15vw; }
      .tv-npm-name { color: #e2e8f0; }
      .tv-npm-stat { color: #94a3b8; font-variant-numeric: tabular-nums; }

      .tv-rounds-groups { display: flex; flex-direction: column; gap: 0.6vw; }
      .tv-rounds-group { }
      .tv-rounds-shift {
        font-size: 0.95vw;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #64748b;
        margin-bottom: 0.3vw;
      }
      .tv-rounds-active {
        color: #10b981;
        font-weight: 700;
        letter-spacing: 0.18em;
        margin-left: 0.4em;
      }
      .tv-rounds-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3vw; }
      .tv-rounds-list li { display: grid; grid-template-columns: 9vw 1fr; gap: 0.6vw; font-size: 1.05vw; align-items: baseline; }
      .tv-round-eng   { font-weight: 600; color: #10b981; }
      .tv-round-stops { color: #e2e8f0; font-variant-numeric: tabular-nums; }
    `}</style>
  );
}
