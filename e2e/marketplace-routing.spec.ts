import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/16 §6–§8, §12 step 9 — the marketplace end to end, plus accessibility on every new screen.
 *
 * ── What this file is for that the integration suite is not ──
 *
 * The integration suite proves the database refuses what it should and computes what it should. It
 * cannot see a routing screen that renders no candidates because a query lost a join, a portal page
 * that 500s from a server component, or a table that pushes the page sideways at 390 px. This drives
 * the whole loop through the screens: buy the merchant's stock, route it, accept it, ship it, and watch
 * the customer's order become `partially_shipped` and the merchant's balance appear.
 *
 * ── The a11y block at the end ──
 *
 * Eleven new screens arrived with M12 and docs/09 §4 sets the floor at no serious or critical axe
 * violations. Checked on the real pages with real data rather than on empty states, because an empty
 * table has no headers to get wrong.
 */

const ips = ipAllocator('233.252.10');

/**
 * 20 s for anything waiting on a server action's outcome.
 *
 * Playwright's default is 5 s, and this file never adopted the convention the checkout and admin specs
 * already had. It cost a full-suite failure: `a merchant proposes a product and a reviewer answers` died on
 * `Proposal sent.` at 9 s into the test, and then passed three times out of three in isolation at 10–17 s.
 * Nothing was wrong with it — the round trip is insert, revalidate, re-render against a shared Supabase in
 * eu-west-1, and under the load of a 484-test run that does not fit in five seconds.
 *
 * Well inside the 90 s per-test budget, for the reason in `playwright.config.ts`: an assertion timeout that
 * can never spend itself turns a slow action into "element(s) not found", which reads like a selector bug.
 */
const ACTION_TIMEOUT = 20_000;

const merchantIds: string[] = [];
const productIds: string[] = [];
const brandIds: string[] = [];
const orderIds: string[] = [];

test.beforeAll(async () => {
  await ips.reset();
});

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

test.afterAll(async () => {
  const service = db();

  for (const id of orderIds) {
    await service.from('order_items').delete().eq('order_id', id);
    await service.from('order_fulfilments').delete().eq('order_id', id);
    await service.from('order_events').delete().eq('order_id', id);
    await service.from('payments').delete().eq('order_id', id);
    await service.from('orders').delete().eq('id', id);
  }
  for (const id of merchantIds) {
    await service.from('merchant_ledger').delete().eq('merchant_id', id);
    await service.from('merchant_payouts').delete().eq('merchant_id', id);
    await service.from('merchant_offers').delete().eq('merchant_id', id);
    await service.from('merchants').delete().eq('id', id);
  }
  for (const id of productIds) {
    await service.from('stock_movements').delete().eq('product_id', id);
    await service.from('product_variants').delete().eq('product_id', id);
    await service.from('products').delete().eq('id', id);
  }
  for (const id of brandIds) await service.from('brands').delete().eq('id', id);
  await deleteCreatedUsers();
});

async function merchantAccount(options?: { commissionPct?: number; rating?: number }) {
  const service = db();
  const account = await staffUser('merchant');

  const { data: users } = await service.auth.admin.listUsers();
  const authUser = users.users.find((entry) => entry.email === account.email);
  if (!authUser) throw new Error('the fixture user vanished');

  const stamp = randomUUID().slice(0, 8);
  const { data, error } = await service
    .from('merchants')
    .insert({
      slug: `e2e-route-${stamp}`,
      legal_name: `E2E Route ${stamp} SH.P.K.`,
      display_name: `E2E Route ${stamp}`,
      business_no: `ARBK-RT-${stamp}`,
      contact_name: 'Arta',
      contact_email: account.email,
      contact_phone: '+383 44 000 000',
      address: { line1: 'Rr. Probe 1', city: 'Prishtinë', country_code: 'XK' },
      bank_name: 'BKT',
      iban: 'XK051000000000008888',
      status: 'approved',
      commission_pct: options?.commissionPct ?? 20,
      rating_avg: options?.rating ?? 0,
      shipping_borne_by: 'biocode',
      terms_version: '1.0',
      terms_accepted_at: new Date().toISOString(),
    })
    .select('id, display_name')
    .single();

  if (error || !data) throw new Error(`fixture merchant failed: ${error?.message}`);
  const merchant = data as { id: string; display_name: string };
  merchantIds.push(merchant.id);

  await service
    .from('merchant_users')
    .insert({ merchant_id: merchant.id, user_id: authUser.id, role: 'owner' });

  return { ...account, merchantId: merchant.id, displayName: merchant.display_name };
}

/** A published product with **no** BioCode stock, so a merchant offer is the only source. */
async function fixtureProduct(priceCents = 2000) {
  const service = db();
  const stamp = randomUUID().slice(0, 8);

  const { data: brand } = await service
    .from('brands')
    .insert({ slug: `brand-${stamp}`, name: `E2E Route Brand ${stamp}` })
    .select('id')
    .single();
  const brandId = (brand as { id: string }).id;
  brandIds.push(brandId);

  const { data: product } = await service
    .from('products')
    .insert({
      slug: `product-${stamp}`,
      brand_id: brandId,
      name: { sq: `Produkt R ${stamp}`, en: `E2E Route Product ${stamp}` },
      status: 'published',
      published_at: new Date().toISOString(),
    })
    .select('id, slug')
    .single();
  const row = product as { id: string; slug: string };
  productIds.push(row.id);

  const { data: variant } = await service
    .from('product_variants')
    .insert({
      product_id: row.id,
      sku: `SKU-R-${stamp}`,
      name: { sq: '60 kapsula', en: '60 capsules' },
      price_cents: priceCents,
      is_default: true,
      is_active: true,
    })
    .select('id, sku')
    .single();

  const v = variant as { id: string; sku: string };
  return { productId: row.id, slug: row.slug, variantId: v.id, sku: v.sku, priceCents };
}

