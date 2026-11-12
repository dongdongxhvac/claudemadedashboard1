// The wall's two-key pad (user 2026-11-12: "i installed a 2keys pad on Pi").
//
// A small USB keypad (FQ-K002 RGB, USB 5131:5345 — a plain HID keyboard)
// sits next to the shop TV so anyone can change what the wall shows:
//   NEXT — show the next enabled board for TV_KEY_NEXT_MINUTES, then go back
//          to whatever the Shop TV card says (a fixed board or the rotation);
//   HOLD — keep the board now on screen for TV_KEY_HOLD_MINUTES; press it
//          again to release early.
// The override lives in this browser only (localStorage, so it survives the
// kiosk's own reload when a new build ships). The account's setting is never
// touched, and the admin card still decides which boards exist: NEXT cycles
// the enabled ones only.
//
// Which key is which is LEARNED, not configured. These pads ship with
// whatever the seller programmed (a/b, 1/2, z/x, Ctrl+C/Ctrl+V …) and the Pi
// can't tell us in advance. The first key ever pressed becomes NEXT, the
// second DIFFERENT key becomes HOLD, and the wall says so when it learns
// one. Holding any key down for TV_KEY_RESET_SECONDS forgets both, so they
// can be re-learned the other way round.
//
// A tiny external store (not React state) because TvLayoutGate remounts on
// every board change — the override, the learned keys and the on-screen
// note have to outlive that.
import { useEffect, useSyncExternalStore } from 'react';
import { TV_LAYOUT_LABELS, isTvLayout, type TvLayout } from './useTvLayout';

export const TV_KEY_NEXT_MINUTES = 10;
export const TV_KEY_HOLD_MINUTES = 30;
export const TV_KEY_RESET_SECONDS = 5;

export type TvKeyOverride = { layout: TvLayout; until: number; kind: 'next' | 'hold' };
type TvKeyMap = { next: string | null; hold: string | null };
export type TvKeypadState = {
  /** Board the pad asked for, until `until` (ms epoch). Null = follow the account. */
  override: TvKeyOverride | null;
  keys: TvKeyMap;
  /** Short note for the wall ("This key is now NEXT BOARD"). */
  toast: { text: string; until: number } | null;
};

const LS_OVERRIDE = 'cove.tv.keypad.override';
const LS_KEYS = 'cove.tv.keypad.keys';

function readJson(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode / storage blocked — the pad still works until reload */ }
}

function load(): TvKeypadState {
  const o = readJson(LS_OVERRIDE) as Partial<TvKeyOverride> | null;
  const override = o && isTvLayout(o.layout) && typeof o.until === 'number' && o.until > Date.now()
    && (o.kind === 'next' || o.kind === 'hold')
    ? { layout: o.layout, until: o.until, kind: o.kind }
    : null;
  const k = readJson(LS_KEYS) as Partial<TvKeyMap> | null;
  const keys: TvKeyMap = {
    next: typeof k?.next === 'string' ? k.next : null,
    hold: typeof k?.hold === 'string' ? k.hold : null,
  };
  return { override, keys, toast: null };
}

let state: TvKeypadState = load();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Wake up when the override or the note runs out, so they clear on time
 *  without anything polling the clock. */
function schedule() {
  if (timer) clearTimeout(timer);
  const due = Math.min(state.override?.until ?? Infinity, state.toast?.until ?? Infinity);
  if (due === Infinity) return;
  timer = setTimeout(() => {
    const now = Date.now();
    set({
      ...state,
      override: state.override && state.override.until > now ? state.override : null,
      toast: state.toast && state.toast.until > now ? state.toast : null,
    });
  }, Math.max(0, due - Date.now()) + 25);
}

function set(next: TvKeypadState) {
  if (next.override !== state.override) writeJson(LS_OVERRIDE, next.override);
  if (next.keys !== state.keys) writeJson(LS_KEYS, next.keys);
  state = next;
  schedule();
  listeners.forEach((l) => l());
}
schedule();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useTvKeypadState(): TvKeypadState {
  return useSyncExternalStore(subscribe, () => state);
}

const note = (text: string, seconds: number) => ({ text, until: Date.now() + seconds * 1000 });

/** One press of key `id` while `current` is on screen. `home` is the board
 *  the account's own setting shows when that is a fixed board (null while it
 *  rotates). */
