// US federal holidays for 2026 + 2027 + 2028.
// For dates that fall on a weekend, federal observance shifts to the nearest
// weekday — both the actual and observed date are listed; the helper below
// matches on either, since on-call windows care about "is anyone working
// regular hours" rather than the calendar holiday name.
//
// Source: OPM federal holiday calendar.
// To customize for COVE's own holidays in the future (closures, special
// blackout dates), add entries to FEDERAL_HOLIDAYS or extend with a per-
// admin "oncall_holidays" table — deferred to v1.2.

export type HolidayDate = { name: string; date: string };

export const FEDERAL_HOLIDAYS: HolidayDate[] = [
  // ---- 2026 ----
  { name: "New Year's Day",   date: '2026-01-01' },
  { name: "MLK Jr. Day",      date: '2026-01-19' },
  { name: "Presidents Day",   date: '2026-02-16' },
  { name: "Memorial Day",     date: '2026-05-25' },
  { name: "Juneteenth",       date: '2026-06-19' },
  { name: "Independence Day", date: '2026-07-03' }, // observed (4th is Sat)
  { name: "Independence Day", date: '2026-07-04' },
  { name: "Labor Day",        date: '2026-09-07' },
  { name: "Columbus Day",     date: '2026-10-12' },
  { name: "Veterans Day",     date: '2026-11-11' },
  { name: "Thanksgiving",     date: '2026-11-26' },
  { name: "Christmas Day",    date: '2026-12-25' },

  // ---- 2027 ----
  { name: "New Year's Day",   date: '2027-01-01' },
  { name: "MLK Jr. Day",      date: '2027-01-18' },
  { name: "Presidents Day",   date: '2027-02-15' },
  { name: "Memorial Day",     date: '2027-05-31' },
  { name: "Juneteenth",       date: '2027-06-18' }, // observed (19th is Sat)
  { name: "Juneteenth",       date: '2027-06-19' },
  { name: "Independence Day", date: '2027-07-05' }, // observed (4th is Sun)
  { name: "Independence Day", date: '2027-07-04' },
  { name: "Labor Day",        date: '2027-09-06' },
  { name: "Columbus Day",     date: '2027-10-11' },
  { name: "Veterans Day",     date: '2027-11-11' },
  { name: "Thanksgiving",     date: '2027-11-25' },
  { name: "Christmas Day",    date: '2027-12-24' }, // observed (25th is Sat)
  { name: "Christmas Day",    date: '2027-12-25' },

  // ---- 2028 ----
  { name: "New Year's Day",   date: '2027-12-31' }, // observed (Jan 1 2028 is Sat)
  { name: "New Year's Day",   date: '2028-01-01' },
  { name: "MLK Jr. Day",      date: '2028-01-17' },
];

/**
 * Returns the first holiday falling inside the Friday→next-Friday window
 * starting at `weekStart` (YYYY-MM-DD). Returns null if no holiday lands in
 * the 7-day inclusive-exclusive interval [weekStart, weekStart+7).
 */
export function weekContainsHoliday(weekStart: string): HolidayDate | null {
  if (!weekStart) return null;
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  for (const h of FEDERAL_HOLIDAYS) {
    const d = new Date(h.date + 'T00:00:00');
    if (d >= start && d < end) return h;
  }
  return null;
}
