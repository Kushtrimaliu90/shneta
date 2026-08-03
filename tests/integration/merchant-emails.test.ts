import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkoutParams,
  createCart,
  createProduct,
  createUser,
  defaultShippingMethodId,
  deleteUser,
  serviceClient,
  type ProductFixture,
  type TestUser,
} from './helpers';

/**
 * docs/16 §6, §7 — the merchant emails and auto-routing.
 *
 * ── What can and cannot be asserted here ──
 *
 * The send functions are `'use server'`-adjacent modules that read `clientEnv` and post to Resend, and no
 * provider key is configured for the test project — so `sendEmail` records `skipped_no_provider` in
 * `email_log` and posts nothing. That is exactly the property this suite uses: **the log is the evidence an
 * email was composed and addressed**, which is the part that can be wrong.
 *
 * What it therefore checks is the two things that would be wrong silently: **who** the email went to, and
 * **that it went once**. The rendered copy is not asserted — a template diff belongs in review, and a test
 * that pinned the wording would fail every time somebody improved a sentence.
 *
 * Auto-routing is tested against the switch in both positions, because "off" is its shipped state.
 */

const merchantIds: string[] = [];
const userIds: string[] = [];
const products: ProductFixture[] = [];
const orderIds: string[] = [];

let shippingMethodId: string;
let admin: TestUser;
let originalAutoRoute = false;

