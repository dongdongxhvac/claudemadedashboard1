// Pull Cove user IDs (and whatever name/email rides along) out of pasted
// text. Pure — no React, no Supabase — so it's unit-testable and reusable.
// See components/CoveIdFinder.tsx for the UI and the why.

export type CoveFound = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
};

const ID_RE = /^[A-Za-z0-9]{8,14}$/;

/** Pull Cove user objects out of whatever was pasted. Tolerant: we decode
 *  the URL (possibly twice — Cove double-encodes some links), then look for
 *  JSON-ish `"id":"…"` objects with firstName/lastName nearby, and also
 *  /users/<id> paths and bare IDs. Dedupes by id. */
export function parseCoveIds(raw: string): CoveFound[] {
  const out = new Map<string, CoveFound>();
  const text = raw.trim();
  if (!text) return [];

  let decoded = text;
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(decoded);
      if (d === decoded) break;
      decoded = d;
    } catch { break; }
  }

  // 1. Full assignee objects: {"imageUrl":…,"email":…,"firstName":…,"id":…,"lastName":…,"role":…,"userId":…}
  //    Keys can come in any order, so match each object's braces and pull fields from within.
  const objRe = /\{[^{}]*"(?:id|userId)"\s*:\s*"([A-Za-z0-9]{8,14})"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(decoded)) !== null) {
    const obj = m[0];
    const id = m[1];
    const pick = (k: string): string | null => {
      const r = new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`).exec(obj);
      return r ? r[1] : null;
    };
    if (!out.has(id)) {
      out.set(id, {
        id,
        firstName: pick('firstName'),
        lastName: pick('lastName'),
        email: pick('email'),
        role: pick('role'),
      });
    }
  }

  // 2. Profile / user URLs: /users/<id>, /members/<id>, /people/<id>
  const pathRe = /\/(?:users|members|people|engineers)\/([A-Za-z0-9]{8,14})(?:[/?#]|$)/g;
  while ((m = pathRe.exec(decoded)) !== null) {
    if (!out.has(m[1])) out.set(m[1], { id: m[1], firstName: null, lastName: null, email: null, role: null });
  }

  // 3. A bare ID on its own (someone copied just the token)
  if (out.size === 0 && ID_RE.test(decoded)) {
    out.set(decoded, { id: decoded, firstName: null, lastName: null, email: null, role: null });
  }

  return Array.from(out.values());
}
