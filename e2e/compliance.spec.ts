import { expect, test } from '@playwright/test';

/**
 * docs/08 §4 and §7.3 — the two things that must be true on a launched shop and are checked by
 * somebody other than us: the supplement disclaimer, and what search engines are told.
 *
 * Written during M11 because the launch checklist in docs/10 §9 claims both, and only half of
 * each was actually asserted. The disclaimer had tests on the PDP and one goal page; the footer
 * and ingredient pages carried it untested. The sitemap had no test at all — the "176 URLs, 352
 * hreflang links" in the ledger was a number somebody counted once.
 *
 * A checklist item whose evidence is a number in a document is not evidence.
 */

test.describe('the supplement disclaimer (docs/08 §7.3)', () => {
  /**
   * Every surface docs/08 §7.3 names, in both locales.
   *
   * It is a legal requirement in the market this ships to, so the failure mode is not a broken
   * page — it is a compliant-looking page that is not compliant, which nobody notices.
   */
  const SURFACES = [
    { path: '/en', what: 'the footer, on the home page' },
    { path: '/en/product/now-vitamin-d3-4000', what: 'the product page' },
    { path: '/en/ingredients/ashwagandha', what: 'an ingredient page' },
    { path: '/en/goals/gjumi', what: 'a health-goal page' },
    { path: '/en/knowledge', what: 'the knowledge centre' },
  ];

  for (const surface of SURFACES) {
    test(`appears on ${surface.what}`, async ({ page }) => {
      await page.goto(surface.path);
      await expect(
        page.getByText(/Food supplements are not a substitute/).first(),
        `${surface.path} is missing the disclaimer`,
      ).toBeVisible();
    });
  }

  test('appears in Albanian too, which is the market it is required for', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/nuk (e )?zëvendësojnë|nuk janë zëvendësim/i).first()).toBeVisible();
  });
});

test.describe('what search engines are told (docs/08 §4)', () => {
  test('the sitemap lists both locales with reciprocal hreflang', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    const xml = await response.text();

    const urlCount = (xml.match(/<url>/g) ?? []).length;
    const alternates = (xml.match(/rel="alternate"/g) ?? []).length;

    expect(urlCount, 'the sitemap is empty').toBeGreaterThan(50);

    /*
     * Two alternates per URL — sq and en — because hreflang must be reciprocal or Google ignores
     * the whole set. Asserting the ratio rather than a fixed count, so adding a page does not
     * fail the test while dropping an alternate does.
     */
    expect(alternates, 'every URL needs an sq and an en alternate').toBe(urlCount * 2);

    expect(xml).toContain('hreflang="sq"');
    expect(xml).toContain('hreflang="en"');
  });

  test('the sitemap includes the pages added after M8', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();

    expect(xml).toContain('/knowledge');
    expect(xml).toContain('/offers');
  });

  /**
   * docs/15 §1 — the Finder's supersession, from the crawler's side.
   *
   * Two halves of one change that are easy to do independently and wrong to ship apart: the
   * redirect without the sitemap edit leaves a listed URL that 308s, and the sitemap edit without
   * the redirect breaks every link in the wild.
   */
  test('/finder permanently redirects to /biohack and has left the sitemap', async ({
    request,
  }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml, '/finder must no longer be advertised').not.toContain('/finder');
    expect(xml, 'the generator is noindex, so it is not advertised either').not.toContain(
      '/biohack',
    );

    const response = await request.get('/finder', { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toContain('/biohack');
  });

  test('private pages are absent from the sitemap', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();

    for (const path of ['/admin', '/account', '/checkout', '/cart']) {
      expect(xml, `${path} must not be advertised to crawlers`).not.toContain(`<loc>${path}`);
      expect(xml).not.toContain(`/en${path}</loc>`);
    }
  });
});
