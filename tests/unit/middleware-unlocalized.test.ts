import { describe, expect, it } from 'vitest';
import { unlocalizedTarget } from '@/lib/route-locale';

/**
 * `/en/admin` returned a 404 while `/sq/admin` redirected to `/admin`.
 *
 * `/admin` and `/api` sit outside `[locale]` on purpose (docs/02 §4), so a locale-prefixed request for
 * one of them was rewritten to `[locale]/admin`, found nothing, and fell through to the catch-all.
 * Albanian escaped it only because `localePrefix: 'as-needed'` has next-intl strip the default locale
 * — so the same URL shape worked in one language and not the other (docs/13 §AX).
 */
describe('unlocalizedTarget', () => {
  it('sends /en/admin to /admin', () => {
    expect(unlocalizedTarget('/en/admin')).toBe('/admin');
  });

  it('keeps the rest of the path', () => {
    expect(unlocalizedTarget('/en/admin/products')).toBe('/admin/products');
    expect(unlocalizedTarget('/en/admin/orders/BIO-1042')).toBe('/admin/orders/BIO-1042');
  });

  it('covers /api, which had the identical hole', () => {
    expect(unlocalizedTarget('/en/api/health')).toBe('/api/health');
  });

  it('leaves an unprefixed path alone', () => {
    // Already correct — redirecting would be a loop.
    expect(unlocalizedTarget('/admin')).toBeNull();
    expect(unlocalizedTarget('/api/health')).toBeNull();
  });

  it('leaves localized storefront routes alone', () => {
    // These genuinely live under `[locale]`, and `/en/account` must stay in English.
    expect(unlocalizedTarget('/en/account')).toBeNull();
    expect(unlocalizedTarget('/en/shop')).toBeNull();
    expect(unlocalizedTarget('/en/merchant/apply')).toBeNull();
    expect(unlocalizedTarget('/en')).toBeNull();
    expect(unlocalizedTarget('/')).toBeNull();
  });

  it('does not match a route that merely starts with the same letters', () => {
    /*
     * Prefix matching has to be segment-aware. `/en/administrators` is a storefront path that happens
     * to begin with "admin", and rewriting it to `/administrators` would break a real page.
     */
    expect(unlocalizedTarget('/en/administrators')).toBeNull();
    expect(unlocalizedTarget('/en/apiary')).toBeNull();
  });

  it('ignores the default locale, which next-intl already strips', () => {
    // `/sq/admin` was never broken; as-needed prefixing redirects it to `/admin` on its own.
    expect(unlocalizedTarget('/sq/admin')).toBeNull();
  });
});
