import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * docs/09 §1 journey 1, browse half — filter the PLP, open a PDP, read the label.
 * The add-to-cart and checkout half arrives with M4.
 */

test.describe('product listing', () => {
  /**
   * The seeded catalogue is 24 products, and the count used to be asserted exactly.
   *
   * That coupled this test to "no other spec ever publishes a product" — which two marketplace specs
   * now do, because a merchant offer needs a published product to be an offer *on*. Running in
   * parallel, their fixtures appeared in the count and this failed for a reason that had nothing to do
   * with the catalogue.
   *
   * **At least** 24 keeps what the assertion was for — the seed is intact and the listing renders it —
   * without asserting something no longer true: that this spec is the only one creating products.
   */
  /**
   * `expect.poll`, not a bare read.
   *
   * The assertion this replaced was `expect(getByText('24 products')).toBeVisible()`, which **retries**
   * until the deadline. A plain `textContent()` does not — so after `goBack()` it read the filtered
   * count off the page still on screen and failed on a number that was about to be correct.
   */
  async function expectAtLeast(page: Page, pattern: RegExp, minimum: number): Promise<void> {
    await expect
      .poll(async () => {
        const text = await page.getByText(pattern).first().textContent();
        return Number(/\d+/.exec(text ?? '')?.[0] ?? 0);
      })
      .toBeGreaterThanOrEqual(minimum);
  }

  test('lists the catalogue in both locales', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dyqani');
    await expectAtLeast(page, /\d+ produkte/, 24);

    await page.goto('/en/shop');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shop');
    await expectAtLeast(page, /\d+ products/, 24);
  });

  test('a dietary filter narrows the result and lives in the URL', async ({ page }) => {
    await page.goto('/en/shop');
    await page.getByRole('link', { name: 'Vegan', exact: true }).click();

    // docs/05 §2 — filters are shareable URL state, not hidden client state.
    await expect(page).toHaveURL(/tag=vegan/);
    await expect(page.getByText('12 products').first()).toBeVisible();

    // ...and the back button restores the previous result, for free, because it is a real
    // navigation rather than a client-side mutation. The unfiltered count is a lower bound for the
    // same reason as above: other specs publish fixture products concurrently.
    await page.goBack();
    await expectAtLeast(page, /\d+ products/, 24);
  });

  test('sorting by price ascending really orders by price', async ({ page }) => {
    await page.goto('/en/shop?sort=price_asc');

    const prices = await page.locator('article p[data-numeric] span').first().textContent();
    expect(prices).toBeTruthy();

    const all = await page.locator('article p[data-numeric]').allTextContents();
    const numbers = all
      .map((text) => /€([\d,.]+)/.exec(text)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseFloat(value.replace(/,/g, '')));

    expect(numbers.length).toBeGreaterThan(3);
    expect([...numbers]).toEqual([...numbers].sort((a, b) => a - b));
  });

  test('clearing filters returns to the unfiltered list', async ({ page }) => {
    await page.goto('/en/shop?tag=vegan&onSale=1');
    await page.getByRole('link', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/en\/shop$/);
  });

  test('a category page scopes the list and shows a breadcrumb', async ({ page }) => {
    await page.goto('/shop/vitaminat');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vitaminat');
    await expect(page.getByRole('navigation', { name: 'Shtegu i faqes' })).toBeVisible();
    await expect(page.getByText('5 produkte').first()).toBeVisible();
  });

  test('an over-narrow filter shows the empty state, not a blank grid', async ({ page }) => {
    // No product is simultaneously vegan and lactose-free *and* on sale in the fixture.
    await page.goto('/en/shop?tag=vegan,halal&onSale=1');
    await expect(page.getByText('No products found')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear filters' }).first()).toBeVisible();
  });
});

