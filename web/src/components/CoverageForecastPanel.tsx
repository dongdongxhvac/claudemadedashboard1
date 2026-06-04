// Coverage forecast — quick-glance 3-day attendance + OT slots card for
// the manager view. Mirrors the shape of the TV's CoverageTvPanel so the
// manager can answer "what's the next 3 days look like?" without
// scrolling to the deep PtoPanel + OvertimePanel.
//
// Calendar days (today + tmrw + day-after), NO weekend skip — Saturday
// shows up if it's in the 3-day window, because PTO can land on weekends
// for hourly engineers.
import { useMemo } from 'react';
import {
  usePtoRequests,
  isPartialDay,
  partialDayLabel,
  PTO_TYPE_LABELS,
  type PtoRequest,
  type PtoType,
} from '../hooks/usePto';
import { useOvertimePosts, OVERTIME_CATEGORY_LABELS } from '../hooks/useOvertime';
import { useEngineers } from '../hooks/useEngineers';
import { Section } from './Section';
import { PTO_TYPE_COLOR } from './PtoPanel';

function shortName(full: string | null | undefined): string {
  if (!full) return '—';
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return full;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function localIso(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

type DayCol = {
  iso: string;
  label: string;          // "today", "tmrw", "Sat"
  monthDay: string;       // "6/4"
  isWeekend: boolean;
  outRows: PtoRequest[];
  fullDayCount: number;
  partialCount: number;
  inCount: number;
};

export function CoverageForecastPanel() {
  const ptoQ = usePtoRequests();
  const otQ = useOvertimePosts();
  const engineersQ = useEngineers();

  const totalEngineers = useMemo(
    () => (engineersQ.data ?? []).filter((e) => e.active && e.role === 'engineer').length,
    [engineersQ.data],
  );

  // Today + next 2 WORK days (Mon–Fri only). UPark regular hours are
  // Mon–Fri so weekends are skipped — Saturday won't appear unless
  // today happens to be Saturday (today is always included).
  const days: DayCol[] = useMemo(() => {
    const ptoRows = ptoQ.data ?? [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out: DayCol[] = [];
    const pushDay = (d: Date, label: string) => {
      const iso = localIso(d);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const outRows = ptoRows.filter(
        (r) => r.status === 'approved' && r.starts_on <= iso && r.ends_on >= iso,
      );
      const partialCount = outRows.filter(isPartialDay).length;
      const fullDayCount = outRows.length - partialCount;
      out.push({
        iso, label,
        monthDay: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        isWeekend, outRows, fullDayCount, partialCount,
        inCount: Math.max(0, totalEngineers - fullDayCount),
      });
    };
    pushDay(today, 'today');
    const cursor = new Date(today);
    while (out.length < 3) {
      cursor.setDate(cursor.getDate() + 1);
      const dow = cursor.getDay();
      if (dow === 0 || dow === 6) continue;
      const daysAhead = Math.round(
        (cursor.getTime() - today.getTime()) / 86_400_000,
      );
      pushDay(
        cursor,
        daysAhead === 1
          ? 'tmrw'
          : cursor.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase(),
      );
    }
    return out;
  }, [ptoQ.data, totalEngineers]);

  // Open OT slots in the same 3-day window (or all open posts whose
  // start falls before the window's end).
  const otSummary = useMemo(() => {
    const posts = (otQ.data ?? []).filter((p) => p.status === 'open');
    const windowEnd = days[days.length - 1]?.iso ?? localIso(new Date());
    const inWindow = posts.filter((p) => {
      const startIso = p.starts_at.slice(0, 10);
      return startIso <= windowEnd;
    });
    const totalSlots = inWindow.reduce(
      (s, p) => s + Math.max(0, p.slots_needed - p.slots_filled),
      0,
    );
    const byCategory = new Map<string, number>();
    for (const p of inWindow) {
      const remaining = Math.max(0, p.slots_needed - p.slots_filled);
      byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + remaining);
    }
    return { totalSlots, byCategory, postCount: inWindow.length };
  }, [otQ.data, days]);

  const subtitle = (
    <span className="t-small t-muted text-right block">
      next 3 calendar days · live PTO + open OT
    </span>
  );

  return (
    <Section
      collapsible
      title="Coverage forecast · next 3 days"
      subtitle={subtitle}
      loading={ptoQ.isLoading || engineersQ.isLoading || otQ.isLoading}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
        }}
      >
        {days.map((d) => (
          <DayCard key={d.iso} d={d} totalEngineers={totalEngineers} />
        ))}
      </div>

      {/* OT slots roll — single line summary across the 3-day horizon. */}
      <div
        style={{
          marginTop: 12,
          padding: '8px 10px',
          borderRadius: 4,
          border: '1px solid var(--color-border)',
          background: 'var(--color-card)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="t-small uppercase tracking-wider t-muted"
          style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
        >
          §11 OT
        </span>
        {otSummary.totalSlots === 0 ? (
          <span className="t-small t-muted">no open slots in next 3 days</span>
        ) : (
          <>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-warn, #d97706)' }}>
              {otSummary.totalSlots}
            </span>
            <span className="t-small t-muted">
              open slot{otSummary.totalSlots === 1 ? '' : 's'} across {otSummary.postCount} post
              {otSummary.postCount === 1 ? '' : 's'}
            </span>
            <span className="t-small" style={{ color: 'var(--color-border)' }}>·</span>
            {Array.from(otSummary.byCategory.entries()).map(([cat, n], i) => (
              <span key={cat} className="t-small">
                {i > 0 && (
                  <span className="t-muted" style={{ margin: '0 4px' }}>·</span>
                )}
                <span className="t-muted">
                  {OVERTIME_CATEGORY_LABELS[cat as keyof typeof OVERTIME_CATEGORY_LABELS] ?? cat}
                </span>{' '}
                <span style={{ fontWeight: 700 }}>{n}</span>
              </span>
            ))}
          </>
        )}
      </div>
    </Section>
  );
}

function DayCard({ d, totalEngineers }: { d: DayCol; totalEngineers: number }) {
  const accent =
    d.fullDayCount === 0
      ? 'var(--color-ok, #10b981)'
      : 'var(--color-warn, #d97706)';
  return (
    <div
      className="t-card"
      style={{
        padding: '10px 12px',
        borderLeft: `4px solid ${accent}`,
        display: 'grid',
        gap: 6,
        opacity: d.isWeekend ? 0.85 : 1,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span
            className="t-small uppercase tracking-wider"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: d.isWeekend ? 'var(--color-text-muted)' : 'var(--color-accent)',
              letterSpacing: '0.08em',
            }}
          >
            {d.label}
          </span>
          <span className="t-small t-muted" style={{ fontSize: '0.75rem' }}>
            {d.monthDay}
          </span>
        </div>
        <div className="t-small" style={{ fontSize: '0.75rem' }}>
          <span style={{ fontWeight: 700 }}>{d.inCount}</span>
          <span className="t-muted">/{totalEngineers} in</span>
          {d.fullDayCount > 0 && (
            <>
              <span className="t-muted"> · </span>
              <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>
                {d.fullDayCount}
              </span>
              <span className="t-muted"> out</span>
            </>
          )}
          {d.partialCount > 0 && (
            <>
              <span className="t-muted"> · </span>
              <span style={{ color: 'var(--color-warn, #d97706)', fontWeight: 700 }}>
                {d.partialCount}
              </span>
              <span className="t-muted"> partial</span>
            </>
          )}
        </div>
      </div>
      {d.outRows.length > 0 ? (
        <div className="flex gap-1 flex-wrap">
          {d.outRows.map((r) => (
            <OutChip key={r.id} pto={r} />
          ))}
        </div>
      ) : (
        <span
          className="t-small t-muted"
          style={{ fontSize: '0.72rem' }}
        >
          fully staffed
        </span>
      )}
    </div>
  );
}

function OutChip({ pto }: { pto: PtoRequest }) {
  const partial = isPartialDay(pto);
  const partialText = partialDayLabel(pto);
  const color = PTO_TYPE_COLOR[pto.type as PtoType] ?? '#64748b';
  const typeLabel = pto.type === 'vacation' ? 'vac' :
                    pto.type === 'sick' ? 'sick' :
                    PTO_TYPE_LABELS[pto.type as PtoType] ?? pto.type;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 3,
        background: 'var(--color-card)',
        border: `1px solid ${color}55`,
        fontSize: '0.75rem',
      }}
    >
      <span style={{ fontWeight: 500 }}>{shortName(pto.user_full_name)}</span>
      <span
        className="t-mono uppercase"
        style={{
          padding: '0 4px',
          borderRadius: 2,
          background: color,
          color: 'white',
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
        }}
      >
        {typeLabel}
        {partial && partialText ? ` ${partialText}` : ''}
      </span>
    </span>
  );
}
