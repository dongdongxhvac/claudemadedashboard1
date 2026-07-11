// Manager TV mode — always-on ops display, viewed from across the room.
// V5 tv=2 layout: slim header, 2-col grid (left = §02 + §00 stacked,
// right = §03 spanning both rows). §01 hidden.
//
// data-mode="tv" on <html> bumps font/spacing tokens up for legibility at
// distance; the active style (V5 / Linear) still applies on top.
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useCurrentPmRows } from '../../hooks/useCurrentSnapshots';
import { useSnapshotRealtime } from '../../hooks/useRealtime';
import { WeeklyCompletions } from '../../components/WeeklyCompletions';
import type { Period } from '../../lib/dashboard';
import { DueNowList } from '../../components/DueNowList';
import { DueThisMonth } from '../../components/DueThisMonth';
import { FocusBoardBanner } from '../../components/FocusBoardBanner';
import { useFocusBoardRealtime } from '../../hooks/useFocusBoard';

export default function ManagerTv() {
  const { session } = useAuth();
  useSnapshotRealtime();
  useFocusBoardRealtime();

  // Toggle TV size tokens on while this layout is mounted.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-mode', 'tv');
    return () => html.removeAttribute('data-mode');
  }, []);

  const pmQ = useCurrentPmRows();
  const snapshotTaken = pmQ.data?.[0]?.snapshot_taken_at;

  // TV mode doesn't share the §00 toggle with anything else, but
  // WeeklyCompletions still needs a controlled period prop.
  const [period, setPeriod] = useState<Period>('7d');
  const snapshotLocal = snapshotTaken
    ? new Date(snapshotTaken).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;
  const today = new Date().toLocaleDateString('en-CA');

  return (
    <div className="min-h-screen t-bg flex flex-col">
      {/* Slim header — no email, no style switcher, no chrome to distract. */}
      <header
        className="border-b px-6 py-2 flex items-baseline justify-between"
        style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}
      >
        <h1 className="t-section-title">UPark · PM Dashboard</h1>
        <div className="t-small t-muted flex items-center gap-4">
          <span>{today}</span>
          {snapshotLocal && <span>· snapshot {snapshotLocal}</span>}
          {!session && <span className="t-danger">· signed out</span>}
        </div>
      </header>

      {/* Focus board banner spans the full width below the slim header. */}
      <div className="px-4 pt-4">
        <FocusBoardBanner allowDismiss={false} />
      </div>

      {/* 60/40 grid — left col stacks §02 on top of §00, right col is §03. */}
      <main
        className="flex-1 grid gap-4 p-4"
        style={{ gridTemplateColumns: '60fr 40fr', gridTemplateRows: 'auto 1fr' }}
      >
        <div className="space-y-4 col-start-1 row-start-1 row-end-3 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-auto">
            <DueNowList />
          </div>
          <div className="overflow-auto">
            <WeeklyCompletions period={period} onPeriodChange={setPeriod} />
          </div>
        </div>
        <div className="col-start-2 row-start-1 row-end-3 overflow-auto">
          <DueThisMonth />
        </div>
      </main>
    </div>
  );
}
