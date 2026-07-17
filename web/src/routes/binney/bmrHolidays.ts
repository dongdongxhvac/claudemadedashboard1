// BMR-observed building holidays for the Binney St campus — the "client 11"
// from the CBA math (the CBA grants 12 holidays, BMR observes 11, and the
// difference is each engineer's one Floating Holiday, tracked as PTO type
// 'holiday'). The coverage heatmap outlines these dates so managers see them
// while booking/checking PTO; they do NOT affect the vacation cap or any
// hours math.
//
// ⚠ Seeded from the standard private-sector list (federal minus Columbus +
// Veterans Day, plus Day after Thanksgiving + Christmas Eve) — VERIFY against
// BMR's published holiday calendar and edit here. Dates are matched as exact
// YYYY-MM-DD strings. Weekend holidays list both the actual date and the
// weekday BMR would observe, same convention as lib/holidays.ts.
//
// Kept in the Binney route tree (not lib/holidays.ts) per the isolate-new-
// features rule: UPark's on-call holiday logic stays untouched.

export type BmrHoliday = { name: string; date: string };

export const BMR_HOLIDAYS: BmrHoliday[] = [
  // ---- 2026 ----
  { name: "New Year's Day",         date: '2026-01-01' },
  { name: 'MLK Jr. Day',            date: '2026-01-19' },
  { name: 'Presidents Day',         date: '2026-02-16' },
  { name: 'Memorial Day',           date: '2026-05-25' },
  { name: 'Juneteenth',             date: '2026-06-19' },
  { name: 'Independence Day (obs)', date: '2026-07-03' }, // 4th is Sat
  { name: 'Independence Day',       date: '2026-07-04' },
  { name: 'Labor Day',              date: '2026-09-07' },
  { name: 'Thanksgiving',           date: '2026-11-26' },
  { name: 'Day after Thanksgiving', date: '2026-11-27' },
  { name: 'Christmas Eve',          date: '2026-12-24' },
  { name: 'Christmas Day',          date: '2026-12-25' },

  // ---- 2027 ----
  { name: "New Year's Day",         date: '2027-01-01' },
  { name: 'MLK Jr. Day',            date: '2027-01-18' },
  { name: 'Presidents Day',         date: '2027-02-15' },
  { name: 'Memorial Day',           date: '2027-05-31' },
  { name: 'Juneteenth (obs)',       date: '2027-06-18' }, // 19th is Sat
  { name: 'Juneteenth',             date: '2027-06-19' },
  { name: 'Independence Day',       date: '2027-07-04' },
  { name: 'Independence Day (obs)', date: '2027-07-05' }, // 4th is Sun
  { name: 'Labor Day',              date: '2027-09-06' },
  { name: 'Thanksgiving',           date: '2027-11-25' },
  { name: 'Day after Thanksgiving', date: '2027-11-26' },
  { name: 'Christmas Eve (obs)',    date: '2027-12-23' }, // Eve slides to Thu
  { name: 'Christmas Day (obs)',    date: '2027-12-24' }, // 25th is Sat
  { name: 'Christmas Day',          date: '2027-12-25' },
  { name: "New Year's Day (obs)",   date: '2027-12-31' }, // Jan 1 2028 is Sat

  // ---- 2028 (boundary) ----
  { name: "New Year's Day",         date: '2028-01-01' },
  { name: 'MLK Jr. Day',            date: '2028-01-17' },
];
