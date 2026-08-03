import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonClient,
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
 * docs/16 §6, §7 — merchant supply becomes purchasable, and an order splits.
 *
 * This is the suite that has to be right. It exercises the one path where the marketplace touches
 * money and stock at the same time, and the failure it exists to catch is **overselling**: two
 * customers buying the last unit a merchant holds, both told yes.
 *
 * Every claim is asserted against the database after the fact rather than against a return value, and
 * the arithmetic is never recomputed here — `merchant_settlement` is the only place it lives (§8), and
 * a test that re-implements it can agree with a bug.
 */

const merchantIds: string[] = [];
const userIds: string[] = [];
const products: ProductFixture[] = [];
const orderIds: string[] = [];

let shippingMethodId: string;

async function createMerchant(
  name: string,
  options?: { commissionPct?: number; rating?: number; status?: string },
): Promise<string> {
  const db = serviceClient();
  const stamp = `${Date.now()}-${merchantIds.length}`;

  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `route-${stamp}`,
      legal_name: `${name} SH.P.K.`,
      display_name: name,
      business_no: `ARBK-RT-${stamp}`,
      contact_name: 'Probe',
      contact_email: `route-${stamp}@biocode.test`,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: options?.status ?? 'approved',
      commission_pct: options?.commissionPct ?? 20,
      rating_avg: options?.rating ?? 0,
      shipping_borne_by: 'biocode',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`merchant insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  merchantIds.push(id);
  return id;
}

async function createOffer(
  merchantId: string,
  variantId: string,
  fields: { price: number; stock: number; status?: string; handling?: number },
): Promise<string> {
  const { data, error } = await serviceClient()
    .from('merchant_offers')
    .insert({
      merchant_id: merchantId,
      variant_id: variantId,
      price_cents: fields.price,
      stock_on_hand: fields.stock,
      status: fields.status ?? 'approved',
      handling_days: fields.handling ?? 1,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`offer insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

/** A product with no BioCode stock, so a merchant offer is the only source. */
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

/** Places an order for one cart, as the service client does for a guest. */
async function placeOrder(
  lines: { variantId: string; quantity: number }[],
): Promise<{ orderId: string; error: string | null }> {
  const cartId = await createCart(null, lines);
  const { data, error } = await serviceClient().rpc(
    'checkout_create_order',
    checkoutParams({
      cartId,
      email: `route-buyer-${Date.now()}-${orderIds.length}@biocode.test`,
      shippingMethodId,
    }),
  );

  if (error) return { orderId: '', error: error.message };

  const orderId = (data as { order_id: string }).order_id;
  orderIds.push(orderId);
  return { orderId, error: null };
}

interface Fulfilment {
  id: string;
  fulfiller_kind: string;
  merchant_id: string | null;
  status: string;
  items_subtotal_cents: number;
  commission_cents: number;
  merchant_due_cents: number;
}

async function fulfilments(orderId: string): Promise<Fulfilment[]> {
  const { data } = await serviceClient()
    .from('order_fulfilments')
    .select(
      'id, fulfiller_kind, merchant_id, status, items_subtotal_cents, commission_cents, merchant_due_cents',
    )
    .eq('order_id', orderId)
    .order('fulfiller_kind', { ascending: false });

  return (data ?? []) as Fulfilment[];
}

async function offerStock(offerId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('merchant_offers')
    .select('stock_on_hand')
    .eq('id', offerId)
    .single();
  return (data as { stock_on_hand: number }).stock_on_hand;
}

async function biocodeStock(variantId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('inventory_levels')
    .select('on_hand')
    .eq('variant_id', variantId);
  return ((data ?? []) as { on_hand: number }[]).reduce((sum, row) => sum + row.on_hand, 0);
}

beforeAll(async () => {
  shippingMethodId = await defaultShippingMethodId();
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of orderIds) {
    await db.from('order_items').delete().eq('order_id', id);
    await db.from('order_fulfilments').delete().eq('order_id', id);
    await db.from('order_events').delete().eq('order_id', id);
    await db.from('payments').delete().eq('order_id', id);
    await db.from('orders').delete().eq('id', id);
  }
  for (const id of merchantIds) {
    await db.from('merchant_offers').delete().eq('merchant_id', id);
    await db.from('merchants').delete().eq('id', id);
  }
  for (const id of userIds) await deleteUser(id);
  for (const fixture of products) {
    await db.from('stock_movements').delete().eq('variant_id', fixture.variantId);
    await db.from('inventory_levels').delete().eq('variant_id', fixture.variantId);
    await db.from('product_variants').delete().eq('id', fixture.variantId);
    await db.from('products').delete().eq('id', fixture.productId);
    await db.from('brands').delete().eq('id', fixture.brandId);
  }
});

