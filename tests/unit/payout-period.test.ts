import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  isPayoutRunDay,
  periodContaining,
  periodToSettle,
} from '@/features/merchants/payout-period';

/**
 * docs/16 §8 — which fortnight a payout run settles.
 *
 * Every function takes the date it should treat as "today", which is the whole reason this can be
 * tested: a period calculation that read `new Date()` internally could only be exercised on whatever
 * day the suite happened to run, and the boundary is the only interesting part.
 *
 * The cycle is **calendar halves**, not "every 14 days". A rolling fortnight drifts until statements
 * straddle month ends, and a merchant reconciling against its own books works in months.
 */

function utc(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

describe('periodToSettle', () => {
  it('a run on the 16th settles the first half of the same month', () => {
    expect(periodToSettle(utc('2026-08-16'))).toEqual({ start: '2026-08-01', end: '2026-08-15' });
  });

  it('a run on the 1st settles the second half of the previous month', () => {
    expect(periodToSettle(utc('2026-08-01'))).toEqual({ start: '2026-07-16', end: '2026-07-31' });
  });

  /** February, so the month length is read rather than assumed. */
  it('handles a short month', () => {
    expect(periodToSettle(utc('2026-03-01'))).toEqual({ start: '2026-02-16', end: '2026-02-28' });
  });

  it('handles a leap February', () => {
    expect(periodToSettle(utc('2028-03-01'))).toEqual({ start: '2028-02-16', end: '2028-02-29' });
  });

  /** A 30-day month, which is the other end a hard-coded 31 would have got wrong. */
  it('handles a thirty-day month', () => {
    expect(periodToSettle(utc('2026-05-01'))).toEqual({ start: '2026-04-16', end: '2026-04-30' });
  });

  it('crosses the year boundary', () => {
    expect(periodToSettle(utc('2027-01-01'))).toEqual({ start: '2026-12-16', end: '2026-12-31' });
  });

  /**
   * Defined for every date, not only the two run days.
   *
   * A run that was missed or is being repeated by hand settles the fortnight that most recently closed,
   * rather than refusing — and it produces the same answer the scheduled run would have, so a late run
   * does not shift every period after it.
   */
  it('a late run settles the same period the scheduled one would have', () => {
    const scheduled = periodToSettle(utc('2026-08-16'));
    expect(periodToSettle(utc('2026-08-20'))).toEqual(scheduled);
    expect(periodToSettle(utc('2026-08-31'))).toEqual(scheduled);
  });

  it('an early-month run settles the same period however late in that window it runs', () => {
    const scheduled = periodToSettle(utc('2026-08-01'));
    expect(periodToSettle(utc('2026-08-15'))).toEqual(scheduled);
  });

  /** The two windows must tile the calendar with no gap and no overlap. */
  it('consecutive runs leave no day unsettled', () => {
    const first = periodToSettle(utc('2026-08-16'));
    const second = periodToSettle(utc('2026-09-01'));

    expect(first.end).toBe('2026-08-15');
    expect(second.start).toBe('2026-08-16');
  });
});

describe('isPayoutRunDay', () => {
  it('is true on the 1st and the 16th and nowhere else', () => {
    expect(isPayoutRunDay(utc('2026-08-01'))).toBe(true);
    expect(isPayoutRunDay(utc('2026-08-16'))).toBe(true);

    for (const day of ['2026-08-02', '2026-08-15', '2026-08-17', '2026-08-31']) {
      expect(isPayoutRunDay(utc(day)), `${day} must not be a run day`).toBe(false);
    }
  });
});

describe('periodContaining', () => {
  it('puts a date in the half it falls in', () => {
    expect(periodContaining(utc('2026-08-07'))).toEqual({ start: '2026-08-01', end: '2026-08-15' });
    expect(periodContaining(utc('2026-08-20'))).toEqual({ start: '2026-08-16', end: '2026-08-31' });
  });

  /** The 15th and the 16th are the boundary, and they belong to different periods. */
  it('splits at the 15th and 16th', () => {
    expect(periodContaining(utc('2026-08-15')).end).toBe('2026-08-15');
    expect(periodContaining(utc('2026-08-16')).start).toBe('2026-08-16');
  });
});

describe('daysInMonth', () => {
  it('knows the month lengths, including February', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  /** A century that is not a leap year, which the naive `year % 4` rule gets wrong. */
  it('gets 2100 right', () => {
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});
