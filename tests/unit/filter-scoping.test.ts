import { describe, expect, it } from 'vitest';
import { buildQuery, unscopeCategory, SHOP_PATH } from '@/features/catalog/filters';
import type { ProductFilters } from '@/features/catalog/types';

/**
 * The category page's filter links, which were broken by a category living in two kinds of URL.
 *
 * `/shop/[category]` scopes the listing by **path** and expresses that by injecting the slug into the
 * filters object. `buildQuery` serialises filters into a **query string** and cannot touch the path,
 * so the two disagreed and produced three symptoms from one cause:
 *
 *   · removing the category rebuilt the URL it was already on, so the chip did nothing;
 *   · removing anything else re-emitted `?category=<slug>` beside the path segment;
 *   · "clear filters" pointed at the scoped path and so could not clear the category.
 *
 * Asserted as strings because the bug was only ever visible as one: every href looked plausible in
 * isolation, and it took putting the current URL next to the chip's href to see they were equal.
 */
const SCOPED = 'vitaminat';

/** What `/shop/[category]` builds: query filters plus the slug forced in from the path. */
const onCategoryPage = (extra: Partial<ProductFilters> = {}): ProductFilters => ({
  category: [SCOPED],
  page: 1,
  ...extra,
});

describe('unscopeCategory', () => {
  it('drops the path-scoped slug so it cannot reach the query string', () => {
    expect(unscopeCategory(onCategoryPage(), SCOPED).category).toBeUndefined();
  });

  it('keeps categories that really are query state', () => {
    const filters = onCategoryPage({ category: [SCOPED, 'mineralet'] });
    expect(unscopeCategory(filters, SCOPED).category).toEqual(['mineralet']);
  });

  it('is a no-op on the unscoped shop, where the category is query state', () => {
    const filters: ProductFilters = { category: [SCOPED], page: 1 };
    expect(unscopeCategory(filters, undefined)).toBe(filters);
  });
});

describe('links on a scoped category page', () => {
  const filters = onCategoryPage({ brand: ['now-foods'] });
  const queryFilters = unscopeCategory(filters, SCOPED);
  const basePath = `/shop/${SCOPED}`;

  it('removing the category leaves the page, keeping the other filters', () => {
    // The bug: this used to be `/shop/vitaminat?brand=now-foods` — the URL it was already on.
    const href = `${SHOP_PATH}${buildQuery(queryFilters, {})}`;
    expect(href).toBe('/shop?brand=now-foods');
    expect(href).not.toBe(`${basePath}?brand=now-foods`);
  });

  it('removing the brand stays on the category page without duplicating the category', () => {
    // The second symptom: this used to be `/shop/vitaminat?category=vitaminat`.
    const href = `${basePath}${buildQuery(queryFilters, { toggle: { key: 'brand', value: 'now-foods' } })}`;
    expect(href).toBe('/shop/vitaminat');
  });

  it('keeps the category out of sort and pagination links', () => {
    expect(`${basePath}${buildQuery(queryFilters, { sort: 'price_asc' })}`).toBe(
      '/shop/vitaminat?brand=now-foods&sort=price_asc',
    );
    expect(`${basePath}${buildQuery(queryFilters, { page: 2 })}`).toBe(
      '/shop/vitaminat?brand=now-foods&page=2',
    );
  });

  it('clears everything to the unscoped shop', () => {
    expect(SCOPED ? SHOP_PATH : basePath).toBe('/shop');
  });
});

describe('links on the unscoped shop are unaffected', () => {
  it('still removes a category through the query', () => {
    const filters: ProductFilters = { category: [SCOPED], page: 1 };
    const queryFilters = unscopeCategory(filters, undefined);
    expect(
      `${SHOP_PATH}${buildQuery(queryFilters, { toggle: { key: 'category', value: SCOPED } })}`,
    ).toBe('/shop');
  });

  it('still removes one of two categories', () => {
    const filters: ProductFilters = { category: [SCOPED, 'mineralet'], page: 1 };
    expect(
      `${SHOP_PATH}${buildQuery(filters, { toggle: { key: 'category', value: SCOPED } })}`,
    ).toBe('/shop?category=mineralet');
  });
});
