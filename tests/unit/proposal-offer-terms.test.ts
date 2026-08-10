import { describe, expect, it } from 'vitest';
import { proposalOfferSchema } from '@/features/merchants/proposal-schemas';

/**
 * The offer terms a proposal now carries, so approval can mint the offer.
 *
 * A proposal already asked for stock and an asking price — two of the five things `merchant_offers`
 * needs. The other three were re-typed into the offer form *after* approval, which for a 200-row batch
 * was 200 forms for a decision the merchant had already made (owner, 2026-08-10).
 *
 * The bounds are asserted here because they are the same bounds as the table's CHECK constraints, and a
 * term that could never become an offer must be refused where the merchant can still fix it — not
 * months later inside a cron, where the only record is `offer_error`.
 */
const base = {
  productName: 'Alpha Magnesium Glycinate',
  brandName: 'Alpha Labs',
  stockOnHand: 12,
  askingPriceEuro: '14,90',
  note: 'We hold twelve units and the box lists every excipient.',
};

const parse = (overrides: Record<string, unknown> = {}) =>
  proposalOfferSchema.safeParse({ ...base, ...overrides });

describe('offer terms on a proposal', () => {
  it('defaults to the same values as the offer table', () => {
    const result = parse();
    expect(result.success).toBe(true);
    // merchant_offers defaults low_stock_threshold 3 and handling_days 1.
    expect(result.success && result.data.lowStockThreshold).toBe(3);
    expect(result.success && result.data.handlingDays).toBe(1);
  });

  it('accepts the terms the merchant actually states', () => {
    const result = parse({ handlingDays: 3, lowStockThreshold: 5, merchantSku: 'ALPHA-MG-120' });
    expect(result.success && result.data.handlingDays).toBe(3);
    expect(result.success && result.data.lowStockThreshold).toBe(5);
    expect(result.success && result.data.merchantSku).toBe('ALPHA-MG-120');
  });

  it('refuses a handling promise the offer table would reject', () => {
    // merchant_offers_handling_days_check is 0..30, so 31 could never become an offer.
    expect(parse({ handlingDays: 31 }).success).toBe(false);
    expect(parse({ handlingDays: -1 }).success).toBe(false);
  });

  it('allows same-day dispatch', () => {
    expect(parse({ handlingDays: 0 }).success).toBe(true);
  });

  it('treats a blank SKU as absent rather than as an empty code', () => {
    const result = parse({ merchantSku: '' });
    expect(result.success).toBe(true);
    expect(result.success && (result.data.merchantSku || null)).toBeNull();
  });

  it('still requires a positive asking price, because the offer cannot exist without one', () => {
    // merchant_offers_price_cents_check is price_cents > 0. A zero here would reach
    // create_offer_from_proposal, fail its guard, and surface only as offer_error days later.
    expect(parse({ askingPriceEuro: '0' }).success).toBe(false);
  });

  it('converts euros to integer cents, comma or point', () => {
    expect(parse({ askingPriceEuro: '14,90' }).success && parse({ askingPriceEuro: '14,90' }).data)
      .toMatchObject({ askingPriceEuro: 1490 });
    expect(parse({ askingPriceEuro: '14.90' }).success && parse({ askingPriceEuro: '14.90' }).data)
      .toMatchObject({ askingPriceEuro: 1490 });
  });
});
