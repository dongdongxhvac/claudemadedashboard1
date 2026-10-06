// Admin → "Shop TV" card: which board each wall screen shows (0138).
//
// One row per tv-role (kiosk) account with a three-way switch: TV1
// operations board, TV2 coverage board, or rotate every few minutes. The
// kiosk follows over realtime, so the wall changes within seconds — no
// trip to the Pi, no re-login.
import { useState } from 'react';
import {
  useTvKiosks,
  useSetTvLayout,
  TV_LAYOUT_OPTIONS,
  type TvKiosk,
  type TvLayoutSetting,
} from '../hooks/useTvLayout';

function KioskRow({ kiosk }: { kiosk: TvKiosk }) {
  const setLayout = useSetTvLayout();
  const [err, setErr] = useState<string | null>(null);
  const choose = (layout: TvLayoutSetting) => {
    if (layout === kiosk.layout) return;
    setErr(null);
    setLayout.mutate({ user_id: kiosk.id, layout }, { onError: (e) => setErr((e as Error).message) });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 py-2 t-row-divider">
      <div style={{ minWidth: 180 }}>
        <div className="t-text" style={{ fontWeight: 500 }}>
          {kiosk.full_name}
          {!kiosk.active && <span className="t-small t-muted"> · inactive</span>}
        </div>
        <div className="t-small t-muted">{kiosk.email ?? '—'}</div>
      </div>
      <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--color-border)' }} role="radiogroup">
        {TV_LAYOUT_OPTIONS.map((opt) => {
          const on = opt.value === kiosk.layout;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={opt.hint}
              disabled={setLayout.isPending}
              onClick={() => choose(opt.value)}
              className="t-small px-3 py-1.5"
              style={{
                background: on ? 'var(--color-accent)' : 'var(--color-card)',
                color: on ? 'white' : 'var(--color-text)',
                fontWeight: on ? 600 : 400,
                borderLeft: '1px solid var(--color-border)',
                marginLeft: -1,
                cursor: setLayout.isPending ? 'wait' : 'pointer',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {setLayout.isPending && <span className="t-small t-muted">saving…</span>}
      {err && <span className="t-small t-danger">{err}</span>}
    </div>
  );
}

export function ShopTvLayoutCard() {
  const kiosksQ = useTvKiosks();
  const kiosks = kiosksQ.data ?? [];
  if (kiosksQ.isLoading) return null;
  if (kiosksQ.error || kiosks.length === 0) return null; // nothing to switch, or not allowed to see it
  return (
    <section className="t-card">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h2 className="t-section-title">Shop TV</h2>
        <span className="t-small t-muted">
          the screen switches within seconds · rotate alternates the two boards on the clock
        </span>
      </div>
      {kiosks.map((k) => <KioskRow key={k.id} kiosk={k} />)}
    </section>
  );
}
