/**
 * docs/16 §8 — which fortnight a payout run settles.
 *
 * Pure and dependency-free so it can be unit-tested without a database or a clock: every function
 * takes the date it should treat as "today". A period calculation that reads `new Date()` internally is
 * a period calculation nobody can test on the boundary, and the boundary is the only interesting part.
 *
 * ── The cycle ──
 *
 * Two runs a month, on the **1st and the 16th**, each settling the fortnight that just ended:
 *
 *   · a run on the 1st  settles the 16th → the last day of the previous month;
 *   · a run on the 16th settles the 1st → the 15th of the current month.
 *
 * Calendar halves rather than "every 14 days", because a merchant reconciling against its own books
 * works in months, and a rolling fortnight drifts until statements straddle month ends. It also means
 * the answer depends only on the date, never on when the last run happened — so a missed run is caught
 * up by running it late with the same result, rather than shifting every period after it.
 */

export interface PayoutPeriod {
  /** Inclusive, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive, `YYYY-MM-DD`. */
  end: string;
}

function iso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Days in a month, so February and the 31sts are not special cases anywhere else. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The period a run on `today` should settle.
 *
 * Defined for **every** date, not only the 1st and the 16th, so a run that was missed or is being
 * repeated by hand settles the fortnight that most recently closed rather than refusing. A run on the
 * 20th settles the 1st–15th, which is exactly what the run on the 16th would have done.
 */
export function periodToSettle(today: Date): PayoutPeriod {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();

  if (day >= 16) {
    return { start: iso(year, month, 1), end: iso(year, month, 15) };
  }

  // Before the 16th: the second half of the previous month.
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return {
    start: iso(previousYear, previousMonth, 16),
    end: iso(previousYear, previousMonth, daysInMonth(previousYear, previousMonth)),
  };
}

/**
 * True on the two days of the month the cron should act.
 *
 * The cron itself runs daily — one schedule is easier to reason about than two, and Vercel's cron
 * granularity is a day anyway — so the decision of *whether* to run lives here where it can be tested.
 */
export function isPayoutRunDay(today: Date): boolean {
  const day = today.getUTCDate();
  return day === 1 || day === 16;
}

/** The period a date falls in, for labelling a statement the other way round. */
export function periodContaining(date: Date): PayoutPeriod {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  return day <= 15
    ? { start: iso(year, month, 1), end: iso(year, month, 15) }
    : { start: iso(year, month, 16), end: iso(year, month, daysInMonth(year, month)) };
}
