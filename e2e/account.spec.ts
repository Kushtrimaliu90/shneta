import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ACTION_TIMEOUT, CHEAP_SKU, addCheapItemToCart, fillCheckout } from './helpers/storefront';

/**
 * docs/09 §1 journey 5 — a customer reading and cancelling their own order.
 *
 * The wishlist and address halves of that journey belong to M7 and are not here.
 *
 * Every test signs up a real customer and buys something as that customer, because the whole
 * point is what `user_id = auth.uid()` gives them: guest orders have no `user_id` and never
 * appear in an account (they go through order lookup instead, docs/05 §13).
 */

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) out[match[1]] = match[2].trim();
    }
  } catch {
    /* CI supplies these through process.env */
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY } = env();
const service: SupabaseClient | null =
  URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null;

const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) await service?.auth.admin.deleteUser(id);
});

/**
 * 203.0.113 and 198.51.100 belong to auth.spec.ts, 192.0.2 to checkout.spec.ts and 233.252.0
 * to admin.spec.ts. This file takes 233.252.1 — the same reserved multicast block, next octet —
 * so its sign-ins and checkouts spend nobody else's rate-limit budget (docs/02 §9).
 */
let addressCounter = 0;

test.beforeAll(async () => {
  await service?.from('rate_limits').delete().like('key', '%:233.252.1.%');
});

test.beforeEach(async ({ page }, testInfo) => {
  addressCounter += 1;
  const octet = ((testInfo.workerIndex * 50 + addressCounter) % 250) + 1;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `233.252.1.${octet}` });
});

/**
 * The service client, narrowed once.
 *
 * `service` is nullable because the credentials may be absent, and non-null assertions are
 * banned project-wide (CLAUDE.md §1). A named throw is better than `!` anyway: when the
 * credentials really are missing, the suite says so instead of failing on a property access.
 */
function db(): SupabaseClient {
  if (!service) throw new Error('Service credentials missing; cannot run account E2E.');
  return service;
}

/** A confirmed customer, created through the service role so no inbox is needed. */
async function customer(): Promise<{ email: string; password: string }> {
  const service = db();

  const email = `e2e-acct-${randomUUID()}@shneta.test`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Arta Krasniqi' },
  });
  if (error || !data.user) throw new Error(`fixture customer failed: ${error?.message}`);
  created.push(data.user.id);

  return { email, password };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/en/auth/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/auth\/sign-in/, { timeout: ACTION_TIMEOUT });
}

/** Signs in, buys the cheap item, and returns the order number. */
async function signedInPurchase(page: Page): Promise<{ email: string; orderNumber: string }> {
  const user = await customer();
  await signIn(page, user.email, user.password);

  await addCheapItemToCart(page);
  await page.goto('/en/checkout');
  await fillCheckout(page, user.email);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });

  await page.goto('/en/account/orders');
  const link = page.locator('#main a[href*="/account/orders/SH-"]').first();
  await expect(link).toBeVisible({ timeout: ACTION_TIMEOUT });
  const orderNumber = (await link.locator('p').first().textContent())?.trim() ?? '';

  return { email: user.email, orderNumber };
}

