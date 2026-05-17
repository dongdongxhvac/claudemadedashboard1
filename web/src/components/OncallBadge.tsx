// Small "ON CALL" pill that goes in every header. Pulls from current_oncall
// (the rotation whose Fri→Fri window contains today). Renders nothing if no
// schedule for this week, so the header stays clean when the schedule has gaps.
import { useCurrentOncall, useOncallRealtime, fmtMd, plus7Days } from '../hooks/useOncall';

export function OncallBadge({ size = 'sm' }: { size?: 'sm' | 'tv' }) {
  useOncallRealtime();
  const q = useCurrentOncall();
  if (q.isLoading || !q.data) return null;
  const { rotation, primary, secondary } = q.data;

  const range =
    rotation.week_start
      ? `${fmtMd(rotation.week_start)} – ${fmtMd(plus7Days(rotation.week_start))}`
      : null;

  const isTv = size === 'tv';
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border ${isTv ? 'px-3 py-1' : 'px-2 py-0.5'}`}
      style={{
        background: 'var(--color-ok)',
        borderColor: 'var(--color-ok)',
        color: '#fff',
      }}
      title={`On-call rotation${range ? ' ' + range : ''}${secondary ? ` · secondary: ${secondary}` : ''}`}
    >
      <span className={`uppercase tracking-wider ${isTv ? 'text-xs' : 'text-[10px]'} font-medium`}>
        On call
      </span>
      <span className={isTv ? 'text-sm' : 't-small'} style={{ fontWeight: 600 }}>
        {primary ?? '—'}
      </span>
    </span>
  );
}
