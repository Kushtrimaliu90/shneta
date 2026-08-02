import { expect, test } from '@playwright/test';
import { ACTION_TIMEOUT, CHEAP_PRODUCT, addCheapItemToCart } from './helpers/storefront';

/**
 * docs/02 §5 and docs/13 §M1 — the storefront is served from files, not re-rendered per request.
 *
 * This is the regression guard for the defect that survived from M4 to M11 unnoticed. It went
 * unnoticed because **the build output lied**: it printed `● (SSG)` and listed prerendered paths
 * for pages that were in fact dynamic, so the only honest signal was the response header. So that
 * is what this asserts.
 *
 * One `cookies()` call in a layout component is all it takes to undo this, and the cost lands on
 * every catalogue page at once. A test is the only thing that will notice.
 */
test.describe('static rendering (docs/13 §M1)', () => {
  /**
   * Pages that must be prerendered.
   *
   * Deliberately not the whole storefront: anything that reads `searchParams` is dynamic by
   * definition, which is correct for a page with filters. `/shop`, `/shop/[category]`,
   * `/goals/[slug]` and `/knowledge` are all in that group and are excluded on purpose — see the
   * note in docs/13 §Q1 rather than assuming they were forgotten.
   */
  const STATIC_PAGES = [
    '/en',
    '/',
    CHEAP_PRODUCT,
    '/en/brands',
    '/en/ingredients',
    '/en/offers',
    '/en/faq',
    '/en/legal/terms',
  ];

  for (const path of STATIC_PAGES) {
    test(`${path} is served from the route cache`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);

      const cacheControl = response.headers()['cache-control'] ?? '';

      /*
       * `no-store` is the fingerprint of a dynamically rendered page. Asserting its absence
       * rather than asserting `x-nextjs-cache: HIT` because the very first request after a deploy
       * is a MISS that populates the cache — the header varies, the dynamic marker does not.
       */
      expect(
        cacheControl,
        `${path} is being rendered per request — something in its tree reads cookies(), headers() or searchParams`,
      ).not.toContain('no-store');
      expect(cacheControl).toContain('s-maxage');
    });
  }

  /** The other half: pages that must NOT be cached, because they are per-visitor. */
  const DYNAMIC_PAGES = ['/en/cart', '/en/account/orders'];

  for (const path of DYNAMIC_PAGES) {
    test(`${path} is never cached`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      const cacheControl = response.headers()['cache-control'] ?? '';

      // A redirect to sign-in is a valid answer for an account page and carries no cache header.
      if (response.status() >= 300 && response.status() < 400) return;

      expect(cacheControl, `${path} must not be shared between visitors`).toContain('no-store');
    });
  }
});

test.describe('the cart badge (docs/13 §M1)', () => {
  test('loads after mount and follows the cart', async ({ page }) => {
    /*
     * The badge is why the storefront stopped being static, and moving it to the client is what
     * fixed that — so it has to keep working. The count is fetched after mount rather than
     * rendered by the server, which is exactly the kind of change that silently stops updating.
     */
    await page.goto('/en');

    const cartLink = page.getByRole('link', { name: /^Cart/ });
    await expect(cartLink).toBeVisible();

    await addCheapItemToCart(page);

    // Same page, no navigation: the badge learns from the cart-changed event.
    await expect(cartLink).toHaveAttribute('aria-label', /1 item/, { timeout: ACTION_TIMEOUT });

    // And it survives a navigation to a statically served page.
    await page.goto('/en/brands');
    await expect(page.getByRole('link', { name: /^Cart/ })).toHaveAttribute(
      'aria-label',
      /1 item/,
      { timeout: ACTION_TIMEOUT },
    );
  });
});
