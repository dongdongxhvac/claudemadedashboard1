// /engineer/training — Training, online (user 2026-10-09). One tab,
// Fundamentals: the five system overviews (HVAC · Electrical · BMS ·
// Plumbing · Life safety) and the four plant overviews (AHU · chiller ·
// boiler · tower). Linked from every engineer's header (both sites) and from
// both manager headers next to Admin.
//
// The documents come from the PRINT STATION (hooks/useTrainingDocs.ts) —
// the one file that holds every handout — so an updated print station is
// what engineers see here, nothing else to edit (user 2026-10-09: the page
// must match the print station). The standalone files under
// web/public/training/new-hire/… are no longer read by this page.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTrainingDocs, type NhDoc } from '../../hooks/useTrainingDocs';

/** Print-station document keys (hooks/useTrainingDocs.ts alias rules), in display order. */
const CATEGORY_KEYS = ['hvac', 'electrical', 'bms', 'plumbing', 'life_safety'];
const EQUIPMENT_KEYS = ['ahu', 'chiller', 'boiler', 'tower'];
const SHORT: Record<string, string> = {
  hvac: 'HVAC', electrical: 'Electrical', bms: 'BMS', plumbing: 'Plumbing', life_safety: 'Life safety',
  ahu: 'Air handling unit', chiller: 'Chiller plant', boiler: 'Boiler plant', tower: 'Cooling tower',
};

type Tab = 'fundamentals';
const TABS: { key: Tab; label: string }[] = [
  { key: 'fundamentals', label: 'Fundamentals' },
];

export default function TrainingOnline() {
  const { signOut } = useAuth();
  const me = useMe();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('fundamentals');
  const [doc, setDoc] = useState<NhDoc | null>(null);
  const td = useTrainingDocs();
  const pickDocs = (keys: string[]) => keys.map((k) => td.byKey.get(k)).filter((d): d is NhDoc => !!d);
  const categories = pickDocs(CATEGORY_KEYS);
  const equipment = pickDocs(EQUIPMENT_KEYS);

  // Managers / admins arrive from the dashboard header; engineers from My day.
  const backTo = me.data && me.data.role !== 'engineer' ? '/manager' : '/engineer/me';
  const backLabel = me.data && me.data.role !== 'engineer' ? '← Dashboard' : '← My day';

  const open = (d: NhDoc) => setDoc(d);
  const pick = (t: Tab) => { setTab(t); setDoc(null); };
  const shownDoc = doc;

  return (
    <div className="min-h-screen t-bg flex flex-col">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-6xl mx-auto px-4 pt-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="t-section-title" style={{ marginBottom: 0 }}>Training</h1>
            <p className="t-small t-muted">Fundamentals · 5 categories · 4 equipment</p>
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap t-small">
            {shownDoc && (
              <>
                <a href={td.href(shownDoc)} target="_blank" rel="noreferrer" className="t-accent hover:underline">Open in new tab</a>
                <button onClick={() => setDoc(null)} className="t-accent hover:underline">All handouts</button>
              </>
            )}
            <Link to={backTo} className="t-accent hover:underline">{backLabel}</Link>
            {!isMobile && <button onClick={signOut} className="t-accent hover:underline">Sign out</button>}
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex items-center gap-1 mt-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => pick(t.key)}
              className="px-3 py-2 t-small"
              style={{
                borderBottom: tab === t.key ? '2px solid var(--color-accent)' : '2px solid transparent',
                color: tab === t.key ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontWeight: tab === t.key ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {shownDoc ? (
        <main className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
          <div className="max-w-6xl mx-auto w-full px-4 pt-2 t-small t-muted">{shownDoc.label}</div>
          <iframe
            key={shownDoc.key}
            title={shownDoc.label}
            srcDoc={shownDoc.html}
            className="flex-1 w-full"
            style={{ border: 0, minHeight: 'calc(100vh - 150px)', background: '#fff' }}
          />
        </main>
      ) : (
        <main className="max-w-6xl mx-auto w-full px-4 py-5 space-y-6">
          {td.isLoading && <p className="t-small t-muted">Loading the handouts…</p>}
          {td.error && (
            <p className="t-small t-danger">
              Couldn't load the print station: {(td.error as Error).message}
            </p>
          )}
          {tab === 'fundamentals' && !td.isLoading && !td.error && (
            <>
              <Group title="5 categories" blurb="How each system works in a life-science building — read these first." docs={categories} onOpen={open} />
              <Group title="4 equipment" blurb="One handout per plant: overview, how it runs, and the field exercise." docs={equipment} onOpen={open} />
              {categories.length + equipment.length < CATEGORY_KEYS.length + EQUIPMENT_KEYS.length && (
                <p className="t-small t-muted italic">
                  Some handouts are missing from the print station ({[...CATEGORY_KEYS, ...EQUIPMENT_KEYS].filter((k) => !td.byKey.has(k)).map((k) => SHORT[k]).join(', ')}).
                </p>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}

function Group({ title, blurb, docs, onOpen }: { title: string; blurb: string; docs: NhDoc[]; onOpen: (d: NhDoc) => void }) {
  return (
    <section>
      <h2 className="t-section-title" style={{ marginBottom: 2 }}>{title}</h2>
      <p className="t-small t-muted mb-2">{blurb}</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        {docs.map((d) => (
          <button
            key={d.key}
            onClick={() => onOpen(d)}
            className="t-card text-left hover:underline"
            style={{ padding: '0.8rem 0.9rem', borderLeft: '3px solid var(--color-accent)' }}
          >
            <div className="t-text font-medium">{SHORT[d.key] ?? d.label}</div>
            <div className="t-small t-muted">{d.label} →</div>
          </button>
        ))}
      </div>
    </section>
  );
}