async function offer(
  merchantId: string,
  variantId: string,
  fields: { price: number; stock: number },
): Promise<string> {
  const { data, error } = await db()
    .from('merchant_offers')
    .insert({
      merchant_id: merchantId,
      variant_id: variantId,
      price_cents: fields.price,
      stock_on_hand: fields.stock,
      status: 'approved',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`offer failed: ${error?.message}`);
  return (data as { id: string }).id;
}

/**
 * Buys the variant as a guest, through the real checkout.
 *
 * Through the RPC rather than by driving the checkout form, deliberately: the checkout journeys already
 * exercise that form in `checkout.spec.ts`, and repeating a dozen form fills here would make this file
 * about checkout instead of about routing.
 */
async function buy(variantId: string, quantity = 1): Promise<string> {
  const service = db();

  const { data: cart } = await service
    .from('carts')
    .insert({ status: 'active' })
    .select('id')
    .single();
  const cartId = (cart as { id: string }).id;

  await service.from('cart_items').insert({ cart_id: cartId, variant_id: variantId, quantity });

  const { data: method } = await service
    .from('shipping_methods')
    .select('id')
    .eq('is_active', true)
    .order('position')
    .limit(1)
    .single();

  const address = {
    recipient_name: 'E2E Klienti',
    phone: '+38344000000',
    line1: 'Rr. Probe 2',
    city: 'Prishtinë',
    country_code: 'XK',
  };

  const { data, error } = await service.rpc('checkout_create_order', {
    p_cart_id: cartId,
    p_email: `route-buyer-${randomUUID().slice(0, 8)}@biocode.test`,
    p_phone: '+38344000000',
    p_shipping_address: address,
    p_billing_address: address,
    p_shipping_method_id: (method as { id: string }).id,
    p_payment_provider: 'cod',
    p_coupon_code: null,
    p_customer_note: null,
    p_locale: 'sq',
  });

  if (error) throw new Error(`checkout failed: ${error.message}`);
  const orderId = (data as { order_id: string }).order_id;
  orderIds.push(orderId);
  return orderId;
}

async function orderNumber(orderId: string): Promise<string> {
  const { data } = await db().from('orders').select('order_number').eq('id', orderId).single();
  return (data as { order_number: string }).order_number;
}

test.describe('the whole loop, through the screens (docs/16 §6, §7)', () => {
  /**
   * The journey the milestone exists for: a customer buys a merchant's stock, an admin routes it, the
   * merchant accepts and ships it, the order becomes shipped, and the money appears.
   */
  test('buy, route, accept, ship, and the merchant is owed', async ({ page, browser }) => {
    const merchant = await merchantAccount({ commissionPct: 20 });
    const product = await fixtureProduct(2000);
    await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });

    const orderId = await buy(product.variantId, 2);
    const number = await orderNumber(orderId);

    // ── Admin routes it ──
    const support = await staffUser('support');
    await signIn(page, support.email, support.password);
    await page.goto('/admin/routing');

    const card = page.locator('article').filter({ hasText: number });
    await expect(card).toBeVisible();

    /*
     * The candidate holding the reservation is marked, because confirming it is the common case and the
     * one that moves nothing — the buy box already chose it at checkout.
     */
    await expect(card.getByText('holds stock')).toBeVisible();
    await card.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.locator('article').filter({ hasText: number })).toBeHidden({
      timeout: ACTION_TIMEOUT,
    });

    // ── The merchant accepts, packs and ships ──
    const portal = await browser.newContext();
    await portal.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.10.240' });
    const merchantPage = await portal.newPage();
    await signIn(merchantPage, merchant.email, merchant.password);

    await merchantPage.goto('/en/merchant/orders');
    await merchantPage.getByRole('link').filter({ hasText: number }).click();

    await expect(merchantPage.getByText('This order is waiting on your answer')).toBeVisible();
    // The address is released only once assigned — and it is, so it shows.
    await expect(merchantPage.getByRole('heading', { name: 'Ship to' })).toBeVisible();

    await merchantPage.getByRole('button', { name: 'Accept' }).click();
    await expect(merchantPage.getByRole('button', { name: 'Mark as packed' })).toBeVisible();

    await merchantPage.getByRole('button', { name: 'Mark as packed' }).click();
    // A paragraph, not a heading: the panel's own title is the page heading above it.
    await expect(merchantPage.getByText('Ship the parcel')).toBeVisible();

    await merchantPage.locator('#carrier').fill('Probe Post');
    await merchantPage.locator('#trackingCode').fill('PP-E2E-0001');
    await merchantPage.getByRole('button', { name: 'Mark as shipped' }).click();

    await expect(merchantPage.getByText('Nothing to do on this order.')).toBeVisible();

    // ── The order followed ──
    const { data: order } = await db().from('orders').select('status').eq('id', orderId).single();
    expect((order as { status: string }).status).toBe('shipped');

    // ── Delivery is BioCode's word, and it is what makes the merchant owed ──
    await db().from('orders').update({ status: 'delivered' }).eq('id', orderId);

    await merchantPage.goto('/en/merchant/payouts');
    // €40.00 of items at 20% leaves €32.00 unsettled.
    await expect(merchantPage.getByText('€32.00')).toBeVisible();
    await expect(merchantPage.getByText('Unsettled, owed to you')).toBeVisible();

    await portal.close();
  });

  /**
   * Declining returns the order to the queue **and the stock to the merchant**. A merchant that ships
   * nothing keeps its stock; leaving it reserved would shrink the stock of whoever was honest about not
   * being able to ship.
   */
  test('declining returns the order to the queue and the stock to the merchant', async ({
    page,
    browser,
  }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(2000);
    const offerId = await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });

    const orderId = await buy(product.variantId, 3);
    const number = await orderNumber(orderId);

    const service = db();
    const { data: reserved } = await service
      .from('merchant_offers')
      .select('stock_on_hand')
      .eq('id', offerId)
      .single();
    expect((reserved as { stock_on_hand: number }).stock_on_hand).toBe(7);

    // Assign it so the merchant has something to decline.
    const { data: fulfilment } = await service
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .eq('fulfiller_kind', 'merchant')
      .single();

    const support = await staffUser('support');
    const staffContext = await browser.newContext();
    await staffContext.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.10.241' });
    const staffPage = await staffContext.newPage();
    await signIn(staffPage, support.email, support.password);
    await staffPage.goto('/admin/routing');
    await staffPage
      .locator('article')
      .filter({ hasText: number })
      .getByRole('button', { name: 'Confirm' })
      .click();

    // The card leaving the unassigned queue is the assignment having actually landed. Closing the
    // context before that aborts the in-flight action, and the merchant then has nothing to decline.
    await expect(staffPage.locator('article').filter({ hasText: number })).toBeHidden({
      timeout: ACTION_TIMEOUT,
    });
    await staffContext.close();

    await signIn(page, merchant.email, merchant.password);
    await page.goto(`/en/merchant/orders/${(fulfilment as { id: string }).id}`);

    await page.getByRole('button', { name: 'Decline' }).click();
    await page.locator('textarea[name="reason"]').fill('We sold the last of these at the counter.');
    await page.getByRole('button', { name: 'Confirm the decline' }).click();

    await expect(page.getByText('This order is not assigned yet')).toBeVisible();

    const { data: returned } = await service
      .from('merchant_offers')
      .select('stock_on_hand')
      .eq('id', offerId)
      .single();
    expect((returned as { stock_on_hand: number }).stock_on_hand, 'stock came back').toBe(10);
  });

  /**
   * A mixed order ships in two parts, and the order says `partially_shipped` — the state the old enum
   * could not express and which was unreachable until step 4.
   */
  test('a mixed order becomes partially shipped', async ({ page }) => {
    const service = db();
    const merchant = await merchantAccount();

    const own = await fixtureProduct(3000);
    const { data: warehouse } = await service
      .from('warehouses')
      .select('id')
      .eq('is_default', true)
      .single();
    await service.rpc('apply_stock_movement', {
      p_variant_id: own.variantId,
      p_warehouse_id: (warehouse as { id: string }).id,
      p_type: 'received',
      p_quantity: 10,
      p_note: 'e2e first-party half',
    });

    const theirs = await fixtureProduct(2000);
    await offer(merchant.merchantId, theirs.variantId, { price: 1200, stock: 10 });

    // One cart with both halves.
    const { data: cart } = await service
      .from('carts')
      .insert({ status: 'active' })
      .select('id')
      .single();
    const cartId = (cart as { id: string }).id;
    await service.from('cart_items').insert([
      { cart_id: cartId, variant_id: own.variantId, quantity: 1 },
      { cart_id: cartId, variant_id: theirs.variantId, quantity: 1 },
    ]);

    const { data: method } = await service
      .from('shipping_methods')
      .select('id')
      .eq('is_active', true)
      .order('position')
      .limit(1)
      .single();

    const address = {
      recipient_name: 'E2E Klienti',
      phone: '+38344000000',
      line1: 'Rr. Probe 3',
      city: 'Prishtinë',
      country_code: 'XK',
    };

    const { data: placed } = await service.rpc('checkout_create_order', {
      p_cart_id: cartId,
      p_email: `mixed-${randomUUID().slice(0, 8)}@biocode.test`,
      p_phone: '+38344000000',
      p_shipping_address: address,
      p_billing_address: address,
      p_shipping_method_id: (method as { id: string }).id,
      p_payment_provider: 'cod',
      p_coupon_code: null,
      p_customer_note: null,
      p_locale: 'sq',
    });

    const orderId = (placed as { order_id: string }).order_id;
    orderIds.push(orderId);

    const { data: rows } = await service
      .from('order_fulfilments')
      .select('id, fulfiller_kind')
      .eq('order_id', orderId);

    const biocode = ((rows ?? []) as { id: string; fulfiller_kind: string }[]).find(
      (row) => row.fulfiller_kind === 'biocode',
    );

    // BioCode's half ships; the merchant's has not.
    await service
      .from('order_fulfilments')
      .update({ status: 'shipped' })
      .eq('id', biocode?.id ?? '');

    const { data: order } = await service
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();
    expect((order as { status: string }).status).toBe('partially_shipped');

    // And an admin sees which half is where.
    const support = await staffUser('support');
    await signIn(page, support.email, support.password);
    await page.goto(`/admin/orders/${orderId}`);

    await expect(page.getByRole('heading', { name: 'Fulfilment' })).toBeVisible();
    await expect(page.getByText('BioCode', { exact: true })).toBeVisible();
    await expect(page.getByText(merchant.displayName)).toBeVisible();
  });
});

