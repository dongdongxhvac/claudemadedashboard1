// Floating jump-nav for the manager dashboard. DOM-scan based — never reads
// or writes React context, never touches the shared Section component's
// internal state directly. Communicates with Sections via CustomEvents on
// each section's DOM element. This keeps it cleanly decoupled from React
// lifecycle, so manager → /admin route changes don't tangle anything.
//
// Discovery: querySelectorAll('section[data-section-id]') on mount + on
// 'cove:section-state' window events (dispatched by Section when its
// collapse flag flips).

import { useCallback, useEffect, useState } from 'react';

type Entry = { id: string; title: string; collapsed: boolean };

function readCollapsed(id: string): boolean {
  try { return localStorage.getItem(`cove.section.collapsed:${id}`) === '1'; } catch { return false; }
}

function scanSections(): Entry[] {
  if (typeof document === 'undefined') return [];
  const els = document.querySelectorAll<HTMLElement>('section[data-section-id]');
  const out: Entry[] = [];
  els.forEach((el) => {
    const id = el.getAttribute('data-section-id') ?? '';
    if (!id) return;
    const titleEl = el.querySelector('.t-section-title');
    const title = titleEl?.textContent?.trim() ?? id;
    out.push({ id, title, collapsed: readCollapsed(id) });
  });
  return out;
}

function dispatchToSection(id: string, eventName: 'cove:expand' | 'cove:collapse') {
  document.getElementById(id)?.dispatchEvent(new CustomEvent(eventName));
}

/** "§11 Upcoming overtime" → "§11"; falls back to first 4 chars. */
function shortLabel(title: string): string {
  const m = title.match(/§\s*\d+[a-z]?/i);
  if (m) return m[0].replace(/\s+/g, '');
  return title.trim().slice(0, 4);
}

export function JumpNav() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Re-scan on mount + whenever a Section signals a collapse change.
  const refresh = useCallback(() => setEntries(scanSections()), []);
  useEffect(() => {
    // Defer first scan to next frame so Sections have mounted.
    const raf = requestAnimationFrame(refresh);
    const onState = () => refresh();
    window.addEventListener('cove:section-state', onState as EventListener);
    // Catch late mounts (e.g. lazy-loaded panels) via MutationObserver on body.
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('cove:section-state', onState as EventListener);
      observer.disconnect();
    };
  }, [refresh]);

  // Scroll-spy: highlight whichever section's top is nearest the threshold.
  useEffect(() => {
    if (entries.length === 0) return;
    const onScroll = () => {
      let bestId: string | null = null;
      let bestTop = -Infinity;
      const threshold = 130;
      for (const e of entries) {
        const el = document.getElementById(e.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - threshold <= 0 && top > bestTop) {
          bestTop = top;
          bestId = e.id;
        }
      }
      if (!bestId && entries[0]) bestId = entries[0].id;
      setActiveId(bestId);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [entries]);

  if (entries.length < 2) return null;

  const allCollapsed = entries.every((e) => e.collapsed);

  const jump = (id: string) => {
    dispatchToSection(id, 'cove:expand');
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const toggleAll = () => {
    const ev = allCollapsed ? 'cove:expand' : 'cove:collapse';
    for (const e of entries) dispatchToSection(e.id, ev);
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
      className="hidden md:block"
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
        {/* Header: title + collapse/expand-all toggle */}
        <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: open ? 6 : 0 }}>
          {open && (
            <span className="t-small t-muted uppercase tracking-wider" style={{ fontSize: 9 }}>
              Jump to
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleAll(); }}
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
          {entries.map((s) => {
            const active = activeId === s.id;
            if (!open) {
              // Compact dot rail
              return (
                <li key={s.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => jump(s.id)}
                    title={`${s.title}${s.collapsed ? ' (collapsed)' : ''}`}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 2px' }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: active ? 20 : 10, height: 5, borderRadius: 999,
                        background: active ? 'var(--color-accent)' : 'var(--color-border)',
                        opacity: s.collapsed && !active ? 0.4 : 1,
                        transition: 'width 120ms, background 120ms',
                      }}
                    />
                  </button>
                </li>
              );
            }
            // Expanded labeled rows: chevron toggles in place, label jumps.
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
                  onClick={() => dispatchToSection(s.id, s.collapsed ? 'cove:expand' : 'cove:collapse')}
                  title={s.collapsed ? 'Expand this section' : 'Collapse this section'}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: 10, width: 12, lineHeight: 1, flexShrink: 0,
                  }}
                >
                  <span style={{ display: 'inline-block', transform: s.collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}>▾</span>
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
                    opacity: s.collapsed ? 0.55 : 1,
                  }}
                >
                  <span aria-hidden style={{ marginRight: 4, color: 'var(--color-text-muted)', fontSize: 9 }}>
                    {shortLabel(s.title)}
                  </span>
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
