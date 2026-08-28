import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  createUser,
  deleteUser,
  serviceClient,
  type ProductFixture,
  type TestUser,
} from './helpers';

/**
 * docs/16 §5 — what a merchant may do to its own offers, and what it may not.
 *
 * Every write here goes through the **merchant's own session**, because that is the only way to test
 * the thing that matters: `guard_merchant_offer_write` plus RLS is what makes "a merchant cannot
 * approve its own offer" true. A service-role write would pass every one of these and prove nothing.
 *
 * Two shapes of refusal appear, and they are not interchangeable — the tests assert which one:
 *
 *   · the **trigger** raises, so the call returns an error;
 *   · a **policy** does not permit the row, so the call matches zero rows and returns no error at all
 *     (docs/13 §N7). An action that only checked `error` would report success for a write that did
 *     nothing, which is why the actions select back and why these tests assert on the row count.
 */

let merchantId: string;
let otherMerchantId: string;
let owner: TestUser;
let staff: TestUser;
const products: ProductFixture[] = [];
const userIds: string[] = [];
const merchantIds: string[] = [];

async function createMerchant(name: string, status = 'approved'): Promise<string> {
  const db = serviceClient();
  const stamp = `${Date.now()}-${merchantIds.length}`;
  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `off-${stamp}`,
      legal_name: `${name} SH.P.K.`,
      display_name: name,
      business_no: `ARBK-OFF-${stamp}`,
      contact_name: 'Probe',
      contact_email: `off-${stamp}@biocode.test`,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status,
      commission_pct: 20,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`merchant insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  merchantIds.push(id);
  return id;
}

/** A published variant with no BioCode stock, so a merchant offer is the only supply. */
async function unstocked(priceCents = 2000): Promise<ProductFixture> {
  const fixture = await createProduct({ stock: 0, priceCents });
  products.push(fixture);
  return fixture;
}

beforeAll(async () => {
  const db = serviceClient();

  merchantId = await createMerchant('Offers Probe');
  otherMerchantId = await createMerchant('Rival Probe');

  owner = await createUser('merchant');
  userIds.push(owner.id);
  await db.from('merchant_users').insert({ merchant_id: merchantId, user_id: owner.id });

  staff = await createUser('product_manager');
  userIds.push(staff.id);
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of merchantIds) {
    await db.from('merchant_offers').delete().eq('merchant_id', id);
    await db.from('merchants').delete().eq('id', id);
  }
  for (const id of userIds) await deleteUser(id);
  for (const fixture of products) {
    await db.from('product_variants').delete().eq('id', fixture.variantId);
    await db.from('products').delete().eq('id', fixture.productId);
    await db.from('brands').delete().eq('id', fixture.brandId);
  }
});

describe('creating an offer (docs/16 §5)', () => {
  it('a merchant can create its own draft', async () => {
    const product = await unstocked();
    const { data, error } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'draft',
      })
      .select('id, status')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('draft');
  });

  it('a merchant can submit straight into review', async () => {
    const product = await unstocked();
    const { data, error } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'pending_review',
      })
      .select('status')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('pending_review');
  });

  /** The reviewer's word, refused at the trigger rather than trusted from the client. */
  it('a merchant cannot create an offer that is already approved', async () => {
    const product = await unstocked();
    const { error } = await owner.client.from('merchant_offers').insert({
      merchant_id: merchantId,
      variant_id: product.variantId,
      price_cents: 1500,
      stock_on_hand: 10,
      status: 'approved',
    });

    expect(error?.message ?? '').toContain('OFFER_STATUS_FORBIDDEN');
  });

  it('a merchant cannot stamp its own approval columns', async () => {
    const product = await unstocked();
    const { error } = await owner.client.from('merchant_offers').insert({
      merchant_id: merchantId,
      variant_id: product.variantId,
      price_cents: 1500,
      stock_on_hand: 10,
      approved_at: new Date().toISOString(),
    });

    expect(error?.message ?? '').toContain('OFFER_APPROVAL_FORBIDDEN');
  });

  /** One offer per merchant per variant, or the buy box has two of the same seller to choose from. */
  it('a second offer on the same variant is refused', async () => {
    const product = await unstocked();
    const first = await owner.client.from('merchant_offers').insert({
      merchant_id: merchantId,
      variant_id: product.variantId,
      price_cents: 1500,
      stock_on_hand: 10,
    });
    expect(first.error).toBeNull();

    const second = await owner.client.from('merchant_offers').insert({
      merchant_id: merchantId,
      variant_id: product.variantId,
      price_cents: 1400,
      stock_on_hand: 5,
    });
    expect(second.error?.code).toBe('23505');
  });

  /**
   * The insert policy is `merchant_id = any (current_merchant_ids())`, so naming somebody else is not
   * an authorisation failure to be reported — the row simply is not permitted.
   */
  it('a merchant cannot create an offer for another merchant', async () => {
    const product = await unstocked();
    const { error } = await owner.client.from('merchant_offers').insert({
      merchant_id: otherMerchantId,
      variant_id: product.variantId,
      price_cents: 1500,
      stock_on_hand: 10,
    });

    expect(error, 'the insert policy must refuse this').not.toBeNull();
  });
});

describe('editing an offer (docs/16 §5)', () => {
  it('price, stock and handling are the merchant’s to change', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
      })
      .select('id')
      .single();

    const offerId = (created as { id: string }).id;

    const { data, error } = await owner.client
      .from('merchant_offers')
      .update({ price_cents: 1600, stock_on_hand: 4, handling_days: 2, merchant_sku: 'MINE-1' })
      .eq('id', offerId)
      .select('price_cents, stock_on_hand, handling_days, merchant_sku')
      .maybeSingle();

    expect(error).toBeNull();
    const row = data as {
      price_cents: number;
      stock_on_hand: number;
      handling_days: number;
      merchant_sku: string;
    };
    expect(row.price_cents).toBe(1600);
    expect(row.stock_on_hand).toBe(4);
    expect(row.handling_days).toBe(2);
    expect(row.merchant_sku).toBe('MINE-1');
  });

  it('a draft can be submitted for review', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'draft',
      })
      .select('id')
      .single();

    const { data, error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'pending_review' })
      .eq('id', (created as { id: string }).id)
      .select('status')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('pending_review');
  });

  it('a merchant cannot approve its own offer', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'pending_review',
      })
      .select('id')
      .single();

    const { error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'approved' })
      .eq('id', (created as { id: string }).id);

    expect(error?.message ?? '').toContain('OFFER_STATUS_FORBIDDEN');
  });

  it('a merchant cannot reject its own offer either', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'pending_review',
      })
      .select('id')
      .single();

    const { error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'rejected' })
      .eq('id', (created as { id: string }).id);

    expect(error?.message ?? '').toContain('OFFER_STATUS_FORBIDDEN');
  });
});

describe('pausing and resuming (docs/16 §5)', () => {
  let approvedOffer: string;

  beforeAll(async () => {
    const product = await unstocked();
    const { data } = await serviceClient()
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'approved',
      })
      .select('id')
      .single();
    approvedOffer = (data as { id: string }).id;
  });

  /** The one thing a merchant must be able to do the moment it runs out at the shop counter. */
  it('an approved offer can be paused by its merchant', async () => {
    const { data, error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'paused' })
      .eq('id', approvedOffer)
      .select('status')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('paused');
  });

  it('a paused offer goes back through review rather than straight live', async () => {
    const { data, error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'pending_review' })
      .eq('id', approvedOffer)
      .select('status')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('pending_review');
  });

  /**
   * `approved → draft` is not a move a merchant owns: it would take a reviewed offer back to a state
   * where its own history no longer describes it. Paused is the state for "not selling right now".
   */
  it('an approved offer cannot be dropped back to draft', async () => {
    const product = await unstocked();
    const { data } = await serviceClient()
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'approved',
      })
      .select('id')
      .single();

    const { error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'draft' })
      .eq('id', (data as { id: string }).id);

    expect(error?.message ?? '').toContain('OFFER_STATUS_FORBIDDEN');
  });
});

describe('deleting an offer (docs/16 §5)', () => {
  it('a draft can be deleted', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 1,
        status: 'draft',
      })
      .select('id')
      .single();

    const offerId = (created as { id: string }).id;
    const { data, error } = await owner.client
      .from('merchant_offers')
      .delete()
      .eq('id', offerId)
      .select('id')
      .maybeSingle();

    expect(error).toBeNull();
    expect(data, 'the delete must have matched the row').not.toBeNull();
  });

  /**
   * An approved offer may already have sourced an order, so it is paused rather than removed. The
   * delete policy restricts to `draft` and `rejected`, so this returns **no error and no rows** — the
   * shape an action has to check for, since a bare `error === null` reads as success.
   */
  it('an approved offer cannot be deleted, and the refusal is silent', async () => {
    const product = await unstocked();
    const { data: created } = await serviceClient()
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'approved',
      })
      .select('id')
      .single();

    const offerId = (created as { id: string }).id;

    const { data, error } = await owner.client
      .from('merchant_offers')
      .delete()
      .eq('id', offerId)
      .select('id');

    expect(error, 'RLS answers with zero rows, not an error').toBeNull();
    expect(data ?? []).toHaveLength(0);

    // And it is still there.
    const still = await owner.client.from('merchant_offers').select('id').eq('id', offerId);
    expect(still.data ?? []).toHaveLength(1);
  });
});

describe('the reviewer’s decision (docs/16 §5)', () => {
  it('a product manager can approve an offer, and it enters the buy box', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1500,
        stock_on_hand: 10,
        status: 'pending_review',
      })
      .select('id')
      .single();

    const offerId = (created as { id: string }).id;

    // Not in the buy box while it waits.
    const before = await serviceClient().rpc('variant_buy_box', {
      p_variant_ids: [product.variantId],
    });
    expect((before.data as { source: string }[])[0]?.source).toBe('none');

    const { data, error } = await staff.client
      .from('merchant_offers')
      .update({
        status: 'approved',
        approved_by: staff.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', offerId)
      .select('status, approved_by')
      .maybeSingle();

    expect(error).toBeNull();
    const row = data as { status: string; approved_by: string };
    expect(row.status).toBe('approved');
    expect(row.approved_by).toBe(staff.id);

    const after = await serviceClient().rpc('variant_buy_box', {
      p_variant_ids: [product.variantId],
    });
    const box = (after.data as { source: string; offer_id: string }[])[0];
    expect(box?.source).toBe('merchant');
    expect(box?.offer_id).toBe(offerId);
  });

  it('a rejection records the reason where the merchant will read it', async () => {
    const product = await unstocked();
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 9900,
        stock_on_hand: 10,
        status: 'pending_review',
      })
      .select('id')
      .single();

    const offerId = (created as { id: string }).id;

    await staff.client
      .from('merchant_offers')
      .update({ status: 'rejected', rejection_note: 'Asking price above what settlement pays.' })
      .eq('id', offerId);

    // Read back as the merchant, which is who the note is for.
    const { data } = await owner.client
      .from('merchant_offers')
      .select('status, rejection_note')
      .eq('id', offerId)
      .single();

    const row = data as { status: string; rejection_note: string };
    expect(row.status).toBe('rejected');
    expect(row.rejection_note).toContain('settlement');
  });

  /** A rejected offer is the merchant's to fix and resubmit — otherwise a rejection is a dead end. */
  it('a rejected offer can be resubmitted by its merchant', async () => {
    const product = await unstocked();
    const { data: created } = await serviceClient()
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 9900,
        stock_on_hand: 10,
        status: 'rejected',
        rejection_note: 'Too dear.',
      })
      .select('id')
      .single();

    const { data, error } = await owner.client
      .from('merchant_offers')
      .update({ status: 'pending_review', price_cents: 1200 })
      .eq('id', (created as { id: string }).id)
      .select('status, price_cents')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as { status: string } | null)?.status).toBe('pending_review');
  });
});

describe('v_merchant_offer_detail (docs/16 §5, §11)', () => {
  it('a merchant sees its own offers and no rival’s', async () => {
    const product = await unstocked();
    await serviceClient().from('merchant_offers').insert({
      merchant_id: otherMerchantId,
      variant_id: product.variantId,
      price_cents: 1000,
      stock_on_hand: 5,
      status: 'approved',
    });

    const { data } = await owner.client.from('v_merchant_offer_detail').select('merchant_id');
    const ids = new Set((data ?? []).map((row) => (row as { merchant_id: string }).merchant_id));

    expect(ids.has(merchantId), 'its own rows must be visible').toBe(true);
    expect(ids.has(otherMerchantId), 'a rival’s must not').toBe(false);
  });

  it('staff see across merchants, which is what the review queue needs', async () => {
    const { data } = await staff.client.from('v_merchant_offer_detail').select('merchant_id');
    const ids = new Set((data ?? []).map((row) => (row as { merchant_id: string }).merchant_id));

    expect(ids.has(merchantId)).toBe(true);
    expect(ids.has(otherMerchantId)).toBe(true);
  });

  /**
   * Settlement is computed from the **retail** price, not the asking price, and this is the assertion
   * that keeps that true. €20.00 retail at 20% commission is €4.00, so €16.00 is due — whatever the
   * merchant happens to be asking.
   */
  it('what settlement pays follows the retail price, not the asking price', async () => {
    const product = await unstocked(2000);
    const { data: created } = await owner.client
      .from('merchant_offers')
      .insert({
        merchant_id: merchantId,
        variant_id: product.variantId,
        price_cents: 1234,
        stock_on_hand: 10,
      })
      .select('id')
      .single();

    const { data } = await owner.client
      .from('v_merchant_offer_detail')
      .select('retail_price_cents, asking_price_cents, merchant_due_cents')
      .eq('id', (created as { id: string }).id)
      .single();

    const row = data as {
      retail_price_cents: number;
      asking_price_cents: number;
      merchant_due_cents: number;
    };
    expect(row.retail_price_cents).toBe(2000);
    expect(row.asking_price_cents).toBe(1234);
    expect(row.merchant_due_cents).toBe(1600);
  });
});

describe('merchant_settlement_units (docs/16 §5)', () => {
  /**
   * The offer form asks for many prices at once. One round trip, and the answers must match what
   * `merchant_settlement` gives one at a time — this asserts against both so a divergence fails here
   * rather than on a statement.
   */
  it('answers a set of prices consistently with merchant_settlement', async () => {
    const db = serviceClient();
    const { data, error } = await db.rpc('merchant_settlement_units', {
      p_merchant_id: merchantId,
      p_unit_prices: [1000, 2000, 2000, 999],
    });

    expect(error).toBeNull();
    const rows = (data ?? []) as { unit_price_cents: number; merchant_due_cents: number }[];

    // Distinct prices only: 2000 asked twice is one answer.
    expect(rows).toHaveLength(3);

    const byPrice = new Map(rows.map((row) => [row.unit_price_cents, row.merchant_due_cents]));
    expect(byPrice.get(1000)).toBe(800);
    expect(byPrice.get(2000)).toBe(1600);
    // 20% of 999 is 199.8, which rounds to 200 — so 799 due, and not a fraction of a cent anywhere.
    expect(byPrice.get(999)).toBe(799);

    const single = await db.rpc('merchant_settlement', {
      p_merchant_id: merchantId,
      p_items_subtotal_cents: 999,
    });
    expect((single.data as Record<string, number>).merchant_due_cents).toBe(byPrice.get(999));
  });

  it('a price of zero is dropped rather than answered', async () => {
    const { data } = await serviceClient().rpc('merchant_settlement_units', {
      p_merchant_id: merchantId,
      p_unit_prices: [0, -100, 1000],
    });

    const rows = (data ?? []) as { unit_price_cents: number }[];
    expect(rows.map((row) => row.unit_price_cents)).toEqual([1000]);
  });
});

describe('a suspended merchant (docs/16 §3, §5)', () => {
  /**
   * Suspension is enforced inside `current_merchant_ids()`, so it applies everywhere at once. The
   * portal does not need to check it and could not be trusted to: this asserts the merchant's own
   * offers become unreachable to them, which is what makes the single choke point worth having.
   */
  it('loses access to its own offers, without any policy naming suspension', async () => {
    const db = serviceClient();
    const suspendedId = await createMerchant('Suspended Probe');
    const suspendedOwner = await createUser('merchant');
    userIds.push(suspendedOwner.id);
    await db
      .from('merchant_users')
      .insert({ merchant_id: suspendedId, user_id: suspendedOwner.id });

    const product = await unstocked();
    await db.from('merchant_offers').insert({
      merchant_id: suspendedId,
      variant_id: product.variantId,
      price_cents: 1500,
      stock_on_hand: 10,
      status: 'approved',
    });

    // Visible while approved…
    const before = await suspendedOwner.client.from('merchant_offers').select('id');
    expect(before.data ?? []).toHaveLength(1);

    await db.from('merchants').update({ status: 'suspended' }).eq('id', suspendedId);

    // …and gone the moment the status changes, with nothing else touched.
    const after = await suspendedOwner.client.from('merchant_offers').select('id');
    expect(after.data ?? []).toHaveLength(0);

    const view = await suspendedOwner.client.from('v_merchant_offer_detail').select('id');
    expect(view.data ?? []).toHaveLength(0);
  });
});