test.describe('the money screens (docs/16 §8)', () => {
  /** Building a statement drops the balance by exactly what it says, and both sides show the same. */
  test('an admin builds a statement and the merchant reads it', async ({ page, browser }) => {
    const service = db();
    const merchant = await merchantAccount({ commissionPct: 20 });

    // A delivered fulfilment, which is the only state that owes anybody anything.
    const product = await fixtureProduct(2000);
    await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });
    const orderId = await buy(product.variantId, 1);

    const { data: fulfilment } = await service
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .eq('fulfiller_kind', 'merchant')
      .single();

    const fulfilmentId = (fulfilment as { id: string }).id;
    await service.from('order_fulfilments').update({ status: 'shipped' }).eq('id', fulfilmentId);
    await service.from('order_fulfilments').update({ status: 'delivered' }).eq('id', fulfilmentId);

    // ── Admin builds ──
    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);
    await page.goto('/admin/payouts');

    await expect(page.getByText(merchant.displayName).first()).toBeVisible();

    /*
     * The form defaults to the fortnight that has just **closed**, which by design does not include
     * rows written moments ago. A test that pressed the button without setting the dates would be
     * asserting against an empty period and calling the result a bug.
     */
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('input[name="periodStart"]').fill(today);
    await page.locator('input[name="periodEnd"]').fill(today);
    await page.getByRole('button', { name: 'Build statements' }).click();
    await expect(page.getByText(/Built \d+ statement/)).toBeVisible();

    // ── The merchant reads the same numbers ──
    const portal = await browser.newContext();
    await portal.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.10.242' });
    const merchantPage = await portal.newPage();
    await signIn(merchantPage, merchant.email, merchant.password);

    await merchantPage.goto('/en/merchant/payouts');
    // Settled to zero, because building posted the balancing ledger row.
    await expect(merchantPage.getByText('Nothing unsettled.')).toBeVisible();

    await merchantPage.getByRole('link').filter({ hasText: '€16.00' }).first().click();
    await expect(merchantPage.getByRole('heading', { level: 3, name: 'Lines' })).toBeVisible();

    /*
     * Scoped to the table, because "Commission" also labels the summary above it and the statement
     * heading. The claim is that the **lines** name what they are, not that the word appears somewhere.
     */
    const lines = merchantPage.getByRole('table');
    await expect(lines.getByText('Sale')).toBeVisible();
    await expect(lines.getByText('Commission')).toBeVisible();
    // Last four only, on a document that gets printed.
    await expect(merchantPage.getByText('•••• 8888')).toBeVisible();

    await portal.close();
  });

  /** A payout marked paid with nothing to trace it by is where reconciliation arguments start. */
  test('marking a payout paid requires a bank reference', async ({ page }) => {
    const service = db();
    const merchant = await merchantAccount();

    await service.from('merchant_ledger').insert([
      { merchant_id: merchant.merchantId, kind: 'sale', amount_cents: 2000, note: 'e2e' },
      { merchant_id: merchant.merchantId, kind: 'commission', amount_cents: -400, note: 'e2e' },
    ]);

    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);
    await page.goto('/admin/payouts');

    /*
     * The form defaults to the fortnight that has just **closed**, which by design does not include
     * rows written moments ago. A test that pressed the button without setting the dates would be
     * asserting against an empty period and calling the result a bug.
     */
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('input[name="periodStart"]').fill(today);
    await page.locator('input[name="periodEnd"]').fill(today);
    await page.getByRole('button', { name: 'Build statements' }).click();
    await expect(page.getByText(/Built \d+ statement/)).toBeVisible();

    const card = page.locator('article').filter({ hasText: merchant.displayName });
    await card.getByRole('textbox').fill('BKT-E2E-9001');
    await card.getByRole('button', { name: 'Mark paid' }).click();

    await expect(card.getByText(/Paid .* ref/)).toBeVisible({ timeout: ACTION_TIMEOUT });
  });
});