async function createMerchant(
  name: string,
  options?: { rating?: number; commissionPct?: number },
): Promise<{ id: string; email: string }> {
  const db = serviceClient();
  const stamp = `${Date.now()}-${merchantIds.length}`;
  const email = `mail-${stamp}@biocode.test`;

  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `mail-${stamp}`,
      legal_name: `${name} SH.P.K.`,
      display_name: name,
      business_no: `ARBK-ML-${stamp}`,
      contact_name: 'Probe',
      contact_email: email,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: 'approved',
      commission_pct: options?.commissionPct ?? 20,
      rating_avg: options?.rating ?? 0,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`merchant insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  merchantIds.push(id);
  return { id, email };
}

async function createOffer(
  merchantId: string,
  variantId: string,
  fields: { price: number; stock: number },
): Promise<string> {
  const { data, error } = await serviceClient()
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

  if (error || !data) throw new Error(`offer insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

async function unstocked(priceCents = 2000): Promise<ProductFixture> {
  const fixture = await createProduct({ stock: 0, priceCents });
  products.push(fixture);
  return fixture;
}

async function stocked(stock: number, priceCents = 2000): Promise<ProductFixture> {
  const fixture = await createProduct({ stock, priceCents });
  products.push(fixture);
  return fixture;
}

async function placeOrder(
  lines: { variantId: string; quantity: number }[],
): Promise<string> {
  const cartId = await createCart(null, lines);
  const { data, error } = await serviceClient().rpc(
    'checkout_create_order',
    checkoutParams({
      cartId,
      email: `mail-buyer-${Date.now()}-${orderIds.length}@biocode.test`,
      shippingMethodId,
    }),
  );
  if (error) throw new Error(`checkout failed: ${error.message}`);

  const orderId = (data as { order_id: string }).order_id;
  orderIds.push(orderId);
  return orderId;
}

async function merchantFulfilment(orderId: string): Promise<string> {
  const { data } = await serviceClient()
    .from('order_fulfilments')
    .select('id')
    .eq('order_id', orderId)
    .eq('fulfiller_kind', 'merchant')
    .maybeSingle();

  const row = data as { id: string } | null;
  if (!row) throw new Error('no merchant fulfilment');
  return row.id;
}

/** What the log says was addressed, which is the evidence an email was composed at all. */
async function logged(template: string, to?: string): Promise<{ to_email: string }[]> {
  let query = serviceClient()
    .from('email_log')
    .select('to_email')
    .eq('template', template)
    .order('created_at', { ascending: false });

  if (to) query = query.eq('to_email', to);

  const { data } = await query;
  return (data ?? []) as { to_email: string }[];
}

async function setAutoRoute(enabled: boolean): Promise<void> {
  const { error } = await serviceClient().rpc('set_auto_routing', { p_enabled: enabled });
  if (error) throw new Error(`set_auto_routing failed: ${error.message}`);
}

beforeAll(async () => {
  shippingMethodId = await defaultShippingMethodId();
  admin = await createUser('admin');
  userIds.push(admin.id);

  const { data } = await serviceClient()
    .from('settings')
    .select('value')
    .eq('key', 'marketplace')
    .single();

  const config = (data as { value: Record<string, unknown> }).value ?? {};
  originalAutoRoute = config.auto_route === true;
});

afterAll(async () => {
  const db = serviceClient();

  // Put the switch back where it was, whatever these tests did to it.
  await db.rpc('set_auto_routing', { p_enabled: originalAutoRoute });

  for (const id of merchantIds) {
    await db.from('email_log').delete().ilike('to_email', '%@biocode.test');
    await db.from('merchant_ledger').delete().eq('merchant_id', id);
    await db.from('merchant_payouts').delete().eq('merchant_id', id);
    await db.from('merchant_offers').delete().eq('merchant_id', id);
    await db.from('product_proposals').delete().eq('merchant_id', id);
  }
  for (const id of orderIds) {
    await db.from('order_items').delete().eq('order_id', id);
    await db.from('order_fulfilments').delete().eq('order_id', id);
    await db.from('order_events').delete().eq('order_id', id);
    await db.from('payments').delete().eq('order_id', id);
    await db.from('orders').delete().eq('id', id);
  }
  for (const id of merchantIds) await db.from('merchants').delete().eq('id', id);
  for (const id of userIds) await deleteUser(id);
  for (const fixture of products) {
    await db.from('stock_movements').delete().eq('variant_id', fixture.variantId);
    await db.from('inventory_levels').delete().eq('variant_id', fixture.variantId);
    await db.from('product_variants').delete().eq('id', fixture.variantId);
    await db.from('products').delete().eq('id', fixture.productId);
    await db.from('brands').delete().eq('id', fixture.brandId);
  }
});

describe('the routing email (docs/16 §7)', () => {
  /**
   * Addressed to the merchant's **application contact**, not to a portal account.
   *
   * They are usually the same address, but the contact is the one the applicant chose to be reached at, and
   * it exists before an account does — which matters because the first email a merchant gets arrives before
   * they have signed in.
   */
  it('goes to the merchant’s contact address when a fulfilment is assigned', async () => {
    const { sendFulfilmentAssigned } = await import('@/features/merchants/email');

    const product = await unstocked();
    const merchant = await createMerchant('Mailed');
    await createOffer(merchant.id, product.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    await serviceClient().rpc('assign_fulfilment', {
      p_fulfilment_id: fulfilmentId,
      p_merchant_id: merchant.id,
    });
    await sendFulfilmentAssigned(fulfilmentId);

    const rows = await logged('merchant_fulfilment_assigned', merchant.email);
    expect(rows).toHaveLength(1);
  });

  /** A reminder is a different template, so the log can tell them apart and so can a merchant's inbox. */
  it('the reminder is its own template', async () => {
    const { sendFulfilmentAssigned } = await import('@/features/merchants/email');

    const product = await unstocked();
    const merchant = await createMerchant('Reminded');
    await createOffer(merchant.id, product.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    await sendFulfilmentAssigned(fulfilmentId, { reminder: true });

    expect(await logged('merchant_fulfilment_reminder', merchant.email)).toHaveLength(1);
    expect(await logged('merchant_fulfilment_assigned', merchant.email)).toHaveLength(0);
  });

  /** A BioCode fulfilment has no merchant to write to, and must not produce an email addressed to nobody. */
  it('sends nothing for a BioCode fulfilment', async () => {
    const { sendFulfilmentAssigned } = await import('@/features/merchants/email');

    const product = await stocked(10);
    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);

    const { data } = await serviceClient()
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .eq('fulfiller_kind', 'biocode')
      .single();

    const before = (await logged('merchant_fulfilment_assigned')).length;
    await sendFulfilmentAssigned((data as { id: string }).id);
    expect((await logged('merchant_fulfilment_assigned')).length).toBe(before);
  });
});

describe('the late-fulfilment sweep (docs/16 §7)', () => {
  it('finds a fulfilment assigned longer ago than the acceptance window', async () => {
    const { findLateFulfilments } = await import('@/features/merchants/email');

    const product = await unstocked();
    const merchant = await createMerchant('Slow');
    await createOffer(merchant.id, product.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    // Assigned two days ago and never answered.
    await serviceClient()
      .from('order_fulfilments')
      .update({
        status: 'assigned',
        assigned_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', fulfilmentId);

    const late = await findLateFulfilments(new Date());
    expect(late).toContain(fulfilmentId);
  });

  it('ignores one assigned within the window', async () => {
    const { findLateFulfilments } = await import('@/features/merchants/email');

    const product = await unstocked();
    const merchant = await createMerchant('Prompt');
    await createOffer(merchant.id, product.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'assigned', assigned_at: new Date().toISOString() })
      .eq('id', fulfilmentId);

    expect(await findLateFulfilments(new Date())).not.toContain(fulfilmentId);
  });

  /** An accepted fulfilment is not late: the merchant answered, which is what the window measures. */
  it('ignores one the merchant has already accepted', async () => {
    const { findLateFulfilments } = await import('@/features/merchants/email');

    const product = await unstocked();
    const merchant = await createMerchant('Accepted Already');
    await createOffer(merchant.id, product.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    await serviceClient()
      .from('order_fulfilments')
      .update({
        status: 'accepted',
        assigned_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', fulfilmentId);

    expect(await findLateFulfilments(new Date())).not.toContain(fulfilmentId);
  });
});

describe('the partial-shipment notice (docs/16 §7)', () => {
  /**
   * Sent once, when the first parcel of a multi-parcel order ships.
   *
   * The failure it prevents: a customer receives one box of a two-box order, assumes something went
   * missing, and opens a ticket — or a chargeback.
   */
  it('is sent for a half-shipped mixed order', async () => {
    const { sendPartialShipmentNotice } = await import(
      '@/features/merchants/partial-shipment-email'
    );

    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Half Shipped');
    await createOffer(merchant.id, theirs.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 1 },
    ]);

    const { data: rows } = await serviceClient()
      .from('order_fulfilments')
      .select('id, fulfiller_kind')
      .eq('order_id', orderId);

    const biocode = ((rows ?? []) as { id: string; fulfiller_kind: string }[]).find(
      (row) => row.fulfiller_kind === 'biocode',
    );

    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'shipped', carrier: 'Probe Post', tracking_code: 'PP-1' })
      .eq('id', biocode?.id ?? '');

    await sendPartialShipmentNotice(orderId);

    const { data: log } = await serviceClient()
      .from('email_log')
      .select('template')
      .eq('order_id', orderId);

    expect(((log ?? []) as { template: string }[]).map((row) => row.template)).toContain(
      'order_partially_shipped',
    );
  });

  /** Once per order, ever: the second parcel must not re-send "part of your order has shipped". */
  it('is not sent twice', async () => {
    const { sendPartialShipmentNotice } = await import(
      '@/features/merchants/partial-shipment-email'
    );

    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Once Only Notice');
    await createOffer(merchant.id, theirs.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 1 },
    ]);

    const { data: rows } = await serviceClient()
      .from('order_fulfilments')
      .select('id, fulfiller_kind')
      .eq('order_id', orderId);

    const biocode = ((rows ?? []) as { id: string; fulfiller_kind: string }[]).find(
      (row) => row.fulfiller_kind === 'biocode',
    );

    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'shipped' })
      .eq('id', biocode?.id ?? '');

    await sendPartialShipmentNotice(orderId);
    await sendPartialShipmentNotice(orderId);

    const { count } = await serviceClient()
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('template', 'order_partially_shipped');

    expect(count).toBe(1);
  });

  /** A single-fulfilment order is not partial, and "part of your order" would be a lie about it. */
  it('is not sent for a fully shipped single-fulfilment order', async () => {
    const { sendPartialShipmentNotice } = await import(
      '@/features/merchants/partial-shipment-email'
    );

    const product = await stocked(10);
    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);

    const { data } = await serviceClient()
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .single();

    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'shipped' })
      .eq('id', (data as { id: string }).id);

    await sendPartialShipmentNotice(orderId);

    const { count } = await serviceClient()
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('template', 'order_partially_shipped');

    expect(count).toBe(0);
  });

  it('the sweep finds a partially shipped order', async () => {
    const { findPartiallyShippedOrders } = await import(
      '@/features/merchants/partial-shipment-email'
    );

    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Swept');
    await createOffer(merchant.id, theirs.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 1 },
    ]);

    const { data: rows } = await serviceClient()
      .from('order_fulfilments')
      .select('id, fulfiller_kind')
      .eq('order_id', orderId);

    const biocode = ((rows ?? []) as { id: string; fulfiller_kind: string }[]).find(
      (row) => row.fulfiller_kind === 'biocode',
    );

    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'shipped' })
      .eq('id', biocode?.id ?? '');

    expect(await findPartiallyShippedOrders()).toContain(orderId);
  });
});

