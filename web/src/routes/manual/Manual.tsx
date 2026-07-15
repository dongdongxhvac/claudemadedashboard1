// Operations manual — /upark/manual and /binney/manual.
//
// Deliberately self-contained: its own layout, its own nav, no shared Section
// component and no context provider. It reads nothing from the database except
// useMySiteAccess (for the cross-site link), so it cannot break a dashboard
// panel. The words live in manualContent.ts — edit that, not this.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMySiteAccess } from '../../hooks/useSiteScope';
import { buildManual, LAST_UPDATED, SITE_LABEL, type Block, type ManualSite } from './manualContent';

const NOTE_TONE: Record<'info' | 'warn' | 'danger', { border: string; bg: string; text: string }> = {
  info: { border: 'var(--color-accent)', bg: 'var(--color-accent-soft)', text: 'var(--color-accent)' },
  warn: { border: 'var(--color-warn)', bg: '#fffbeb', text: 'var(--color-warn)' },
  danger: { border: 'var(--color-danger)', bg: '#fef2f2', text: 'var(--color-danger)' },
};

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'p':
      return <p className="t-text" style={{ lineHeight: 1.65, maxWidth: '78ch', margin: '0 0 0.5rem' }}>{block.text}</p>;

    case 'bullets':
      return (
        <ul className="t-text" style={{ lineHeight: 1.6, maxWidth: '78ch', margin: '0 0 0.5rem', paddingLeft: '1.1rem', listStyle: 'disc' }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ marginBottom: '0.3rem' }}>{it}</li>
          ))}
        </ul>
      );

    case 'steps':
      return (
        <ol className="t-text" style={{ lineHeight: 1.6, maxWidth: '78ch', margin: '0 0 0.5rem', paddingLeft: '1.4rem', listStyle: 'decimal' }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ marginBottom: '0.35rem' }}>{it}</li>
          ))}
        </ol>
      );

    case 'table':
      return (
        <div style={{ overflowX: 'auto', margin: '0 0 0.75rem' }}>
          <table className="t-text" style={{ borderCollapse: 'collapse', width: '100%', maxWidth: '78ch' }}>
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th
                    key={i}
                    className="t-small t-muted"
                    style={{
                      textAlign: 'left',
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '0.3rem 0.6rem 0.3rem 0',
                      borderBottom: '1px solid var(--color-border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        padding: '0.35rem 0.6rem 0.35rem 0',
                        borderBottom: '1px solid var(--color-border-soft)',
                        verticalAlign: 'top',
                        lineHeight: 1.5,
                        color: ci === 0 ? 'var(--color-text)' : undefined,
                        fontWeight: ci === 0 ? 500 : undefined,
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'note': {
      const tone = NOTE_TONE[block.tone];
      return (
        <div
          style={{
            borderLeft: `2px solid ${tone.border}`,
            background: tone.bg,
            padding: '0.5rem 0.7rem',
            margin: '0 0 0.75rem',
            maxWidth: '78ch',
            borderRadius: '0 var(--radius-card) var(--radius-card) 0',
          }}
        >
          <div className="t-small" style={{ color: tone.text, fontWeight: 600, marginBottom: '0.2rem' }}>
            {block.title}
          </div>
          <div className="t-text" style={{ lineHeight: 1.6 }}>{block.text}</div>
        </div>
      );
    }
  }
}

export default function Manual({ site }: { site: ManualSite }) {
  const access = useMySiteAccess();
  const chapters = useMemo(() => buildManual(site), [site]);
  const topicIds = useMemo(() => chapters.flatMap((c) => c.topics.map((t) => t.id)), [chapters]);
  const initial = window.location.hash.slice(1);
  const [active, setActive] = useState<string>(
    initial && topicIds.includes(initial) ? initial : (topicIds[0] ?? ''),
  );

  // Track the topic you are currently reading: the last one whose top has
  // passed under the header. Deliberately position-based rather than an
  // IntersectionObserver — these topics are far taller than any sensible
  // observation band, so intersection RATIO stays near zero for all of them and
  // the highlight never moves.
  //
  // This is an ENHANCEMENT ONLY, and must stay that way: clicking a contents
  // link sets the highlight directly (see onClick below), so the nav is still
  // correct for the interaction people actually use even where scroll events
  // never arrive. Local to this page: no shared state, nothing to unregister on
  // a route change.
  useEffect(() => {
    let raf = 0;
    const pick = () => {
      raf = 0;
      const line = 100; // px below the viewport top — just under the sticky header
      let current = topicIds[0] ?? '';
      for (const id of topicIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top > line) break;
        current = id;
      }
      // At the very bottom the last topic may never cross the line — pin it.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = topicIds[topicIds.length - 1] ?? current;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    // A deep link (/binney/manual#pto-cap) may land with the hash applied only
    // AFTER mount, so honour it whenever it changes rather than only on first
    // render. This also keeps the nav honest on browser back/forward.
    const onHash = () => {
      const id = window.location.hash.slice(1);
      if (id && topicIds.includes(id)) setActive(id);
    };
    // Don't run the initial pick when we arrived on a deep link: the browser's
    // jump to the anchor may not have settled yet, and a premature measurement
    // would overwrite the very topic the link asked for.
    if (window.location.hash) {
      onHash();
      // App-wide <ScrollToTop> fires window.scrollTo(0,0) on mount, which races
      // with — and often beats — the browser's own jump to the anchor, leaving a
      // deep link sitting at the top of the page. Re-assert the target here
      // rather than special-casing the hash inside that shared component.
      // scrollIntoView honours each topic's scroll-margin-top, so it clears the
      // sticky header the same way a plain anchor click does.
      requestAnimationFrame(() => {
        document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
      });
    } else pick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('hashchange', onHash);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [topicIds]);

  const otherSite: ManualSite = site === 'binney' ? 'upark' : 'binney';

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="t-section-title">{SITE_LABEL[site]} · Operations Manual</h1>
              {access.canSeeAllSites && (
                <Link to={`/${otherSite}/manual`} className="t-small t-accent hover:underline">
                  → {SITE_LABEL[otherSite]}
                </Link>
              )}
            </div>
            <p className="t-small t-muted">Updated {LAST_UPDATED} · how each function works, the rules, and who does what</p>
          </div>
          <Link to={`/${site}/manager`} className="t-small t-accent hover:underline whitespace-nowrap">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-8 items-start">
          {/* Contents */}
          <nav
            className="hidden lg:block"
            style={{ position: 'sticky', top: '4.5rem', width: '15rem', flex: '0 0 15rem', maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto' }}
          >
            <div className="t-small t-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
              Contents
            </div>
            {chapters.map((c) => (
              <div key={c.id} style={{ marginBottom: '0.75rem' }}>
                <div className="t-text" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{c.title}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, borderLeft: '1px solid var(--color-border)' }}>
                  {c.topics.map((t) => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        onClick={() => setActive(t.id)}
                        className="t-small"
                        style={{
                          display: 'block',
                          padding: '0.2rem 0 0.2rem 0.6rem',
                          marginLeft: '-1px',
                          borderLeft: `2px solid ${active === t.id ? 'var(--color-accent)' : 'transparent'}`,
                          color: active === t.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
                          fontWeight: active === t.id ? 600 : 400,
                          textDecoration: 'none',
                          lineHeight: 1.4,
                        }}
                      >
                        {t.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="t-small t-muted" style={{ marginTop: '1rem', lineHeight: 1.5 }}>
              More sections (overtime, on-call, rounds) get written as we build them out.
            </p>
          </nav>

          {/* Body */}
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            {chapters.map((c) => (
              <section key={c.id} style={{ marginBottom: '1.5rem' }}>
                <div className="t-card" style={{ marginBottom: '0.75rem' }}>
                  <h2 className="t-section-title" style={{ fontSize: '1.05rem' }}>{c.title}</h2>
                  <p className="t-small t-muted" style={{ marginTop: '0.15rem' }}>{c.summary}</p>
                </div>

                {c.topics.map((t) => (
                  <article
                    key={t.id}
                    id={t.id}
                    className="t-card"
                    style={{ marginBottom: '0.6rem', scrollMarginTop: '5rem', padding: '0.9rem 1rem' }}
                  >
                    <h3
                      className="t-section-title"
                      style={{ marginBottom: '0.6rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--color-border-soft)' }}
                    >
                      {t.title}
                    </h3>
                    {t.blocks.map((b, i) => (
                      <BlockView key={i} block={b} />
                    ))}
                  </article>
                ))}
              </section>
            ))}

            <p className="t-small t-muted" style={{ marginTop: '1rem', maxWidth: '78ch', lineHeight: 1.5 }}>
              Something here wrong or out of date? It is hand-written in
              {' '}<span className="t-mono">web/src/routes/manual/manualContent.ts</span>{' '}
              and is meant to be updated in the same commit as the behavior it describes.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