test.describe('bulk update (docs/16 §6)', () => {
  /**
   * The paste path, with a semicolon sheet and a comma decimal — which is what Excel produces here and
   * what a comma-only parser would have failed on for most merchants.
   */
  test('a semicolon sheet with a comma decimal applies', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(3000);
    await offer(merchant.merchantId, product.variantId, { price: 1500, stock: 2 });

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/bulk');

    await page.locator('textarea[name="csv"]').fill(`sku;stock;price\n${product.sku};25;18,50`);
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('Applied 1 row(s).')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.goto('/en/merchant/offers');
    const row = page.getByRole('row').filter({ hasText: product.sku });
    await expect(row.getByText('€18.50')).toBeVisible();
  });

  /** A sheet with no recognisable header is refused, not guessed at. */
  test('a headerless paste is refused', async ({ page }) => {
    const merchant = await merchantAccount();
    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/bulk');

    await page.locator('textarea[name="csv"]').fill('ABC-1;5;12,50');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText(/first row must contain the column names/)).toBeVisible();
  });

  /**
   * docs/16 §6.1 — the paste that creates offers.
   *
   * Two rows and one tick: a SKU the merchant already has an offer on is updated, one it does not becomes a
   * **draft**. The draft is what the whole feature turns on — an offer a paste could publish would be a
   * merchant publishing supply, and the assertion that it says "Draft" in the offers table is the
   * assertion that the review model survived the convenience.
   */
  test('a ticked paste creates a draft offer and updates an existing one', async ({ page }) => {
    const merchant = await merchantAccount();
    const existing = await fixtureProduct(3000);
    const fresh = await fixtureProduct(4000);
    await offer(merchant.merchantId, existing.variantId, { price: 1500, stock: 2 });

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/bulk');

    // The catalogue download is what tells a merchant these codes in the first place.
    await expect(page.getByRole('link', { name: 'Download the catalogue' })).toBeVisible();

    await page
      .locator('textarea[name="csv"]')
      .fill(
        `sku;stock;price;handling;lowstock\n${existing.sku};30;17,50;2;5\n${fresh.sku};8;21,00;3;4`,
      );
    await page.getByRole('checkbox', { name: /Create offers for SKUs/ }).check();
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('Applied 1 row(s).')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText(/Created 1 draft offer/)).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.goto('/en/merchant/offers');

    const updated = page.getByRole('row').filter({ hasText: existing.sku });
    await expect(updated.getByText('€17.50')).toBeVisible();

    const created = page.getByRole('row').filter({ hasText: fresh.sku });
    await expect(created.getByText('€21.00')).toBeVisible();
    await expect(created.getByText('Draft'), 'a paste cannot publish supply').toBeVisible();
  });

  /** Without the tick, an unmatched SKU is reported. A nightly stock file must not invent offers. */
  test('an unticked paste reports the unmatched SKU instead of creating it', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(3000);

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/bulk');

    await page.locator('textarea[name="csv"]').fill(`sku;stock;price\n${product.sku};5;9,90`);
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('Applied 0 row(s).')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText(/no matching offer of yours/)).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    await page.goto('/en/merchant/offers');
    await expect(page.getByRole('row').filter({ hasText: product.sku })).toHaveCount(0);
  });
});

