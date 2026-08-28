import { expect, test } from '@playwright/test';
import { ACTION_TIMEOUT, CHEAP_PRODUCT, fillCheckout } from './helpers/storefront';
import { db, deleteCreatedUsers, env, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/09 §1 journey 9 — subscribe at the PDP → the account shows it → the renewal engine
 * generates an order with the discount — plus the loyalty half of M9.
 *
 * The cron endpoint is invoked directly with `CRON_SECRET`, which is what docs/09 means by
 * "test-invoked": waiting for 06:00 is not a test, and the engine's own idempotency is proved
 * against SQL in `tests/integration/subscriptions.test.ts`. What this file proves is the part
 * only a browser can: that the toggle reaches the database, the account page can manage what it
 * created, and a delivery actually appears.
 */
const ips = ipAllocator('233.252.5');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

/** The cron secret, read the same way the helpers read every other env value. */
function cronSecret(): string {
  return env().CRON_SECRET ?? '';
}

test.describe('journey 9 — subscribe, manage, renew (docs/09 §1)', () => {
  test('subscribing at checkout creates a subscription the account can manage', async ({
    page,
  }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    // ── 1 · Choose "subscribe and save" on the PDP ───────────────────────────
    await page.goto(CHEAP_PRODUCT);

    const subscribeOption = page.getByRole('radio', { name: /Subscribe and save/ });
    await expect(subscribeOption).toBeVisible({ timeout: ACTION_TIMEOUT });
    await subscribeOption.check();

    // docs/07 §8.3 — the COD model has to be stated, not implied.
    await expect(page.getByText(/You pay on delivery each time/)).toBeVisible();

    await page.locator('#subscribe-frequency').selectOption('45');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to your cart.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    // ── 2 · Check out ────────────────────────────────────────────────────────
    await page.goto('/en/checkout');
    await fillCheckout(page, customer.email);
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    // ── 3 · The subscription exists, at the cadence chosen ───────────────────
    const { data: profile } = await db()
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .single();
    const userId = (profile as { id: string }).id;

    await expect
      .poll(
        async () => {
          const { count } = await db()
            .from('subscriptions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          return count ?? 0;
        },
        { message: 'checkout must create the subscription', timeout: ACTION_TIMEOUT },
      )
      .toBe(1);

    const { data: subscription } = await db()
      .from('subscriptions')
      .select('id, frequency_days, status, discount_pct, next_run_at')
      .eq('user_id', userId)
      .single();

    const row = subscription as {
      frequency_days: number;
      status: string;
      discount_pct: number;
      next_run_at: string;
    };

    expect(row.frequency_days, 'the chosen cadence, not the default').toBe(45);
    expect(row.status).toBe('active');
    expect(row.discount_pct).toBeGreaterThan(0);

    /*
     * The first delivery is a full cycle away, not today. Shipping again immediately is the
     * single most obvious way to make a subscription feel like a trap, and the customer has
     * just received these items.
     */
    const daysAway = (Date.parse(row.next_run_at) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysAway).toBeGreaterThan(40);

    // ── 4 · The account page shows and manages it ────────────────────────────
    await page.goto('/en/account/subscriptions');
    await expect(page.getByText('Every 45 days')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText(/You pay the courier on delivery/)).toBeVisible();

    // Pause, then restart — the two controls docs/07 §8.3 says must be instant.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
  });

  test('the renewal engine generates one discounted order, however often it is invoked', async ({
    page,
    request,
  }) => {
    const customer = await staffUser('customer');

    const { data: profile } = await db()
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .single();
    const userId = (profile as { id: string }).id;

    const { data: variant } = await db()
      .from('product_variants')
      .select('id')
      .eq('sku', 'NOW-D3-120')
      .single();

    const { data: method } = await db()
      .from('shipping_methods')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single();

    /*
     * Due yesterday, so the engine picks it up on this invocation. Built through the service
     * client rather than by checking out and waiting 45 days, for obvious reasons.
     */
    const { data: created, error } = await db()
      .from('subscriptions')
      .insert({
        user_id: userId,
        status: 'active',
        frequency_days: 30,
        next_run_at: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        discount_pct: 10,
        shipping_address: {
          recipient_name: 'Test Abonuesi',
          phone: '+38344000000',
          line1: 'Rruga A, nr. 1',
          city: 'Prishtinë',
          country_code: 'XK',
        },
        shipping_method_id: (method as { id: string }).id,
        payment_provider: 'cod',
      })
      .select('id')
      .single();

    expect(error, 'subscription fixture must insert').toBeNull();
    const subscriptionId = (created as { id: string }).id;

    const { error: itemError } = await db()
      .from('subscription_items')
      .insert({
        subscription_id: subscriptionId,
        variant_id: (variant as { id: string }).id,
        quantity: 1,
      });
    expect(itemError, 'subscription item fixture must insert').toBeNull();

    // ── Invoke the cron twice ────────────────────────────────────────────────
    const headers = { authorization: `Bearer ${cronSecret()}` };

    const first = await request.get('/api/cron/subscriptions', { headers });
    expect(first.status(), 'the cron must be reachable with the secret').toBe(200);

    const second = await request.get('/api/cron/subscriptions', { headers });
    expect(second.status()).toBe(200);

    /*
     * docs/12 M9 acceptance — double invoke, one order. The guarantee is in
     * `claim_due_subscription`, and this is the end-to-end confirmation that the route does not
     * work around it.
     */
    const { data: orders } = await db()
      .from('orders')
      .select('id, order_number, discount_cents, subscription_id')
      .eq('subscription_id', subscriptionId);

    const generated = (orders ?? []) as {
      order_number: string;
      discount_cents: number;
    }[];

    expect(generated, 'exactly one order for one due cycle').toHaveLength(1);
    // docs/07 §8.2 — the discount arrives as the SUB-10 coupon, so it is a real order-level
    // discount rather than a price the renewal path invented.
    expect(generated[0]?.discount_cents ?? 0).toBeGreaterThan(0);

    // The schedule moved on by exactly one cycle.
    const { data: after } = await db()
      .from('subscriptions')
      .select('next_run_at')
      .eq('id', subscriptionId)
      .single();

    const nextRun = (after as { next_run_at: string }).next_run_at;
    expect(Date.parse(nextRun)).toBeGreaterThan(Date.now());

    // And the customer can see the delivery from their account.
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/subscriptions');
    await expect(page.getByText('Deliveries so far')).toBeVisible({ timeout: ACTION_TIMEOUT });
  });

  test('the cron refuses an unauthenticated caller', async ({ request }) => {
    const response = await request.get('/api/cron/subscriptions');
    expect(response.status()).toBe(401);
  });

  test('a one-click skip link works with no session at all', async ({ browser }) => {
    const customer = await staffUser('customer');

    const { data: profile } = await db()
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .single();

    const { data: method } = await db()
      .from('shipping_methods')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single();

    const dueIn3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    const { data: created } = await db()
      .from('subscriptions')
      .insert({
        user_id: (profile as { id: string }).id,
        status: 'active',
        frequency_days: 30,
        next_run_at: dueIn3,
        discount_pct: 10,
        shipping_address: { city: 'Prishtinë', country_code: 'XK' },
        shipping_method_id: (method as { id: string }).id,
        payment_provider: 'cod',
      })
      .select('id')
      .single();

    const subscriptionId = (created as { id: string }).id;

    const { data: token } = await db()
      .from('subscription_action_tokens')
      .insert({
        subscription_id: subscriptionId,
        action: 'skip',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('token')
      .single();

    /*
     * A fresh context with no cookies — the point of the whole mechanism. docs/12 M9's
     * acceptance is literally "notice email links skip correctly without login", and a test
     * that ran in the signed-in context would prove nothing about that.
     */
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/en/subscriptions/action?token=${(token as { token: string }).token}`);

    await expect(strangerPage.getByRole('heading', { name: 'Delivery skipped' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    const { data: after } = await db()
      .from('subscriptions')
      .select('next_run_at')
      .eq('id', subscriptionId)
      .single();

    // Moved by one cycle from the original date.
    const expected = new Date(Date.parse(`${dueIn3}T00:00:00Z`) + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect((after as { next_run_at: string }).next_run_at).toBe(expected);

    await stranger.close();
  });
});

test.describe('loyalty (docs/07 §9)', () => {
  test('a delivered order earns points, and they can be exchanged for a coupon', async ({
    page,
  }) => {
    const customer = await staffUser('customer');

    const { data: profile } = await db()
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .single();
    const userId = (profile as { id: string }).id;

    /*
     * Points are earned by a trigger on `delivered`, so the ledger is seeded the same way the
     * shop does it — through the ledger table, which `sync_loyalty_balance` mirrors into the
     * balance. Writing `profiles.loyalty_points` directly is refused by `guard_profile_self_update`,
     * which is exactly the protection being relied on here.
     */
    /*
     * 550 points, not 150.
     *
     * docs/17 §0.1 replaced the fixed "100 points for a EUR 5 coupon" tier with one point value and a
     * `min_redeem_points` floor of 500, so a balance of 150 can no longer redeem at all — the button is
     * correctly disabled and this test used to wait ninety seconds for it. The amounts below follow from
     * the floor: 500 points at 1 cent each is the same EUR 5 coupon, and 550 leaves 50 behind, which is
     * what the balance assertion at the end is checking.
     */
    const { error } = await db()
      .from('loyalty_transactions')
      .insert({ user_id: userId, points: 550, reason: 'adjustment', note: 'E2E fixture' });
    expect(error, 'ledger insert must succeed').toBeNull();

    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/loyalty');

    await expect(page.getByText('550 points')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText('Adjustment')).toBeVisible();

    // ── Exchange ─────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: /Exchange 500 points/ }).click();
    await expect(page.getByText('Here is your code')).toBeVisible({ timeout: ACTION_TIMEOUT });

    const code = await page.locator('code').first().textContent();
    expect(code, 'a real coupon code is shown').toMatch(/^LOY-[A-Z0-9]{6}$/);

    const { data: coupon } = await db()
      .from('coupons')
      .select('code, type, value, max_uses, is_system, is_active')
      .eq('code', (code ?? '').trim())
      .single();

    const row = coupon as {
      type: string;
      value: number;
      max_uses: number;
      is_system: boolean;
      is_active: boolean;
    };
    expect(row.type).toBe('fixed');
    expect(row.value, '500 points at 1 cent each is €5').toBe(500);
    expect(row.max_uses, 'single use').toBe(1);
    // docs/13 §A3 — system coupons stay active and are hidden from /offers, never deactivated.
    expect(row.is_system).toBe(true);
    expect(row.is_active).toBe(true);

    // The balance came down, through the ledger rather than a direct write.
    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from('profiles')
            .select('loyalty_points')
            .eq('id', userId)
            .single();
          return (data as { loyalty_points: number }).loyalty_points;
        },
        { timeout: ACTION_TIMEOUT },
      )
      .toBe(50);
  });

  test('a customer without enough points cannot exchange', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/loyalty');

    // Disabled rather than hidden, so the customer can see what they are working towards.
    await expect(page.getByRole('button', { name: /Exchange 500 points/ })).toBeDisabled();
  });
});
