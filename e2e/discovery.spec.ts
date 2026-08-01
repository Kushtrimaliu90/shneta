import { expect, test } from '@playwright/test';
import { ACTION_TIMEOUT, CHEAP_PRODUCT } from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/09 §1 journey 10 — how a shopper finds things: search, compare, wishlist.
 *
 * The three features share one story — a visitor who does not yet know what they want — and
 * they share one page, the shop grid, where the heart and the compare toggle both live.
 */
const ips = ipAllocator('233.252.3');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

test.describe('journey 10 — search, compare, wishlist (docs/09 §1)', () => {
  test('a typo still finds the product (docs/05 §8 acceptance)', async ({ page }) => {
    /*
     * The acceptance criterion, exactly as written: "vitamn c" finds Vitamin C. It works
     * because `search_products` falls back from full-text to trigram similarity — this test
     * exists to notice if that fallback is ever dropped, since FTS alone would return nothing
     * and the page would look merely empty rather than broken.
     */
    await page.goto('/en/search?q=vitamn+c');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('vitamn c');
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText(/Vitamin C/i).first()).toBeVisible();
  });

  test('an empty query goes to the shop instead of an empty results page', async ({ page }) => {
    await page.goto('/en/search');
    await expect(page).toHaveURL(/\/en\/shop$/);
  });

  test('the overlay searches as you type and leads to the full page', async ({ page }) => {
    await page.goto('/en/shop');
    await page.getByRole('button', { name: 'Open search' }).click();

    const input = page.locator('#site-search');
    await input.fill('vitamin');

    // Debounced at 250 ms, so the wait is real rather than an artefact of the test.
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    await input.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=vitamin$/);
  });

  test('a search that matches nothing says so and offers the shop', async ({ page }) => {
    await page.goto('/en/search?q=zzzqqqxxx');
    await expect(page.getByText(/Nothing matched/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the shop' })).toBeVisible();
  });

  test('three products compare, and the URL reproduces the table', async ({ page, browser }) => {
    await page.goto('/en/shop');

    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible({ timeout: ACTION_TIMEOUT });

    for (const index of [0, 1, 2]) {
      await cards
        .nth(index)
        .getByRole('button', { name: /^Compare:/ })
        .click();
    }

    // docs/05 §9 — the bar is the only affordance that leads to the table.
    await expect(page.getByText('3 products to compare')).toBeVisible();
    await page.getByRole('link', { name: 'Compare now' }).click();

    await expect(page).toHaveURL(/\/en\/compare\?ids=/);
    const shareable = page.url();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    // `exact`: "Price" is a prefix of "Price per serving", the row directly beneath it.
    await expect(table.getByRole('rowheader', { name: 'Price', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveCount(3);

    /*
     * The shareable URL, opened by somebody else.
     *
     * A fresh context has no compare cookie, which is the case that matters: if the page read
     * the cookie in preference to the query string, the recipient would see their own selection
     * — or nothing — and the link would be useless for the one thing it exists to do.
     */
    const recipient = await browser.newContext();
    const recipientPage = await recipient.newPage();
    await recipientPage.goto(shareable);
    await expect(recipientPage.getByRole('columnheader')).toHaveCount(3);
    await recipient.close();

    // docs/05 §9 — removing an item updates the URL.
    await page
      .getByRole('columnheader')
      .first()
      .getByRole('button', { name: /^Remove from comparison:/ })
      .click();
    await expect(page.getByRole('columnheader')).toHaveCount(2);
    await expect(page).not.toHaveURL(shareable);
  });

  test('an empty comparison explains itself', async ({ page }) => {
    await page.goto('/en/compare');
    await expect(page.getByText('Nothing to compare yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the shop' })).toBeVisible();
  });

  test('the heart sends a signed-out visitor to sign-in and back', async ({ page }) => {
    await page.goto(CHEAP_PRODUCT);
    await page
      .getByRole('button', { name: /^Save to wishlist:/ })
      .click({ timeout: ACTION_TIMEOUT });

    // The intent was to save the product, so the return path carries it.
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=/, { timeout: ACTION_TIMEOUT });
    expect(decodeURIComponent(page.url())).toContain('/product/now-vitamin-d3-4000');
  });

  test('a signed-in customer saves a product and finds it in the account', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    await page.goto(CHEAP_PRODUCT);
    const heart = page.getByRole('button', { name: /wishlist: / });
    await heart.click({ timeout: ACTION_TIMEOUT });

    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from('profiles')
            .select('id')
            .eq('email', customer.email)
            .single();
          const userId = (data as { id: string }).id;
          const { count } = await db()
            .from('wishlist_items')
            .select('product_id', { count: 'exact', head: true })
            .eq('user_id', userId);
          return count ?? 0;
        },
        { message: 'the heart must write a row', timeout: ACTION_TIMEOUT },
      )
      .toBe(1);

    await page.goto('/en/account/wishlist');
    await expect(page.getByRole('link', { name: /Vitamin D3/i }).first()).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
  });
});
