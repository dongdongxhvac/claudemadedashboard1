// MRO Receipts — standalone, phone-first page for field capture. Bookmark
// /mro/receipts on a phone home screen: snap a receipt, tag it, it OCRs and
// joins the pool. Same data as the admin tab's pool, just a focused
// full-screen surface. Admin/manager only (RLS gates the data too).
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useMe } from '../../hooks/useMe';
import { MroReceiptPool } from '../admin/MroReceiptPool';

export default function MroReceipts() {
  const { signOut } = useAuth();
  const me = useMe();
  const canBill = me.data?.role === 'admin' || me.data?.role === 'manager' || me.data?.is_manager === true;

  return (
    <div className="min-h-screen t-bg">
      <header className="border-b sticky top-0 z-10" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)' }}>
        <div className="mx-auto px-4 py-2.5 flex items-center justify-between" style={{ maxWidth: 720 }}>
          <h1 className="t-section-title" style={{ fontSize: '1.05rem' }}>📷 MRO Receipts</h1>
          <div className="flex items-center gap-3">
            <Link to="/admin" className="t-small t-accent hover:underline">Billing →</Link>
            <button onClick={signOut} className="t-small t-muted hover:underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto px-3 py-3" style={{ maxWidth: 720 }}>
        {me.isLoading ? (
          <p className="t-text t-muted">Loading…</p>
        ) : !canBill ? (
          <p className="t-text t-danger">MRO receipts are admin/manager only.</p>
        ) : (
          <>
            <p className="t-small t-muted mb-2">
              Snap or upload a receipt, tag it (building · category · item), and it joins the pool — OCR runs automatically.
            </p>
            <MroReceiptPool />
          </>
        )}
      </main>
    </div>
  );
}
