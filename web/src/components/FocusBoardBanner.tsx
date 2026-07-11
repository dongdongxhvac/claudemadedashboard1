import { useActiveFocusItems, useDismissFocusItem, type FocusLevel } from '../hooks/useFocusBoard';
import { useMySiteAccess } from '../hooks/useSiteScope';

const LEVEL_STYLE: Record<FocusLevel, { bg: string; border: string; fg: string; label: string }> = {
  info:     { bg: '#eff6ff', border: '#bfdbfe', fg: '#1e40af', label: 'INFO' },
  warn:     { bg: '#fffbeb', border: '#fde68a', fg: '#92400e', label: 'WARN' },
  urgent:   { bg: '#fef2f2', border: '#fecaca', fg: '#991b1b', label: 'URGENT' },
  critical: { bg: '#7f1d1d', border: '#7f1d1d', fg: '#ffffff', label: 'CRITICAL' },
};

export function FocusBoardBanner({ allowDismiss = true }: { allowDismiss?: boolean }) {
  const q = useActiveFocusItems();
  const dismiss = useDismissFocusItem();
  // Site fence (0097): show only announcements for the viewer's home site
  // (NULL site = all sites); admin/director see everything.
  const access = useMySiteAccess();
  const items = (q.data ?? []).filter((it) =>
    access.canSeeAllSites || it.site_id === null || it.site_id === access.homeSiteId);

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((it) => {
        const s = LEVEL_STYLE[it.level];
        return (
          <div
            key={it.id}
            className="flex items-start gap-3 px-3 py-2 rounded border"
            style={{ background: s.bg, borderColor: s.border, color: s.fg }}
          >
            <span
              className="t-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
              style={{ background: s.fg, color: s.bg }}
            >
              {it.pinned ? `📌 ${s.label}` : s.label}
            </span>
            <div className="flex-1 min-w-0">
              {it.title && <div className="font-medium">{it.title}</div>}
              <div className="t-text" style={{ color: s.fg }}>{it.body}</div>
            </div>
            {allowDismiss && (
              <button
                onClick={() => dismiss.mutate(it.id)}
                disabled={dismiss.isPending}
                className="t-small px-2 py-0.5 rounded border shrink-0 hover:opacity-100 opacity-70"
                style={{ borderColor: s.fg, color: s.fg, background: 'transparent' }}
                title="Dismiss (sets expires_at to now)"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
