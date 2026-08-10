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
    await expect(
      page.getByText(/nuk (e )?zëvendësojnë|nuk janë zëvendësim/i).first(),
    ).toBeVisible();
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

  /**
   * Every URL is a URL a crawler can fetch — no doubled slash after the origin.
   *
   * This is the assertion that was missing when it mattered. `NEXT_PUBLIC_SITE_URL` was set with a trailing
   * slash, `z.url()` accepted it, and the live sitemap advertised `https://www.shtrejt.com//` as the canonical
   * home page and `//shop` for every product — distinct URLs to Google, none of them the real one. The
   * reciprocity test above passed throughout, because the alternates were consistently wrong.
   *
   * Checked on the **rendered output** rather than on the env var, because that is where the mistake showed up
   * and where a future one will: any code path that concatenates an origin badly fails here.
   */
  test('no sitemap URL has a doubled slash after the origin', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();

    const urls = [...xml.matchAll(/(?:<loc>|href=")(https?:\/\/[^<"]+)/g)].map(
      (match) => match[1] ?? '',
    );
    expect(urls.length, 'no URLs found to check').toBeGreaterThan(50);

    const malformed = urls.filter((url) => url.replace(/^https?:\/\//, '').includes('//'));
    expect(malformed.slice(0, 5), 'these URLs have a doubled slash').toEqual([]);
  });

  test('robots.txt points at a well-formed sitemap', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();

    /*
     * Skipped while the pre-launch crawl block is on (docs/13 §AC). `SEO_INDEXING` defaults to off, so
     * robots.txt is `Disallow: /` with no sitemap line and no per-path rules to assert. What follows
     * describes the *indexable* configuration, which is what launch day turns on — so it is skipped
     * rather than deleted or weakened into something that passes either way.
     */
    test.skip(/^\s*Disallow:\s*\/\s*$/m.test(body), 'crawling is blocked pre-launch');

    const sitemap = /Sitemap:\s*(\S+)/.exec(body)?.[1] ?? '';
    expect(sitemap, 'robots.txt names no sitemap').toContain('/sitemap.xml');
    expect(sitemap.replace(/^https?:\/\//, ''), 'doubled slash in the sitemap URL').not.toContain(
      '//',
    );
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

/**
 * The faceted-navigation crawl trap (found 2026-08-05).
 *
 * The filter panel links to the current filters plus one more value, so the reachable URL set is the
 * product of every facet — categories × brands × goals × tags × sorts × pages — and `/shop` is dynamic
 * by design, so each combination is a live `search_products` round trip that no cache can serve twice.
 *
 * Measured before the fix, over the 5.6 days `pg_stat_statements` had been collecting: **4.8M of the
 * project's 4.9M PostgREST requests were the listing query**, four hours of database CPU, on a shop with
 * no customers. The dominant argument shapes were combinations — goal+brand, goal+brand+category+tag —
 * in proportions no human clicking around produces.
 *
 * Three layers, asserted here because only the first is free and all three are one careless edit from
 * being undone.
 */
test.describe('faceted listings are not a crawl space', () => {
  test('every facet link is rel=nofollow', async ({ page }) => {
    await page.goto('/en/shop');

    /*
     * The links that *should* be followed are the ones that go somewhere canonical: the category pages,
     * and "clear filters" back to /shop. Everything carrying a query string is a facet combination.
     */
    const followable = await page
      .locator('aside a[href*="?"]:not([rel~="nofollow"])')
      .allTextContents();

    expect(followable, 'a filter link without rel=nofollow reopens the crawl space').toEqual([]);
    expect(await page.locator('aside a[rel~="nofollow"]').count()).toBeGreaterThan(10);
  });

  test('a filtered listing is noindex, and the plain one is not', async ({ page }) => {
    await page.goto('/en/shop?brand=now-foods&goal=gjumi');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );

    // The page worth indexing keeps its place.
    await page.goto('/en/shop');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/);
  });

  test('robots.txt disallows the parameterised listings and allows the real pages', async ({
    request,
  }) => {
    const body = await (await request.get('/robots.txt')).text();

    // Same reason as the sitemap assertion above: `Disallow: /` has no facet rules to inspect.
    test.skip(/^\s*Disallow:\s*\/\s*$/m.test(body), 'crawling is blocked pre-launch');

    for (const rule of ['/shop?*', '/en/shop?*', '/*?brand=', '/*?goal=', '/*?tag=']) {
      expect(body, `robots.txt should disallow ${rule}`).toContain(`Disallow: ${rule}`);
    }

    // The pages that carry the catalogue's SEO must stay crawlable.
    for (const path of ['Disallow: /shop\n', 'Disallow: /brands', 'Disallow: /goals']) {
      expect(body, `robots.txt must not block ${path}`).not.toContain(path);
    }
  });
});
