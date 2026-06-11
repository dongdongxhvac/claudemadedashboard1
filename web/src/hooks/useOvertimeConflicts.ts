// Overtime conflict checks — shared by the §11 Assign-engineer modal
// (grey + reason, still clickable with confirm) and the engineer
// self-serve "Sign me up" button (hard block with reason).
//
// Three checks for engineer E against a post's time window:
//   * shift — the window overlaps E's regular Mon–Fri shift by MORE
//     than the tolerance (UPark rule: "overlap in 2 hours is ok")
//   * ot    — E is already signed up on another post whose window
//     overlaps by more than the tolerance
//   * pto   — E has approved PTO covering any day the window touches
//     (partial-day times go in the label; the manager judges)
//
// Posts without ends_at are assumed to run DEFAULT_OT_DURATION_HOURS —
// the assumption is called out in the conflict label.
//
// Timezone note: shift times ('07:00:00') are site-local wall-clock and
// are deliberately parsed WITHOUT a zone suffix, so they resolve in the
// browser's timezone; post timestamps are absolute instants. Both land
// on one epoch timeline, and the comparison is exact whenever the
// viewing browser shares the site timezone — the same convention the
// rest of the dashboard uses (localISODate etc.). Do NOT "fix" this by
// suffixing Z onto shift times: that would turn a 7am ET shift start
// into 7am UTC (3am ET) and break the overlap math for everyone.
import type { OvertimePost } from './useOvertime';
import type { PtoRequest } from './usePto';
import type { Shift } from './useShifts';

export const OT_OVERLAP_TOLERANCE_HOURS = 2;
export const DEFAULT_OT_DURATION_HOURS = 4;

export type OtConflict = {
  kind: 'pto' | 'shift' | 'ot';
  label: string;
};

type WindowMs = { start: number; end: number; assumedEnd: boolean };

function postWindowMs(post: Pick<OvertimePost, 'starts_at' | 'ends_at'>): WindowMs {
  const start = Date.parse(post.starts_at);
  const end = post.ends_at
    ? Date.parse(post.ends_at)
    : start + DEFAULT_OT_DURATION_HOURS * 3_600_000;
  return { start, end: Math.max(end, start), assumedEnd: !post.ends_at };
}

function localDateIso(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA');
}

function hhmm(t: string): string {
  // 'HH:MM:SS' → 'H:MMa/p'
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

function fmtHours(ms: number): string {
  const h = ms / 3_600_000;
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

export function computeOtConflicts(args: {
  userId: string;
  post: OvertimePost;
  allPosts: OvertimePost[];
  shiftId: string | null;
  shifts: Shift[];
  ptoRequests: PtoRequest[];
}): OtConflict[] {
  const { userId, post, allPosts, shiftId, shifts, ptoRequests } = args;
  const w = postWindowMs(post);
  const tolMs = OT_OVERLAP_TOLERANCE_HOURS * 3_600_000;
  const out: OtConflict[] = [];
  const assumedNote = w.assumedEnd ? ` (post has no end time — assumed ${DEFAULT_OT_DURATION_HOURS}h)` : '';

  // ---- regular shift (Mon–Fri only; weekend posts never conflict) ----
  const shift = shiftId ? shifts.find((s) => s.id === shiftId) : null;
  if (shift) {
    const startDay = new Date(w.start);
    const dow = startDay.getDay(); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 5) {
      const dateIso = localDateIso(w.start);
      const shStart = Date.parse(`${dateIso}T${shift.start_time}`);
      const shEnd = Date.parse(`${dateIso}T${shift.end_time}`);
      if (Number.isFinite(shStart) && Number.isFinite(shEnd)) {
        const ovl = Math.min(w.end, shEnd) - Math.max(w.start, shStart);
        if (ovl > tolMs) {
          out.push({
            kind: 'shift',
            label: `on regular shift ${hhmm(shift.start_time)}–${hhmm(shift.end_time)} — ${fmtHours(ovl)}h overlap${assumedNote}`,
          });
        }
      }
    }
  }

  // ---- double-booked on another OT post ----
  for (const p of allPosts) {
    if (p.id === post.id || p.status === 'cancelled') continue;
    if (!p.signups.some((s) => s.user_id === userId)) continue;
    const w2 = postWindowMs(p);
    const ovl = Math.min(w.end, w2.end) - Math.max(w.start, w2.start);
    if (ovl > tolMs) {
      const where = p.building_short_code ? `Bld ${p.building_short_code}` : p.scope;
      const when = new Date(w2.start).toLocaleString('en-US', {
        weekday: 'short', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      out.push({
        kind: 'ot',
        label: `already covering ${where} ${when} — ${fmtHours(ovl)}h overlap${assumedNote}`,
      });
    }
  }

  // ---- approved PTO touching the post's date range ----
  const dFrom = localDateIso(w.start);
  const dTo = localDateIso(w.end);
  for (const r of ptoRequests) {
    if (r.user_id !== userId || r.status !== 'approved') continue;
    if (r.ends_on < dFrom || r.starts_on > dTo) continue;
    const partial = r.out_from || r.out_until
      ? ` (out ${r.out_from ? hhmm(r.out_from) : 'start of day'} → ${r.out_until ? hhmm(r.out_until) : 'end of day'})`
      : '';
    const range = r.starts_on === r.ends_on ? r.starts_on : `${r.starts_on} → ${r.ends_on}`;
    out.push({ kind: 'pto', label: `on PTO ${range}${partial}` });
  }

  return out;
}

export function conflictSummary(conflicts: OtConflict[]): string {
  return conflicts.map((c) => `• ${c.label}`).join('\n');
}
