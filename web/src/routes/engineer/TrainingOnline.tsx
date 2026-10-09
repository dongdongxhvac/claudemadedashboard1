// /engineer/training — Training, online (user 2026-10-09). One tab,
// Fundamentals: the five system overviews (HVAC · Electrical · BMS ·
// Plumbing · Life safety) and the four plant handouts (AHU · chiller ·
// boiler · tower) — the new-hire material, read anywhere. No print station
// here. Linked from every engineer's header (both sites) and from both
// manager headers next to Admin. The documents are static pages under
// web/public/training/new-hire/…, shown in an iframe with Open-in-new-tab.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { TRAINING_CATEGORIES, TRAINING_EQUIPMENT, type TrainingDoc } from '../../lib/tracker';

type Tab = 'fundamentals';
const TABS: { key: Tab; label: string }[] = [
  { key: 'fundamentals', label: 'Fundamentals' },
];

export default function TrainingOnline() {
  const { signOut } = useAuth();
  const me = useMe();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('fundamentals');
  const [doc, setDoc] = useState<TrainingDoc | null>(null);

  // Managers / admins arrive from the dashboard header; engineers from My day.
  const backTo = me.data && me.data.role !== 'engineer' ? '/manager' : '/engineer/me';
  const backLabel = me.data && me.data.role !== 'engineer' ? '← Dashboard' : '← My day';

  const open = (d: TrainingDoc) => setDoc(d);
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
                <a href={shownDoc.path} target="_blank" rel="noreferrer" className="t-accent hover:underline">Open in new tab</a>
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
          <div className="max-w-6xl mx-auto w-full px-4 pt-2 t-small t-muted">{shownDoc.title}</div>
          <iframe
            key={shownDoc.key}
            title={shownDoc.title}
            src={shownDoc.path}
            className="flex-1 w-full"
            style={{ border: 0, minHeight: 'calc(100vh - 150px)', background: '#fff' }}
          />
        </main>
      ) : (
        <main className="max-w-6xl mx-auto w-full px-4 py-5 space-y-6">
          {tab === 'fundamentals' && (
            <>
              <Group title="5 categories" blurb="How each system works in a life-science building — read these first." docs={TRAINING_CATEGORIES} onOpen={open} />
              <Group title="4 equipment" blurb="One handout per plant: overview, how it runs, and the field exercise." docs={TRAINING_EQUIPMENT} onOpen={open} />
            </>
          )}
        </main>
      )}
    </div>
  );
}

function Group({ title, blurb, docs, onOpen }: { title: string; blurb: string; docs: TrainingDoc[]; onOpen: (d: TrainingDoc) => void }) {
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
            <div className="t-text font-medium">{d.title}</div>
            <div className="t-small t-muted">Open handout →</div>
          </button>
        ))}
      </div>
    </section>
  );
}