test.describe('product detail', () => {
  test('renders the label, price and stock line', async ({ page }) => {
    await page.goto('/en/product/on-gold-standard-whey');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ON Gold Standard Whey');
    await expect(page.getByRole('link', { name: 'Optimum Nutrition' }).first()).toBeVisible();
    await expect(page.getByText('Price includes VAT.')).toBeVisible();

    // docs/05 §3 — the ingredient table renders from the DB, with per-serving amounts.
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('link', { name: 'Whey protein' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '24 g' })).toBeVisible();

    // docs/05 §3 — %NRV footnote is present wherever the label is shown.
    await expect(page.getByText(/NRV = Nutrient Reference Value/)).toBeVisible();
  });

  test('shows warnings prominently when the product has them', async ({ page }) => {
    // docs/08 §7.4 — melatonin carries real warnings and they must be visually distinct.
    await page.goto('/en/product/jamieson-melatonin-3');
    await expect(page.getByRole('heading', { name: 'Warnings' })).toBeVisible();
    await expect(page.getByText(/Do not drive after taking/)).toBeVisible();
  });

  test('still lists an out-of-stock variant, marked unavailable', async ({ page }) => {
    // The 2.27 kg whey is the docs/11 §7 out-of-stock fixture.
    await page.goto('/en/product/on-gold-standard-whey');

    /*
     * It stays listed rather than being hidden: someone who came for the 2.27 kg needs to
     * learn that it exists and is out of stock, not to conclude the shop never had it.
     *
     * The option is a real radio since M4, so "unavailable" is `disabled` on the input —
     * which conveys it to assistive technology — plus a line-through for sighted users.
     * That it cannot be *selected* is asserted in checkout.spec.ts, where buying is the
     * subject; here the concern is that the catalogue shows it honestly.
     */
    const label = page.locator('label', { hasText: '2.27 kg chocolate' });
    await expect(label).toBeVisible();
    await expect(label).toHaveClass(/line-through/);

    // The radio's accessible name carries the reason in words, not by strike-through alone
    // (docs/04 §10 — never colour or decoration as the only signal).
    const radio = page.getByRole('radio', { name: /2\.27 kg chocolate — Currently out of stock/ });
    await expect(radio).toBeDisabled();
  });

  test('carries the mandatory supplement disclaimer (docs/08 §7.3)', async ({ page }) => {
    await page.goto('/en/product/now-vitamin-d3-4000');
    await expect(page.getByText(/Food supplements are not a substitute/).first()).toBeVisible();
  });

  test('emits Product and BreadcrumbList JSON-LD (docs/08 §4)', async ({ page }) => {
    await page.goto('/en/product/now-vitamin-d3-4000');

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = blocks.map((block) => JSON.parse(block) as { '@type': string });
    const types = parsed.map((schema) => schema['@type']);

    expect(types).toContain('Product');
    expect(types).toContain('BreadcrumbList');

    const product = parsed.find((schema) => schema['@type'] === 'Product') as
      | {
          offers: { price: string; priceCurrency: string };
          aggregateRating?: { ratingValue: string; reviewCount: number };
        }
      | undefined;
    expect(product?.offers.priceCurrency).toBe('EUR');
    expect(product?.offers.price).toBe('9.90');

    /*
     * The rule is "never emit `aggregateRating` with a count of zero" — that is a Search Console
     * error — not "never emit it".
     *
     * This used to assert the field was simply absent, which held only because nothing could
     * create a review. M7 can: `reviews.spec.ts` writes and approves one on this very product,
     * and the two specs run concurrently, so whether a rating exists here is a race. Asserting
     * the *contract* holds either way; asserting the absence made this test a report of what
     * some other spec happened to be doing.
     */
    if (product?.aggregateRating !== undefined) {
      expect(product.aggregateRating.reviewCount).toBeGreaterThan(0);
      expect(Number(product.aggregateRating.ratingValue)).toBeGreaterThan(0);
    }
  });

  test('a missing product renders the localized 404', async ({ page }) => {
    const response = await page.goto('/en/product/nope-does-not-exist');
    expect(response?.status()).toBe(404);
  });
});

test.describe('taxonomy pages', () => {
  test('the brand index groups alphabetically and links to a scoped listing', async ({ page }) => {
    await page.goto('/en/brands');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brands');

    await page.getByRole('link', { name: /Solgar/ }).click();
    await expect(page).toHaveURL(/\/brands\/solgar$/);
    // Scoped: Solgar has three products in the fixture, not all 24.
    await expect(page.getByText('3 products').first()).toBeVisible();
  });

  test('a goal page scopes the listing and carries the disclaimer', async ({ page }) => {
    await page.goto('/en/goals/gjumi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Better Sleep');
    await expect(page.getByText('3 products').first()).toBeVisible();
    // docs/08 §7.3 — goal pages are educational surfaces and need it.
    await expect(page.getByText(/Food supplements are not a substitute/).first()).toBeVisible();
  });

  test('goal intros never leak the seed placeholder to a customer', async ({ page }) => {
    await page.goto('/en/goals/energji');
    await expect(page.getByText('[CONTENT')).toHaveCount(0);
  });

  test('an ingredient page always shows safety notes when present', async ({ page }) => {
    // docs/05 §6 acceptance — melatonin has real warnings and they must be visible.
    await page.goto('/en/ingredients/melatonin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Melatonin');
    await expect(page.getByRole('heading', { name: 'Safety notes' })).toBeVisible();
    await expect(page.getByText(/Not for pregnancy/)).toBeVisible();
    // The evidence badge states the level as text, not by colour alone (docs/04 §10).
    await expect(page.getByText('Strong evidence')).toBeVisible();
  });

  test('ingredient chips on a PDP land on the ingredient page', async ({ page }) => {
    await page.goto('/en/product/jamieson-melatonin-3');
    await page.getByRole('table').getByRole('link', { name: 'Melatonin' }).click();
    await expect(page).toHaveURL(/\/ingredients\/melatonin$/);
  });
});

test.describe('home', () => {
  test('shows bestsellers, goals and categories from the database', async ({ page }) => {
    await page.goto('/en');

    await expect(page.getByRole('heading', { name: 'Bestsellers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shop by goal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();

    // Eight product cards, each linking to a PDP.
    const cards = page.locator('#main article');
    expect(await cards.count()).toBeGreaterThanOrEqual(8);
  });

  test('emits Organization and WebSite JSON-LD', async ({ page }) => {
    await page.goto('/en');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.map((block) => (JSON.parse(block) as { '@type': string })['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });
});

test.describe('accessibility', () => {
  for (const path of ['/en/shop', '/en/shop/vitaminat', '/en/product/on-gold-standard-whey']) {
    test(`axe finds no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
    });
  }
});
