// /engineer/training — the online training handouts (user 2026-10-09): the
// five category overviews (HVAC · Electrical · BMS · Plumbing · Life safety)
// and the four equipment handouts (AHU · chiller plant · boiler plant ·
// cooling tower). Linked from every engineer's header, both sites. The
// documents are the static pages under web/public/training/new-hire/…,
// shown in an iframe with Print / Open in new tab — no print station, no
// sign-off sheet: this is the read-anywhere version.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useIsMobile } from '../../hooks/useIsMobile';
import { TRAINING_CATEGORIES, TRAINING_EQUIPMENT, type TrainingDoc } from '../../lib/tracker';

export default function TrainingOnline() {
  const { signOut } = useAuth();
  const isMobile = useIsMobile();
  const [doc, setDoc] = useState<TrainingDoc | null>(null);

  return (
    <div className="min-h-screen t-bg flex flex-col">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="t-section-title" style={{ marginBottom: 0 }}>Training</h1>
            <p className="t-small t-muted">5 categories · 4 equipment · online version</p>
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap t-small">
            {doc && (
              <>
                <a href={doc.path} target="_blank" rel="noreferrer" className="t-accent hover:underline">Open in new tab</a>
                <button onClick={() => setDoc(null)} className="t-accent hover:underline">All handouts</button>
              </>
            )}
            <Link to="/engineer/me" className="t-accent hover:underline">← My day</Link>
            {!isMobile && <button onClick={signOut} className="t-accent hover:underline">Sign out</button>}
          </div>
        </div>
      </header>

      {doc ? (
        <main className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
          <div className="max-w-6xl mx-auto w-full px-4 pt-2 t-small t-muted">{doc.title}</div>
          <iframe
            key={doc.key}
            title={doc.title}
            src={doc.path}
            className="flex-1 w-full"
            style={{ border: 0, minHeight: 'calc(100vh - 110px)', background: '#fff' }}
          />
        </main>
      ) : (
        <main className="max-w-6xl mx-auto w-full px-4 py-5 space-y-6">
          <Group title="5 categories" blurb="How each system works in a life-science building — read these first." docs={TRAINING_CATEGORIES} onOpen={setDoc} />
          <Group title="4 equipment" blurb="One handout per plant: overview, how it runs, and the field exercise." docs={TRAINING_EQUIPMENT} onOpen={setDoc} />
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