describe('a merchant-only variant can now be bought (docs/16 §6)', () => {
  it('checkout succeeds and reserves the merchant’s stock', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Sole Source');
    const offer = await createOffer(merchant, product.variantId, { price: 1200, stock: 5 });

    const { orderId, error } = await placeOrder([{ variantId: product.variantId, quantity: 2 }]);
    expect(error, 'the order must be placeable').toBeNull();

    // The merchant's stock moved; BioCode's did not go negative.
    expect(await offerStock(offer)).toBe(3);
    expect(await biocodeStock(product.variantId)).toBe(0);

    // And the line records which offer sourced it.
    const { data } = await serviceClient()
      .from('order_items')
      .select('merchant_offer_id, unit_price_cents')
      .eq('order_id', orderId)
      .single();

    const item = data as { merchant_offer_id: string; unit_price_cents: number };
    expect(item.merchant_offer_id).toBe(offer);
    /*
     * The canonical price, not the merchant's €12.00 asking price. This is the marketplace's central
     * pricing rule (§5) and the assertion that would fail first if somebody made the offer price the
     * shelf price.
     */
    expect(item.unit_price_cents).toBe(2000);
  });

  /** BioCode is not a competitor on its own shelf: its stock wins even against a cheaper offer. */
  it('BioCode stock is used in preference to a cheaper merchant offer', async () => {
    const product = await stocked(10, 2000);
    const merchant = await createMerchant('Cheaper');
    const offer = await createOffer(merchant, product.variantId, { price: 400, stock: 50 });

    const { orderId, error } = await placeOrder([{ variantId: product.variantId, quantity: 3 }]);
    expect(error).toBeNull();

    expect(await biocodeStock(product.variantId)).toBe(7);
    expect(await offerStock(offer), 'the merchant must not have been touched').toBe(50);

    const rows = await fulfilments(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fulfiller_kind).toBe('biocode');
  });

  /**
   * The case that makes the fallback worth having: BioCode has *some* stock but not enough.
   *
   * The whole line goes to the merchant rather than being split across two suppliers. Splitting one
   * line would mean two parcels for one product, which is worse for the customer and worse for the
   * courier bill, and neither BioCode nor the merchant would have shipped what their screen said.
   */
  it('a line BioCode cannot fully cover goes entirely to a merchant', async () => {
    const product = await stocked(1, 2000);
    const merchant = await createMerchant('Backstop');
    const offer = await createOffer(merchant, product.variantId, { price: 1200, stock: 10 });

    const { orderId, error } = await placeOrder([{ variantId: product.variantId, quantity: 4 }]);
    expect(error).toBeNull();

    expect(await biocodeStock(product.variantId), 'BioCode keeps its single unit').toBe(1);
    expect(await offerStock(offer)).toBe(6);

    const rows = await fulfilments(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fulfiller_kind).toBe('merchant');
    expect(rows[0]?.merchant_id).toBe(merchant);
  });

  it('nobody with enough stock means the familiar out-of-stock refusal', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Nearly');
    await createOffer(merchant, product.variantId, { price: 1200, stock: 1 });

    const { error } = await placeOrder([{ variantId: product.variantId, quantity: 5 }]);
    expect(error ?? '').toContain('OUT_OF_STOCK');
  });

  it('a paused offer cannot be sourced from', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Paused');
    await createOffer(merchant, product.variantId, { price: 1200, stock: 20, status: 'paused' });

    const { error } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    expect(error ?? '').toContain('OUT_OF_STOCK');
  });

  it('a suspended merchant cannot be sourced from', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Suspended', { status: 'suspended' });
    await createOffer(merchant, product.variantId, { price: 1200, stock: 20 });

    const { error } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    expect(error ?? '').toContain('OUT_OF_STOCK');
  });

  /**
   * **The oversell test.** Two orders for the last two units, placed one after the other.
   *
   * This is why the reservation happens at checkout rather than at routing: without the `for update`
   * lock and the decrement, both orders would be accepted and the merchant would find out when it was
   * asked to ship three of two.
   */
  it('the last unit cannot be sold twice', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Last One');
    const offer = await createOffer(merchant, product.variantId, { price: 1200, stock: 2 });

    const first = await placeOrder([{ variantId: product.variantId, quantity: 2 }]);
    expect(first.error).toBeNull();
    expect(await offerStock(offer)).toBe(0);

    const second = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    expect(second.error ?? '', 'the second order must be refused').toContain('OUT_OF_STOCK');
  });

  /** The cheapest of two capable merchants takes the sale, matching the buy box. */
  it('checkout sources from the same merchant the buy box names', async () => {
    const product = await unstocked(2000);
    const dear = await createMerchant('Dear One');
    const cheap = await createMerchant('Cheap One');

    await createOffer(dear, product.variantId, { price: 1800, stock: 10 });
    const winner = await createOffer(cheap, product.variantId, { price: 1100, stock: 10 });

    const box = await anonClient().rpc('variant_buy_box', {
      p_variant_ids: [product.variantId],
    });
    expect((box.data as { offer_id: string }[])[0]?.offer_id).toBe(winner);

    const { orderId, error } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    expect(error).toBeNull();

    const { data } = await serviceClient()
      .from('order_items')
      .select('merchant_offer_id')
      .eq('order_id', orderId)
      .single();

    expect((data as { merchant_offer_id: string }).merchant_offer_id).toBe(winner);
  });
});

