import { useEffect, type ReactNode } from 'react';
import { useSectionsRegistry, sectionSlug } from './SectionsNav';

export function Section({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}) {
  const reg = useSectionsRegistry();
  const id = sectionSlug(title);

  // Register with the page's section registry (if any) so the floating nav
  // knows about this card. No-ops on pages without a <SectionsProvider>.
  useEffect(() => {
    if (!reg) return;
    reg.register(id, title);
    return () => reg.unregister(id);
  }, [reg, id, title]);

  const collapsible = !!reg;
  const collapsed = reg?.isCollapsed(id) ?? false;

  return (
    <section id={id} className="t-card" style={{ scrollMarginTop: 16 }}>
      <div className="flex items-baseline justify-between mb-3 gap-3">
        {collapsible ? (
          <button
            type="button"
            onClick={() => reg!.toggle(id)}
            className="t-section-title text-left"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit' }}
            title={collapsed ? 'Expand section' : 'Collapse section'}
          >
            <span
              style={{
                fontSize: 11, color: 'var(--color-text-muted)',
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 120ms', display: 'inline-block', width: 10,
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
