// BMR-observed building holidays — the "client 11" from the CBA math (the
// CBA grants 12 holidays, BMR observes 11, and the difference is each
// engineer's one Floating Holiday, tracked as PTO type 'holiday'). BMR is
// the client at BOTH campuses, so this list is shared: the UPark and Binney
// PTO cap heatmaps outline these dates so managers see them while
// booking/checking PTO; they do NOT affect the vacation cap. A BMR holiday
// is already a paid day off, so NEITHER site charges it against PTO: the
// hours auto-fill skips it via chargeableWeekdays() at UPark (Mon–Fri,
// since 2026-10-07) and chargeableDays() at Binney (7-day crews, since
// 2026-11-11 per user). (Moved from routes/binney/ 2026-07-25 when the Binney panel layout
// was ported to UPark. Still separate from lib/holidays.ts — that file
// drives UPark's on-call pay logic and must not change meaning.)
//
// ⚠ Seeded from the standard private-sector list (federal minus Columbus +
// Veterans Day, plus Day after Thanksgiving + Christmas Eve) — VERIFY against
// BMR's published holiday calendar and edit here. Dates are matched as exact
// YYYY-MM-DD strings. Only the day BMR OBSERVES is listed (per user,
// 2026-07-17): when a holiday falls on a weekend, just the shifted weekday
// appears — e.g. Jul 4 2026 (Sat) marks only Fri Jul 3. "(obs)" in the name
// flags a shifted date.

export type BmrHoliday = { name: string; date: string };

export const BMR_HOLIDAYS: BmrHoliday[] = [
  // ---- 2026 ----
  { name: "New Year's Day",         date: '2026-01-01' },
  { name: 'MLK Jr. Day',            date: '2026-01-19' },
  { name: 'Presidents Day',         date: '2026-02-16' },
  { name: 'Memorial Day',           date: '2026-05-25' },
  { name: 'Juneteenth',             date: '2026-06-19' },
  { name: 'Independence Day (obs)', date: '2026-07-03' }, // 4th is Sat
  { name: 'Labor Day',              date: '2026-09-07' },
  { name: 'Thanksgiving',           date: '2026-11-26' },
  { name: 'Day after Thanksgiving', date: '2026-11-27' },
  { name: 'Christmas Eve',          date: '2026-12-24' },
  { name: 'Christmas Day',          date: '2026-12-25' },

  // ---- 2027 ---- (confirmed against BMR's published 2027 list, 2026-10-07)
  { name: "New Year's Day",         date: '2027-01-01' },
  { name: 'MLK Jr. Day',            date: '2027-01-18' },
  { name: 'Presidents Day',         date: '2027-02-15' },
  { name: 'Memorial Day',           date: '2027-05-31' },
  { name: 'Juneteenth (obs)',       date: '2027-06-18' }, // 19th is Sat
  { name: 'Independence Day (obs)', date: '2027-07-02' }, // 4th is Sun — BMR observes Fri
  { name: 'Labor Day',              date: '2027-09-06' },
  { name: 'Thanksgiving',           date: '2027-11-25' },
  { name: 'Day after Thanksgiving', date: '2027-11-26' },
  { name: 'Christmas Day (obs)',    date: '2027-12-24' }, // 25th is Sat; no separate Eve in 2027
  { name: "New Year's Day (obs)",   date: '2027-12-31' }, // Jan 1 2028 is Sat

  // ---- 2028 (boundary) ----
  { name: 'MLK Jr. Day',            date: '2028-01-17' },
];

const BMR_HOLIDAY_BY_DATE = new Map(BMR_HOLIDAYS.map((h) => [h.date, h]));

/** BMR holidays falling inside [startsOn, endsOn] (YYYY-MM-DD, inclusive). */
export function bmrHolidaysInRange(startsOn: string, endsOn: string): BmrHoliday[] {
  if (!startsOn || !endsOn || endsOn < startsOn) return [];
  return BMR_HOLIDAYS.filter((h) => h.date >= startsOn && h.date <= endsOn);
}

/** Mon–Fri days in [startsOn, endsOn] that are NOT BMR holidays — the days
 *  a UPark (5×8) PTO request actually costs. Holidays are already paid days
 *  off, so they must not be charged against vacation/sick. */
export function chargeableWeekdays(startsOn: string, endsOn: string): number {
  if (!startsOn || !endsOn || endsOn < startsOn) return 0;
  let n = 0;
  const cur = new Date(startsOn + 'T00:00:00');
  const end = new Date(endsOn + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    const iso = cur.toLocaleDateString('en-CA');
    if (dow !== 0 && dow !== 6 && !BMR_HOLIDAY_BY_DATE.has(iso)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** Every day in [startsOn, endsOn] that is NOT a BMR holiday — the days a
 *  Binney (7-day, 4×10 crews) PTO request costs. Weekends count; BMR
 *  holidays don't. */
export function chargeableDays(startsOn: string, endsOn: string): number {
  if (!startsOn || !endsOn || endsOn < startsOn) return 0;
  let n = 0;
  const cur = new Date(startsOn + 'T00:00:00');
  const end = new Date(endsOn + 'T00:00:00');
  while (cur <= end) {
    if (!BMR_HOLIDAY_BY_DATE.has(cur.toLocaleDateString('en-CA'))) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** BMR holidays that a [startsOn, endsOn] absence sits right next to: the
 *  last working day before the holiday or the first working day after it
 *  falls inside the range. "Working day" skips other BMR holidays, and
 *  weekends too when weekdaysOnly (UPark Mon–Fri; Binney's 7-day crews use
 *  calendar days). Rule (user, 2026-11-11): a sick call-out the day before
 *  or after a holiday is not paid — the manager logs it as Unpaid. */
export function bmrHolidaysAdjacent(startsOn: string, endsOn: string, weekdaysOnly: boolean): BmrHoliday[] {
  if (!startsOn || !endsOn || endsOn < startsOn) return [];
  const step = (iso: string, dir: 1 | -1): string => {
    const d = new Date(iso + 'T00:00:00');
    for (let i = 0; i < 10; i++) {
      d.setDate(d.getDate() + dir);
      const cur = d.toLocaleDateString('en-CA');
      const dow = d.getDay();
      if (BMR_HOLIDAY_BY_DATE.has(cur)) continue;
      if (weekdaysOnly && (dow === 0 || dow === 6)) continue;
      return cur;
    }
    return d.toLocaleDateString('en-CA');
  };
  const inRange = (iso: string) => iso >= startsOn && iso <= endsOn;
  return BMR_HOLIDAYS.filter((h) => inRange(step(h.date, -1)) || inRange(step(h.date, 1)));
}

