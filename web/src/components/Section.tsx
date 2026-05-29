import { useEffect, useState, type ReactNode } from 'react';

// Backwards-compatible Section. When neither `collapsible` nor `id` is set
// (e.g. engineer / TV pages), renders exactly as before — no DOM attribute
// changes, no extra state, no behavior diff.
//
// When `collapsible` is passed, the Section owns its own collapse state via
// local useState + localStorage. There is intentionally NO React context,
// NO provider, NO registration into shared state. Cross-component signals
// (e.g. jump nav clicking → expand) flow through DOM CustomEvents so they
// never tangle with React lifecycle or route transitions. This is the
// isolation discipline saved in memory after the previous Admin-route
// regression (commit 13cda8f revert).

function slugifyTitle(title: string): string {
  return 'sec-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function Section({
  title,
  subtitle,
  loading,
  children,
  collapsible = false,
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
  collapsible?: boolean;
  id?: string;
}) {
  const resolvedId = id ?? (collapsible ? slugifyTitle(title) : undefined);
  const canCollapse = collapsible && !!resolvedId;
  const storageKey = canCollapse ? `cove.section.collapsed:${resolvedId}` : null;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!storageKey || typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });

  // Persist + broadcast on change so the JumpNav can re-render its rail.
  useEffect(() => {
    if (!storageKey) return;
    try { window.localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('cove:section-state', { detail: { id: resolvedId, collapsed } }));
  }, [storageKey, resolvedId, collapsed]);

  // Listen for DOM events dispatched at our element by the JumpNav so it can
  // expand/collapse this section without holding a React reference.
  useEffect(() => {
    if (!canCollapse || !resolvedId) return;
    const el = document.getElementById(resolvedId);
    if (!el) return;
    const onExpand   = () => setCollapsed(false);
    const onCollapse = () => setCollapsed(true);
    el.addEventListener('cove:expand', onExpand as EventListener);
    el.addEventListener('cove:collapse', onCollapse as EventListener);
    return () => {
      el.removeEventListener('cove:expand', onExpand as EventListener);
      el.removeEventListener('cove:collapse', onCollapse as EventListener);
    };
  }, [canCollapse, resolvedId]);

  return (
    <section
      className="t-card"
      id={resolvedId}
      data-section-id={resolvedId}
      style={resolvedId ? { scrollMarginTop: 16 } : undefined}
    >
      <div className="flex items-baseline justify-between mb-3 gap-3">
        {canCollapse ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="t-section-title text-left"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', background: 'none', border: 'none',
              padding: 0, color: 'inherit', font: 'inherit',
            }}
            title={collapsed ? 'Expand section' : 'Collapse section'}
            aria-expanded={!collapsed}
          >
            <span
              style={{
                fontSize: 11, color: 'var(--color-text-muted)',
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 120ms',
                display: 'inline-block', width: 10,
              }}
            >▾</span>
            {title}
          </button>
        ) : (
          <h2 className="t-section-title">{title}</h2>
        )}
        {subtitle && <span className="t-small t-muted">{subtitle}</span>}
      </div>
      {!collapsed && (loading ? <p className="t-text t-muted">Loading...</p> : children)}
    </section>
  );
}
