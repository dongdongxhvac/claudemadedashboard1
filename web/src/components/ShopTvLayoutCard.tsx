// Admin → "Shop TV" card: which board each wall screen shows (0138).
//
// One row per tv-role (kiosk) account: a radio of the boards (TV0
// operations, TV2 coverage, TV212 coverage 20/45/35) or rotate every few
// minutes, plus an on/off toggle per board (0142) — a board switched off
// can't be chosen and rotate skips it. The kiosk follows over realtime, so
// the wall changes within seconds — no trip to the Pi, no re-login.
import { useState } from 'react';
import {
  useTvKiosks,
  useSetTvLayout,
  useSetTvLayoutEnabled,
  TV_LAYOUT_OPTIONS,
  TV_LAYOUT_LABELS,
  TV_ROTATION_ORDER,
  type TvKiosk,
  type TvLayout,
  type TvLayoutSetting,
} from '../hooks/useTvLayout';

function KioskRow({ kiosk }: { kiosk: TvKiosk }) {
  const setLayout = useSetTvLayout();
  const setEnabled = useSetTvLayoutEnabled();
  const [err, setErr] = useState<string | null>(null);
  const busy = setLayout.isPending || setEnabled.isPending;
  const isOff = (l: TvLayoutSetting) => l !== 'rotate' && kiosk.off.includes(l);
  const enabledCount = TV_ROTATION_ORDER.length - kiosk.off.length;
  const choose = (layout: TvLayoutSetting) => {
    if (layout === kiosk.layout || isOff(layout)) return;
    setErr(null);
    setLayout.mutate({ user_id: kiosk.id, layout }, { onError: (e) => setErr((e as Error).message) });
  };
  const toggle = (layout: TvLayout) => {
    const enabled = kiosk.off.includes(layout);
    // Never switch the last board off — the wall has to show something.
    if (!enabled && enabledCount <= 1) return;
    setErr(null);
    setEnabled.mutate({ user_id: kiosk.id, layout, enabled }, { onError: (e) => setErr((e as Error).message) });
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
          const off = isOff(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={off ? `${opt.label} is switched off for this screen — turn it on below to use it` : opt.hint}
              disabled={busy || off}
              onClick={() => choose(opt.value)}
              className="t-small px-3 py-1.5"
              style={{
                background: on ? 'var(--color-accent)' : 'var(--color-card)',
                color: on ? 'white' : 'var(--color-text)',
                fontWeight: on ? 600 : 400,
                opacity: off ? 0.45 : 1,
                textDecoration: off ? 'line-through' : 'none',
                borderLeft: '1px solid var(--color-border)',
                marginLeft: -1,
                cursor: busy ? 'wait' : off ? 'not-allowed' : 'pointer',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {/* Per-board on/off (0142). Rotate cycles only the boards that are
          on; the last board on can't be switched off. */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="t-small t-muted uppercase tracking-wider" style={{ fontSize: 10, marginRight: 4 }}>boards</span>
        {TV_ROTATION_ORDER.map((l) => {
          const enabled = !kiosk.off.includes(l);
          const last = enabled && enabledCount <= 1;
          return (
            <button
              key={l}
              type="button"
              aria-pressed={enabled}
              disabled={busy || last}
              onClick={() => toggle(l)}
              title={last ? 'the last board on can’t be switched off' : enabled ? `switch ${TV_LAYOUT_LABELS[l]} off for this screen` : `switch ${TV_LAYOUT_LABELS[l]} on`}
              className="t-small px-2 py-0.5 rounded-full border"
              style={{
                background: enabled ? 'rgba(16,185,129,0.12)' : 'var(--color-card)',
                color: enabled ? '#047857' : 'var(--color-text-muted)',
                borderColor: enabled ? 'rgba(16,185,129,0.4)' : 'var(--color-border)',
                fontWeight: 600,
                fontSize: 11,
                cursor: busy ? 'wait' : last ? 'not-allowed' : 'pointer',
              }}
            >
              {enabled ? '✓' : '✕'} {TV_LAYOUT_LABELS[l]}
            </button>
          );
        })}
      </div>
      {busy && <span className="t-small t-muted">saving…</span>}
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
          the screen switches within seconds · rotate cycles the boards that are on, {5} min each, on the clock
        </span>
      </div>
      {kiosks.map((k) => <KioskRow key={k.id} kiosk={k} />)}
    </section>
  );
}
