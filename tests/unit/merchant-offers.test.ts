import { describe, expect, it } from 'vitest';
import {
  offerCreateSchema,
  offerDecisionSchema,
  offerUpdateSchema,
} from '@/features/merchants/offer-schemas';
import { offerErrorLeaf, settingsErrorLeaf } from '@/features/merchants/error-keys';

/**
 * docs/16 §5 — the offer schema, which is where a merchant's typing becomes cents.
 *
 * The price is the field worth testing hardest: it is entered in euro and stored in integer cents, and
 * a conversion that is wrong by a factor of a hundred is the kind of bug that looks like a
 * commercial dispute rather than a defect.
 */

const VARIANT = '11111111-1111-4111-8111-111111111111';
const OFFER = '22222222-2222-4222-8222-222222222222';

function creation(over: Record<string, string> = {}): Record<string, string> {
  return {
    variantId: VARIANT,
    priceEuro: '12.50',
    stockOnHand: '10',
    lowStockThreshold: '3',
    handlingDays: '1',
    ...over,
  };
}

describe('the asking price', () => {
  it('converts euro to integer cents', () => {
    const result = offerCreateSchema.safeParse(creation({ priceEuro: '12.50' }));
    expect(result.success && result.data.priceEuro).toBe(1250);
  });

  /** A comma is how the number is written in Albanian, and a form that refuses it is broken. */
  it('accepts a comma as the decimal separator', () => {
    const result = offerCreateSchema.safeParse(creation({ priceEuro: '12,50' }));
    expect(result.success && result.data.priceEuro).toBe(1250);
  });

  it('rounds to the nearest cent rather than truncating', () => {
    // 12.555 € is 1255.5 cents. Truncating would quietly favour one side of every such price.
    const result = offerCreateSchema.safeParse(creation({ priceEuro: '12.555' }));
    expect(result.success && result.data.priceEuro).toBe(1256);
  });

  it('handles a whole number with no separator', () => {
    const result = offerCreateSchema.safeParse(creation({ priceEuro: '9' }));
    expect(result.success && result.data.priceEuro).toBe(900);
  });

  /**
   * `Number('')` is 0 and `Number('abc')` is NaN, and both are of type number — so `positive()` alone
   * would let one of them through. This is the assertion that keeps the finite check in the schema.
   */
  it('refuses a price that is not a number', () => {
    expect(offerCreateSchema.safeParse(creation({ priceEuro: 'abc' })).success).toBe(false);
  });

  it('refuses an empty price', () => {
    expect(offerCreateSchema.safeParse(creation({ priceEuro: '' })).success).toBe(false);
  });

  it('refuses zero and negatives — an offer at no price is not an offer', () => {
    expect(offerCreateSchema.safeParse(creation({ priceEuro: '0' })).success).toBe(false);
    expect(offerCreateSchema.safeParse(creation({ priceEuro: '-5' })).success).toBe(false);
  });
});

describe('stock and handling', () => {
  /** Zero stock is valid and meaningful: it is how a merchant says "sold out" without pausing. */
  it('accepts zero stock', () => {
    const result = offerCreateSchema.safeParse(creation({ stockOnHand: '0' }));
    expect(result.success && result.data.stockOnHand).toBe(0);
  });

  it('refuses negative stock', () => {
    expect(offerCreateSchema.safeParse(creation({ stockOnHand: '-1' })).success).toBe(false);
  });

  it('refuses a fractional unit count', () => {
    expect(offerCreateSchema.safeParse(creation({ stockOnHand: '2.5' })).success).toBe(false);
  });

  /** Same-day handling is a real answer, so zero days must pass. */
  it('accepts zero handling days', () => {
    const result = offerCreateSchema.safeParse(creation({ handlingDays: '0' }));
    expect(result.success && result.data.handlingDays).toBe(0);
  });

  /**
   * The schema's cap is the column's (30). The *marketplace* cap is a setting and is enforced in the
   * action — a schema that hard-coded 3 would need a deploy to change a commercial policy.
   */
  it('refuses more handling days than the column allows', () => {
    expect(offerCreateSchema.safeParse(creation({ handlingDays: '31' })).success).toBe(false);
    expect(offerCreateSchema.safeParse(creation({ handlingDays: '30' })).success).toBe(true);
  });
});

describe('what the form may and may not say', () => {
  /**
   * `submitNow` is a checkbox, and the action turns it into a status. The schema has no `status` field
   * at all, which is the point: a form that can express a status is a form somebody can post
   * `approved` through.
   */
  it('has no status field to post', () => {
    const result = offerCreateSchema.safeParse(creation({ status: 'approved' }));
    expect(result.success).toBe(true);
    expect(result.success && 'status' in result.data).toBe(false);
  });

  it('treats a missing submitNow as "save as draft"', () => {
    const result = offerCreateSchema.safeParse(creation());
    expect(result.success && result.data.submitNow).toBeUndefined();
  });

  it('reads a ticked submitNow', () => {
    const result = offerCreateSchema.safeParse(creation({ submitNow: 'on' }));
    expect(result.success && result.data.submitNow).toBe('on');
  });

  /** The variant is fixed after creation, so the update schema must not carry one. */
  it('the update schema cannot move an offer to a different variant', () => {
    const result = offerUpdateSchema.safeParse({
      offerId: OFFER,
      variantId: VARIANT,
      priceEuro: '10',
      stockOnHand: '1',
      lowStockThreshold: '1',
      handlingDays: '1',
    });
    expect(result.success && 'variantId' in result.data).toBe(false);
  });

  it('an update needs an offer id', () => {
    const result = offerUpdateSchema.safeParse({
      priceEuro: '10',
      stockOnHand: '1',
      lowStockThreshold: '1',
      handlingDays: '1',
    });
    expect(result.success).toBe(false);
  });
});

describe('the reviewer’s decision schema', () => {
  it('accepts an approval with no note', () => {
    expect(offerDecisionSchema.safeParse({ offerId: OFFER, decision: 'approve' }).success).toBe(true);
  });

  it('refuses a decision that is neither approve nor reject', () => {
    expect(offerDecisionSchema.safeParse({ offerId: OFFER, decision: 'pause' }).success).toBe(false);
  });
});

describe('error keys', () => {
  /**
   * The actions return full keys so any caller can render one with a bare `t()`; the portal components
   * are scoped and need the leaf. Narrowing to a literal union is what makes a missing message a build
   * error instead of a raw key shown to a merchant.
   */
  it('takes the leaf of a namespaced key', () => {
    expect(offerErrorLeaf('merchant.offers.errors.locked')).toBe('locked');
    expect(offerErrorLeaf('merchant.offers.errors.handlingTooLong')).toBe('handlingTooLong');
  });

  it('falls back to generic for a key it does not own', () => {
    // `admin.errors.forbidden` cannot reach a merchant-side component, but a crash would be worse.
    expect(offerErrorLeaf('admin.errors.forbidden')).toBe('generic');
    expect(offerErrorLeaf('')).toBe('generic');
  });

  it('the settings union is narrower and rejects offer-only keys', () => {
    expect(settingsErrorLeaf('merchant.settings.errors.locked')).toBe('locked');
    expect(settingsErrorLeaf('merchant.offers.errors.duplicate')).toBe('generic');
  });
});