describe('route_order (docs/16 §6)', () => {
  it('a mixed order splits into one BioCode and one merchant fulfilment', async () => {
    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Mixed', { commissionPct: 20 });
    await createOffer(merchant, theirs.variantId, { price: 1200, stock: 10 });

    const { orderId, error } = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 2 },
    ]);
    expect(error).toBeNull();

    const rows = await fulfilments(orderId);
    expect(rows).toHaveLength(2);

    const biocode = rows.find((row) => row.fulfiller_kind === 'biocode');
    const merchantRow = rows.find((row) => row.fulfiller_kind === 'merchant');

    expect(biocode?.status, 'BioCode has nobody to ask').toBe('assigned');
    expect(biocode?.items_subtotal_cents).toBe(3000);
    expect(biocode?.merchant_id).toBeNull();
    expect(biocode?.commission_cents, 'commission on your own stock is meaningless').toBe(0);

    expect(merchantRow?.status, 'a merchant fulfilment awaits the routing decision').toBe(
      'unassigned',
    );
    expect(merchantRow?.merchant_id).toBe(merchant);
    expect(merchantRow?.items_subtotal_cents).toBe(4000);
    // 20% of €40.00, from merchant_settlement rather than recomputed here.
    expect(merchantRow?.commission_cents).toBe(800);
    expect(merchantRow?.merchant_due_cents).toBe(3200);
  });

  it('every line is attached to its fulfilment', async () => {
    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Attach');
    await createOffer(merchant, theirs.variantId, { price: 1200, stock: 10 });

    const { orderId } = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 1 },
    ]);

    const { data } = await serviceClient()
      .from('order_items')
      .select('variant_id, fulfilment_id')
      .eq('order_id', orderId);

    const items = (data ?? []) as { variant_id: string; fulfilment_id: string | null }[];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.fulfilment_id, `line ${item.variant_id} has no fulfilment`).not.toBeNull();
    }
    // Two lines, two different fulfilments.
    expect(new Set(items.map((item) => item.fulfilment_id)).size).toBe(2);
  });

  it('two merchants on one order are two fulfilments', async () => {
    const a = await unstocked(2000);
    const b = await unstocked(1000);
    const first = await createMerchant('Split A');
    const second = await createMerchant('Split B');
    await createOffer(first, a.variantId, { price: 1200, stock: 10 });
    await createOffer(second, b.variantId, { price: 600, stock: 10 });

    const { orderId, error } = await placeOrder([
      { variantId: a.variantId, quantity: 1 },
      { variantId: b.variantId, quantity: 1 },
    ]);
    expect(error).toBeNull();

    const rows = await fulfilments(orderId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.fulfiller_kind === 'merchant')).toBe(true);
    expect(new Set(rows.map((row) => row.merchant_id)).size).toBe(2);
  });

  /** Called twice, once by checkout and once by an admin retrying: the second is a no-op. */
  it('is idempotent', async () => {
    const product = await stocked(5, 2000);
    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);

    const { data } = await serviceClient().rpc('route_order', { p_order_id: orderId });
    expect(data).toBe(0);
    expect(await fulfilments(orderId)).toHaveLength(1);
  });
});

