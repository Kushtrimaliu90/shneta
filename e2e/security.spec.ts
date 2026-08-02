import { expect, test } from '@playwright/test';
import { deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

const ips = ipAllocator('233.252.7');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

/**
 * docs/09 §5 — the half of the security pass that needs HTTP rather than SQL.
 *
 * The RLS matrix (`tests/integration/rls.test.ts`) and the attack suite
 * (`tests/integration/security.test.ts`) cover the database. This covers the edge: what an
 * unauthenticated request gets from each protected surface, and what the browser is told about
 * what it may execute.
 */

test.describe('protected surfaces refuse an unauthenticated caller', () => {
  /**
   * Every admin route, not a sample.
   *
   * A sample is how one page ships without its capability check — the layout guard is easy to
   * rely on and easy to bypass by adding a route outside it. The list is the sidebar's own
   * `IMPLEMENTED` set, so a new admin page that forgets its guard fails here.
   */
  const ADMIN_ROUTES = [
    '/admin',
    '/admin/orders',
    '/admin/products',
    '/admin/categories',
    '/admin/brands',
    '/admin/ingredients',
    '/admin/goals',
    '/admin/compliance',
    '/admin/reviews',
    '/admin/messages',
    '/admin/subscriptions',
    '/admin/inventory',
    '/admin/movements',
    '/admin/customers',
    '/admin/coupons',
    '/admin/settings',
    '/admin/settings/shipping',
    '/admin/settings/team',
    '/admin/settings/audit',
    '/admin/content',
    '/admin/content/pages',
    '/admin/content/faqs',
    '/admin/content/banners',
  ];

  for (const route of ADMIN_ROUTES) {
    test(`${route} redirects a signed-out visitor`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });

      expect(
        response.status(),
        `${route} answered ${response.status()} to a signed-out request`,
      ).toBeGreaterThanOrEqual(300);
      expect(response.status()).toBeLessThan(400);

      const location = response.headers()['location'] ?? '';
      expect(location, `${route} redirected somewhere other than sign-in`).toContain('/auth/sign-in');
    });
  }

  test('the customer data export refuses a signed-in customer', async ({ page }) => {
    /*
     * Signed **in**, deliberately. The middleware only proves that *someone* has a session — it
     * says so in `middleware.ts`, and role enforcement lives in the layout, the actions and RLS.
     * A signed-out request is therefore turned away by the middleware and proves nothing about
     * this endpoint's own guard.
     *
     * A customer gets past the middleware and must still be refused, because the export is a
     * route handler outside the admin layout entirely and carries its own capability check. It
     * answers 404 rather than 403 so probing cannot confirm which customer ids exist.
     */
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    const response = await page.request.get(
      '/admin/customers/00000000-0000-4000-8000-000000000001/export',
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(404);
  });

  test('the cron endpoints refuse a caller with no secret', async ({ request }) => {
    for (const route of ['/api/cron/housekeeping', '/api/cron/subscriptions']) {
      const response = await request.get(route);
      expect(response.status(), `${route} ran without CRON_SECRET`).toBe(401);
    }
  });

  test('the revalidation endpoint refuses a caller with no secret', async ({ request }) => {
    const response = await request.post('/api/revalidate', { data: { tag: 'products' } });
    expect(response.status()).toBe(401);
  });
});

test.describe('the browser is told what it may execute (docs/10 §5)', () => {
  test('every security header is present on a storefront page', async ({ request }) => {
    const response = await request.get('/en');
    const headers = response.headers();

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('geolocation=()');
    expect(headers['strict-transport-security']).toContain('max-age=');

    /*
     * One of the two must carry the policy. Which one depends on `CSP_ENFORCE` (docs/13 §Q3), so
     * asserting the directives rather than the header name keeps this true either side of the
     * launch-week promotion — the same lesson as the robots tag in §N9.
     */
    const csp =
      headers['content-security-policy'] ?? headers['content-security-policy-report-only'] ?? '';

    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ]) {
      expect(csp, `CSP is missing ${directive}`).toContain(directive);
    }

    // Never in production, whichever header carries the policy.
    expect(csp, 'eval must not be allowed in a production build').not.toContain("'unsafe-eval'");
  });

  test('the powered-by header is not advertised', async ({ request }) => {
    const response = await request.get('/en');
    expect(response.headers()['x-powered-by']).toBeUndefined();
  });
});