describe('auto-routing (docs/16 §6)', () => {
  /**
   * **Off is its shipped state**, and the function says so rather than doing nothing quietly — a cron that
   * "succeeded" while routing nothing is indistinguishable from a broken one.
   */
  it('does nothing and reports that it is off', async () => {
    await setAutoRoute(false);

    const product = await unstocked();
    const merchant = await createMerchant('Not Auto');
    await createOffer(merchant.id, product.variantId, { price: 1200, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    const { data, error } = await admin.client.rpc('auto_route_fulfilments');
    expect(error).toBeNull();

    const result = data as { enabled: boolean; routed: unknown[] };
    expect(result.enabled).toBe(false);
    expect(result.routed).toHaveLength(0);

    const { data: after } = await serviceClient()
      .from('order_fulfilments')
      .select('status')
      .eq('id', fulfilmentId)
      .single();
    expect((after as { status: string }).status).toBe('unassigned');
  });

  it('assigns to the best candidate when it is on', async () => {
    await setAutoRoute(true);

    const product = await unstocked();
    const cheap = await createMerchant('Auto Cheap');
    const dear = await createMerchant('Auto Dear');
    await createOffer(cheap.id, product.variantId, { price: 1000, stock: 10 });
    await createOffer(dear.id, product.variantId, { price: 1800, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    const { data, error } = await admin.client.rpc('auto_route_fulfilments');
    expect(error).toBeNull();
    expect((data as { enabled: boolean }).enabled).toBe(true);

    const { data: after } = await serviceClient()
      .from('order_fulfilments')
      .select('status, merchant_id')
      .eq('id', fulfilmentId)
      .single();

    const row = after as { status: string; merchant_id: string };
    expect(row.status).toBe('assigned');
    // The cheapest to source, which is the first row `fulfilment_candidates` returns to a human too.
    expect(row.merchant_id).toBe(cheap.id);
  });

  /** Only `unassigned` rows are touched: a fulfilment somebody assigned by hand stays where they put it. */
  it('does not override a human’s assignment', async () => {
    await setAutoRoute(true);

    const product = await unstocked();
    const cheap = await createMerchant('Auto Would Pick');
    const chosen = await createMerchant('Human Picked');
    await createOffer(cheap.id, product.variantId, { price: 800, stock: 10 });
    await createOffer(chosen.id, product.variantId, { price: 1900, stock: 10 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    await admin.client.rpc('assign_fulfilment', {
      p_fulfilment_id: fulfilmentId,
      p_merchant_id: chosen.id,
    });

    await admin.client.rpc('auto_route_fulfilments');

    const { data } = await serviceClient()
      .from('order_fulfilments')
      .select('merchant_id')
      .eq('id', fulfilmentId)
      .single();

    expect((data as { merchant_id: string }).merchant_id).toBe(chosen.id);
  });

  /**
   * A fulfilment with no candidate is reported, not silently left. Somebody has to know that an order is
   * sitting there because nobody can ship it.
   */
  it('reports a fulfilment it cannot route', async () => {
    await setAutoRoute(true);

    const product = await unstocked();
    const merchant = await createMerchant('Ran Out');
    const offer = await createOffer(merchant.id, product.variantId, { price: 1200, stock: 5 });

    const orderId = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const fulfilmentId = await merchantFulfilment(orderId);

    // The only merchant runs out after the order was placed, so no candidate can cover it.
    await serviceClient().from('merchant_offers').update({ stock_on_hand: 0 }).eq('id', offer);
    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'unassigned' })
      .eq('id', fulfilmentId);
    await serviceClient()
      .from('order_items')
      .update({ merchant_offer_id: null })
      .eq('fulfilment_id', fulfilmentId);

    const { data } = await admin.client.rpc('auto_route_fulfilments');
    const result = data as { skipped: { fulfilment_id: string; reason: string }[] };

    const skipped = result.skipped.find((entry) => entry.fulfilment_id === fulfilmentId);
    expect(skipped?.reason).toBe('no_candidate');
  });

  it('a merchant cannot run it, and cannot flip the switch', async () => {
    const merchant = await createMerchant('No Self Route');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant.id, user_id: owner.id });

    const run = await owner.client.rpc('auto_route_fulfilments');
    expect(run.error?.message ?? '').toContain('FORBIDDEN');

    const flip = await owner.client.rpc('set_auto_routing', { p_enabled: true });
    expect(flip.error?.message ?? '').toContain('FORBIDDEN');
  });

  it('support cannot flip the switch either — automation is an admin decision', async () => {
    const support = await createUser('support');
    userIds.push(support.id);

    const { error } = await support.client.rpc('set_auto_routing', { p_enabled: true });
    expect(error?.message ?? '').toContain('FORBIDDEN');
  });

  it('the switch round-trips', async () => {
    await setAutoRoute(true);
    let { data } = await serviceClient()
      .from('settings')
      .select('value')
      .eq('key', 'marketplace')
      .single();
    expect((data as { value: Record<string, unknown> }).value.auto_route).toBe(true);

    await setAutoRoute(false);
    ({ data } = await serviceClient()
      .from('settings')
      .select('value')
      .eq('key', 'marketplace')
      .single());
    expect((data as { value: Record<string, unknown> }).value.auto_route).toBe(false);
  });
});
