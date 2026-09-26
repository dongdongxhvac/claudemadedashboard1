// Pure PTO year-end + CBA allotment rules (no Supabase import, so the
// node test in ptoYearEnd.test.ts can run it). Hooks: hooks/usePtoYearEnd.ts.
// The close-out math mirrors pto_close_year() in migration 0135.

export type VacationAction = 'carry' | 'lose' | 'custom';

export const SICK_CARRY_MAX_DAYS = 2;

export const VACATION_ACTION_LABELS: Record<VacationAction, string> = {
  carry:  'Carry balance',
  lose:   'Lose (forfeit)',
  custom: 'Carry custom hours',
};

/** Client-side preview of the sick split — same rule as pto_close_year(). */
export function sickCloseoutPreview(sickRemaining: number, dailyHours: number) {
  const cap = SICK_CARRY_MAX_DAYS * dailyHours;
  return {
    cap,
    carry: Math.min(sickRemaining, cap),
    payout: Math.max(sickRemaining - cap, 0),
  };
}

/** Client-side preview of the vacation split — same rule as pto_close_year(). */
export function vacationCloseoutPreview(remaining: number, action: VacationAction, custom: number | null) {
  const carry = action === 'carry' ? remaining : action === 'lose' ? 0 : (custom ?? 0);
  return { carry, forfeit: remaining - carry };
}

// ── CBA allotment rule (preload for a year's allotment)
//
// Service is measured on Jan 1 of the target year.
//   Vacation — starts after the 60-day probation. In the year probation
//              ends it's pro-rated: 80h × days left in that year (from the
//              day after probation) ÷ days in the year, rounded to the hour.
//              After that: <3 yrs 80h, 3–<8 yrs 120h, 8–<18 yrs 160h,
//              18+ yrs 200h (weeks × 40h).
//   Sick     — days by service (<3 mo 0, 3–<6 mo 2, 6–<9 mo 3, 9–<12 mo 4,
//              1 yr+ 8) × the engineer's daily hours.
//   Floating holiday — not in the schedule: keeps the prior year's
//              allotment (even 0), else 1 day when there's no prior row.
// It's a starting point; the manager can edit every number before saving.

export const PROBATION_DAYS = 60;

export type CbaAllotment = {
  vacation: number;
  sick: number;
  holiday: number;
  /** Human-readable basis, e.g. "4.2 yrs on 1/1/2027 → 3–<8 yrs". */
  basis: string;
};

export function cbaAllotment(
  hireIso: string | null | undefined,
  year: number,
  dailyHours: number,
  prevHoliday?: number | null,
): CbaAllotment | null {
  if (!hireIso) return null;
  const hire = new Date(hireIso + 'T00:00:00');
  if (Number.isNaN(hire.getTime())) return null;
  const asOf = new Date(year, 0, 1);
  let months = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());
  if (asOf.getDate() < hire.getDate()) months -= 1;
  months = Math.max(0, months);

  // Probation: 60 days from hire. Day math in UTC so DST can't shift it.
  const DAY = 86_400_000;
  const hireUtc   = Date.UTC(hire.getFullYear(), hire.getMonth(), hire.getDate());
  const probEnd   = hireUtc + PROBATION_DAYS * DAY;          // first day vacation accrues
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd   = Date.UTC(year, 11, 31);
  const daysInYear = Math.round((yearEnd - yearStart) / DAY) + 1;
  const fmtUtc = (t: number) => {
    const d = new Date(t);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
  };

  let proRated: [number, string] | null = null;
  if (probEnd > yearEnd) {
    proRated = [0, `in probation until ${fmtUtc(probEnd)}`];
  } else if (probEnd > yearStart) {
    const days = Math.round((yearEnd - probEnd) / DAY) + 1;
    proRated = [
      Math.round((80 * days) / daysInYear),
      `first year, pro-rated from ${fmtUtc(probEnd)}: 80h × ${days}/${daysInYear} days`,
    ];
  }

  const [vacation, vacTier] =
    proRated          ? proRated
    : months < 36     ? [80,  '<3 yrs']
    : months < 96     ? [120, '3–<8 yrs']
    : months < 216    ? [160, '8–<18 yrs']
    :                   [200, '18+ yrs'];
  const sickDays =
    months < 3  ? 0
    : months < 6  ? 2
    : months < 9  ? 3
    : months < 12 ? 4
    :               8;
  const holiday = prevHoliday != null ? prevHoliday : dailyHours;
  const svc = months < 12 ? `${months} mo` : `${(months / 12).toFixed(1)} yrs`;
  return {
    vacation,
    sick: sickDays * dailyHours,
    holiday,
    basis: `${svc} on 1/1/${year} → vacation ${vacTier}, sick ${sickDays} days × ${dailyHours}h`,
  };
}
