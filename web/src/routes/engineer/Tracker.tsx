// /engineer/tracker — the engineer's own tracker (user 2026-10-09). While in
// testing the header link shows only for TRACKER_TEST_EMAILS (lib/tracker.ts);
// the page itself is reachable by any signed-in engineer for their own rows
// (RLS keeps everyone to their own user_id unless they can view careers).
// The engineer can add / edit their own unverified log entries and type SOP
// write-ups; spirit marks, scores and verification are the lead's.
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { TrackerPanel } from '../../components/tracker/TrackerPanel';

export default function EngineerTracker() {
  const { signOut } = useAuth();
  const me = useMe();
  const isMobile = useIsMobile();

  if (me.isLoading) return <div className="min-h-screen t-bg p-6"><p className="t-text t-muted">Loading...</p></div>;
  if (!me.data) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="t-section-title" style={{ marginBottom: 0 }}>My tracker</h1>
            <p className="t-small t-muted">{me.data.full_name} · what you did, how it was done, what you can do</p>
          </div>
          <div className="flex items-center gap-3 whitespace-nowrap t-small">
            <Link to="/engineer/me" className="t-accent hover:underline">← My day</Link>
            {!isMobile && <button onClick={signOut} className="t-accent hover:underline">Sign out</button>}
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-4">
        <TrackerPanel userId={me.data.id} canEdit={false} isSelf />
      </main>
    </div>
  );
}
