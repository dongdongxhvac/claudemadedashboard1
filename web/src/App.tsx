import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Login from './routes/Login';
import Manager from './routes/manager/Manager';
import Admin from './routes/admin/Admin';

function Protected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (session) return <Navigate to="/manager" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"   element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/manager" element={<Protected><Manager /></Protected>} />
        <Route path="/admin"   element={<Protected><Admin /></Protected>} />
        <Route path="/"        element={<Navigate to="/manager" replace />} />
        <Route path="*"        element={<Navigate to="/manager" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
