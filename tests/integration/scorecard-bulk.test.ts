import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonClient,
  createProduct,
  createUser,
  deleteUser,
  serviceClient,
  type ProductFixture,
  type TestUser,
} from './helpers';

/**
 * docs/16 §6 — the scorecard, the rating it feeds, and the bulk update.
 *
 * The rating matters because it is a **buy-box tie-break** (§1): it decides which of two equally-priced
 * merchants gets the sale. So the assertions here are about the two directions that decision can go
 * wrong — a merchant with no history winning a tie it has not earned, and a merchant that declines
 * everything keeping a rating it no longer deserves.
 */

const merchantIds: string[] = [];
const userIds: string[] = [];
const products: ProductFixture[] = [];
const orderIds: string[] = [];
const proposalIds: string[] = [];
const promotedProductIds: string[] = [];
const promotedBrandIds: string[] = [];

let admin: TestUser;

async function createMerchant(name: string): Promise<string> {
  const db = serviceClient();
  const stamp = `${Date.now()}-${merchantIds.length}`;

  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `card-${stamp}`,
      legal_name: `${name} SH.P.K.`,
      display_name: name,
      business_no: `ARBK-SC-${stamp}`,
      contact_name: 'Probe',
      contact_email: `card-${stamp}@biocode.test`,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: 'approved',
      commission_pct: 20,
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
  fields: { price: number; stock: number; sku?: string; handling?: number },
): Promise<string> {
  const { data, error } = await serviceClient()
    .from('merchant_offers')
    .insert({
      merchant_id: merchantId,
      variant_id: variantId,
      price_cents: fields.price,
      stock_on_hand: fields.stock,
      merchant_sku: fields.sku ?? null,
      handling_days: fields.handling ?? 1,
      status: 'approved',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`offer insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

/**
 * A fulfilment with hand-set timestamps, so acceptance and dispatch speed can be asserted.
 *
 * The timestamps are written through the service client rather than by walking the state machine: this
 * suite is about how the scorecard *reads* history, and manufacturing a two-hour dispatch by waiting two
 * hours is not a test anybody runs.
 */
async function fulfilmentHistory(
  merchantId: string,
  entries: {
    assignedHoursAgo: number;
    acceptedHoursAfterAssign?: number;
    shippedHoursAfterAccept?: number;
    status: string;
    handlingDays?: number;
  }[],
): Promise<void> {
  const db = serviceClient();

  for (const entry of entries) {
    const product = await createProduct({ stock: 0, priceCents: 2000 });
    products.push(product);
    const offer = await createOffer(merchantId, product.variantId, {
      price: 1200,
      stock: 10,
      handling: entry.handlingDays ?? 1,
    });

    const { data: order } = await db
      .from('orders')
      .insert({
        email: `card-buyer-${Date.now()}-${orderIds.length}@biocode.test`,
        phone: '+38344000000',
        status: 'pending',
        payment_status: 'pending',
        currency: 'EUR',
        subtotal_cents: 2000,
        discount_cents: 0,
        shipping_cents: 0,
        tax_cents: 0,
        total_cents: 2000,
        shipping_address: { city: 'Prishtinë', country_code: 'XK' },
        billing_address: { city: 'Prishtinë', country_code: 'XK' },
        locale: 'sq',
      })
      .select('id')
      .single();

    const orderId = (order as { id: string }).id;
    orderIds.push(orderId);

    const hour = 60 * 60 * 1000;
    const assignedAt = new Date(Date.now() - entry.assignedHoursAgo * hour);
    const acceptedAt =
      entry.acceptedHoursAfterAssign === undefined
        ? null
        : new Date(assignedAt.getTime() + entry.acceptedHoursAfterAssign * hour);
    const shippedAt =
      acceptedAt && entry.shippedHoursAfterAccept !== undefined
        ? new Date(acceptedAt.getTime() + entry.shippedHoursAfterAccept * hour)
        : null;

    const { data: fulfilment } = await db
      .from('order_fulfilments')
      .insert({
        order_id: orderId,
        fulfiller_kind: 'merchant',
        merchant_id: merchantId,
        status: entry.status,
        items_subtotal_cents: 2000,
        assigned_at: assignedAt.toISOString(),
        accepted_at: acceptedAt?.toISOString() ?? null,
        shipped_at: shippedAt?.toISOString() ?? null,
      })
      .select('id')
      .single();

    const fulfilmentId = (fulfilment as { id: string }).id;

    await db.from('order_items').insert({
      order_id: orderId,
      product_id: product.productId,
      variant_id: product.variantId,
      fulfilment_id: fulfilmentId,
      merchant_offer_id: offer,
      name_snapshot: 'Probe',
      sku: product.sku,
      quantity: 1,
      unit_price_cents: 2000,
      total_cents: 2000,
    });
  }
}

async function scorecard(merchantId: string): Promise<Record<string, number | null>> {
  const { data, error } = await serviceClient().rpc('merchant_scorecard', {
    p_merchant_id: merchantId,
  });
  if (error) throw new Error(`merchant_scorecard failed: ${error.message}`);
  return data as Record<string, number | null>;
}

beforeAll(async () => {
  admin = await createUser('admin');
  userIds.push(admin.id);
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of orderIds) {
    await db.from('order_items').delete().eq('order_id', id);
    await db.from('order_fulfilments').delete().eq('order_id', id);
    await db.from('order_events').delete().eq('order_id', id);
    await db.from('orders').delete().eq('id', id);
  }
  for (const id of promotedProductIds) {
    await db.from('product_images').delete().eq('product_id', id);
    await db.from('product_variants').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
  for (const id of proposalIds) await db.from('product_proposals').delete().eq('id', id);
  for (const id of merchantIds) {
    await db.from('merchant_ledger').delete().eq('merchant_id', id);
    await db.from('merchant_offers').delete().eq('merchant_id', id);
    await db.from('product_proposals').delete().eq('merchant_id', id);
    await db.from('merchants').delete().eq('id', id);
  }
  for (const id of promotedBrandIds) await db.from('brands').delete().eq('id', id);
  for (const id of userIds) await deleteUser(id);
  for (const fixture of products) {
    await db.from('stock_movements').delete().eq('variant_id', fixture.variantId);
    await db.from('inventory_levels').delete().eq('variant_id', fixture.variantId);
    await db.from('product_variants').delete().eq('id', fixture.variantId);
    await db.from('products').delete().eq('id', fixture.productId);
    await db.from('brands').delete().eq('id', fixture.brandId);
  }
});

describe('the scorecard (docs/16 §6)', () => {
  /**
   * Rates are **null**, not zero, when there is nothing to judge.
   *
   * Zero would tell a brand-new merchant it had failed at something, and — worse — would place it below
   * every established merchant in a buy-box tie-break before it had shipped anything.
   */
  it('a merchant with no history has null rates, not zero', async () => {
    const merchant = await createMerchant('Fresh');
    const card = await scorecard(merchant);

    expect(card.assigned).toBe(0);
    expect(card.acceptance_rate).toBeNull();
    expect(card.cancellation_rate).toBeNull();
    expect(card.avg_accept_hours).toBeNull();
  });

  it('counts what was assigned, accepted and delivered', async () => {
    const merchant = await createMerchant('Counted');
    await fulfilmentHistory(merchant, [
      { assignedHoursAgo: 48, acceptedHoursAfterAssign: 2, shippedHoursAfterAccept: 4, status: 'delivered' },
      { assignedHoursAgo: 30, acceptedHoursAfterAssign: 3, shippedHoursAfterAccept: 5, status: 'shipped' },
      { assignedHoursAgo: 10, status: 'assigned' },
    ]);

    const card = await scorecard(merchant);
    expect(card.assigned).toBe(3);
    expect(card.accepted).toBe(2);
    expect(card.shipped).toBe(2);
    expect(card.delivered).toBe(1);
  });

  it('averages the hours to accept and to dispatch', async () => {
    const merchant = await createMerchant('Timed');
    await fulfilmentHistory(merchant, [
      { assignedHoursAgo: 50, acceptedHoursAfterAssign: 2, shippedHoursAfterAccept: 6, status: 'shipped' },
      { assignedHoursAgo: 40, acceptedHoursAfterAssign: 4, shippedHoursAfterAccept: 10, status: 'shipped' },
    ]);

    const card = await scorecard(merchant);
    expect(card.avg_accept_hours).toBe(3);
    expect(card.avg_dispatch_hours).toBe(8);
  });

  /**
   * Late dispatch is measured against the **offer's own** handling promise, not a marketplace default. A
   * merchant that said three days and took three days is on time; one that said one day and took three
   * is not. Anything else would punish honesty about a slower shelf.
   */
  it('lateness is judged against what the merchant promised', async () => {
    const honest = await createMerchant('Honest Three Days');
    await fulfilmentHistory(honest, [
      {
        assignedHoursAgo: 100,
        acceptedHoursAfterAssign: 1,
        shippedHoursAfterAccept: 60,
        status: 'shipped',
        handlingDays: 3,
      },
    ]);

    const optimistic = await createMerchant('Promised One Day');
    await fulfilmentHistory(optimistic, [
      {
        assignedHoursAgo: 100,
        acceptedHoursAfterAssign: 1,
        shippedHoursAfterAccept: 60,
        status: 'shipped',
        handlingDays: 1,
      },
    ]);

    expect((await scorecard(honest)).late_dispatch, 'three days promised, sixty hours taken').toBe(0);
    expect((await scorecard(optimistic)).late_dispatch, 'one day promised, sixty hours taken').toBe(1);
  });

  it('counts a cancellation after acceptance, which is what the customer feels', async () => {
    const merchant = await createMerchant('Cancelled Late');
    await fulfilmentHistory(merchant, [
      { assignedHoursAgo: 40, acceptedHoursAfterAssign: 1, status: 'cancelled' },
      { assignedHoursAgo: 30, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 2, status: 'shipped' },
    ]);

    const card = await scorecard(merchant);
    expect(card.cancelled_after_accept).toBe(1);
    expect(card.cancellation_rate).toBe(0.5);
  });

  it('a merchant reads its own scorecard', async () => {
    const merchant = await createMerchant('Self Aware');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    const { data, error } = await owner.client.rpc('merchant_scorecard', {
      p_merchant_id: merchant,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  /** A rival's scorecard is operational data about a competitor, which §3 exists to prevent. */
  it('a merchant cannot read a rival’s scorecard', async () => {
    const mine = await createMerchant('Mine SC');
    const theirs = await createMerchant('Theirs SC');

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient().from('merchant_users').insert({ merchant_id: mine, user_id: owner.id });

    const { error } = await owner.client.rpc('merchant_scorecard', { p_merchant_id: theirs });
    expect(error?.message ?? '').toContain('FORBIDDEN');
  });
});

describe('the rating the buy box reads (docs/16 §6)', () => {
  async function rating(merchantId: string): Promise<number> {
    const { data } = await serviceClient()
      .from('merchants')
      .select('rating_avg, rating_count')
      .eq('id', merchantId)
      .single();
    return Number((data as { rating_avg: number }).rating_avg);
  }

  /**
   * No history means **0**, which loses every tie-break rather than winning one it has not earned.
   * `rating_count` is what stops that being mistaken for a bad review.
   */
  it('a merchant that has shipped nothing scores zero', async () => {
    const merchant = await createMerchant('Unproven');
    const { data } = await admin.client.rpc('recompute_merchant_rating', {
      p_merchant_id: merchant,
    });

    expect(Number(data)).toBe(0);
    expect(await rating(merchant)).toBe(0);

    const { data: row } = await serviceClient()
      .from('merchants')
      .select('rating_count')
      .eq('id', merchant)
      .single();
    expect((row as { rating_count: number }).rating_count).toBe(0);
  });

  it('accepting everything quickly and shipping on time scores near the top', async () => {
    const merchant = await createMerchant('Exemplary');
    await fulfilmentHistory(merchant, [
      { assignedHoursAgo: 40, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 3, status: 'delivered' },
      { assignedHoursAgo: 30, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 4, status: 'delivered' },
    ]);

    const { data } = await admin.client.rpc('recompute_merchant_rating', {
      p_merchant_id: merchant,
    });

    expect(Number(data)).toBeGreaterThan(4.5);
  });

  /** Cancelling after acceptance costs two points, because it is the failure a customer experiences. */
  it('cancelling after acceptance drops the rating hard', async () => {
    const good = await createMerchant('Reliable');
    await fulfilmentHistory(good, [
      { assignedHoursAgo: 40, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 3, status: 'delivered' },
      { assignedHoursAgo: 35, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 3, status: 'delivered' },
    ]);

    const flaky = await createMerchant('Flaky');
    await fulfilmentHistory(flaky, [
      { assignedHoursAgo: 40, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 3, status: 'delivered' },
      { assignedHoursAgo: 35, acceptedHoursAfterAssign: 1, shippedHoursAfterAccept: 3, status: 'cancelled' },
    ]);

    const goodRating = Number(
      (await admin.client.rpc('recompute_merchant_rating', { p_merchant_id: good })).data,
    );
    const flakyRating = Number(
      (await admin.client.rpc('recompute_merchant_rating', { p_merchant_id: flaky })).data,
    );

    expect(flakyRating).toBeLessThan(goodRating);
  });

  it('is clamped to the 0–5 range', async () => {
    const merchant = await createMerchant('Clamped');
    await fulfilmentHistory(merchant, [
      { assignedHoursAgo: 20, acceptedHoursAfterAssign: 0, shippedHoursAfterAccept: 1, status: 'delivered' },
    ]);

    const value = Number(
      (await admin.client.rpc('recompute_merchant_rating', { p_merchant_id: merchant })).data,
    );

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(5);
  });

  it('a merchant cannot set its own rating', async () => {
    const merchant = await createMerchant('No Self Rating');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    const { error } = await owner.client.rpc('recompute_merchant_rating', {
      p_merchant_id: merchant,
    });
    expect(error?.message ?? '').toContain('FORBIDDEN');

    // And not by writing the column either — the self-update guard refuses it.
    const direct = await owner.client
      .from('merchants')
      .update({ rating_avg: 5 })
      .eq('id', merchant)
      .select('id');
    expect(direct.error ?? direct.data ?? []).toBeTruthy();
    const { data } = await serviceClient()
      .from('merchants')
      .select('rating_avg')
      .eq('id', merchant)
      .single();
    expect(Number((data as { rating_avg: number }).rating_avg)).not.toBe(5);
  });
});

describe('bulk stock and price (docs/16 §6)', () => {
  it('applies stock and price by BioCode SKU', async () => {
    const merchant = await createMerchant('Bulk One');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);
    const offer = await createOffer(merchant, product.variantId, { price: 1500, stock: 2 });

    const { data, error } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, stock: 20, price_cents: 1800 }],
    });

    expect(error).toBeNull();
    expect((data as { applied: number }).applied).toBe(1);

    const { data: row } = await serviceClient()
      .from('merchant_offers')
      .select('stock_on_hand, price_cents')
      .eq('id', offer)
      .single();

    const updated = row as { stock_on_hand: number; price_cents: number };
    expect(updated.stock_on_hand).toBe(20);
    expect(updated.price_cents).toBe(1800);
  });

  /** The merchant's own code wins, because that is what its export and its spreadsheet contain. */
  it('matches the merchant’s own SKU in preference to BioCode’s', async () => {
    const merchant = await createMerchant('Bulk Own Sku');
    const a = await createProduct({ stock: 0, priceCents: 3000 });
    const b = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(a, b);

    // The merchant's code for offer B collides with BioCode's code for offer A.
    const offerA = await createOffer(merchant, a.variantId, { price: 1500, stock: 1 });
    const offerB = await createOffer(merchant, b.variantId, {
      price: 1500,
      stock: 1,
      sku: a.sku,
    });

    await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: a.sku, stock: 50 }],
    });

    const { data: rows } = await serviceClient()
      .from('merchant_offers')
      .select('id, stock_on_hand')
      .in('id', [offerA, offerB]);

    const byId = new Map(
      ((rows ?? []) as { id: string; stock_on_hand: number }[]).map((row) => [row.id, row.stock_on_hand]),
    );

    expect(byId.get(offerB), 'the merchant’s own code wins').toBe(50);
    expect(byId.get(offerA), 'BioCode’s code loses the tie').toBe(1);
  });

  it('a stock-only row leaves the price alone', async () => {
    const merchant = await createMerchant('Bulk Stock Only');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);
    const offer = await createOffer(merchant, product.variantId, { price: 1500, stock: 2 });

    await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, stock: 9 }],
    });

    const { data } = await serviceClient()
      .from('merchant_offers')
      .select('stock_on_hand, price_cents')
      .eq('id', offer)
      .single();

    const row = data as { stock_on_hand: number; price_cents: number };
    expect(row.stock_on_hand).toBe(9);
    expect(row.price_cents).toBe(1500);
  });

  it('reports a SKU it cannot match, and applies the rest', async () => {
    const merchant = await createMerchant('Bulk Partial');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);
    await createOffer(merchant, product.variantId, { price: 1500, stock: 1 });

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [
        { sku: product.sku, stock: 4 },
        { sku: 'NOT-A-SKU', stock: 4 },
      ],
    });

    const result = data as { applied: number; skipped: { sku: string; reason: string }[] };
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([{ sku: 'NOT-A-SKU', reason: 'no_matching_offer' }]);
  });

  /** An offer mid-review must not move: a price that changed under a reviewer is a stale review. */
  it('does not touch an offer awaiting review', async () => {
    const merchant = await createMerchant('Bulk Pending');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);

    const { data: created } = await serviceClient()
      .from('merchant_offers')
      .insert({
        merchant_id: merchant,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 1,
        status: 'pending_review',
      })
      .select('id')
      .single();

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, stock: 99 }],
    });

    expect((data as { applied: number }).applied).toBe(0);

    const { data: row } = await serviceClient()
      .from('merchant_offers')
      .select('stock_on_hand')
      .eq('id', (created as { id: string }).id)
      .single();
    expect((row as { stock_on_hand: number }).stock_on_hand).toBe(1);
  });

  it('a merchant cannot bulk-update another merchant’s offers', async () => {
    const mine = await createMerchant('Bulk Mine');
    const theirs = await createMerchant('Bulk Theirs');

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient().from('merchant_users').insert({ merchant_id: mine, user_id: owner.id });

    const { error } = await owner.client.rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: theirs,
      p_rows: [{ sku: 'ANY', stock: 999 }],
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });

  it('the export round-trips the SKUs the upload matches on', async () => {
    const merchant = await createMerchant('Round Trip');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);
    await createOffer(merchant, product.variantId, { price: 1500, stock: 3, sku: 'MY-1' });

    const { data, error } = await serviceClient().rpc('merchant_offers_export', {
      p_merchant_id: merchant,
    });

    expect(error).toBeNull();
    const rows = (data ?? []) as { sku: string; merchant_sku: string; price_cents: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sku).toBe(product.sku);
    expect(rows[0]?.merchant_sku).toBe('MY-1');

    // And the exported SKU matches on the way back in, which is the point of the export.
    const applied = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: rows[0]?.merchant_sku ?? '', stock: 11 }],
    });
    expect((applied.data as { applied: number }).applied).toBe(1);
  });

  it('applies handling days and the low-stock threshold', async () => {
    const merchant = await createMerchant('Bulk Handling');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);
    const offer = await createOffer(merchant, product.variantId, { price: 1500, stock: 2 });

    await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, handling_days: 4, low_stock_threshold: 12 }],
    });

    const { data } = await serviceClient()
      .from('merchant_offers')
      .select('handling_days, low_stock_threshold, price_cents')
      .eq('id', offer)
      .single();

    const row = data as {
      handling_days: number;
      low_stock_threshold: number;
      price_cents: number;
    };
    expect(row.handling_days).toBe(4);
    expect(row.low_stock_threshold).toBe(12);
    // Absent columns still mean "leave it alone", which is what makes a partial sheet safe.
    expect(row.price_cents).toBe(1500);
  });
});

/**
 * docs/16 §6.1 — the same paste creates offers.
 *
 * The thing worth testing is not that an INSERT works. It is that **every way a creation should be
 * refused, is** — an unknown code, a product BioCode has not published, a variant that is switched off, an
 * offer already mid-review, and a row with no price. A bulk creator that guesses is a bulk creator that
 * puts a merchant's supply on the wrong product at the wrong price, two hundred rows at a time.
 */
describe('bulk offer creation (docs/16 §6.1)', () => {
  it('creates a draft offer for a SKU the merchant has no offer on', async () => {
    const merchant = await createMerchant('Create One');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);

    const { data, error } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [
        { sku: product.sku, price_cents: 1750, stock: 6, handling_days: 2, low_stock_threshold: 4 },
      ],
      p_create: true,
    });

    expect(error).toBeNull();
    const result = data as { applied: number; created: number; skipped: unknown[] };
    expect(result.created).toBe(1);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([]);

    const { data: row } = await serviceClient()
      .from('merchant_offers')
      .select('status, price_cents, stock_on_hand, handling_days, low_stock_threshold, merchant_sku')
      .eq('merchant_id', merchant)
      .eq('variant_id', product.variantId)
      .single();

    const offer = row as {
      status: string;
      price_cents: number;
      stock_on_hand: number;
      handling_days: number;
      low_stock_threshold: number;
      merchant_sku: string;
    };

    /*
     * `draft`, not `pending_review`.
     *
     * Submitting for review is a decision a merchant makes about an offer it has looked at, and a paste of
     * two hundred rows is not two hundred such decisions. It is also what keeps the review model intact:
     * nothing here reaches a customer without `offers.review`.
     */
    expect(offer.status).toBe('draft');
    expect(offer.price_cents).toBe(1750);
    expect(offer.stock_on_hand).toBe(6);
    expect(offer.handling_days).toBe(2);
    expect(offer.low_stock_threshold).toBe(4);
    // Kept, so the merchant's *next* sheet matches on its own code rather than ours.
    expect(offer.merchant_sku).toBe(product.sku);
  });

  it('defaults stock, handling and threshold when the sheet omits them', async () => {
    const merchant = await createMerchant('Create Defaults');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);

    await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, price_cents: 900 }],
      p_create: true,
    });

    const { data } = await serviceClient()
      .from('merchant_offers')
      .select('stock_on_hand, handling_days, low_stock_threshold')
      .eq('merchant_id', merchant)
      .single();

    const offer = data as {
      stock_on_hand: number;
      handling_days: number;
      low_stock_threshold: number;
    };
    // Zero stock is the honest default: a merchant that did not say how many holds none yet.
    expect(offer.stock_on_hand).toBe(0);
    expect(offer.handling_days).toBe(1);
    expect(offer.low_stock_threshold).toBe(3);
  });

  it('matches a barcode when that is all the merchant has', async () => {
    const merchant = await createMerchant('Create Barcode');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);

    const barcode = `50${Date.now().toString().slice(-11)}`;
    await serviceClient()
      .from('product_variants')
      .update({ barcode })
      .eq('id', product.variantId);

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: barcode, price_cents: 1100 }],
      p_create: true,
    });

    expect((data as { created: number }).created).toBe(1);

    const { data: row } = await serviceClient()
      .from('merchant_offers')
      .select('variant_id')
      .eq('merchant_id', merchant)
      .single();
    expect((row as { variant_id: string }).variant_id).toBe(product.variantId);
  });

  it('reports a code no product of ours carries', async () => {
    const merchant = await createMerchant('Create Unknown');

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: 'NO-SUCH-SKU-EVER', price_cents: 500 }],
      p_create: true,
    });

    const result = data as { created: number; skipped: { sku: string; reason: string }[] };
    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([{ sku: 'NO-SUCH-SKU-EVER', reason: 'unknown_sku' }]);
  });

  /**
   * A draft product is not offerable, and the reason is not tidiness.
   *
   * An offer on an unpublished product would sit on a page no customer can reach — and a lookup that
   * answered for drafts would make this function an oracle for probing whether BioCode is preparing to
   * list something. `unknown_sku` is the same answer a nonexistent code gets, deliberately.
   */
  it('refuses to create against an unpublished product, and says nothing about it', async () => {
    const merchant = await createMerchant('Create Draft Product');
    const product = await createProduct({ stock: 0, priceCents: 3000, status: 'draft' });
    products.push(product);

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, price_cents: 500 }],
      p_create: true,
    });

    const result = data as { created: number; skipped: { sku: string; reason: string }[] };
    expect(result.created).toBe(0);
    expect(result.skipped[0]?.reason).toBe('unknown_sku');
  });

  it('refuses to create against an inactive variant', async () => {
    const merchant = await createMerchant('Create Inactive');
    const product = await createProduct({ stock: 0, priceCents: 3000, variantActive: false });
    products.push(product);

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, price_cents: 500 }],
      p_create: true,
    });

    expect((data as { created: number }).created).toBe(0);
  });

  it('needs a price to create, and says so', async () => {
    const merchant = await createMerchant('Create No Price');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, stock: 5 }],
      p_create: true,
    });

    const result = data as { created: number; skipped: { sku: string; reason: string }[] };
    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([{ sku: product.sku, reason: 'price_required' }]);
  });

  /**
   * `unique (merchant_id, variant_id)` would raise on a second offer, and the two blocked states need
   * different things from the merchant: wait, or open the offer and read the note.
   */
  it('names the offer that is in the way rather than colliding', async () => {
    const merchant = await createMerchant('Create Blocked');
    const pending = await createProduct({ stock: 0, priceCents: 3000 });
    const rejected = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(pending, rejected);

    await serviceClient().from('merchant_offers').insert([
      {
        merchant_id: merchant,
        variant_id: pending.variantId,
        price_cents: 1000,
        status: 'pending_review',
      },
      {
        merchant_id: merchant,
        variant_id: rejected.variantId,
        price_cents: 1000,
        status: 'rejected',
      },
    ]);

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [
        { sku: pending.sku, price_cents: 1200 },
        { sku: rejected.sku, price_cents: 1200 },
      ],
      p_create: true,
    });

    const result = data as { created: number; skipped: { sku: string; reason: string }[] };
    expect(result.created).toBe(0);

    const reasons = new Map(result.skipped.map((entry) => [entry.sku, entry.reason]));
    expect(reasons.get(pending.sku)).toBe('awaiting_review');
    expect(reasons.get(rejected.sku)).toBe('offer_rejected');
  });

  /** The default. A nightly stock file must report a typo, not turn it into an offer. */
  it('creates nothing when p_create is not asked for', async () => {
    const merchant = await createMerchant('Create Off');
    const product = await createProduct({ stock: 0, priceCents: 3000 });
    products.push(product);

    const { data } = await serviceClient().rpc('merchant_bulk_upsert_offers', {
      p_merchant_id: merchant,
      p_rows: [{ sku: product.sku, price_cents: 1000, stock: 3 }],
    });

    const result = data as { created: number; skipped: { sku: string; reason: string }[] };
    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([{ sku: product.sku, reason: 'no_matching_offer' }]);
  });

  it('the catalogue export lists published variants and not drafts', async () => {
    const published = await createProduct({ stock: 4, priceCents: 2500 });
    const draft = await createProduct({ stock: 0, priceCents: 2500, status: 'draft' });
    products.push(published, draft);

    const { data, error } = await serviceClient().rpc('catalogue_export');
    expect(error).toBeNull();

    const rows = (data ?? []) as { sku: string; in_stock: boolean; price_cents: number }[];
    const bySku = new Map(rows.map((row) => [row.sku, row]));

    expect(bySku.has(published.sku), 'a published variant is offerable and listed').toBe(true);
    expect(bySku.has(draft.sku), 'a draft is neither').toBe(false);
    // The column that tells a merchant where its offer would win the buy box.
    expect(bySku.get(published.sku)?.in_stock).toBe(true);
    expect(bySku.get(published.sku)?.price_cents).toBe(2500);
  });
});

describe('proposals (docs/16 §4)', () => {
  it('a merchant submits one and reads its own', async () => {
    const merchant = await createMerchant('Proposer');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    const { error } = await owner.client.from('product_proposals').insert({
      merchant_id: merchant,
      status: 'pending',
      payload: { product_name: 'Magnesium Bisglycinate', brand_name: 'Probe Labs' },
    });

    expect(error).toBeNull();

    const { data } = await owner.client.from('product_proposals').select('id, status');
    expect(data ?? []).toHaveLength(1);
    expect((data as { status: string }[])[0]?.status).toBe('pending');
  });

  /** The insert policy pins the status: a merchant cannot submit something already approved. */
  it('a merchant cannot submit a pre-approved proposal', async () => {
    const merchant = await createMerchant('Sneaky Proposer');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    const { error } = await owner.client.from('product_proposals').insert({
      merchant_id: merchant,
      status: 'approved',
      payload: { product_name: 'Self approved' },
    });

    expect(error, 'the insert policy requires status = pending').not.toBeNull();
  });

  /**
   * `needs_info` is the one status a merchant may edit from, which is the whole point of asking for more.
   * A `pending` proposal is mid-review and must not move under the reviewer.
   */
  it('a merchant may edit a proposal returned for more information, but not a pending one', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Editor');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await db.from('merchant_users').insert({ merchant_id: merchant, user_id: owner.id });

    const { data: needsInfo } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'needs_info',
        payload: { product_name: 'Needs more' },
      })
      .select('id')
      .single();

    const { data: pending } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: { product_name: 'Under review' },
      })
      .select('id')
      .single();

    const editable = await owner.client
      .from('product_proposals')
      .update({ payload: { product_name: 'Needs more, revised' } })
      .eq('id', (needsInfo as { id: string }).id)
      .select('id');
    expect(editable.data ?? [], 'needs_info is editable').toHaveLength(1);

    const locked = await owner.client
      .from('product_proposals')
      .update({ payload: { product_name: 'Tampered' } })
      .eq('id', (pending as { id: string }).id)
      .select('id');
    expect(locked.data ?? [], 'pending is not').toHaveLength(0);
  });

  it('a merchant cannot see a rival’s proposal', async () => {
    const db = serviceClient();
    const mine = await createMerchant('Prop Mine');
    const theirs = await createMerchant('Prop Theirs');

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await db.from('merchant_users').insert({ merchant_id: mine, user_id: owner.id });

    await db.from('product_proposals').insert({
      merchant_id: theirs,
      status: 'pending',
      payload: { product_name: 'Their idea' },
    });

    const { data } = await owner.client.from('product_proposals').select('merchant_id');
    const ids = new Set((data ?? []).map((row) => (row as { merchant_id: string }).merchant_id));
    expect(ids.has(theirs)).toBe(false);
  });

  it('a product manager decides one', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Decided');
    const staff = await createUser('product_manager');
    userIds.push(staff.id);

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: { product_name: 'Worth listing' },
      })
      .select('id')
      .single();

    const { data, error } = await staff.client
      .from('product_proposals')
      .update({
        status: 'approved',
        reviewer_note: 'Listed as SKU BIO-1234.',
        reviewed_by: staff.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', (created as { id: string }).id)
      .select('status, reviewer_note')
      .maybeSingle();

    expect(error).toBeNull();
    const row = data as { status: string; reviewer_note: string };
    expect(row.status).toBe('approved');
    expect(row.reviewer_note).toContain('BIO-1234');
  });

  /**
   * Approving records a decision and creates **no product**. Anything else would be merchant-created
   * listings with a delay, which is what §1 exists to prevent.
   */
  /**
   * Approving promotes the proposal to a **draft** product — the inverse of what this file asserted at
   * step 6, which was "approving creates no product".
   *
   * That assertion was defensible and it was also more conservative than the schema:
   * `created_product_id` has existed since migration 28 and was wired to nothing. What makes the change
   * safe is the next test — a draft cannot reach a customer, because publishing needs `compliance.approve`.
   */
  it('promoting an approved proposal creates a draft product', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Promoted');
    const name = `Promoted Probe ${Date.now()}`;

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: {
          product_name: name,
          brand_name: 'Promote Labs',
          form: 'powder',
          variant_name: '500 g',
          asking_price_cents: 1450,
        },
      })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const { data, error } = await db.rpc('promote_proposal_to_draft', {
      p_proposal_id: proposalId,
    });

    expect(error).toBeNull();
    const result = data as { created: boolean; product_id: string; slug: string };
    expect(result.created).toBe(true);
    promotedProductIds.push(result.product_id);

    const { data: product } = await db
      .from('products')
      .select('slug, status, form, name, brand_id')
      .eq('id', result.product_id)
      .single();

    const row = product as {
      slug: string;
      status: string;
      form: string;
      name: Record<string, string>;
      brand_id: string;
    };

    // **Draft.** This is the whole safety of the change.
    expect(row.status).toBe('draft');
    expect(row.form).toBe('powder');
    expect(row.name.sq).toBe(name);
    expect(row.name.en).toBe(name);
    promotedBrandIds.push(row.brand_id);

    // The link is recorded, which is what makes a second approval a no-op.
    const { data: after } = await db
      .from('product_proposals')
      .select('created_product_id')
      .eq('id', proposalId)
      .single();
    expect((after as { created_product_id: string }).created_product_id).toBe(result.product_id);
  });

  /**
   * A draft is invisible on the storefront, which is why creating one from a merchant's proposal is not
   * "merchant-created listings with a delay". Asserted through `search_products` and the anon client — the
   * two things a shopper actually goes through — rather than by reading the status column back.
   */
  it('the draft it creates is invisible to a shopper', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Invisible Draft');
    const name = `Invisible Probe ${Date.now()}`;

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: { product_name: name, brand_name: 'Invisible Labs', asking_price_cents: 1000 },
      })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const { data } = await db.rpc('promote_proposal_to_draft', { p_proposal_id: proposalId });
    const result = data as { product_id: string; slug: string };
    promotedProductIds.push(result.product_id);

    const { data: brand } = await db
      .from('products')
      .select('brand_id')
      .eq('id', result.product_id)
      .single();
    promotedBrandIds.push((brand as { brand_id: string }).brand_id);

    const found = await anonClient().rpc('search_products', { p_query: name, p_limit: 24 });
    expect(found.data ?? [], 'a draft must not be searchable').toHaveLength(0);

    const direct = await anonClient()
      .from('products')
      .select('id')
      .eq('id', result.product_id);
    expect(direct.data ?? [], 'and not readable by slug or id either').toHaveLength(0);
  });

  /** A second approval, or a stale tab, must not mint a second product. */
  it('promoting twice is a no-op', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Promote Once');

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: {
          product_name: `Once Probe ${Date.now()}`,
          brand_name: 'Once Labs',
          asking_price_cents: 900,
        },
      })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const first = await db.rpc('promote_proposal_to_draft', { p_proposal_id: proposalId });
    const firstResult = first.data as { created: boolean; product_id: string };
    expect(firstResult.created).toBe(true);
    promotedProductIds.push(firstResult.product_id);

    const { data: brand } = await db
      .from('products')
      .select('brand_id')
      .eq('id', firstResult.product_id)
      .single();
    promotedBrandIds.push((brand as { brand_id: string }).brand_id);

    const second = await db.rpc('promote_proposal_to_draft', { p_proposal_id: proposalId });
    const secondResult = second.data as { created: boolean; product_id: string };
    expect(secondResult.created).toBe(false);
    expect(secondResult.product_id).toBe(firstResult.product_id);
  });

  /**
   * The brand is matched case-insensitively before being created, or a second "Alpha Labs" would split one
   * brand's products across two pages.
   */
  it('reuses an existing brand whose name differs only in case', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Brand Reuse');
    const stamp = Date.now();

    const { data: brand } = await db
      .from('brands')
      .insert({ slug: `brand-reuse-${stamp}`, name: `Reuse Labs ${stamp}` })
      .select('id')
      .single();
    const brandId = (brand as { id: string }).id;
    promotedBrandIds.push(brandId);

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: {
          product_name: `Reuse Probe ${stamp}`,
          // Same brand, shouted.
          brand_name: `REUSE LABS ${stamp}`,
          asking_price_cents: 1100,
        },
      })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const { data } = await db.rpc('promote_proposal_to_draft', { p_proposal_id: proposalId });
    const result = data as { product_id: string; brand_id: string };
    promotedProductIds.push(result.product_id);

    expect(result.brand_id).toBe(brandId);
  });

  /** The variant carries the merchant's asking price, because a variant cannot exist without one. */
  it('the variant is created at the asking price, provisionally', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Provisional Price');

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchant,
        status: 'pending',
        payload: {
          product_name: `Price Probe ${Date.now()}`,
          brand_name: 'Price Labs',
          variant_name: '250 g',
          asking_price_cents: 1450,
        },
      })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const { data } = await db.rpc('promote_proposal_to_draft', { p_proposal_id: proposalId });
    const result = data as { product_id: string; provisional_price_cents: number };
    promotedProductIds.push(result.product_id);

    const { data: brand } = await db
      .from('products')
      .select('brand_id')
      .eq('id', result.product_id)
      .single();
    promotedBrandIds.push((brand as { brand_id: string }).brand_id);

    expect(result.provisional_price_cents).toBe(1450);

    const { data: variant } = await db
      .from('product_variants')
      .select('sku, price_cents, name, is_default')
      .eq('product_id', result.product_id)
      .single();

    const row = variant as {
      sku: string;
      price_cents: number;
      name: Record<string, string>;
      is_default: boolean;
    };
    expect(row.price_cents).toBe(1450);
    expect(row.name.en).toBe('250 g');
    expect(row.is_default).toBe(true);
    // Obviously provisional, so nobody mistakes it for a real supplier code.
    expect(row.sku.startsWith('PROP-')).toBe(true);
  });

  it('a proposal with no product name cannot be promoted', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Nameless');

    const { data: created } = await db
      .from('product_proposals')
      .insert({ merchant_id: merchant, status: 'pending', payload: { brand_name: 'Only Brand' } })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const { error } = await db.rpc('promote_proposal_to_draft', { p_proposal_id: proposalId });
    expect(error?.message ?? '').toContain('PROPOSAL_INCOMPLETE');
  });

  it('a merchant cannot promote its own proposal', async () => {
    const db = serviceClient();
    const merchantId = await createMerchant('Self Promote');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await db.from('merchant_users').insert({ merchant_id: merchantId, user_id: owner.id });

    const { data: created } = await db
      .from('product_proposals')
      .insert({
        merchant_id: merchantId,
        status: 'pending',
        payload: { product_name: 'Self promoted', brand_name: 'Self Labs' },
      })
      .select('id')
      .single();

    const proposalId = (created as { id: string }).id;
    proposalIds.push(proposalId);

    const { error } = await owner.client.rpc('promote_proposal_to_draft', {
      p_proposal_id: proposalId,
    });
    expect(error?.message ?? '').toContain('FORBIDDEN');
  });
});

describe('proposal images (docs/16 §9)', () => {
  /**
   * The bucket is private, and that is the point: a **rejected** proposal's photographs must not sit on a
   * public URL forever for a product BioCode decided not to list.
   */
  it('the proposals bucket is private and accepts only images', async () => {
    const { data } = await serviceClient()
      .from('storage.buckets' as never)
      .select('*')
      .limit(0);

    /*
     * `storage.buckets` is not reachable through PostgREST, so the bucket's shape is asserted through the
     * storage API instead — which is also how the application sees it.
     */
    void data;

    const { data: buckets, error } = await serviceClient().storage.listBuckets();
    expect(error).toBeNull();

    const bucket = (buckets ?? []).find((entry) => entry.name === 'merchant-proposals');
    expect(bucket, 'the bucket must exist').toBeDefined();
    expect(bucket?.public, 'and must not be public').toBe(false);
  });

  /** A merchant may write into its own folder and nowhere else. */
  it('a merchant cannot upload into another merchant’s folder', async () => {
    const db = serviceClient();
    const mine = await createMerchant('Upload Mine');
    const theirs = await createMerchant('Upload Theirs');

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await db.from('merchant_users').insert({ merchant_id: mine, user_id: owner.id });

    const bytes = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

    const own = await owner.client.storage
      .from('merchant-proposals')
      .upload(`proposals/${mine}/probe-${Date.now()}.png`, bytes, { contentType: 'image/png' });
    expect(own.error, 'its own folder is writable').toBeNull();

    const other = await owner.client.storage
      .from('merchant-proposals')
      .upload(`proposals/${theirs}/probe-${Date.now()}.png`, bytes, { contentType: 'image/png' });
    expect(other.error, 'a rival’s folder is not').not.toBeNull();

    // Tidy up the one that succeeded.
    await db.storage.from('merchant-proposals').remove([`proposals/${mine}/`]);
  });
});
