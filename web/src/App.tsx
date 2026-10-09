import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { authLink } from './lib/supabase';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from './routes/Login';
import SetPassword from './routes/SetPassword';
import Manager from './routes/manager/Manager';
import Admin from './routes/admin/Admin';
import EngineerProfile from './routes/engineer/Profile';
import EngineerMe from './routes/engineer/Me';
import EngineerBuildings from './routes/engineer/Buildings';
import EngineerShiftTv from './routes/engineer/ShiftTv';
import TvView, { Tv2View } from './routes/tv/TvView';
import BuildingsIndex from './routes/buildings/Index';
import BuildingDetail from './routes/buildings/Detail';
import Training from './routes/training/Training';
import NewHireTraining from './routes/engineer/NewHireTraining';
import EngineerTracker from './routes/engineer/Tracker';
import TrainingOnline from './routes/engineer/TrainingOnline';
import Manual from './routes/manual/Manual';
import BinneyManager from './routes/binney/Manager';
import BinneyAdmin from './routes/binney/Admin';
import BinneyEscortExp from './routes/binney/EscortExp';
import MroReceipts from './routes/mro/Receipts';
import FieldReceipt from './routes/field/Receipt';
import { useMe, type Me } from './hooks/useMe';
import { useMySiteAccess, type SiteCode } from './hooks/useSiteScope';
import { resolveTvLayout, useTvLayoutLive, useMinuteTick, TV_LAYOUT_PATHS } from './hooks/useTvLayout';

/** Reset scroll to the top on every route change. Without this, navigating
 *  from a long page (e.g. the manager dashboard) to another route leaves the
 *  window scrolled mid-page, so the new page looks blank until you refresh. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/** Invite / password-reset action links land on the app root with a hash the
 *  supabase client consumes (creating a session) and strips. supabase.ts
 *  captured the hash's type/error before that; this one-shot redirect steers
 *  those arrivals onto /set-password — including expired-link errors, which
 *  arrive session-less and render the explanation there. */
function AuthLinkRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!authLink.consumed && (authLink.type || authLink.errorCode)) {
      authLink.consumed = true; // one-shot; also guards StrictMode double-run
      navigate('/set-password', { replace: true });
    }
  }, [navigate]);
  return null;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** The shop's wall screens each sign in with a tv-role account, and the
 *  ACCOUNT decides which layout it shows: users.preferences.tv_layout is
 *  'tv' (operations), 'tv2' (coverage) or 'rotate' (alternate on 5-minute
 *  slots — see resolveTvLayout); an account without one gets the
 *  operations board. The Admin page's Shop TV card sets it (0138). */
function tvLayoutPath(me: Me | null | undefined, now: Date = new Date()): string {
  return TV_LAYOUT_PATHS[resolveTvLayout(me?.preferences?.tv_layout, now)];
}

/** Wraps each wall-layout route. A tv-role account is always sent to its own
 *  layout, whichever TV address the browser opened — so signing a screen in
 *  as "Shop TV 2" is all it takes to make it the coverage board. Everyone
 *  else (an admin previewing a layout) gets the address they asked for.
 *  If the profile can't be read, the address wins: a kiosk must not sit on
 *  a spinner or the wrong board because one lookup failed, which is why the
 *  kiosk still boots into its own layout's URL. */
