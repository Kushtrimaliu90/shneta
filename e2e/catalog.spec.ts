import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * docs/09 §1 journey 1, browse half — filter the PLP, open a PDP, read the label.
 * The add-to-cart and checkout half arrives with M4.
 */

/**
 * Opens the mobile filter sheet when there is one.
 *
 * Below `lg` the facets live behind a trigger instead of above the grid (docs/05 §2) — 51 links in a
 * single column put the first product about five screens down. The trigger is `lg:hidden`, so on the
 * desktop project this is a no-op and the same test covers both layouts.
 */
async function openFiltersIfMobile(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /^Filters/ });
  if (await trigger.isVisible()) await trigger.click();
}

/**
 * The result count on screen.
 *
 * Module scope because both `describe` blocks need it: the listing tests compare a filtered count with an
 * unfiltered one, and the taxonomy tests compare a scoped page with the whole shop.
 *
 * Every literal count in this file has now been replaced by a comparison. `12 products`, `5 produkte` and
 * two `3 products` were all facts about a 24-product demo catalogue; the real one has 108 and grows
 * whenever somebody adds a product in the panel, so a literal broke on ordinary catalogue work — and when
 * it passed it proved nothing about filtering or scoping, which is what these tests are named for.
 */
async function resultCount(page: Page, pattern: RegExp): Promise<number> {
  const text = await page.getByText(pattern).first().textContent();
  return Number(/\d+/.exec(text ?? '')?.[0] ?? 0);
}

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
    const unfiltered = await resultCount(page, /\d+ products/);
    expect(unfiltered).toBeGreaterThan(0);

    await openFiltersIfMobile(page);
    await page.getByRole('link', { name: 'Vegan', exact: true }).click();

    // docs/05 §2 — filters are shareable URL state, not hidden client state.
    await expect(page).toHaveURL(/tag=vegan/);

    /*
     * Asserted as a relationship, not as a number.
     *
     * This said `12 products`, which was true of a 24-product demo catalogue and false the moment the
     * real one landed — 108 products, and growing every time somebody adds one in the admin panel. A
     * literal count breaks on ordinary catalogue work, and when it passes it says nothing about
     * filtering.
     *
     * What the test is for is in its name: the filter *narrows*. So — fewer than unfiltered, and not
     * zero.
     */
    const filtered = await resultCount(page, /\d+ products/);
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(unfiltered);

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

    /*
     * Scoped, not counted. This said `5 produkte`, which was a fact about the 24-product demo
     * catalogue — the real one has 108 and grows whenever somebody adds a product in the panel.
     * "This category shows fewer than the whole shop, and more than none" is the claim that survives.
     */
    const scoped = await resultCount(page, /\d+ produkte/);
    expect(scoped).toBeGreaterThan(0);

    await page.goto('/shop');
    expect(scoped).toBeLessThan(await resultCount(page, /\d+ produkte/));
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

    // Scoped: Solgar's own products, not the whole shop. A literal count here was a fact about the
    // demo catalogue and broke when the real one landed.
    const scoped = await resultCount(page, /\d+ products/);
    expect(scoped).toBeGreaterThan(0);

    await page.goto('/en/shop');
    expect(scoped).toBeLessThan(await resultCount(page, /\d+ products/));
  });

  test('a goal page scopes the listing and carries the disclaimer', async ({ page }) => {
    await page.goto('/en/goals/gjumi');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Better Sleep');

    // Scoped to the goal, for the same reason as the brand page above.
    expect(await resultCount(page, /\d+ products/)).toBeGreaterThan(0);

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
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();

    /*
     * "Shop by goal" was a section heading until the goals grid became the intent band, which
     * carries a visually-hidden "Where to start" heading and links out to `/goals` from a tile. The
     * test kept asserting the old heading and had been failing since — caught while verifying an
     * unrelated fix, which is the only reason it surfaced at all.
     *
     * Asserted as the link a visitor actually uses rather than the heading, because the heading is
     * `sr-only` now and a hidden string is a weaker thing to pin than a working route.
     */
    await expect(page.getByRole('link', { name: /Shop by health goal/ })).toBeVisible();

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

/**
 * docs/05 §2 — the mobile listing layout.
 *
 * The panel renders 51 links across 5 groups. In a single column that is roughly 1,900 px, so the first
 * product card sat about five screens below the fold on a 390 px phone — you scrolled past every brand
 * in the shop to reach a product. These assert the shape of the fix rather than its pixels: the trigger
 * exists, the grid starts near the top, the sheet is a real dialog, and the way out is always reachable.
 */
test.describe('the mobile filter sheet', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'mobile layout only');

  test('products are on the first screen, with filters behind a trigger', async ({
    page,
    viewport,
  }) => {
    await page.goto('/en/shop');

    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();

    /*
     * Within one viewport height. A pixel budget rather than an exact number, because the header and
     * the count line are allowed to change — what must not come back is a screenful of facets between
     * the heading and the first product.
     */
    const box = await page.getByRole('article').first().boundingBox();
    expect(box?.y ?? Infinity).toBeLessThan(viewport?.height ?? 844);
  });

  test('the sheet is a dialog, closes on Escape, and returns focus', async ({ page }) => {
    await page.goto('/en/shop');
    const trigger = page.getByRole('button', { name: /^Filters/ });

    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // The primary action names what you are going back to.
    await expect(sheet.getByRole('button', { name: /Show \d+ product/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('an active filter is a chip that removes itself in one tap', async ({ page }) => {
    await page.goto('/en/shop?brand=now-foods');

    // Visible without opening anything — undoing a filter was four actions before this.
    const chip = page.getByRole('link', { name: /Remove filter: NOW Foods/ });
    await expect(chip).toBeVisible();
    await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');

    await chip.click();
    await expect(page).toHaveURL(/\/en\/shop$/);
  });

  test('no serious axe violations with the sheet open', async ({ page }) => {
    await page.goto('/en/shop');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
});
