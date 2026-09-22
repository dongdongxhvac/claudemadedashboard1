// UPark New-Hire 8-Week Program — program constants.
//
// The program CONTENT (weeks, verified items, rep tally, COVE audit,
// certification) is NOT transcribed here any more: it is read from the
// Master Sign-Off Sheet document inside the Print Station
// (lib/signoffSheet.ts). Progress is keyed on the sheet's own items.
// This file keeps what is not in the sheet: the week-from-start-date rule
// and the per-handout mentor tick / note keys. The list of programs (keys,
// titles, print stations) lives in lib/programs.ts.

export const NH_WEEKS = 8;

/** new_hire_checkoffs keys for the per-handout MENTOR ticks (Reviewed / Quiz passed). */
export const docKeyFor = (docKey: string) => ({
  reviewed: `doc.${docKey}.reviewed`,
  quiz:     `doc.${docKey}.quiz`,
});
export const DOC_KEY_RE = /^doc\.(.+)\.(reviewed|quiz)$/;

/** new_hire_checkoffs key for a free-standing NOTE on a sign-off item — a
 *  note is independent of the initials (initials = complete). The row's
 *  `note` holds the text, `verified_by` / `done_at` who wrote it and when. */
export const noteKeyFor = (itemKey: string) => `note.${itemKey}`;

/** Which program week "should" be in progress for a start date (1..8, or
 *  9 = past the program, 0 = not started). Weeks roll on Mondays relative
 *  to the start date. */
export function nhWeekFor(startDate: string | null | undefined, today = new Date()): number {
  if (!startDate) return 0;
  const start = new Date(startDate + 'T00:00:00');
  const days = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return 0;
  return Math.min(NH_WEEKS + 1, Math.floor(days / 7) + 1);
}
