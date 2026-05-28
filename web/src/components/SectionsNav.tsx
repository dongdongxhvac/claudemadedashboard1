// Collapsible-section registry + floating jump nav.
//
// <SectionsProvider> wraps a page that renders many <Section> cards. Each
// Section registers itself (id + title) on mount and reads/writes its own
// collapsed flag here. <SectionsNav> renders a fixed vertical rail that lists
// every registered section, highlights the one currently in view
// (scroll-spy via IntersectionObserver), and on click expands + smooth-
// scrolls to it.
//
// Collapse state persists in localStorage so a manager's preferred
// open/closed layout survives reloads.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

const LS_KEY = 'cove.sections.collapsed';

export function sectionSlug(title: string): string {
  return 'sec-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

type Registered = { id: string; title: string };

type Ctx = {
  register: (id: string, title: string) => void;
  unregister: (id: string) => void;
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  sections: Registered[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
};

const SectionsCtx = createContext<Ctx | null>(null);

export function useSectionsRegistry(): Ctx | null {
  return useContext(SectionsCtx);
}

export function SectionsProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<Registered[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);

  const register = useCallback((id: string, title: string) => {
    setSections((prev) => (prev.some((s) => s.id === id) ? prev : [...prev, { id, title }]));
  }, []);
  const unregister = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const isCollapsed = useCallback((id: string) => collapsed[id] === true, [collapsed]);
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const expand = useCallback((id: string) => {
    setCollapsed((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
  }, []);
  const collapseAll = useCallback(() => {
    setCollapsed(Object.fromEntries(sections.map((s) => [s.id, true])));
  }, [sections]);
  const expandAll = useCallback(() => setCollapsed({}), []);

  const value = useMemo<Ctx>(() => ({
    register, unregister, isCollapsed, toggle, expand, collapseAll, expandAll, sections, activeId, setActiveId,
  }), [register, unregister, isCollapsed, toggle, expand, collapseAll, expandAll, sections, activeId]);

  return <SectionsCtx.Provider value={value}>{children}</SectionsCtx.Provider>;
}

/** Floating right-side table-of-contents. Collapsed to a slim rail of dots by
 *  default; expands to a labeled list on hover or when pinned open. Renders
 *  nothing until at least 2 sections are registered. */
export function SectionsNav() {
  const ctx = useContext(SectionsCtx);
  const ordered = useDomOrdered(ctx?.sections ?? []);
  const [open, setOpen] = useState(false);   // hover/click-expanded labeled mode

  useScrollSpy(ordered, (id) => ctx?.setActiveId(id));

  if (!ctx || ordered.length < 2) return null;

  const allCollapsed = ordered.every((s) => ctx.isCollapsed(s.id));

  const jump = (id: string) => {
    ctx.expand(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <nav
      aria-label="Section navigation"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'fixed', right: 8, top: '50%', transform: 'translateY(-50%)',
        zIndex: 40, maxHeight: '92vh',
      }}
      className="hidden lg:block"
    >
      <div
        className="t-card"
        style={{
          padding: open ? '8px' : '6px 4px',
          width: open ? 210 : 'auto',
          maxHeight: '92vh', overflowY: 'auto',
          boxShadow: open ? '0 6px 20px rgba(0,0,0,0.18)' : '0 1px 4px rgba(0,0,0,0.08)',
          transition: 'width 140ms, padding 140ms',
          opacity: open ? 1 : 0.85,
        }}
      >
        {/* Header: title + collapse/expand-all toggle (labels only when open) */}
        <div
          className="flex items-center justify-between"
          style={{ gap: 8, marginBottom: open ? 6 : 0 }}
        >
          {open && (
            <span className="t-small t-muted uppercase tracking-wider" style={{ fontSize: 9 }}>
              Jump to
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); allCollapsed ? ctx.expandAll() : ctx.collapseAll(); }}
            title={allCollapsed ? 'Expand all sections' : 'Collapse all sections'}
            className="t-small t-accent hover:underline"
            style={{
              fontSize: open ? 10 : 12, lineHeight: 1, whiteSpace: 'nowrap',
              marginLeft: 'auto', padding: open ? '1px 4px' : '2px',
            }}
          >
            {open ? (allCollapsed ? 'Expand all' : 'Collapse all') : (allCollapsed ? '⊞' : '⊟')}
          </button>
        </div>

        {/* Section rows */}
        <ul style={{ display: 'flex', flexDirection: 'column', gap: open ? 1 : 4 }}>
          {ordered.map((s) => {
            const active = ctx.activeId === s.id;
            const collapsed = ctx.isCollapsed(s.id);
            if (!open) {
              // Compact dot-only mode.
              return (
                <li key={s.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => jump(s.id)}
                    title={`${s.title}${collapsed ? ' (collapsed)' : ''}`}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 2px' }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: active ? 20 : 10, height: 5, borderRadius: 999,
                        background: active ? 'var(--color-accent)' : 'var(--color-border)',
                        opacity: collapsed && !active ? 0.4 : 1,
                        transition: 'width 120ms, background 120ms',
                      }}
                    />
                  </button>
                </li>
              );
            }
            // Expanded labeled mode: chevron toggles in place, label jumps.
            return (
              <li
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  borderRadius: 4, padding: '2px 4px',
                  background: active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
                }}
              >
                <button
                  type="button"
                  onClick={() => ctx.toggle(s.id)}
                  title={collapsed ? 'Expand this section' : 'Collapse this section'}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: 10, width: 12, lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  <span style={{ display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}>▾</span>
                </button>
                <button
                  type="button"
                  onClick={() => jump(s.id)}
                  title={s.title}
                  style={{
                    flex: 1, minWidth: 0, textAlign: 'left',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: active ? 'var(--color-accent)' : 'var(--color-text)',
                    fontWeight: active ? 600 : 400,
                    fontSize: 11, lineHeight: 1.3,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    opacity: collapsed ? 0.55 : 1,
                  }}
                >
                  {s.title}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** Returns the registered sections sorted by current DOM vertical position. */
function useDomOrdered(sections: Registered[]): Registered[] {
  return useMemo(() => {
    if (typeof document === 'undefined') return sections;
    return [...sections].sort((a, b) => {
      const ea = document.getElementById(a.id);
      const eb = document.getElementById(b.id);
      if (!ea || !eb) return 0;
      return ea.getBoundingClientRect().top - eb.getBoundingClientRect().top;
    });
    // Re-sort whenever the membership changes.
  }, [sections]);
}

/** Highlights the section whose top edge most recently crossed ~120px from the
 *  top of the viewport. */
function useScrollSpy(sections: Registered[], onActive: (id: string) => void) {
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  useEffect(() => {
    if (sections.length === 0) return;
    const compute = () => {
      let bestId: string | null = null;
      let bestTop = -Infinity;
      const threshold = 130;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        // The active section is the last one whose top is at or above the
        // threshold line (i.e. we've scrolled into it).
        if (top - threshold <= 0 && top > bestTop) {
          bestTop = top;
          bestId = s.id;
        }
      }
      // Before the first section passes the line, default to the first.
      if (!bestId && sections[0]) bestId = sections[0].id;
      if (bestId) onActiveRef.current(bestId);
    };
    compute();
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, [sections]);
}