describe('assign_fulfilment (docs/16 §6)', () => {
  let staff: TestUser;

  beforeAll(async () => {
    staff = await createUser('support');
    userIds.push(staff.id);
  });

  it('confirming the proposed merchant does not move any stock', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Confirmed');
    const offer = await createOffer(merchant, product.variantId, { price: 1200, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 2 }]);
    expect(await offerStock(offer)).toBe(8);

    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { data, error } = await staff.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: merchant,
    });

    expect(error).toBeNull();
    const result = data as { reassigned: boolean; lines_moved: number };
    expect(result.reassigned).toBe(false);
    expect(result.lines_moved, 'the reservation was already correct').toBe(0);
    expect(await offerStock(offer), 'confirming must not reserve twice').toBe(8);

    const after = await fulfilments(orderId);
    expect(after[0]?.status).toBe('assigned');
  });

  /**
   * The reassignment test, and the one this function exists for: the reservation follows the decision.
   *
   * Without it one merchant is short of stock it never sold and the other oversells stock it never
   * reserved — and neither notices until a customer does.
   */
  it('re-routing moves the reservation and recomputes the money', async () => {
    const product = await unstocked(2000);
    const cheap = await createMerchant('Cheap Route', { commissionPct: 10 });
    const dear = await createMerchant('Dear Route', { commissionPct: 30 });

    const cheapOffer = await createOffer(cheap, product.variantId, { price: 1000, stock: 10 });
    const dearOffer = await createOffer(dear, product.variantId, { price: 1500, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 3 }]);

    // The buy box chose the cheap one, so that is where the reservation sits.
    expect(await offerStock(cheapOffer)).toBe(7);
    expect(await offerStock(dearOffer)).toBe(10);

    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');
    expect(target.merchant_id).toBe(cheap);
    expect(target.commission_cents, '10% of €60.00').toBe(600);

    const { data, error } = await staff.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: dear,
    });

    expect(error).toBeNull();
    expect((data as { reassigned: boolean }).reassigned).toBe(true);

    expect(await offerStock(cheapOffer), 'returned to the merchant that lost it').toBe(10);
    expect(await offerStock(dearOffer), 'taken from the merchant that gained it').toBe(7);

    const after = await fulfilments(orderId);
    expect(after[0]?.merchant_id).toBe(dear);
    expect(after[0]?.status).toBe('assigned');
    // 30% of €60.00 — the new merchant's rate, not the old one's.
    expect(after[0]?.commission_cents).toBe(1800);
    expect(after[0]?.merchant_due_cents).toBe(4200);

    // And the line now points at the new merchant's offer.
    const { data: item } = await serviceClient()
      .from('order_items')
      .select('merchant_offer_id')
      .eq('order_id', orderId)
      .single();
    expect((item as { merchant_offer_id: string }).merchant_offer_id).toBe(dearOffer);
  });

  /** A candidate that cannot cover the line is refused outright, and nothing moves. */
  it('refuses a merchant that cannot cover the lines, leaving the reservation alone', async () => {
    const product = await unstocked(2000);
    const holder = await createMerchant('Holder');
    const thin = await createMerchant('Thin');

    const holderOffer = await createOffer(holder, product.variantId, { price: 1000, stock: 10 });
    const thinOffer = await createOffer(thin, product.variantId, { price: 900, stock: 1 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 4 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { error } = await staff.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: thin,
    });

    expect(error?.message ?? '').toContain('CANDIDATE_CANNOT_COVER');
    expect(await offerStock(holderOffer), 'the original reservation is untouched').toBe(6);
    expect(await offerStock(thinOffer)).toBe(1);
  });

  it('a merchant cannot route its own fulfilment', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Self Route');
    await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { error } = await owner.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: merchant,
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });

  it('a BioCode fulfilment cannot be routed to a merchant', async () => {
    const product = await stocked(10, 2000);
    const merchant = await createMerchant('Not Mine');
    await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { error } = await staff.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: merchant,
    });

    expect(error?.message ?? '').toContain('NOT_A_MERCHANT_FULFILMENT');
  });
});

