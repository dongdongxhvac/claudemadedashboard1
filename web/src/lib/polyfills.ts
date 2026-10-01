// crypto.randomUUID exists only in secure contexts (https or localhost).
// Opening the dev server from another device over plain http — e.g. a
// phone on the LAN at http://192.168.x.x:5173 — lacks it, which crashed
// every realtime hook that names its Supabase channel with a UUID.
// crypto.getRandomValues IS available in insecure contexts, so back-fill
// a spec-correct v4 UUID from it. Import this module first in main.tsx.
if (!('randomUUID' in crypto)) {
  (crypto as unknown as { randomUUID: () => string }).randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

export {};
