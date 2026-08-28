import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, createProduct, serviceClient, type ProductFixture } from './helpers';

/**
 * docs/16 §1 — who supplies a variant.
 *
 * The selection rule is one SQL function, and this file is the only place its behaviour is
 * asserted. Every case builds real rows and asks `variant_buy_box` as **anon** wherever the claim is
 * about what a shopper sees, because the interesting half of this function is what it refuses to
 * return: it reads two tables anon has no access to, and a definer function that leaked a unit count
 * would undo the bucketing the storefront has relied on since docs/13 §B7.
 */

const merchantIds: string[] = [];
const offerIds: string[] = [];
const products: ProductFixture[] = [];

/** An approved merchant, with a rating so the tie-break is testable. */
async function createMerchant(options?: {
  status?: string;
  rating?: number;
  name?: string;
}): Promise<string> {
  const db = serviceClient();
  const stamp = `${Date.now()}-${merchantIds.length}`;

  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `bb-${stamp}`,
      legal_name: `Buy Box ${stamp} SH.P.K.`,
      display_name: options?.name ?? `Buy Box ${stamp}`,
      business_no: `ARBK-BB-${stamp}`,
      contact_name: 'Probe',
      contact_email: `bb-${stamp}@biocode.test`,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: options?.status ?? 'approved',
      rating_avg: options?.rating ?? 0,
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
  fields: { price: number; stock: number; status?: string; handling?: number; threshold?: number },
): Promise<string> {
  const db = serviceClient();
  const { data, error } = await db
    .from('merchant_offers')
    .insert({
      merchant_id: merchantId,
      variant_id: variantId,
      price_cents: fields.price,
      stock_on_hand: fields.stock,
      status: fields.status ?? 'approved',
      handling_days: fields.handling ?? 1,
      low_stock_threshold: fields.threshold ?? 3,
    })
    .select('id')
    .single();

  // PostgREST reports an insert failure in the result rather than by throwing, and an unchecked
  // one leaves a test asserting confidently about zero rows (docs/13 §N9).
  if (error || !data) throw new Error(`offer insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  offerIds.push(id);
  return id;
}

interface BuyBox {
  variant_id: string;
  source: 'biocode' | 'merchant' | 'none';
  stock_status: 'in_stock' | 'low' | 'out_of_stock';
  merchant_id: string | null;
  merchant_slug: string | null;
  merchant_name: string | null;
  offer_id: string | null;
  handling_days: number | null;
  supplier_count: number;
}

/** The function as a shopper calls it. */
async function buyBox(variantIds: string[]): Promise<BuyBox[]> {
  const { data, error } = await anonClient().rpc('variant_buy_box', {
    p_variant_ids: variantIds,
  });
  if (error) throw new Error(`variant_buy_box failed: ${error.message}`);
  return (data ?? []) as BuyBox[];
}

async function one(variantId: string): Promise<BuyBox> {
  const rows = await buyBox([variantId]);
  const row = rows[0];
  if (!row) throw new Error('variant_buy_box returned no row for a variant that was asked for');
  return row;
}

/** A product with no BioCode stock at all — the case merchant supply exists for. */
async function unstockedProduct(): Promise<ProductFixture> {
  const fixture = await createProduct({ stock: 0, priceCents: 2490 });
  products.push(fixture);
  return fixture;
}

async function stockedProduct(stock = 25): Promise<ProductFixture> {
  const fixture = await createProduct({ stock, priceCents: 2490 });
  products.push(fixture);
  return fixture;
}

afterAll(async () => {
  const db = serviceClient();
  for (const id of offerIds) await db.from('merchant_offers').delete().eq('id', id);
  for (const id of merchantIds) await db.from('merchants').delete().eq('id', id);
  for (const fixture of products) {
    await db.from('product_variants').delete().eq('id', fixture.variantId);
    await db.from('products').delete().eq('id', fixture.productId);
    await db.from('brands').delete().eq('id', fixture.brandId);
  }
});

describe('BioCode wins (docs/16 §1)', () => {
  /**
   * The rule with the most riding on it: first-party stock is privileged by the shape of the
   * schema, and this asserts the selection agrees. A merchant undercutting BioCode by €20 does not
   * take the buy box — it is a supplier, not a competitor on the same shelf.
   */
  it('BioCode stock beats a cheaper merchant offer', async () => {
    const product = await stockedProduct();
    const merchant = await createMerchant();
    await createOffer(merchant, product.variantId, { price: 490, stock: 100 });

    const row = await one(product.variantId);
    expect(row.source).toBe('biocode');
    expect(row.stock_status).toBe('in_stock');
    expect(row.merchant_id, 'a BioCode line names no merchant').toBeNull();
    expect(row.offer_id).toBeNull();
    // Two suppliers exist even though only one is in the box; routing needs to know that.
    expect(row.supplier_count).toBe(2);
  });

  it('a variant with no stock anywhere is out of stock, not absent', async () => {
    const product = await unstockedProduct();
    const row = await one(product.variantId);
    expect(row.source).toBe('none');
    expect(row.stock_status).toBe('out_of_stock');
    expect(row.supplier_count).toBe(0);
  });

  /**
   * A variant id the caller invented, or one whose stock rows were deleted, must still come back.
   *
   * The PDP maps its variants against this result; a function that silently dropped unknown ids
   * would render a variant with no availability at all rather than an out-of-stock one.
   */
  it('a variant that has never had an inventory row still returns a row', async () => {
    const rows = await buyBox(['00000000-0000-4000-8000-000000000000']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('none');
  });
});

describe('choosing between merchants (docs/16 §1)', () => {
  it('the cheapest approved in-stock offer wins', async () => {
    const product = await unstockedProduct();
    const dear = await createMerchant({ name: 'Dear' });
    const cheap = await createMerchant({ name: 'Cheap' });

    await createOffer(dear, product.variantId, { price: 2000, stock: 10 });
    const winner = await createOffer(cheap, product.variantId, { price: 1500, stock: 10 });

    const row = await one(product.variantId);
    expect(row.source).toBe('merchant');
    expect(row.offer_id).toBe(winner);
    expect(row.merchant_name).toBe('Cheap');
    expect(row.supplier_count).toBe(2);
  });

  /** Equal prices: the better-rated merchant takes it. */
  it('a price tie is broken by merchant rating', async () => {
    const product = await unstockedProduct();
    const poor = await createMerchant({ rating: 3.2, name: 'Poor' });
    const good = await createMerchant({ rating: 4.8, name: 'Good' });

    await createOffer(poor, product.variantId, { price: 1500, stock: 10 });
    await createOffer(good, product.variantId, { price: 1500, stock: 10 });

    expect((await one(product.variantId)).merchant_name).toBe('Good');
  });

  /**
   * Equal price and equal rating: the offer that has been there longest.
   *
   * Without this last term the winner would be whatever the planner returned first, and the PDP
   * could name a different seller on two consecutive renders of an unchanged page.
   */
  it('an unbroken tie goes to the oldest offer', async () => {
    const product = await unstockedProduct();
    const first = await createMerchant({ rating: 4, name: 'First' });
    const second = await createMerchant({ rating: 4, name: 'Second' });

    const oldest = await createOffer(first, product.variantId, { price: 1500, stock: 10 });
    await createOffer(second, product.variantId, { price: 1500, stock: 10 });

    const a = await one(product.variantId);
    const b = await one(product.variantId);
    expect(a.offer_id).toBe(oldest);
    expect(b.offer_id, 'two calls must not disagree about who is selling').toBe(oldest);
  });

  it('the winning offer carries its handling time, which is the delivery estimate', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    await createOffer(merchant, product.variantId, { price: 1500, stock: 10, handling: 3 });

    expect((await one(product.variantId)).handling_days).toBe(3);
  });
});

describe('offers that must not reach the buy box (docs/16 §1)', () => {
  it('a draft offer does not sell', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    await createOffer(merchant, product.variantId, { price: 1500, stock: 10, status: 'draft' });

    expect((await one(product.variantId)).source).toBe('none');
  });

  it('an offer awaiting review does not sell', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    await createOffer(merchant, product.variantId, {
      price: 1500,
      stock: 10,
      status: 'pending_review',
    });

    expect((await one(product.variantId)).source).toBe('none');
  });

  it('a paused offer leaves the buy box', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    const offer = await createOffer(merchant, product.variantId, { price: 1500, stock: 10 });

    expect((await one(product.variantId)).offer_id).toBe(offer);

    await serviceClient().from('merchant_offers').update({ status: 'paused' }).eq('id', offer);
    expect((await one(product.variantId)).source).toBe('none');
  });

  it('an approved offer with no stock does not sell', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    await createOffer(merchant, product.variantId, { price: 1500, stock: 0 });

    expect((await one(product.variantId)).source).toBe('none');
  });

  /**
   * Suspension has to take effect on the storefront, not only in the portal.
   *
   * `current_merchant_ids()` already excludes a suspended merchant from its own data (§3). This is
   * the other half: its stock stops being sellable at the same moment, without anyone touching the
   * offers.
   */
  it('suspending a merchant removes its offers from the buy box', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    const offer = await createOffer(merchant, product.variantId, { price: 1500, stock: 10 });

    expect((await one(product.variantId)).offer_id).toBe(offer);

    await serviceClient().from('merchants').update({ status: 'suspended' }).eq('id', merchant);
    const after = await one(product.variantId);
    expect(after.source).toBe('none');
    expect(after.supplier_count).toBe(0);
  });

  it('a pending merchant cannot sell before it is approved', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant({ status: 'pending' });
    // Inserted through the service client, since the offer guard would refuse the merchant itself.
    await createOffer(merchant, product.variantId, { price: 1500, stock: 10 });

    expect((await one(product.variantId)).source).toBe('none');
  });
});

describe('what the buy box withholds (docs/16 §3)', () => {
  let product: ProductFixture;

  beforeAll(async () => {
    // Distinctive quantities, so a leak is unmistakable in the serialised payload. Two units of
    // BioCode stock is also what makes the `low` bucket below the real answer.
    product = await stockedProduct(2);
    const merchant = await createMerchant();
    await createOffer(merchant, product.variantId, { price: 4137, stock: 8624, threshold: 3 });
  });

  /**
   * Asserted two ways, because each catches a different mistake.
   *
   * Searching the serialised row catches a **value** arriving under an innocent key name. Checking
   * the key list catches a column added later whose value happens not to be distinctive. Neither is
   * sufficient alone: `supplier_count` is legitimately a small integer that will collide with any
   * unit count sooner or later, which is exactly why the value search uses quantities nothing else
   * in the payload could produce.
   */
  it('no unit count appears anywhere in the payload', async () => {
    const row = await one(product.variantId);
    const serialised = JSON.stringify(row);

    expect(serialised, 'the merchant unit count must not be reachable').not.toContain('8624');

    for (const key of Object.keys(row)) {
      expect(key, 'no column may carry a unit count').not.toMatch(/stock_on_hand|on_hand|quantity/);
    }
  });

  /** No price of any kind: the canonical variant price is the only customer-facing number. */
  it('no price appears anywhere in the payload', async () => {
    const row = await one(product.variantId);
    expect(
      JSON.stringify(row),
      'the asking price is between the merchant and BioCode',
    ).not.toContain('4137');
    expect(Object.keys(row).some((key) => key.includes('price'))).toBe(false);
  });

  /** Two units against a threshold of three is `low`, and that is all a shopper learns. */
  it('a shortage is bucketed, not counted', async () => {
    const row = await one(product.variantId);
    expect(row.source).toBe('biocode');
    expect(row.stock_status).toBe('low');
  });

  /** The tables it reads are still shut. The function is a window, not a door. */
  it('anon still cannot read the tables the function reads', async () => {
    const anon = anonClient();

    const inventory = await anon.from('inventory_levels').select('on_hand').limit(1);
    expect(inventory.data ?? [], 'inventory_levels is staff-only').toHaveLength(0);

    const offers = await anon.from('merchant_offers').select('price_cents').limit(1);
    expect(offers.data ?? [], 'merchant_offers is scoped to its merchant').toHaveLength(0);
  });
});

describe('v_merchant_offer_detail (docs/16 §5)', () => {
  /**
   * What the portal and the review queue both read.
   *
   * `merchant_due_cents` comes off the **retail** price, not the asking price, because that is what
   * settlement pays: the customer pays the canonical price and the merchant receives it less
   * commission. €24.90 at 15% is €3.74 commission — €21.16 due — and the merchant asking €18.00 is
   * therefore an offer worth routing. Asserted against the view rather than recomputed, so a change
   * to `merchant_settlement` cannot pass here and fail on a statement.
   */
  it('reports what settlement would pay, computed from the retail price', async () => {
    const product = await unstockedProduct();
    const merchant = await createMerchant();
    await serviceClient().from('merchants').update({ commission_pct: 15 }).eq('id', merchant);
    const offer = await createOffer(merchant, product.variantId, { price: 1800, stock: 10 });

    const { data, error } = await serviceClient()
      .from('v_merchant_offer_detail')
      .select('retail_price_cents, asking_price_cents, merchant_due_cents, commission_pct, sku')
      .eq('id', offer)
      .single();

    expect(error).toBeNull();
    const row = data as {
      retail_price_cents: number;
      asking_price_cents: number;
      merchant_due_cents: number;
      commission_pct: number;
      sku: string;
    };

    expect(row.retail_price_cents).toBe(2490);
    expect(row.asking_price_cents).toBe(1800);
    expect(Number(row.commission_pct)).toBe(15);
    expect(row.merchant_due_cents).toBe(2490 - 374);
    expect(row.sku).toBe(product.sku);
  });

  /**
   * The view is `security_invoker`, so one definition serves both audiences. This is the half that
   * matters: a merchant reads its own offers through it and nobody else's.
   */
  it('is scoped by RLS rather than by a status flag', async () => {
    const anon = anonClient();
    const { data } = await anon.from('v_merchant_offer_detail').select('id').limit(1);
    expect(data ?? [], 'anon has no offers, so it sees none').toHaveLength(0);
  });
});