test.describe('journey 5 — the customer reads their own order', () => {
  test('a placed order appears in the account and opens', async ({ page }) => {
    const { orderNumber } = await signedInPurchase(page);
    expect(orderNumber).toMatch(/SH-\d{4}-\d{6}-[A-Z0-9]{4}/);

    await page.getByRole('link', { name: new RegExp(orderNumber) }).click();

    await expect(page.getByRole('heading', { level: 2, name: orderNumber })).toBeVisible();
    await expect(page.getByText(CHEAP_SKU)).toBeVisible();
    // The same OrderSummary the success page renders, so the figures match everywhere.
    await expect(page.getByText('€11.90').first()).toBeVisible();
    /*
     * Asserted by **content**, not by position or count.
     *
     * Next streams metadata: under load the layout's default lands early and the page's override
     * arrives later, so the document can carry two robots tags — and which of them is in the
     * head varies with where the streaming boundary fell (docs/13 §N9). What the page promises
     * is that it declares noindex, and that is what this checks.
     */
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).not.toHaveCount(0);
  });

  test('the empty state tells a new customer what to do', async ({ page }) => {
    const user = await customer();
    await signIn(page, user.email, user.password);

    await page.goto('/en/account/orders');
    await expect(page.getByText('No orders yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse the shop' }).first()).toBeVisible();
  });

  test('one customer cannot open another customer’s order', async ({ page, browser }) => {
    const { orderNumber } = await signedInPurchase(page);

    /*
     * The order is real and its number is known. A different signed-in customer asking for it
     * by URL must get a 404 — and that comes from RLS, not from a check in the page: the row is
     * invisible to `p_read on orders` for anyone but its owner and staff.
     */
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.1.251' });
    const other = await customer();
    await signIn(strangerPage, other.email, other.password);

    const response = await strangerPage.goto(`/en/account/orders/${orderNumber}`);
    expect(response?.status()).toBe(404);
    await stranger.close();
  });
});

test.describe('journey 5 — cancel while pending (docs/07 §7.4)', () => {
  test('a pending order can be cancelled by the customer, and stock returns', async ({ page }) => {
    const { orderNumber } = await signedInPurchase(page);

    await page.goto(`/en/account/orders/${orderNumber}`);
    await page.getByRole('button', { name: 'Cancel order' }).click();
    // Two steps on purpose: cancelled is terminal, so a mis-tap has no undo.
    await expect(page.getByText('Cancel this order? This cannot be undone.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel order' }).click();

    await expect(page.getByText('Cancelled').first()).toBeVisible({ timeout: ACTION_TIMEOUT });

    /*
     * The restock is proven by the **ledger row for this order**, not by `inventory_levels`.
     *
     * The first version compared `on_hand` before and after and asserted `before + 1`. It
     * passed alone and failed in the full suite, for a reason worth remembering: the checkout
     * journeys buy the same SKU concurrently, so a global counter moves under the test. That is
     * not flakiness to retry away — the assertion was simply about the wrong thing.
     *
     * A `cancel_restock` movement referencing this order id is order-scoped, so no amount of
     * parallelism can disturb it. It is also the stronger claim: docs/07 §11 makes the ledger
     * the authority and `on_hand` its derivative, and the cancel path does no inventory work
     * itself — `orders_after_status_change` does. This asserts that trigger ran.
     */
    const { data: order } = await db()
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .single();

    const { data: movements } = await db()
      .from('stock_movements')
      .select('type, quantity')
      .eq('reference_id', (order as { id: string }).id)
      .eq('type', 'cancel_restock');

    const restocked = (movements ?? []) as { type: string; quantity: number }[];
    expect(restocked, 'cancelling must write a cancel_restock movement').toHaveLength(1);
    expect(restocked[0]?.quantity, 'and it must return the quantity ordered').toBe(1);

    // And the option is gone — cancelled is terminal.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });

  test('once confirmed, the customer is pointed at support instead', async ({ page }) => {
    const { orderNumber } = await signedInPurchase(page);

    // Confirm it out from under them, the way support would.
    const { data: order } = await db()
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .single();
    await db()
      .from('orders')
      .update({ status: 'confirmed' })
      .eq('id', (order as { id: string }).id);

    await page.goto(`/en/account/orders/${orderNumber}`);

    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
    await expect(page.getByText('Cannot be cancelled online')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contact support' })).toBeVisible();
  });
});

test.describe('account accessibility', () => {
  test('axe finds no serious or critical violations on the order pages', async ({ page }) => {
    const { orderNumber } = await signedInPurchase(page);

    for (const path of ['/en/account/orders', `/en/account/orders/${orderNumber}`]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(blocking, `${path}\n${blocking.map((v) => `${v.id}: ${v.help}`).join('\n')}`).toEqual(
        [],
      );
    }
  });
});
