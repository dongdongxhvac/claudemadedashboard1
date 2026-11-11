// Inline note on PTO entry forms when the date range covers a BMR holiday.
// Neither site charges a BMR holiday against PTO: the auto-filled hours
// skip it (UPark Mon–Fri, Binney every day), and this note says so.
import { bmrHolidaysInRange, bmrHolidaysAdjacent } from '../lib/bmrHolidays';

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

/** Shown when a SICK entry falls on the working day before or after a BMR
 *  holiday. Policy: that call-out is not paid — the manager logs the day as
 *  Unpaid instead of Sick. Pass onUseUnpaid (manager forms) for a one-click
 *  switch; without it (engineer form, pending cards) it only informs. */
export function SickNextToHolidayNote({
  type, startsOn, endsOn, weekdaysOnly, onUseUnpaid, forEngineer = false,
}: {
  type: string;
  startsOn: string;
  endsOn: string;
  /** true at UPark (Mon–Fri); false at Binney (7-day crews). */
  weekdaysOnly: boolean;
  onUseUnpaid?: () => void;
  forEngineer?: boolean;
}) {
  if (type !== 'sick') return null;
  const hols = bmrHolidaysAdjacent(startsOn, endsOn, weekdaysOnly);
  if (hols.length === 0) return null;
  const list = hols.map((h) => `${h.name} ${md(h.date)}`).join(', ');
  return (
    <p
      className="t-small mt-1"
      style={{ color: '#b45309', padding: '0.35rem 0.5rem', borderRadius: 4, background: 'rgba(245,158,11,0.10)' }}
    >
      Sick call-out next to a BMR holiday ({list}).{' '}
      {forEngineer
        ? 'A sick day taken the day before or after a holiday is not paid — your manager may record it as Unpaid.'
        : 'Per policy it is not paid — log the day as Unpaid instead of Sick.'}
      {onUseUnpaid && (
        <button type="button" onClick={onUseUnpaid} className="t-accent hover:underline ml-2" style={{ fontWeight: 600 }}>
          Switch to Unpaid
        </button>
      )}
    </p>
  );
}

