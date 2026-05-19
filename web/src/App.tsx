import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Login from './routes/Login';
import Manager from './routes/manager/Manager';
import Admin from './routes/admin/Admin';
import EngineerProfile from './routes/engineer/Profile';
import EngineerMe from './routes/engineer/Me';
import EngineerShiftTv from './routes/engineer/ShiftTv';
import TvView from './routes/tv/TvView';
import { useMe } from './hooks/useMe';

function Protected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Role-aware home redirect: engineers go to /engineer/me, tv to /tv, others to /manager. */
function Home() {
  const me = useMe();
  if (me.isLoading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (me.data?.role === 'engineer') return <Navigate to="/engineer/me" replace />;
  if (me.data?.role === 'tv')       return <Navigate to="/tv" replace />;
  return <Navigate to="/manager" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"   element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/manager" element={<Protected><Manager /></Protected>} />
        <Route path="/admin"   element={<Protected><Admin /></Protected>} />
        <Route path="/engineer/me" element={<Protected><EngineerMe /></Protected>} />
        <Route path="/engineer/shift" element={<Protected><EngineerShiftTv /></Protected>} />
        <Route path="/engineer/:id/profile" element={<Protected><EngineerProfile /></Protected>} />
        <Route path="/tv" element={<Protected><TvView /></Protected>} />
        <Route path="/"        element={<Protected><Home /></Protected>} />
        <Route path="*"        element={<Protected><Home /></Protected>} />
      </Routes>
    </BrowserRouter>
  );
}