describe('fulfilment_candidates (docs/16 §6)', () => {
  let staff: TestUser;

  beforeAll(async () => {
    staff = await createUser('support');
    userIds.push(staff.id);
  });

  it('lists every merchant that can cover the whole fulfilment, cheapest first', async () => {
    const product = await unstocked(2000);
    const cheap = await createMerchant('Candidate Cheap');
    const dear = await createMerchant('Candidate Dear');
    await createOffer(cheap, product.variantId, { price: 1000, stock: 10 });
    await createOffer(dear, product.variantId, { price: 1600, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 2 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { data, error } = await staff.client.rpc('fulfilment_candidates', {
      p_fulfilment_id: target.id,
    });

    expect(error).toBeNull();
    const candidates = (data ?? []) as {
      merchant_id: string;
      asking_total_cents: number;
      is_current: boolean;
    }[];

    expect(candidates.map((row) => row.merchant_id)).toEqual([cheap, dear]);
    expect(candidates[0]?.asking_total_cents, '€10.00 × 2').toBe(2000);
    expect(candidates[0]?.is_current, 'the buy-box winner holds the reservation').toBe(true);
    expect(candidates[1]?.is_current).toBe(false);
  });

  /**
   * A merchant holding two of three products is not a candidate. Splitting a fulfilment further would
   * mean two parcels from two suppliers for lines the customer bought together.
   */
  it('excludes a merchant that can only cover part of it', async () => {
    const a = await unstocked(2000);
    const b = await unstocked(1000);
    const both = await createMerchant('Has Both');
    const partial = await createMerchant('Has One');

    await createOffer(both, a.variantId, { price: 1000, stock: 10 });
    await createOffer(both, b.variantId, { price: 500, stock: 10 });
    await createOffer(partial, a.variantId, { price: 900, stock: 10 });

    const { orderId } = await placeOrder([
      { variantId: a.variantId, quantity: 1 },
      { variantId: b.variantId, quantity: 1 },
    ]);

    // Both lines went to the same merchant, so this is one fulfilment of two lines.
    const rows = await fulfilments(orderId);
    const target = rows.find((row) => row.merchant_id === both);
    if (!target) throw new Error('expected a fulfilment for the merchant holding both');

    const { data } = await staff.client.rpc('fulfilment_candidates', {
      p_fulfilment_id: target.id,
    });

    const ids = ((data ?? []) as { merchant_id: string }[]).map((row) => row.merchant_id);
    expect(ids).toContain(both);
    expect(ids, 'a partial supplier is not a candidate').not.toContain(partial);
  });

  it('is staff-only', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Peek');
    await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { error } = await owner.client.rpc('fulfilment_candidates', {
      p_fulfilment_id: target.id,
    });

    // Rival asking prices and stock levels are exactly what §3 keeps merchants from seeing.
    expect(error?.message ?? '').toContain('FORBIDDEN');
  });
});

describe('release_fulfilment (docs/16 §6)', () => {
  let staff: TestUser;

  beforeAll(async () => {
    staff = await createUser('support');
    userIds.push(staff.id);
  });

  it('returns the stock and puts the fulfilment back in the queue', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Decliner');
    const offer = await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 3 }]);
    expect(await offerStock(offer)).toBe(7);

    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    const { error } = await staff.client.rpc('release_fulfilment', {
      p_fulfilment_id: target.id,
      p_reason: 'Out of stock at the shop',
    });

    expect(error).toBeNull();
    expect(await offerStock(offer), 'a merchant that ships nothing keeps its stock').toBe(10);

    const after = await fulfilments(orderId);
    expect(after[0]?.status).toBe('unassigned');
    expect(after[0]?.merchant_due_cents).toBe(0);

    const { data: item } = await serviceClient()
      .from('order_items')
      .select('merchant_offer_id')
      .eq('order_id', orderId)
      .single();
    expect((item as { merchant_offer_id: string | null }).merchant_offer_id).toBeNull();
  });

  /**
   * Reassigning to the **same** merchant after a release has to take the stock again.
   *
   * The first version of `assign_fulfilment` keyed the whole decision on `merchant_id` changing, so
   * this case silently left the lines with no reservation at all — the merchant would have been asked
   * to ship stock its own portal still showed as available.
   */
  it('a released fulfilment reassigned to the same merchant reserves again', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Second Thoughts');
    const offer = await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 2 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    await staff.client.rpc('release_fulfilment', { p_fulfilment_id: target.id, p_reason: 'oops' });
    expect(await offerStock(offer)).toBe(10);

    const { data, error } = await staff.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: merchant,
    });

    expect(error).toBeNull();
    expect((data as { lines_moved: number }).lines_moved).toBe(1);
    expect(await offerStock(offer), 'the reservation is taken again').toBe(8);
  });
});