function TvLayoutGate({ path, children }: { path: string; children: React.ReactNode }) {
  const me = useMe();
  // Follow the kiosk's own users row (a layout flip from the admin page) and
  // the clock (rotate slots) while the wall is up.
  useTvLayoutLive(me.data?.role === 'tv' ? me.data.id : null);
  const now = useMinuteTick();
  if (me.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (me.data?.role === 'tv') {
    const own = tvLayoutPath(me.data, now);
    if (own !== path) return <Navigate to={own} replace />;
  }
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Role-aware home redirect — always to a site-prefixed address:
 *  engineers → /<site>/engineer, tv → the wall layout its account is set to
 *  (see tvLayoutPath), others → /<site>/manager. */
function Home() {
  const me = useMe();
  const access = useMySiteAccess();
  if (me.isLoading || access.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (me.data?.role === 'engineer') return <Navigate to={`/${access.homeSite}/engineer`} replace />;
  if (me.data?.role === 'tv')       return <Navigate to={tvLayoutPath(me.data)} replace />;
  return <Navigate to={`/${access.homeSite}/manager`} replace />;
}

/** Legacy bare URLs (/manager, /admin, /engineer/me) → the viewer's
 *  home-site address, so an old bookmark can't land anyone on the wrong
 *  site — the address bar always shows /upark/... or /binney/... */
function SiteRedirect({ page }: { page: 'manager' | 'admin' | 'engineer' | 'manual' }) {
  const access = useMySiteAccess();
  if (access.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  return <Navigate to={`/${access.homeSite}/${page}`} replace />;
}

/** Fence a site's manager/admin pages: admin + director can enter every
 *  site; managers/engineers/leads only their home site — anyone else is
 *  bounced to their own site's dashboard (engineers then bounce onward to
 *  /engineer/me via RequireManagerArea). Navigation-level gating — RLS
 *  stays role-based. */
function RequireSite({ site, children }: { site: SiteCode; children: React.ReactNode }) {
  const access = useMySiteAccess();
  if (access.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (access.canSeeAllSites || access.homeSite === site) return <>{children}</>;
  return <Navigate to={`/${access.homeSite}/manager`} replace />;
}

/** Admin + director only — for cross-site tools (/training) that would
 *  otherwise expose one site's content to the other's staff. */
function RequireCrossSite({ children }: { children: React.ReactNode }) {
  const access = useMySiteAccess();
  if (access.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (access.canSeeAllSites) return <>{children}</>;
  return <Navigate to={`/${access.homeSite}/manager`} replace />;
}

/** Gate the manager dashboard to non-engineers. Engineers/TV that reach
 *  /manager (bookmark, stale tab, manual URL) bounce to their own home, so the
 *  "engineer → /engineer/me, admin → /manager" rule holds however they arrive. */
function RequireManagerArea({ children }: { children: React.ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (me.data?.role === 'engineer') return <Navigate to="/engineer/me" replace />;
  if (me.data?.role === 'tv')       return <Navigate to={tvLayoutPath(me.data)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthLinkRedirect />
      <ErrorBoundary>
      <Routes>
        <Route path="/login"   element={<PublicOnly><Login /></PublicOnly>} />
        {/* Public, login-free field capture — gated by the URL token, not auth. */}
        <Route path="/field/receipt" element={<FieldReceipt />} />
        {/* Invite / reset landing — bare on purpose: expired links arrive
            session-less (must render), fresh links arrive WITH a session
            (must not bounce to the dashboard before the password is set). */}
        <Route path="/set-password" element={<SetPassword />} />
        {/* Canonical UPark addresses — every site page carries its site
            prefix so a shared/bookmarked URL always says which site it is. */}
        <Route path="/upark/manager" element={<Protected><RequireSite site="upark"><RequireManagerArea><Manager /></RequireManagerArea></RequireSite></Protected>} />
        <Route path="/upark/admin"   element={<Protected><RequireSite site="upark"><Admin /></RequireSite></Protected>} />
        <Route path="/upark/engineer" element={<Protected><RequireSite site="upark"><EngineerMe /></RequireSite></Protected>} />
        {/* Operations manual — site-scoped because the rules genuinely differ
            (day length, sick hours, crews, invite recipients). Site-fenced like
            every other site page, but NOT manager-gated: it is documentation,
            so an engineer who follows a link is shown it rather than bounced. */}
        <Route path="/upark/manual" element={<Protected><RequireSite site="upark"><Manual site="upark" /></RequireSite></Protected>} />
        {/* New-hire training — handouts + quizzes for every UPark person
            (course material, so not manager-gated; site-fenced like the
            manual). The static handouts live under /training/… */}
        <Route path="/upark/training/new-hire" element={<Protected><RequireSite site="upark"><NewHireTraining /></RequireSite></Protected>} />
        <Route path="/binney/manual" element={<Protected><RequireSite site="binney"><Manual site="binney" /></RequireSite></Protected>} />
        <Route path="/manual" element={<Protected><SiteRedirect page="manual" /></Protected>} />
        {/* Legacy bare addresses → the viewer's own home-site page. */}
        <Route path="/manager" element={<Protected><SiteRedirect page="manager" /></Protected>} />
        <Route path="/admin"   element={<Protected><SiteRedirect page="admin" /></Protected>} />
        <Route path="/engineer/me" element={<Protected><SiteRedirect page="engineer" /></Protected>} />
        {/* UPark-flavored surfaces: shift TV, shop TV, MRO. Site-fenced so
            Binney staff don't land in UPark data (admin/director pass). */}
        <Route path="/engineer/shift" element={<Protected><RequireSite site="upark"><EngineerShiftTv /></RequireSite></Protected>} />
        <Route path="/engineer/:id/profile" element={<Protected><EngineerProfile /></Protected>} />
        {/* Engineer's own building set-up sheets + system sign-offs (2026-09-23). */}
        <Route path="/engineer/buildings" element={<Protected><EngineerBuildings /></Protected>} />
        {/* Tracker (2026-10-09): the engineer's own log / scorecard / skills.
            Header link is test-account-only for now (lib/tracker.ts). */}
        <Route path="/engineer/tracker" element={<Protected><EngineerTracker /></Protected>} />
        {/* Training, online version: 5 category overviews + 4 equipment
            handouts, every engineer, both sites (course material, no gate). */}
        <Route path="/engineer/training" element={<Protected><TrainingOnline /></Protected>} />
        <Route path="/upark/tv" element={<Protected><RequireSite site="upark"><TvLayoutGate path="/upark/tv"><TvView /></TvLayoutGate></RequireSite></Protected>} />
        <Route path="/tv" element={<Navigate to="/upark/tv" replace />} />
        {/* Second wall screen — PTO, equipment/LOTO, on-call, OT posts. */}
        <Route path="/upark/tv2" element={<Protected><RequireSite site="upark"><TvLayoutGate path="/upark/tv2"><Tv2View /></TvLayoutGate></RequireSite></Protected>} />
        {/* Buildings KB is UPark-only content (Index filters via
            useUparkBuildingIds), so fence it like the other UPark surfaces —
            otherwise Binney staff land in UPark's building list. */}
        <Route path="/buildings" element={<Protected><RequireSite site="upark"><BuildingsIndex /></RequireSite></Protected>} />
        <Route path="/upark/buildings" element={<Navigate to="/buildings" replace />} />
        <Route path="/buildings/:short_code" element={<Protected><RequireSite site="upark"><BuildingDetail /></RequireSite></Protected>} />
        {/* Training is the training-manager's cross-site tool — admin/director only. */}
        <Route path="/training" element={<Protected><RequireCrossSite><Training /></RequireCrossSite></Protected>} />
        {/* Binney St — isolated route tree (first pass: PTO only). */}
        <Route path="/binney/manager" element={<Protected><RequireSite site="binney"><RequireManagerArea><BinneyManager /></RequireManagerArea></RequireSite></Protected>} />
        <Route path="/binney/admin"   element={<Protected><RequireSite site="binney"><BinneyAdmin /></RequireSite></Protected>} />
        {/* Experimental escort schedule — deliberately unlinked from nav. */}
        <Route path="/binney/exp"     element={<Protected><RequireSite site="binney"><BinneyEscortExp /></RequireSite></Protected>} />
        <Route path="/binney/engineer" element={<Protected><RequireSite site="binney"><EngineerMe /></RequireSite></Protected>} />
        <Route path="/mro/receipts" element={<Protected><RequireSite site="upark"><MroReceipts /></RequireSite></Protected>} />
        <Route path="/upark/mro/receipts" element={<Navigate to="/mro/receipts" replace />} />
        <Route path="/"        element={<Protected><Home /></Protected>} />
        <Route path="*"        element={<Protected><Home /></Protected>} />
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
