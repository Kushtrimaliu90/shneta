import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  ACTION_TIMEOUT,
  addCheapItemToCart,
  CHEAP_PRODUCT,
  fillCheckout,
} from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/09 §1 journey 6 — buy → deliver → review → moderate → live.
 *
 * Separate from `admin.spec.ts` even though half of it happens in the admin panel: the subject
 * is a customer's review, and the moderation step is one beat in that story rather than an
 * operator task. Splitting it also keeps the two files' sign-ins in different rate-limit blocks.
 */
const ips = ipAllocator('233.252.2');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

test.describe('journey 6 — buy, receive, review, moderate (docs/09 §1)', () => {
  /**
   * The whole review loop in one test, because every step depends on the one before it: a
   * review cannot be written without a delivered order, cannot be seen without approval, and
   * the rating aggregate cannot move without both.
   *
   * The customer signs in rather than checking out as a guest — a review needs an account to
   * belong to, and `p_insert_own` proves the purchase through `orders.user_id`.
   */
  test('a delivered purchase can be reviewed, and it appears once approved', async ({
    page,
    browser,
  }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    /*
     * A unique headline, and every locator below filters on it.
     *
     * The desktop and mobile projects run concurrently against one database, so a fixed title
     * means the mobile run's "a pending review must not be public" assertion sees the desktop
     * run's *approved* review and fails — reporting a security hole that does not exist. Third
     * time this shape has appeared (docs/13 §K2, §L8): anything asserted against a shared list
     * has to be identified uniquely.
     */
    const headline = `Does what it says ${randomUUID().slice(0, 8)}`;

    // ── 1 · Buy ───────────────────────────────────────────────────────────────
    await addCheapItemToCart(page);
    await page.goto('/en/checkout');
    await fillCheckout(page, customer.email);
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    /*
     * ── 2 · Deliver ─────────────────────────────────────────────────────────
     *
     * Through the service client rather than the admin UI. Journey 7 already walks
     * confirm → ship → deliver in a browser; repeating it here would make this test fail for
     * reasons that have nothing to do with reviews. One transition at a time, because
     * `orders_before_status_change` validates each one.
     */
    const { data: order } = await db()
      .from('orders')
      .select('id, order_items ( product_id )')
      .eq('email', customer.email)
      .order('placed_at', { ascending: false })
      .limit(1)
      .single();

    const orderRow = order as { id: string; order_items: { product_id: string }[] };
    const productId = orderRow.order_items[0]?.product_id ?? '';
    expect(productId, 'the order must contain the cheap product').toBeTruthy();

    for (const status of ['confirmed', 'processing', 'shipped', 'delivered'] as const) {
      const { error } = await db().from('orders').update({ status }).eq('id', orderRow.id);
      expect(error, `transition to ${status} must be accepted`).toBeNull();
    }

    // ── 3 · Write ─────────────────────────────────────────────────────────────
    await page.goto(CHEAP_PRODUCT);
    await page.getByRole('button', { name: 'Write a review' }).click({ timeout: ACTION_TIMEOUT });
    await page.getByRole('button', { name: '4 out of 5' }).click();
    await page.locator('#review-title').fill(headline);
    await page.locator('#review-body').fill('Easy to swallow and arrived quickly.');
    await page.getByRole('button', { name: 'Send review' }).click();

    await expect(page.getByText('Thank you')).toBeVisible({ timeout: ACTION_TIMEOUT });

    const { data: written } = await db()
      .from('reviews')
      .select('id, status, order_id, rating')
      .eq('product_id', productId)
      .eq('rating', 4)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const review = written as { id: string; status: string; order_id: string | null };
    expect(review.status, 'a new review starts pending, never published').toBe('pending');
    // docs/13 §B3 — the verified badge is earned, and the policy proved the purchase.
    expect(review.order_id, 'the purchase must be recorded on the review').toBe(orderRow.id);

    // ── 4 · Invisible until approved ─────────────────────────────────────────
    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    await shopperPage.goto(CHEAP_PRODUCT);
    await expect(
      shopperPage.getByText(headline),
      'a pending review must not be public',
    ).toHaveCount(0);

    // ── 5 · Moderate ─────────────────────────────────────────────────────────
    const moderatorPage = await (await browser.newContext()).newPage();
    await moderatorPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.201' });
    const moderator = await staffUser('content_manager');
    await signIn(moderatorPage, moderator.email, moderator.password);

    await moderatorPage.goto('/admin/reviews');
    const card = moderatorPage.getByRole('listitem').filter({ hasText: headline });
    await expect(card).toBeVisible({ timeout: ACTION_TIMEOUT });
    await card.getByRole('button', { name: 'Approve' }).click();

    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from('reviews')
            .select('status')
            .eq('id', review.id)
            .maybeSingle();
          return (data as { status: string } | null)?.status ?? null;
        },
        { message: 'approval must reach the database', timeout: ACTION_TIMEOUT },
      )
      .toBe('approved');

    // ── 6 · Live, and the aggregate moved ────────────────────────────────────
    /*
     * `refresh_product_rating` recomputes `products.rating_avg` on approval, and approving
     * purges the product's cache tag — so the storefront shows both the review and the new
     * average without waiting out the revalidate window. That is the M6 §K1 machinery being
     * exercised by a second feature.
     */
    await shopperPage.reload();
    await expect(shopperPage.getByText(headline)).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    await expect(shopperPage.getByText('Verified purchase').first()).toBeVisible();

    const { data: aggregate } = await db()
      .from('products')
      .select('rating_avg, rating_count')
      .eq('id', productId)
      .single();

    const rating = aggregate as { rating_avg: number; rating_count: number };
    expect(rating.rating_count, 'the aggregate counts the approved review').toBeGreaterThan(0);

    await shopper.close();
    await moderatorPage.context().close();
  });

  test('someone who has not bought it is told why they cannot review', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    await page.goto(CHEAP_PRODUCT);

    // docs/12 M7 acceptance — blocked with a friendly explanation, not a hidden control.
    await expect(
      page.getByText('Only customers who have received this product can review it'),
    ).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByRole('button', { name: 'Write a review' })).toHaveCount(0);
  });

  test('a signed-out visitor is invited to sign in rather than shown nothing', async ({ page }) => {
    await page.goto(CHEAP_PRODUCT);
    await expect(page.getByRole('link', { name: 'Sign in' }).last()).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
  });

  test('a rejected review carries its reason back to the customer', async ({ page, browser }) => {
    const customer = await staffUser('customer');

    /*
     * Written directly: this test is about what moderation *says*, not about how a review is
     * created, and journey 6 above already covers the write path end to end. The insert goes
     * through the service client, which is exempt from `p_insert_own` — so `order_id` stays
     * null and the review is honestly unverified.
     */
    const { data: product } = await db()
      .from('products')
      .select('id')
      .eq('slug', 'now-vitamin-d3-4000')
      .single();
    const { data: profile } = await db()
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .single();

    const body = `Rejected fixture ${randomUUID().slice(0, 8)}`;
    const { data: inserted, error } = await db()
      .from('reviews')
      .insert({
        product_id: (product as { id: string }).id,
        user_id: (profile as { id: string }).id,
        rating: 1,
        body,
        author_name: 'E2E',
      })
      .select('id')
      .single();
    expect(error, 'fixture review must insert').toBeNull();
    const reviewId = (inserted as { id: string }).id;

    const moderatorPage = await (await browser.newContext()).newPage();
    await moderatorPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.202' });
    const moderator = await staffUser('support');
    await signIn(moderatorPage, moderator.email, moderator.password);

    await moderatorPage.goto('/admin/reviews');
    const card = moderatorPage.getByRole('listitem').filter({ hasText: body });
    await card.getByRole('button', { name: 'Reject…' }).click();
    await card.getByRole('textbox').fill('Describes treating an illness.');
    await card.getByRole('button', { name: 'Reject', exact: true }).click();

    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from('reviews')
            .select('status, rejection_reason')
            .eq('id', reviewId)
            .maybeSingle();
          return (data as { status: string } | null)?.status ?? null;
        },
        { timeout: ACTION_TIMEOUT },
      )
      .toBe('rejected');

    // docs/06 §10 — the reason is shown to the customer, which is the whole point of requiring it.
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/reviews');
    // `exact`, because the rejection note below the badge also contains "not published" —
    // the docs/13 §K2 trap, caught this time by Playwright's strict mode rather than by a
    // passing test that proved nothing.
    await expect(page.getByText('Not published', { exact: true })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    await expect(page.getByText('Describes treating an illness.')).toBeVisible();

    await moderatorPage.context().close();
  });
});