describe('order status follows its fulfilments (docs/16 §7)', () => {
  let staff: TestUser;

  beforeAll(async () => {
    staff = await createUser('support');
    userIds.push(staff.id);
  });

  async function orderStatus(orderId: string): Promise<string> {
    const { data } = await serviceClient().from('orders').select('status').eq('id', orderId).single();
    return (data as { status: string }).status;
  }

  /**
   * The state the old enum could not express: BioCode has shipped its half and a merchant has not.
   *
   * `partially_shipped` was added to `order_status` in migration 28 and was unreachable until this
   * step, because no transition admitted it — an enum value the guard rejects is a value the column
   * can never hold.
   */
  it('a half-shipped mixed order is partially_shipped', async () => {
    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Half');
    await createOffer(merchant, theirs.variantId, { price: 1200, stock: 10 });

    const { orderId } = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 1 },
    ]);

    const rows = await fulfilments(orderId);
    const biocode = rows.find((row) => row.fulfiller_kind === 'biocode');
    const merchantRow = rows.find((row) => row.fulfiller_kind === 'merchant');
    if (!biocode || !merchantRow) throw new Error('expected two fulfilments');

    await staff.client.from('order_fulfilments').update({ status: 'shipped' }).eq('id', biocode.id);
    expect(await orderStatus(orderId)).toBe('partially_shipped');

    // The merchant's half follows, and the order becomes shipped.
    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'shipped' })
      .eq('id', merchantRow.id);
    expect(await orderStatus(orderId)).toBe('shipped');
  });

  it('a single-fulfilment order goes straight to shipped', async () => {
    const product = await stocked(10, 2000);
    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);

    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    await staff.client.from('order_fulfilments').update({ status: 'shipped' }).eq('id', target.id);
    expect(await orderStatus(orderId)).toBe('shipped');
  });

  /** A cancelled fulfilment is not an unshipped one: the order can still complete without it. */
  it('a cancelled fulfilment does not hold the order at partially_shipped', async () => {
    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Gone');
    await createOffer(merchant, theirs.variantId, { price: 1200, stock: 10 });

    const { orderId } = await placeOrder([
      { variantId: own.variantId, quantity: 1 },
      { variantId: theirs.variantId, quantity: 1 },
    ]);

    const rows = await fulfilments(orderId);
    const biocode = rows.find((row) => row.fulfiller_kind === 'biocode');
    const merchantRow = rows.find((row) => row.fulfiller_kind === 'merchant');
    if (!biocode || !merchantRow) throw new Error('expected two fulfilments');

    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'cancelled' })
      .eq('id', merchantRow.id);
    await staff.client.from('order_fulfilments').update({ status: 'shipped' }).eq('id', biocode.id);

    expect(await orderStatus(orderId)).toBe('shipped');
  });

  it('the timestamps are stamped by the database, not posted by the merchant', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Stamps');
    await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    const rows = await fulfilments(orderId);
    const target = rows[0];
    if (!target) throw new Error('no fulfilment');

    await staff.client.rpc('assign_fulfilment', {
      p_fulfilment_id: target.id,
      p_merchant_id: merchant,
    });
    await serviceClient()
      .from('order_fulfilments')
      .update({ status: 'accepted' })
      .eq('id', target.id);

    const { data } = await serviceClient()
      .from('order_fulfilments')
      .select('accepted_at, shipped_at')
      .eq('id', target.id)
      .single();

    const stamps = data as { accepted_at: string | null; shipped_at: string | null };
    expect(stamps.accepted_at, 'accepting stamps its own time').not.toBeNull();
    expect(stamps.shipped_at).toBeNull();
  });
});

