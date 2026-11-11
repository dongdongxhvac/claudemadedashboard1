// Inline note on PTO entry forms when the date range covers a BMR holiday.
// Neither site charges a BMR holiday against PTO: the auto-filled hours
// skip it (UPark Mon–Fri, Binney every day), and this note says so.
import { bmrHolidaysInRange } from '../lib/bmrHolidays';

function md(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function BmrHolidayNote({ startsOn, endsOn }: { startsOn: string; endsOn: string }) {
  const hols = bmrHolidaysInRange(startsOn, endsOn);
  if (hols.length === 0) return null;
  const list = hols.map((h) => `${h.name} ${md(h.date)}`).join(', ');
  return (
    <p className="t-small mt-1" style={{ color: '#b45309' }}>
      Includes BMR holiday{hols.length > 1 ? 's' : ''}: {list} — not charged (hours skip {hols.length > 1 ? 'them' : 'it'}).
    </p>
  );
}