function press(id: string, current: TvLayout, enabled: TvLayout[], home: TvLayout | null) {
  let keys = state.keys;
  let action: 'next' | 'hold';
  let learned = false;
  if (id === keys.next) action = 'next';
  else if (id === keys.hold) action = 'hold';
  else if (!keys.next) { keys = { ...keys, next: id }; action = 'next'; learned = true; }
  else if (!keys.hold) { keys = { ...keys, hold: id }; action = 'hold'; learned = true; }
  else return;   // a third key — not one of the pad's two

  const now = Date.now();
  if (action === 'next') {
    if (enabled.length < 2) {
      set({ ...state, keys, toast: note(learned
        ? 'This key is now NEXT BOARD — only one board is switched on for this screen'
        : 'Only one board is switched on for this screen', 5) });
      return;
    }
    const layout = enabled[(enabled.indexOf(current) + 1) % enabled.length];
    // Cycling round to the screen's own fixed board is simply "back to
    // normal" — nothing to override, no countdown to show.
    if (layout === home && !learned) {
      set({ ...state, keys, override: null, toast: note(`${TV_LAYOUT_LABELS[layout]} · back to the usual board`, 3) });
      return;
    }
    set({
      ...state, keys,
      override: { layout, until: now + TV_KEY_NEXT_MINUTES * 60_000, kind: 'next' },
      toast: note(learned
        ? `This key is now NEXT BOARD · ${TV_LAYOUT_LABELS[layout]} for ${TV_KEY_NEXT_MINUTES} min`
        : `${TV_LAYOUT_LABELS[layout]} · ${TV_KEY_NEXT_MINUTES} min`, learned ? 6 : 3),
    });
    return;
  }
  // HOLD toggles: a hold in force is released, otherwise this board is held.
  if (state.override?.kind === 'hold' && !learned) {
    set({ ...state, keys, override: null, toast: note('Hold released', 3) });
    return;
  }
  set({
    ...state, keys,
    override: { layout: current, until: now + TV_KEY_HOLD_MINUTES * 60_000, kind: 'hold' },
    toast: note(learned
      ? `This key is now HOLD · holding this board ${TV_KEY_HOLD_MINUTES} min, press again to release`
      : `Holding this board ${TV_KEY_HOLD_MINUTES} min · press again to release`, learned ? 6 : 4),
  });
}

function forgetKeys() {
  set({
    ...state,
    keys: { next: null, hold: null },
    toast: note('Keypad reset — press the key you want for NEXT BOARD, then the other for HOLD', 8),
  });
}

/** A stable name for the key behind an event: the physical key plus any
 *  modifiers held with it ("KeyA", "C+KeyC" for Ctrl+C). Bare modifier
 *  presses are not keys of their own. */
function keyIdOf(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock'].includes(e.key)) return null;
  const mods = (e.ctrlKey ? 'C' : '') + (e.altKey ? 'A' : '') + (e.shiftKey ? 'S' : '') + (e.metaKey ? 'M' : '');
  const base = e.code && e.code !== 'Unidentified' ? e.code : e.key;
  if (!base) return null;
  return mods ? `${mods}+${base}` : base;
}

/** Listen for the pad while `active` (a kiosk account showing `current`).
 *  `enabledKey` is the enabled boards joined with commas — a string so the
 *  listener is only re-attached when the set really changes. `home` is the
 *  account's fixed board, or null while it rotates. */
export function useTvKeypad(active: boolean, current: TvLayout | null, enabledKey: string, home: TvLayout | null) {
  useEffect(() => {
    if (!active || !current) return;
    const enabled = enabledKey.split(',').filter(isTvLayout);
    const downAt = new Map<string, number>();
    const onDown = (e: KeyboardEvent) => {
      const id = keyIdOf(e);
      if (!id) return;
      const ours = id === state.keys.next || id === state.keys.hold || !state.keys.next || !state.keys.hold;
      if (!ours) return;
      // Whatever the pad was programmed to send (Space, F5, Ctrl+V …) must
      // not also scroll, reload or paste on the wall.
      e.preventDefault();
      if (e.repeat) return;
      downAt.set(id, Date.now());
      press(id, current, enabled, home);
    };
    const onUp = (e: KeyboardEvent) => {
      const id = keyIdOf(e);
      if (!id) return;
      const t = downAt.get(id);
      downAt.delete(id);
      if (t !== undefined && Date.now() - t >= TV_KEY_RESET_SECONDS * 1000) forgetKeys();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [active, current, enabledKey, home]);
}
