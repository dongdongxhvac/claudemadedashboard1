// Admin "view as user" impersonation — provider, control panel, banner, and
// phone-frame shell. See lib/impersonationContext.ts for the shared context.
//
// Only a real admin (useRealMe) can drive this. Picking a user re-renders the
// whole app as them (identity hooks read the context) and navigates to their
// default view. A device toggle previews phone vs PC; the phone option frames
// the app in a ~390px mock. Writes are blocked unless the admin flips
// "Act as them".
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ImpersonationCtx, useImpersonation,
  type ForceDevice, type ImpersonationValue,
} from '../lib/impersonationContext';
import { useRealMe } from '../hooks/useMe';
import { useAllUsers } from '../hooks/useEngineers';

const SS_KEY = 'cove.impersonation';

type Persisted = { userId: string | null; forceDevice: ForceDevice; actAsMe: boolean };

function loadPersisted(): Persisted {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { userId: null, forceDevice: null, actAsMe: false };
}

function defaultRouteFor(role: string | undefined): string {
  if (role === 'engineer') return '/engineer/me';
  if (role === 'tv') return '/tv';
  return '/manager';
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const init = loadPersisted();
  const [impersonatedUserId, setUserId] = useState<string | null>(init.userId);
  const [forceDevice, setForceDevice] = useState<ForceDevice>(init.forceDevice);
  const [actAsMe, setActAsMe] = useState<boolean>(init.actAsMe);

  useEffect(() => {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify({ userId: impersonatedUserId, forceDevice, actAsMe }));
    } catch { /* ignore */ }
  }, [impersonatedUserId, forceDevice, actAsMe]);

  const value = useMemo<ImpersonationValue>(() => {
    const isImpersonating = !!impersonatedUserId;
    return {
      impersonatedUserId,
      forceDevice,
      actAsMe,
      isImpersonating,
      canAct: !isImpersonating || actAsMe,
      start: (id) => { setUserId(id); setActAsMe(false); },
      stop: () => { setUserId(null); setForceDevice(null); setActAsMe(false); },
      setForceDevice,
      setActAsMe,
    };
  }, [impersonatedUserId, forceDevice, actAsMe]);

  return <ImpersonationCtx.Provider value={value}>{children}</ImpersonationCtx.Provider>;
}

/** Wraps the routed content. When the phone device is forced, renders the app
 *  inside a centered ~390px phone mock so the mobile layout shows true-to-size
 *  on a desktop. */
export function ImpersonationFrame({ children }: { children: ReactNode }) {
  const { forceDevice, isImpersonating } = useImpersonation();
  if (forceDevice !== 'mobile') return <>{children}</>;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: isImpersonating ? '12px' : 0, background: 'var(--color-bg, #f1f5f9)' }}>
      <div
        style={{
          width: 390, maxWidth: '100%',
          height: 'calc(100vh - 90px)',
          overflow: 'auto',
          border: '10px solid #111827',
          borderRadius: 28,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          background: 'var(--color-bg, #fff)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Admin-only control: a sticky banner while impersonating + a floating
 *  launcher that opens the user picker. Renders nothing for non-admins. */
export function ImpersonationBar() {
  const real = useRealMe();
  const imp = useImpersonation();
  const usersQ = useAllUsers();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (real.data?.role !== 'admin') return null;

  const users = (usersQ.data ?? []).filter((u) => u.active);
  const current = users.find((u) => u.user_id === imp.impersonatedUserId) ?? null;

  const pick = (userId: string, role: string) => {
    imp.start(userId);
    setPickerOpen(false);
    navigate(defaultRouteFor(role));
  };

  return (
    <>
      {/* Active banner */}
      {imp.isImpersonating && (
        <div
          style={{
            position: 'sticky', top: 0, zIndex: 60,
            background: imp.canAct ? '#7f1d1d' : '#1e293b',
            color: '#fff', padding: '6px 14px',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            fontSize: 13,
          }}
        >
          <span>
            👁 Viewing as <strong>{current?.full_name ?? imp.impersonatedUserId}</strong>
            {current && <span style={{ opacity: 0.8 }}> · {current.role}</span>}
          </span>

          {/* Device toggle */}
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6 }}>
            <DeviceBtn label="PC"    active={imp.forceDevice === 'pc'}     onClick={() => imp.setForceDevice(imp.forceDevice === 'pc' ? null : 'pc')} />
            <DeviceBtn label="Phone" active={imp.forceDevice === 'mobile'} onClick={() => imp.setForceDevice(imp.forceDevice === 'mobile' ? null : 'mobile')} />
          </span>

          {/* Act-as-me toggle */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} title="When off, all action buttons are read-only. When on, you can submit as this user (writes run as your admin account).">
            <input type="checkbox" checked={imp.actAsMe} onChange={(e) => imp.setActAsMe(e.target.checked)} />
            <span>{imp.actAsMe ? 'Acting as them (writes ON)' : 'Read-only'}</span>
          </label>

          <button onClick={() => setPickerOpen((v) => !v)} style={bannerBtn}>Switch</button>
          <button onClick={() => { imp.stop(); navigate('/manager'); }} style={{ ...bannerBtn, marginLeft: 'auto' }}>
            Exit
          </button>
        </div>
      )}

      {/* Floating launcher (when not actively shown in banner, or to reopen) */}
      {!imp.isImpersonating && (
        <button
          onClick={() => setPickerOpen((v) => !v)}
          style={{
            position: 'fixed', left: 12, bottom: 12, zIndex: 55,
            background: 'var(--color-card)', border: '1px solid var(--color-border)',
            borderRadius: 999, padding: '6px 12px', fontSize: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'pointer',
            color: 'var(--color-text)',
          }}
          title="Preview the app as another user"
        >
          👁 View as…
        </button>
      )}

      {/* Picker panel */}
      {pickerOpen && (
        <div
          onClick={() => setPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.2)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="t-card"
            style={{
              position: 'fixed', left: 12, bottom: 12, width: 280, maxHeight: '70vh',
              overflowY: 'auto', padding: 12,
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            }}
          >
            <div className="t-small t-muted uppercase tracking-wider mb-2">View as user</div>
            <ul className="space-y-0.5">
              {users.map((u) => {
                const active = u.user_id === imp.impersonatedUserId;
                return (
                  <li key={u.user_id}>
                    <button
                      onClick={() => pick(u.user_id, u.role)}
                      className="t-small"
                      style={{
                        width: '100%', textAlign: 'left', padding: '5px 8px',
                        borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: active ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'transparent',
                        color: 'var(--color-text)',
                        display: 'flex', justifyContent: 'space-between', gap: 8,
                      }}
                    >
                      <span>{u.full_name}</span>
                      <span className="t-muted" style={{ fontSize: 10 }}>{u.role}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="t-small t-muted mt-2" style={{ fontSize: 10 }}>
              Previews their data, view & layout. Reads run as admin; writes stay off
              unless you enable “Act as them”.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

const bannerBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: 4, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
};

function DeviceBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#fff' : 'rgba(255,255,255,0.15)',
        color: active ? '#111827' : '#fff',
        border: '1px solid rgba(255,255,255,0.35)', borderRadius: 4,
        padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
