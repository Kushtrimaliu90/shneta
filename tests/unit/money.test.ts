import { describe, expect, it } from 'vitest';
import {
  amountToFreeShipping,
  computeTotals,
  CURRENCY_NBSP as NB,
  discountCents,
  formatPrice,
  fromCents,
  percentOff,
  shippingCents,
  subtotalCents,
  taxCents,
  toCents,
} from '@/lib/money';

describe('formatPrice', () => {
  it('renders the sq format from docs/04 §4', () => {
    expect(formatPrice(990, 'sq')).toBe(`9,90${NB}€`);
    expect(formatPrice(0, 'sq')).toBe(`0,00${NB}€`);
    expect(formatPrice(5, 'sq')).toBe(`0,05${NB}€`);
    expect(formatPrice(123456, 'sq')).toBe(`1.234,56${NB}€`);
    expect(formatPrice(100000000, 'sq')).toBe(`1.000.000,00${NB}€`);
  });

  it('separates the amount from the symbol with a non-breaking space', () => {
    expect(NB).toBe(' ');
    expect(formatPrice(990, 'sq')).not.toContain(' ');
  });

  it('renders the en format from docs/04 §4', () => {
    expect(formatPrice(990, 'en')).toBe('€9.90');
    expect(formatPrice(123456, 'en')).toBe('€1,234.56');
    expect(formatPrice(100000000, 'en')).toBe('€1,000,000.00');
  });

  it('keeps refunds readable', () => {
    expect(formatPrice(-1550, 'sq')).toBe(`-15,50${NB}€`);
    expect(formatPrice(-1550, 'en')).toBe('€-15.50');
  });
});

describe('toCents / fromCents', () => {
  it('round-trips admin euro input without float drift', () => {
    expect(toCents('18.50')).toBe(1850);
    expect(toCents('18,50')).toBe(1850);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('7')).toBe(700);
    expect(toCents(34.9)).toBe(3490);
    // The classic float trap: 0.1 + 0.2 style inputs must not lose a cent.
    expect(toCents('1.15')).toBe(115);
    expect(toCents('29.99')).toBe(2999);
    expect(fromCents(1850)).toBe('18.50');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(-1850)).toBe('-18.50');
  });

  it('rejects anything that is not a euro amount', () => {
    expect(() => toCents('18.505')).toThrow(RangeError);
    expect(() => toCents('abc')).toThrow(RangeError);
    expect(() => toCents('')).toThrow(RangeError);
  });
});

describe('totals algorithm — parity with checkout_create_order (docs/07 §2)', () => {
  const standard = { priceCents: 200, freeOverCents: 3000 };
  const express = { priceCents: 400, freeOverCents: null };

  it('sums the subtotal from line prices', () => {
    expect(
      subtotalCents([
        { unitPriceCents: 990, quantity: 2 },
        { unitPriceCents: 1850, quantity: 1 },
      ]),
    ).toBe(3830);
    expect(subtotalCents([])).toBe(0);
  });

  it('floors percentage discounts exactly as integer division does', () => {
    // 1499 × 10 / 100 = 149.9 → Postgres integer division truncates to 149.
    expect(discountCents(1499, { type: 'percentage', value: 10 })).toBe(149);
    expect(discountCents(1000, { type: 'percentage', value: 10 })).toBe(100);
    expect(discountCents(333, { type: 'percentage', value: 33 })).toBe(109);
  });

  it('clamps fixed discounts to the subtotal', () => {
    expect(discountCents(1000, { type: 'fixed', value: 500 })).toBe(500);
    expect(discountCents(300, { type: 'fixed', value: 500 })).toBe(300);
  });

  it('treats free_shipping as zero discount', () => {
    expect(discountCents(5000, { type: 'free_shipping', value: 0 })).toBe(0);
  });

  it('tests the free-over threshold against subtotal minus discount', () => {
    // Exactly on the threshold ships free.
    expect(shippingCents(3000, 0, standard)).toBe(0);
    // A discount that drops the net below the threshold reinstates the fee.
    expect(shippingCents(3200, 500, standard)).toBe(200);
    expect(shippingCents(9999, 0, express)).toBe(400);
  });

  it('zeroes shipping for a free_shipping coupon regardless of threshold', () => {
    expect(shippingCents(500, 0, express, { type: 'free_shipping', value: 0 })).toBe(0);
  });

  it('ignores a coupon whose minimum subtotal is not met', () => {
    const totals = computeTotals({
      lines: [{ unitPriceCents: 1000, quantity: 1 }],
      coupon: { type: 'percentage', value: 10, minSubtotalCents: 1500 },
      shippingMethod: standard,
    });
    expect(totals.discountCents).toBe(0);
    expect(totals.totalCents).toBe(1200);
  });

  it('produces the full five figures the order row stores', () => {
    const totals = computeTotals({
      lines: [
        { unitPriceCents: 990, quantity: 2 },
        { unitPriceCents: 1850, quantity: 1 },
      ],
      coupon: { type: 'percentage', value: 10, minSubtotalCents: 1500 },
      shippingMethod: standard,
    });

    expect(totals.subtotalCents).toBe(3830);
    expect(totals.discountCents).toBe(383);
    // 3830 − 383 = 3447 ≥ 3000, so delivery is free.
    expect(totals.shippingCents).toBe(0);
    expect(totals.totalCents).toBe(3447);
    expect(totals.taxCents).toBe(526);
  });
});

describe('taxCents — VAT extracted from a VAT-inclusive total', () => {
  it('matches round(total × rate / (100 + rate)) half-up', () => {
    expect(taxCents(1000, 18)).toBe(153); // 152.542… → 153
    expect(taxCents(118, 18)).toBe(18); // exact
    expect(taxCents(0, 18)).toBe(0);
    expect(taxCents(3447, 18)).toBe(526); // 525.86… → 526
  });

  it('rounds a genuine .5 boundary up rather than to-even', () => {
    // total × 20 / 120 = 4.5 exactly when total = 27.
    expect(taxCents(27, 20)).toBe(5);
    // total × 100 / 200 = 12.5 exactly when total = 25.
    expect(taxCents(25, 100)).toBe(13);
  });

  it('handles a fractional rate without float drift', () => {
    expect(taxCents(10000, 8.5)).toBe(783); // 783.41… → 783
  });

  it('defaults to the 18% rate from settings', () => {
    expect(taxCents(1000)).toBe(taxCents(1000, 18));
  });
});

describe('display helpers', () => {
  it('computes the sale badge percentage', () => {
    expect(percentOff(6990, 7990)).toBe(13);
    expect(percentOff(2990, 3670)).toBe(19);
  });

  it('returns null when there is no genuine markdown', () => {
    expect(percentOff(1000, null)).toBeNull();
    expect(percentOff(1000, 1000)).toBeNull();
    expect(percentOff(1000, 900)).toBeNull();
  });

  it('reports the gap to free delivery', () => {
    expect(amountToFreeShipping(2500, 3000)).toBe(500);
    expect(amountToFreeShipping(3000, 3000)).toBe(0);
    expect(amountToFreeShipping(3500, 3000)).toBe(0);
    expect(amountToFreeShipping(100, null)).toBe(0);
  });
});
