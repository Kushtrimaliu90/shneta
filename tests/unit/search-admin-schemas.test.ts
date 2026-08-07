import { describe, expect, it } from 'vitest';
import {
  searchRedirectSchema,
  searchRuleSchema,
  synonymGroupSchema,
} from '@/features/search/admin-schemas';

/**
 * The search console's validation.
 *
 * These schemas mirror `check` constraints in migrations 66. Testing them here rather than trusting the
 * database is the difference between an operator seeing "A boost needs a positive weight" under the field
 * and seeing a raw constraint name in a red box.
 */

const UUID = '00000000-0000-4000-8000-000000000001';

function rule(overrides: Record<string, unknown> = {}) {
  return searchRuleSchema.safeParse({
    action: 'boost',
    productId: UUID,
    matchType: 'exact',
    query: 'proteina',
    weight: 2,
    ...overrides,
  });
}

describe('synonymGroupSchema', () => {
  it('splits terms on newlines and commas, lower-cased', () => {
    const parsed = synonymGroupSchema.safeParse({
      label: 'Magnesium',
      terms: 'Magnez\nMAGNESIUM, magnezium ',
      isActive: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.terms).toEqual(['magnez', 'magnesium', 'magnezium']);
  });

  it('rejects a group of one — a synonym needs something to be synonymous with', () => {
    expect(synonymGroupSchema.safeParse({ label: 'Solo', terms: 'magnez' }).success).toBe(false);
  });

  it('rejects duplicate terms', () => {
    expect(
      synonymGroupSchema.safeParse({ label: 'Dupe', terms: 'magnez\nmagnez' }).success,
    ).toBe(false);
  });

  it('drops blank lines rather than turning them into empty terms', () => {
    const parsed = synonymGroupSchema.safeParse({ label: 'Zinc', terms: 'zink\n\n\nzinc\n' });
    expect(parsed.success && parsed.data.terms).toEqual(['zink', 'zinc']);
  });
});

describe('searchRuleSchema', () => {
  it('accepts a well-formed boost', () => {
    expect(rule().success).toBe(true);
  });

  it('requires a positive weight for a boost and a negative one for a bury', () => {
    expect(rule({ action: 'boost', weight: -2 }).success).toBe(false);
    expect(rule({ action: 'bury', weight: 2 }).success).toBe(false);
    expect(rule({ action: 'bury', weight: -2 }).success).toBe(true);
  });

  it('rejects a zero weight, which is a rule that looks active and does nothing', () => {
    expect(rule({ action: 'boost', weight: 0 }).success).toBe(false);
  });

  it('requires a position for a pin', () => {
    expect(rule({ action: 'pin', weight: undefined }).success).toBe(false);
    expect(rule({ action: 'pin', weight: undefined, pinPosition: 1 }).success).toBe(true);
  });

  it('requires a query unless the rule applies to every search', () => {
    expect(rule({ query: '' }).success).toBe(false);
    expect(rule({ matchType: 'any', query: '' }).success).toBe(true);
  });

  it('rejects a query on an “any” rule, which would read as though it were scoped', () => {
    expect(rule({ matchType: 'any', query: 'proteina' }).success).toBe(false);
  });

  it('allows hide with no weight and no position', () => {
    expect(rule({ action: 'hide', weight: undefined }).success).toBe(true);
  });
});

describe('searchRedirectSchema', () => {
  function redirect(destinationPath: string) {
    return searchRedirectSchema.safeParse({
      query: 'transporti',
      matchType: 'contains',
      destinationPath,
    });
  }

  it('accepts a site path', () => {
    expect(redirect('/legal/shipping-returns').success).toBe(true);
    expect(redirect('/shop?category=vitamina').success).toBe(true);
  });

  /*
   * The open-redirect guard. This field is a free-text box three staff roles can edit and its value is
   * handed straight to `redirect()`, so anything that leaves the origin is a phishing hop with our domain
   * in the address bar. Protocol-relative `//evil.com` is the one people forget — it has a leading slash
   * and is still off-site.
   */
  it('refuses anything that leaves the site', () => {
    expect(redirect('https://evil.example/phish').success).toBe(false);
    expect(redirect('//evil.example/phish').success).toBe(false);
    expect(redirect('javascript:alert(1)').success).toBe(false);
    expect(redirect('legal/terms').success).toBe(false);
  });
});
