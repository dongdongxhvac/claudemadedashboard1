// Inline note on PTO entry forms when the date range covers a BMR holiday.
// UPark (Mon–Fri): the auto-filled hours already skip the holiday. Binney
// (7-day crews): hours still count every day, so the manager is prompted to
// check whether the holiday should be charged.
import { bmrHolidaysInRange } from '../lib/bmrHolidays';

function md(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function BmrHolidayNote({
  startsOn, endsOn, excluded,
}: {
  startsOn: string;
  endsOn: string;
  /** true = auto-filled hours already leave the holiday out (UPark). */
  excluded: boolean;
}) {
  const hols = bmrHolidaysInRange(startsOn, endsOn);
  if (hols.length === 0) return null;
  const list = hols.map((h) => `${h.name} ${md(h.date)}`).join(', ');
  return (
    <p className="t-small mt-1" style={{ color: '#b45309' }}>
      Includes BMR holiday{hols.length > 1 ? 's' : ''}: {list}
      {excluded
        ? ` — not charged (hours skip ${hols.length > 1 ? 'them' : 'it'}).`
        : ` — hours count every day; take ${hols.length > 1 ? 'them' : 'it'} out if not worked.`}
    </p>
  );
}
