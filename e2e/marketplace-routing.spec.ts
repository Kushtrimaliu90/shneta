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

    await expect(page.locator('article').filter({ hasText: number })).toBeHidden();

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
    await expect(staffPage.locator('article').filter({ hasText: number })).toBeHidden();
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

    const { data: order } = await service.from('orders').select('status').eq('id', orderId).single();
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

    await expect(card.getByText(/Paid .* ref/)).toBeVisible();
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

    await expect(page.getByText('Applied 1 row(s).')).toBeVisible();

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
    await page.locator('#note').fill('Customers ask for this constantly and we import it directly.');
    await page.getByRole('button', { name: 'Send the proposal' }).click();

    await expect(page.getByText('Proposal sent.')).toBeVisible();
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
    await expect(staffPage.locator('article').filter({ hasText: name })).toBeHidden();
    await staffContext.close();

    // The merchant reads the answer where it was promised.
    await page.reload();
    await expect(page.getByText('Listed as BIO-E2E-1')).toBeVisible();
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
      '/en/merchant/payouts',
      '/en/merchant/documents',
      '/en/merchant/settings',
    ]) {
      await scan(page, path);
    }
  });

  test('the admin marketplace screens are accessible with real data', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(2000);
    await offer(merchant.merchantId, product.variantId, { price: 1200, stock: 10 });
    await buy(product.variantId, 1);

    const service = db();
    await service.from('merchant_ledger').insert([
      { merchant_id: merchant.merchantId, kind: 'sale', amount_cents: 2000, note: 'e2e' },
    ]);
    await service.from('product_proposals').insert({
      merchant_id: merchant.merchantId,
      status: 'pending',
      payload: { product_name: 'Axe probe', brand_name: 'Probe', note: 'For the a11y scan.' },
    });

    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);

    for (const path of [
      '/admin/routing',
      '/admin/payouts',
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
