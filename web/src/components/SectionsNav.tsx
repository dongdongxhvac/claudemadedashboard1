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

/** "§11 Upcoming overtime" → "§11"; falls back to first word / initials. */
function shortLabel(title: string): string {
  const m = title.match(/§\s*\d+[a-z]?/i);
  if (m) return m[0].replace(/\s+/g, '');
  const word = title.trim().split(/\s+/)[0];
  return word.length <= 4 ? word : word.slice(0, 3);
}

type Registered = { id: string; title: string };

type Ctx = {
  register: (id: string, title: string) => void;
  unregister: (id: string) => void;
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
  expand: (id: string) => void;
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

  const value = useMemo<Ctx>(() => ({
    register, unregister, isCollapsed, toggle, expand, sections, activeId, setActiveId,
  }), [register, unregister, isCollapsed, toggle, expand, sections, activeId]);

  return <SectionsCtx.Provider value={value}>{children}</SectionsCtx.Provider>;
}

/** Floating right-side rail. Renders nothing until at least 2 sections are
 *  registered (no point on a one-card page). */
export function SectionsNav() {
  const ctx = useContext(SectionsCtx);
  // Sort registered sections by their actual document position so the rail
  // order always matches what the user sees, regardless of mount order.
  const ordered = useDomOrdered(ctx?.sections ?? []);

  // Scroll-spy: highlight whichever section's top is nearest the top of the
  // viewport. Re-evaluated on scroll + resize.
  useScrollSpy(ordered, (id) => ctx?.setActiveId(id));

  if (!ctx || ordered.length < 2) return null;

  const jump = (id: string) => {
    ctx.expand(id);
    // Defer the scroll one frame so an expanding section has laid out before
    // we measure its position.
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <nav
      aria-label="Section navigation"
      style={{
        position: 'fixed', right: 8, top: '50%', transform: 'translateY(-50%)',
        zIndex: 40, display: 'flex', flexDirection: 'column', gap: 3,
        maxHeight: '90vh', overflowY: 'auto', padding: '4px 2px',
      }}
      className="hidden lg:flex"
    >
      {ordered.map((s) => {
        const active = ctx.activeId === s.id;
        const collapsed = ctx.isCollapsed(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            title={s.title + (collapsed ? ' (collapsed)' : '')}
            className="group"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              gap: 6, border: 'none', background: 'transparent', cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            {/* Compact §-code label: always shown for the active section,
                revealed on hover for the rest. */}
            <span
              className={`t-small transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              style={{
                background: 'var(--color-card)',
                border: '1px solid var(--color-border-soft)',
                borderRadius: 4, padding: '1px 6px', fontSize: 10,
                whiteSpace: 'nowrap', color: 'var(--color-text)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                pointerEvents: 'none',
              }}
            >
              {shortLabel(s.title)}{collapsed ? ' ·' : ''}
            </span>
            <span
              style={{
                width: active ? 22 : 10, height: 6, borderRadius: 999,
                background: active ? 'var(--color-accent)' : 'var(--color-border)',
                opacity: collapsed && !active ? 0.4 : 1,
                transition: 'width 120ms, background 120ms',
              }}
            />
          </button>
        );
      })}
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