describe('cancelling a marketplace order (docs/16 §6)', () => {
  /**
   * The restock bug this fixes would have been invisible and corroborated by its own audit trail.
   *
   * The original trigger returned **every** line to `inventory_levels`, so cancelling a
   * merchant-sourced order invented first-party stock — and wrote a `stock_movements` row saying it was
   * legitimate.
   */
  it('returns merchant lines to the offer and never to BioCode', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Cancelled');
    const offer = await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 3 }]);
    expect(await offerStock(offer)).toBe(7);
    const biocodeBefore = await biocodeStock(product.variantId);

    await serviceClient().from('orders').update({ status: 'cancelled' }).eq('id', orderId);

    expect(await offerStock(offer), 'the merchant gets its stock back').toBe(10);
    expect(
      await biocodeStock(product.variantId),
      'BioCode must not gain stock it never held',
    ).toBe(biocodeBefore);

    // No movement row was invented for a variant BioCode never stocked.
    const { data } = await serviceClient()
      .from('stock_movements')
      .select('id')
      .eq('reference_id', orderId);
    expect(data ?? []).toHaveLength(0);
  });

  it('a mixed order returns each half to its own owner', async () => {
    const own = await stocked(10, 3000);
    const theirs = await unstocked(2000);
    const merchant = await createMerchant('Mixed Cancel');
    const offer = await createOffer(merchant, theirs.variantId, { price: 1200, stock: 10 });

    const { orderId } = await placeOrder([
      { variantId: own.variantId, quantity: 2 },
      { variantId: theirs.variantId, quantity: 2 },
    ]);

    expect(await biocodeStock(own.variantId)).toBe(8);
    expect(await offerStock(offer)).toBe(8);

    await serviceClient().from('orders').update({ status: 'cancelled' }).eq('id', orderId);

    expect(await biocodeStock(own.variantId)).toBe(10);
    expect(await offerStock(offer)).toBe(10);
  });

  it('cancels the fulfilments too, so nobody keeps packing', async () => {
    const product = await unstocked(2000);
    const merchant = await createMerchant('Stop Packing');
    await createOffer(merchant, product.variantId, { price: 1000, stock: 10 });

    const { orderId } = await placeOrder([{ variantId: product.variantId, quantity: 1 }]);
    await serviceClient().from('orders').update({ status: 'cancelled' }).eq('id', orderId);

    const rows = await fulfilments(orderId);
    expect(rows.every((row) => row.status === 'cancelled')).toBe(true);
  });
});