test.describe('proposals (docs/16 §4)', () => {
  test('a merchant proposes a product and a reviewer answers', async ({ page, browser }) => {
    const merchant = await merchantAccount();

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/proposals');

    const name = `E2E Creatine ${randomUUID().slice(0, 6)}`;
    await page.locator('#productName').fill(name);
    await page.locator('#brandName').fill('Probe Labs');
    await page.locator('#stockOnHand').fill('12');
    await page.locator('#askingPriceEuro').fill('14,50');
    await page
      .locator('#note')
      .fill('Customers ask for this constantly and we import it directly.');
    await page.getByRole('button', { name: 'Send the proposal' }).click();

    await expect(page.getByText('Proposal sent.')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText(name)).toBeVisible();

    // ── The reviewer answers ──
    const staffContext = await browser.newContext();
    await staffContext.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.10.243' });
    const staffPage = await staffContext.newPage();
    const reviewer = await staffUser('product_manager');
    await signIn(staffPage, reviewer.email, reviewer.password);

    await staffPage.goto('/admin/merchants/proposals');
    const card = staffPage.locator('article').filter({ hasText: name });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Approve' }).click();
    await card.locator('textarea[name="note"]').fill('Listed as BIO-E2E-1. Add an offer on it.');
    // The submit inside the panel, not the toggle that opened it — both are named "Approve".
    await card.locator('form').getByRole('button', { name: 'Approve' }).click();

    // The card leaves the pending queue when the decision lands; closing before that aborts it.
    await expect(staffPage.locator('article').filter({ hasText: name })).toBeHidden({
      timeout: ACTION_TIMEOUT,
    });
    await staffContext.close();

    // The merchant reads the answer where it was promised.
    await page.reload();
    await expect(page.getByText('Listed as BIO-E2E-1')).toBeVisible({ timeout: ACTION_TIMEOUT });

    /*
     * The draft this approval created has to be registered for cleanup (docs/13 §X16).
     *
     * This test predates §9, when approving recorded a decision and created nothing. It now leaves a draft
     * product and a brand behind, and the purge cannot see either: it matches `slug LIKE 'product-%'` and a
     * promoted draft is slugged from the product name. Ten of these accumulated on the shared project in one
     * day before anybody counted them.
     */
    const service = db();
    const { data: proposal } = await service
      .from('product_proposals')
      .select('created_product_id')
      .eq('merchant_id', merchant.merchantId)
      .maybeSingle();

    const productId = (proposal as { created_product_id: string | null } | null)
      ?.created_product_id;
    expect(productId, 'approving promotes the proposal').toBeTruthy();

    if (productId) {
      productIds.push(productId);
      const { data: product } = await service
        .from('products')
        .select('brand_id')
        .eq('id', productId)
        .single();
      brandIds.push((product as { brand_id: string }).brand_id);
    }
  });

  /**
   * docs/16 §9 — the photograph a merchant sends ends up on the product BioCode creates.
   *
   * The whole point of the feature, and the assertion worth having is the **last** one: the draft is
   * invisible to a shopper. A merchant's photograph reaching a product page is the goal; reaching a
   * customer without a compliance officer having looked is not, and `status = 'draft'` is what separates
   * the two.
   */
  test('a proposed photograph lands on the draft product, which stays invisible', async ({
    page,
    browser,
  }) => {
    const merchant = await merchantAccount();
    const service = db();

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/proposals');

    const name = `E2E Photo Probe ${randomUUID().slice(0, 6)}`;
    await page.locator('#productName').fill(name);
    await page.locator('#brandName').fill(`Photo Labs ${randomUUID().slice(0, 6)}`);
    await page.locator('#form').fill('powder');
    await page.locator('#variantName').fill('500 g');
    await page.locator('#stockOnHand').fill('8');
    await page.locator('#askingPriceEuro').fill('12,90');
    await page.locator('#note').fill('We hold this and can photograph the real packaging.');

    /*
     * A real 1×1 PNG — the same bytes journey 8 uses — not a stub with a PNG content type. The bucket
     * enforces its own MIME allowlist, and this travels browser → private bucket → public bucket, so
     * anything storage would refuse proves nothing about the path that matters.
     */
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    // The input is `hidden` behind a styled button; `setInputFiles` needs it attached, not visible.
    await page.locator('#proposal-images').setInputFiles({
      name: 'packaging.png',
      mimeType: 'image/png',
      buffer: png,
    });

    // The preview appearing is the upload having landed — the hidden path input exists only after it does.
    await expect(page.getByAltText(/Preview of packaging\.png/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Send the proposal' }).click();
    await expect(page.getByText('Proposal sent.')).toBeVisible({ timeout: 20_000 });

    // ── The reviewer sees the photograph and approves ──
    const staffContext = await browser.newContext();
    await staffContext.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.10.244' });
    const staffPage = await staffContext.newPage();
    const reviewer = await staffUser('product_manager');
    await signIn(staffPage, reviewer.email, reviewer.password);

    await staffPage.goto('/admin/merchants/proposals');
    const card = staffPage.locator('article').filter({ hasText: name });
    await expect(card).toBeVisible();

    /*
     * The thumbnail, served through `/admin/merchants/proposal-image`, which signs on request.
     *
     * Fetched rather than merely located: a broken `<img>` is still "visible", and the claim being made
     * here is that a reviewer can *see* the photograph before deciding — which means the private bucket,
     * the signing route and the redirect all have to work.
     */
    const thumbnail = card.getByAltText(/Proposed product photograph/);
    await expect(thumbnail).toBeVisible();

    const signed = await staffPage.request.get((await thumbnail.getAttribute('src')) ?? '');
    expect(signed.status(), 'the reviewer can see it before approving').toBe(200);

    await card.getByRole('button', { name: 'Approve' }).click();
    await card.locator('textarea[name="note"]').fill('Listed. Set the price before publishing.');
    await card.locator('form').getByRole('button', { name: 'Approve' }).click();

    // The card leaves the pending queue when the decision lands; closing before that aborts the promotion.
    await expect(staffPage.locator('article').filter({ hasText: name })).toBeHidden({
      timeout: 20_000,
    });

    // ── The draft exists, carries the image, and is not on the storefront ──
    const { data: proposal } = await service
      .from('product_proposals')
      .select('created_product_id')
      .eq('merchant_id', merchant.merchantId)
      .eq('status', 'approved')
      .single();

    const productId = (proposal as { created_product_id: string | null }).created_product_id;
    expect(productId, 'approval promoted the proposal').toBeTruthy();
    if (!productId) throw new Error('no draft product');
    productIds.push(productId);

    const { data: product } = await service
      .from('products')
      .select('slug, status, brand_id, form')
      .eq('id', productId)
      .single();

    const row = product as {
      slug: string;
      status: string;
      brand_id: string;
      form: string | null;
    };
    expect(row.status).toBe('draft');
    // "powder" is one of ours, so it carried across; free text that is not would be left for the reviewer.
    expect(row.form).toBe('powder');
    brandIds.push(row.brand_id);

    const { data: images } = await service
      .from('product_images')
      .select('storage_path')
      .eq('product_id', productId);

    expect(images ?? [], 'the photograph came with it').toHaveLength(1);
    /*
     * `<product_id>/<file>` — the same shape `media-actions.ts` signs for an editor upload, asserted in
     * `admin.spec.ts:661`. One convention in the bucket, so an image that arrived from a proposal is
     * indistinguishable from one a product manager added.
     */
    expect(
      (images as { storage_path: string }[])[0]?.storage_path.startsWith(`${productId}/`),
    ).toBe(true);

    // The image is now on the public bucket, which is what puts it on the page once published.
    const publicUrl = service.storage
      .from('product-images')
      .getPublicUrl((images as { storage_path: string }[])[0]?.storage_path ?? '').data.publicUrl;
    const fetched = await staffPage.request.get(publicUrl);
    expect(fetched.status(), 'and is actually served').toBe(200);

    await staffContext.close();

    /*
     * ── And a shopper cannot reach it ──
     *
     * By slug, not by search: a search that finds nothing proves nothing, because a made-up product name
     * may simply not match the query parser. The product's own URL is the strongest available claim — a
     * published product answers 200 there, and this one must not.
     */
    const shopper = await page.goto(`/en/product/${row.slug}`);
    expect(shopper?.status(), 'a draft is not on the storefront').toBe(404);
  });

  /**
   * docs/16 §9.1 — a pasted catalogue, photographs matched by filename, decided as one thing.
   *
   * The whole feature in one journey, because the parts only mean something together: a sheet is worthless
   * without photographs, filename matching is the only reason a merchant would attach three hundred of them,
   * and the batch is the only reason a reviewer would look at two hundred rows.
   *
   * Three rows, two photographs. One filename carries a barcode, one carries the merchant's own SKU with a
   * `-2` counter, and the third row gets nothing — so the assertions cover a match, a match through the
   * counter-stripping path, and a row a reviewer must be told has no images.
   */
  test('a pasted catalogue matches photographs by filename and is decided as a unit', async ({
    page,
    browser,
  }) => {
    const merchant = await merchantAccount();
    const service = db();

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/proposals/bulk');

    const stamp = randomUUID().slice(0, 6);
    const barcode = `509${Date.now().toString().slice(-10)}`;
    const sku = `MG-${stamp}`;
    const names = [`Batch Alpha ${stamp}`, `Batch Beta ${stamp}`, `Batch Gamma ${stamp}`];

    await page
      .locator('textarea[name="csv"]')
      .fill(
        [
          'name;brand;form;variant;barcode;sku;stock;price',
          `${names[0]};Probe Labs ${stamp};capsule;120 caps;${barcode};;12;14,90`,
          `${names[1]};Probe Labs ${stamp};powder;500 g;;${sku};8;21,50`,
          `${names[2]};Probe Labs ${stamp};;;;;3;9,90`,
        ].join('\n'),
      );
    await page.locator('textarea[name="note"]').fill('Our importer list. We hold all of it.');
    await page.getByRole('button', { name: 'Send the sheet' }).click();

    // A clean sheet navigates to the batch, because the rows are only half a proposal (§9.1).
    await expect(page.getByRole('heading', { name: '3 product(s)' })).toBeVisible({
      timeout: 20_000,
    });

    // ── The photographs, named after the codes ──
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    await page.locator('#batch-images').setInputFiles([
      // Matches row 1 on the barcode.
      { name: `${barcode}.png`, mimeType: 'image/png', buffer: png },
      // Matches row 2 on the merchant's SKU, through the trailing-counter path.
      { name: `${sku}-2.png`, mimeType: 'image/png', buffer: png },
      // Matches nothing: a camera filename, which is exactly why the assign list exists.
      { name: 'IMG_4821.png', mimeType: 'image/png', buffer: png },
    ]);

    await expect(page.getByRole('heading', { name: 'Matched to a product (2)' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Could not be matched (1)' })).toBeVisible();

    /*
     * axe here, not in the a11y block.
     *
     * The matched and unmatched lists only exist while files are in flight, so the scan in the accessibility
     * describe — which visits a batch page with nothing uploaded — cannot see them. This is the only moment
     * the assign list is on screen, and it is a `<select>` per row whose label is `sr-only`.
     */
    const uploadAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      uploadAxe.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} on ${v.nodes.length} node(s)`),
      'axe found serious violations on the batch upload lists',
    ).toEqual([]);

    // The unmatched one is assigned by hand — the handful of dropdowns the keying leaves behind.
    await page.getByRole('combobox').selectOption({ label: names[2] ?? '' });
    await expect(page.getByRole('heading', { name: 'Matched to a product (3)' })).toBeVisible();

    await page.getByRole('button', { name: /Attach 3 photograph/ }).click();
    await expect(page.getByText('Attached 3 photograph(s).')).toBeVisible({ timeout: 30_000 });

    /*
     * Read back from the database rather than the screen: the claim is that each photograph reached the row
     * its *filename* named, and a count on the page would pass even if all three landed on one row.
     */
    const { data: rows } = await service
      .from('product_proposals')
      .select('payload')
      .eq('merchant_id', merchant.merchantId);

    const byName = new Map(
      ((rows ?? []) as { payload: Record<string, unknown> }[]).map((entry) => [
        String(entry.payload.product_name ?? ''),
        (entry.payload.images as string[] | undefined) ?? [],
      ]),
    );

    expect(byName.get(names[0] ?? '')).toHaveLength(1);
    expect(byName.get(names[0] ?? '')?.[0]).toContain(barcode);
    expect(byName.get(names[1] ?? ''), 'the -2 counter came off before matching').toHaveLength(1);
    expect(byName.get(names[2] ?? ''), 'assigned by hand').toHaveLength(1);

    // ── The reviewer rejects one row and approves the rest ──
    const staffContext = await browser.newContext();
    await staffContext.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.10.245' });
    const staffPage = await staffContext.newPage();
    const reviewer = await staffUser('product_manager');
    await signIn(staffPage, reviewer.email, reviewer.password);

    await staffPage.goto('/admin/merchants/proposals');
    // By merchant name, not by row count: other fixtures leave batches in this queue too.
    await staffPage
      .getByRole('link', { name: new RegExp(`${merchant.displayName} — 3 row`) })
      .click();

    await expect(staffPage.getByRole('heading', { name: /3 row\(s\)/ })).toBeVisible();
    // The photographs are visible to the reviewer before the decision, through the signing route.
    await expect(staffPage.getByAltText(/Proposed product photograph/).first()).toBeVisible();

    const rejectedRow = staffPage.getByRole('row').filter({ hasText: names[2] ?? '' });
    await rejectedRow.getByRole('button', { name: 'Reject' }).click();
    await rejectedRow.locator('textarea[name="note"]').fill('We already list this under Alpha.');
    await rejectedRow.getByRole('button', { name: 'Reject' }).click();

    await expect(rejectedRow.getByText('rejected')).toBeVisible({ timeout: 20_000 });

    // Approving takes every row still pending and leaves the rejected one alone.
    await staffPage.getByRole('button', { name: /Approve the 2 pending row/ }).click();
    await staffPage
      .locator('form')
      .locator('textarea[name="note"]')
      .fill('Listing both. Prices to be set before publishing.');
    await staffPage.getByRole('button', { name: 'Approve', exact: true }).click();

    await expect(staffPage.getByText(/2 row\(s\) decided/)).toBeVisible({ timeout: 60_000 });

    await staffContext.close();

    /*
     * ── Two drafts, and the rejected row produced nothing ──
     *
     * `decideBatch` promotes a bounded first slice inline (ten) and leaves the rest to the cron, so at this
     * size both rows have their draft product by the time the message renders.
     */
    const { data: after } = await service
      .from('product_proposals')
      .select('status, created_product_id, payload')
      .eq('merchant_id', merchant.merchantId);

    const decided = (after ?? []) as {
      status: string;
      created_product_id: string | null;
      payload: Record<string, unknown>;
    }[];

    const approved = decided.filter((entry) => entry.status === 'approved');
    const rejected = decided.filter((entry) => entry.status === 'rejected');

    expect(approved).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.created_product_id, 'a rejected row makes no product').toBeNull();

    for (const entry of approved) {
      expect(entry.created_product_id, 'approved rows were promoted').toBeTruthy();
      const productId = entry.created_product_id ?? '';
      productIds.push(productId);

      const { data: product } = await service
        .from('products')
        .select('status, brand_id')
        .eq('id', productId)
        .single();

      const row = product as { status: string; brand_id: string };
      // Still a draft. A pasted catalogue does not put anything on the storefront (§9).
      expect(row.status).toBe('draft');
      brandIds.push(row.brand_id);

      const { data: images } = await service
        .from('product_images')
        .select('storage_path')
        .eq('product_id', productId);
      expect((images ?? []) as unknown[], 'the merchant photograph came with it').toHaveLength(1);
    }
  });
});

test.describe('accessibility (docs/09 §4)', () => {
  /**
   * No serious or critical axe violations on the eleven screens M12 added.
   *
   * Run against pages with **real data** rather than empty states: an empty table has no headers to get
   * wrong, no status chips whose contrast can fail, and no form controls to leave unlabelled.
   */
  async function scan(page: Page, path: string): Promise<void> {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );

    expect(
      serious.map((violation) => `${violation.id} on ${violation.nodes.length} node(s)`),
      `axe found serious violations on ${path}`,
    ).toEqual([]);
  }

  test('the merchant portal is accessible with real data', async ({ page }) => {
    const merchant = await merchantAccount({ commissionPct: 20 });
    const product = await fixtureProduct(2000);
    await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });

    const service = db();
    await service.from('merchant_ledger').insert([
      { merchant_id: merchant.merchantId, kind: 'sale', amount_cents: 2000, note: 'e2e' },
      { merchant_id: merchant.merchantId, kind: 'commission', amount_cents: -400, note: 'e2e' },
    ]);

    const orderId = await buy(product.variantId, 1);
    const { data: fulfilment } = await service
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .eq('fulfiller_kind', 'merchant')
      .single();

    await service
      .from('order_fulfilments')
      .update({ status: 'assigned', assigned_at: new Date().toISOString() })
      .eq('id', (fulfilment as { id: string }).id);

    await signIn(page, merchant.email, merchant.password);

    for (const path of [
      '/en/merchant',
      '/en/merchant/orders',
      `/en/merchant/orders/${(fulfilment as { id: string }).id}`,
      '/en/merchant/offers',
      '/en/merchant/offers/new',
      '/en/merchant/bulk',
      '/en/merchant/proposals',
      '/en/merchant/proposals/bulk',
      '/en/merchant/payouts',
      '/en/merchant/documents',
      '/en/merchant/settings',
    ]) {
      await scan(page, path);
    }

    /*
     * The batch page separately, because it needs a batch (§9.1).
     *
     * Its table is the widest surface in the portal — seven columns — so it is the one most likely to
     * overflow at 390 px, which is where `scrollable-region-focusable` fired during M12 (docs/13 §X6).
     */
    const { data: batch } = await db().rpc('merchant_bulk_create_proposals', {
      p_merchant_id: merchant.merchantId,
      p_rows: [
        {
          product_name: 'Axe Batch Probe',
          brand_name: 'Probe Labs',
          asking_price_cents: 1500,
          stock_on_hand: 4,
          barcode: '5099999999123',
        },
      ],
      p_note: 'For the a11y scan.',
    });

    const batchId = (batch as { batch_id: string }).batch_id;
    await scan(page, `/en/merchant/proposals/${batchId}`);
  });

  test('the admin marketplace screens are accessible with real data', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(2000);
    await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });
    await buy(product.variantId, 1);

    const service = db();
    await service
      .from('merchant_ledger')
      .insert([
        { merchant_id: merchant.merchantId, kind: 'sale', amount_cents: 2000, note: 'e2e' },
      ]);
    /*
     * With an image path, so the review card's photograph block is scanned too (docs/16 §9).
     *
     * The object does not exist, and that is fine here: the signing route answers 404 and the browser
     * shows a broken thumbnail, while axe checks the thing being asserted — that the `<img>` carries alt
     * text and the list around it is markup a screen reader can follow. Loading bytes is the journey
     * test's job.
     */
    await service.from('product_proposals').insert({
      merchant_id: merchant.merchantId,
      status: 'pending',
      payload: {
        product_name: 'Axe probe',
        brand_name: 'Probe',
        note: 'For the a11y scan.',
        images: [`proposals/${merchant.merchantId}/axe-probe.png`],
      },
    });

    // A batch too, so the reviewer's table — the widest grid in the admin panel — is scanned (§9.1).
    const { data: batch } = await service.rpc('merchant_bulk_create_proposals', {
      p_merchant_id: merchant.merchantId,
      p_rows: [
        {
          product_name: 'Axe Batch Row',
          brand_name: 'Probe Labs',
          asking_price_cents: 1500,
          stock_on_hand: 4,
          barcode: '5099999999124',
          source_url: 'https://example.com/p/1',
        },
      ],
    });
    const batchId = (batch as { batch_id: string }).batch_id;

    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);

    for (const path of [
      '/admin/routing',
      '/admin/payouts',
      `/admin/merchants/proposals/${batchId}`,
      '/admin/merchants/applications',
      '/admin/merchants/offers',
      '/admin/merchants/proposals',
    ]) {
      await scan(page, path);
    }
  });

  /**
   * The seller line on a real product page, in both locales.
   *
   * On the storefront rather than the portal because this is the one M12 change every shopper sees, and
   * the storefront has its own chrome — a contrast failure there would affect every page, not one.
   */
  test('the seller line does not break the product page', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(2000);
    await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });

    await scan(page, `/en/product/${product.slug}`);
    await scan(page, `/product/${product.slug}`);
  });
});
