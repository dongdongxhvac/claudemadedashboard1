// On-call week dealing with staged joins ("compacting" effective_from,
// 2026-07-29). One algorithm, consumed by the OncallTab grid + diff +
// export, the /tv rotation panel, oncallParticipantAt (§11 overtime), and
// mirrored in SQL by deal_oncall_weeks() (migration 0114) for the publish
// RPC's materialization. Keep the TS and SQL implementations in lockstep.
//
// The deal: walk the ordered roster with a rotating pointer, one Friday per
// step, SKIPPING members whose effective_from is after the week being dealt.
// A member's join therefore slots them in at their roster position on their
// first eligible pass, and everyone else keeps their exact weeks — no gaps,
// no re-dealing of the past. When every member is always eligible this
// reduces to the old fixed formula (week k → roster[k mod N]), which is the
// regression guarantee for all pre-existing schedules.
//
// Dependency-free on purpose: the parity tests run this file directly in
// Node (esbuild transpile) against the SQL function's output.

export type RotationSlot = {
  user_id: string;
  effective_from: string | null;
};

/** Add `days` to an ISO YYYY-MM-DD date string. Formats via LOCAL date
 *  parts (not toISOString, which shifts a day in UTC-positive timezones —
 *  and a single shifted week would cascade through the stateful pointer
 *  walk, diverging from the SQL twin's exact date arithmetic). */
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Deal `forwardWeeks` sequential Fridays from startFriday (week index 0),
 *  plus `backWeeks` before it (negative indices, pointer run in reverse —
 *  used only for the grid's italic "Prev" column). Returns a map of
 *  week index → ROSTER INDEX; missing keys are gap weeks where no member
 *  was eligible. */
export function dealRotationWeeks(
  roster: RotationSlot[],
  startFriday: string,
  forwardWeeks: number,
  backWeeks = 0,
): Map<number, number> {
  const out = new Map<number, number>();
  const n = roster.length;
  if (n === 0) return out;
  const eligible = (idx: number, weekStart: string): boolean => {
    const ef = roster[idx].effective_from;
    return !ef || ef <= weekStart;
  };

  let ptr = 0;
  for (let w = 0; w < forwardWeeks; w++) {
    const weekStart = addDays(startFriday, w * 7);
    for (let s = 0; s < n; s++) {
      const idx = (ptr + s) % n;
      if (eligible(idx, weekStart)) {
        out.set(w, idx);
        ptr = ptr + s + 1;
        break;
      }
    }
    // nobody eligible: ptr unchanged, week left unassigned
  }

  ptr = -1;
  for (let w = -1; w >= -backWeeks; w--) {
    const weekStart = addDays(startFriday, w * 7);
    for (let s = 0; s < n; s++) {
      const idx = (((ptr - s) % n) + n) % n;
      if (eligible(idx, weekStart)) {
        out.set(w, idx);
        ptr = ptr - s - 1;
        break;
      }
    }
  }
  return out;
}

/** Per-member view of the deal, shaped for the cycle-column grids:
 *  forward[i] = member i's assigned week starts (ascending) across `passes`
 *  passes of the roster; prev[i] = their most recent week before the anchor
 *  from one backward pass (null if none). With everyone always eligible,
 *  forward[i][c] = startFriday + (c*N + i) weeks and prev[i] =
 *  startFriday + (i − N) weeks — exactly the old grid math. */
export function rotationWeeksByMember(
  roster: RotationSlot[],
  startFriday: string,
  passes: number,
): { forward: string[][]; prev: (string | null)[] } {
  const n = roster.length;
  const forward: string[][] = Array.from({ length: n }, () => []);
  const prev: (string | null)[] = Array.from({ length: n }, () => null);
  if (n === 0) return { forward, prev };
  // Horizon: passes·n weeks, EXTENDED past the latest effective_from (same
  // rule as the SQL publish horizon, 0114b). Without this, a stale anchor
  // eats the window before a staged joiner is even eligible and their row
  // shows one or two cells with the rest '—'. Each member is capped at
  // `passes` turns, so always-eligible members are unaffected.
  let extra = 0;
  for (const m of roster) {
    if (!m.effective_from) continue;
    const w = Math.ceil((new Date(m.effective_from + 'T00:00:00').getTime()
      - new Date(startFriday + 'T00:00:00').getTime()) / (7 * 86_400_000));
    if (w > extra) extra = w;
  }
  const horizon = Math.min(520, passes * n + Math.max(0, extra));
  const deal = dealRotationWeeks(roster, startFriday, horizon, n);
  for (let w = -n; w < horizon; w++) {
    const idx = deal.get(w);
    if (idx === undefined) continue;
    const weekStart = addDays(startFriday, w * 7);
    if (w < 0) prev[idx] = weekStart; // ascending scan → last one before 0 wins
    else if (forward[idx].length < passes) forward[idx].push(weekStart);
  }
  return { forward, prev };
}
