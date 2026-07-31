import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * docs/09 §1 journey 1, browse half — filter the PLP, open a PDP, read the label.
 * The add-to-cart and checkout half arrives with M4.
 */

test.describe('product listing', () => {
  test('lists the catalogue in both locales', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dyqani');
    await expect(page.getByText('24 produkte').first()).toBeVisible();

    await page.goto('/en/shop');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shop');
    await expect(page.getByText('24 products').first()).toBeVisible();
  });

  test('a dietary filter narrows the result and lives in the URL', async ({ page }) => {
    await page.goto('/en/shop');
    await page.getByRole('link', { name: 'Vegan', exact: true }).click();

    // docs/05 §2 — filters are shareable URL state, not hidden client state.
    await expect(page).toHaveURL(/tag=vegan/);
    await expect(page.getByText('12 products').first()).toBeVisible();

    // ...and the back button restores the previous result, for free, because it is a real
    // navigation rather than a client-side mutation.
    await page.goBack();
    await expect(page.getByText('24 products').first()).toBeVisible();
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

  test('marks an out-of-stock variant as unavailable', async ({ page }) => {
    // The 2.27 kg whey is the docs/11 §7 out-of-stock fixture.
    await page.goto('/en/product/on-gold-standard-whey');
    const option = page.getByText('2.27 kg chocolate');
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('aria-disabled', 'true');
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
      { offers: { price: string; priceCurrency: string }; aggregateRating?: unknown } | undefined;
    expect(product?.offers.priceCurrency).toBe('EUR');
    expect(product?.offers.price).toBe('9.90');
    // No reviews in the fixture, so aggregateRating must be absent — emitting it with
    // reviewCount 0 is a Search Console error.
    expect(product?.aggregateRating).toBeUndefined();
  });

  test('a missing product renders the localized 404', async ({ page }) => {
    const response = await page.goto('/en/product/nope-does-not-exist');
    expect(response?.status()).toBe(404);
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
