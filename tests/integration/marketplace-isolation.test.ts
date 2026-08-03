import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  createUser,
  deleteUser,
  required,
  serviceClient,
  type ProductFixture,
  type TestUser,
} from './helpers';

/**
 * docs/16 §3 — the isolation matrix. **This suite is the definition of done for step 1**, and
 * nothing else in M12 is built until it is green.
 *
 * A marketplace is the first feature in this shop where a hostile authenticated user is part of the
 * threat model. Every other role is either a customer looking at their own data or staff who are
 * meant to see everything; a merchant is a commercial counterparty with a login, a competitor to
 * the other merchants, and a reason to want BioCode's numbers.
 *
 * So the assertions are written as an attacker would: merchant A is signed in, holds merchant B's
 * row ids, and asks for them directly. Every answer must be empty or refused — never "the UI does
 * not show it".
 *
 * `.select()` returning `[]` rather than an error is the correct RLS outcome and is what these
 * assert. A 403 would confirm the row exists.
 */

/**
 * Fails loudly on a bad fixture write.
 *
 * PostgREST answers an insert naming an unknown column with an error in the result rather than a
 * throw, so an unchecked insert is a fixture that silently does nothing — and then every assertion
 * about the rows it should have created passes against an empty set.
 */
function must(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`fixture ${what} failed: ${result.error.message}`);
}

interface MerchantFixture {
  id: string;
  slug: string;
  owner: TestUser;
  offerId: string;
  fulfilmentId: string;
  ledgerId: string;
  payoutId: string;
  documentId: string;
  proposalId: string;
}

let product: ProductFixture;
let alpha: MerchantFixture;
let beta: MerchantFixture;
let customer: TestUser;
let staff: TestUser;
/** A BioCode-fulfilled order, which no merchant may see any part of. */
let biocodeOrderId: string;
let biocodeFulfilmentId: string;

const created: string[] = [];

/** One merchant, fully populated so every table has a row for the other one to fail to read. */
async function createMerchant(name: string, variantId: string): Promise<MerchantFixture> {
  const db = serviceClient();
  const owner = await createUser('merchant');
  created.push(owner.id);

  const slug = `mkt-${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const { data: merchant, error } = await db
    .from('merchants')
    .insert({
      slug,
      legal_name: `${name} LLC`,
      display_name: name,
      business_no: `ARBK-${name}`,
      contact_name: 'Owner',
      contact_email: owner.email,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: 'approved',
      commission_pct: 15,
      iban: 'XK051000000000000000',
    })
    .select('id')
    .single();
  if (error || !merchant) throw new Error(`merchant fixture failed: ${error?.message}`);
  const merchantId = (merchant as { id: string }).id;

  must(
    await db.from('merchant_users').insert({ merchant_id: merchantId, user_id: owner.id }),
    'merchant_users',
  );

  const { data: offer } = await db
    .from('merchant_offers')
    .insert({
      merchant_id: merchantId,
      variant_id: variantId,
      price_cents: 999,
      stock_on_hand: 10,
      status: 'approved',
    })
    .select('id')
    .single();

  const { data: order } = await db
    .from('orders')
    .insert({
      order_number: `SH-9999-${Date.now().toString().slice(-6)}-${name.slice(0, 2).toUpperCase()}`,
      email: `buyer-${name}@biocode.test`,
      phone: '+383 44 111 222',
      status: 'confirmed',
      subtotal_cents: 999,
      shipping_cents: 200,
      discount_cents: 0,
      tax_cents: 0,
      total_cents: 1199,
      shipping_address: { full_name: 'A Buyer', city: 'Prishtinë', country_code: 'XK' },
      billing_address: { full_name: 'A Buyer', city: 'Prishtinë', country_code: 'XK' },
      shipping_method: { name: 'Standard' },
    })
    .select('id')
    .single();

  const { data: fulfilment } = await db
    .from('order_fulfilments')
    .insert({
      order_id: required(order, 'order').id,
      fulfiller_kind: 'merchant',
      merchant_id: merchantId,
      status: 'assigned',
      items_subtotal_cents: 999,
      commission_cents: 150,
      merchant_due_cents: 849,
      assigned_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  /*
   * `must()` on every insert, because the first version of this fixture wrote `product_name` and
   * `line_total_cents` — columns `order_items` does not have. PostgREST returned an error nobody
   * looked at, no rows were created, and the isolation test that counts a merchant's visible lines
   * passed against zero rows.
   *
   * A fixture that fails silently produces tests that pass for the wrong reason, which is worse
   * than a test that fails.
   */
  must(
    await db.from('order_items').insert({
      order_id: required(order, 'order').id,
      variant_id: variantId,
      fulfilment_id: required(fulfilment, 'fulfilment').id,
      merchant_offer_id: required(offer, 'offer').id,
      name_snapshot: `Product ${name}`,
      sku: `SKU-${name}`,
      quantity: 1,
      unit_price_cents: 999,
      total_cents: 999,
    }),
    'order_items',
  );

  const { data: ledger } = await db
    .from('merchant_ledger')
    .insert({ merchant_id: merchantId, kind: 'sale', amount_cents: 999 })
    .select('id')
    .single();

  const { data: payout } = await db
    .from('merchant_payouts')
    .insert({
      merchant_id: merchantId,
      period_start: '2026-08-01',
      period_end: '2026-08-15',
      gross_cents: 999,
      commission_cents: 150,
      net_cents: 849,
    })
    .select('id')
    .single();

  const { data: doc } = await db
    .from('merchant_documents')
    .insert({
      merchant_id: merchantId,
      kind: 'business_registration',
      storage_path: `merchants/${merchantId}/reg.pdf`,
    })
    .select('id')
    .single();

  const { data: proposal } = await db
    .from('product_proposals')
    .insert({ merchant_id: merchantId, payload: { name: `${name} proposal` } })
    .select('id')
    .single();

  return {
    id: merchantId,
    slug,
    owner,
    offerId: required(offer, 'offer').id,
    fulfilmentId: required(fulfilment, 'fulfilment').id,
    ledgerId: required(ledger, 'ledger').id,
    payoutId: required(payout, 'payout').id,
    documentId: required(doc, 'doc').id,
    proposalId: required(proposal, 'proposal').id,
  };
}

beforeAll(async () => {
  const db = serviceClient();
  product = await createProduct();

  alpha = await createMerchant('alpha', product.variantId);
  beta = await createMerchant('beta', product.variantId);

  customer = await createUser('customer');
  staff = await createUser('support');
  created.push(customer.id, staff.id);

  // A BioCode-fulfilled order: no merchant has any business seeing a single field of it.
  const { data: order } = await db
    .from('orders')
    .insert({
      order_number: `SH-9999-${Date.now().toString().slice(-6)}-BC`,
      email: 'biocode-buyer@biocode.test',
      phone: '+383 44 999 888',
      status: 'confirmed',
      subtotal_cents: 5000,
      shipping_cents: 200,
      discount_cents: 0,
      tax_cents: 0,
      total_cents: 5200,
      shipping_address: { full_name: 'House Buyer', city: 'Prishtinë', country_code: 'XK' },
      billing_address: { full_name: 'House Buyer', city: 'Prishtinë', country_code: 'XK' },
      shipping_method: { name: 'Standard' },
    })
    .select('id')
    .single();
  biocodeOrderId = required(order, 'biocode order').id;

  const { data: fulfilment } = await db
    .from('order_fulfilments')
    .insert({
      order_id: biocodeOrderId,
      fulfiller_kind: 'biocode',
      status: 'accepted',
      items_subtotal_cents: 5000,
    })
    .select('id')
    .single();
  biocodeFulfilmentId = required(fulfilment, 'biocode fulfilment').id;

  await db.from('order_items').insert({
    order_id: biocodeOrderId,
    variant_id: product.variantId,
    fulfilment_id: biocodeFulfilmentId,
    product_name: { sq: 'Produkt', en: 'Product' },
    variant_name: { sq: 'Standard', en: 'Standard' },
    sku: 'SKU-BC',
    quantity: 2,
    unit_price_cents: 2500,
    line_total_cents: 5000,
  });
});

afterAll(async () => {
  const db = serviceClient();

  // Ledger and payouts first: both reference merchants, and neither cascades.
  for (const m of [alpha, beta]) {
    if (!m) continue;
    await db.from('merchant_ledger').delete().eq('merchant_id', m.id);
    await db.from('merchant_payouts').delete().eq('merchant_id', m.id);
    const { data: fulfilments } = await db
      .from('order_fulfilments')
      .select('order_id')
      .eq('merchant_id', m.id);
    for (const row of (fulfilments ?? []) as { order_id: string }[]) {
      await db.from('orders').delete().eq('id', row.order_id);
    }
    await db.from('merchants').delete().eq('id', m.id);
  }

  if (biocodeOrderId) await db.from('orders').delete().eq('id', biocodeOrderId);
  for (const id of created) await deleteUser(id);
});

/** Every merchant-owned table, with the id of the row that must stay invisible. */
const tables = (victim: () => MerchantFixture): { table: string; id: () => string }[] => [
  { table: 'merchants', id: () => victim().id },
  { table: 'merchant_offers', id: () => victim().offerId },
  { table: 'merchant_documents', id: () => victim().documentId },
  { table: 'product_proposals', id: () => victim().proposalId },
  { table: 'order_fulfilments', id: () => victim().fulfilmentId },
  { table: 'merchant_ledger', id: () => victim().ledgerId },
  { table: 'merchant_payouts', id: () => victim().payoutId },
];

describe('merchant A cannot read merchant B (docs/16 §3)', () => {
  for (const { table, id } of tables(() => beta)) {
    it(`${table}: asking for B's row by id returns nothing`, async () => {
      const { data, error } = await alpha.owner.client.from(table).select('*').eq('id', id());

      expect(error, 'RLS filters rather than errors').toBeNull();
      expect(data ?? [], `${table} leaked a row across merchants`).toHaveLength(0);
    });

    it(`${table}: an unfiltered select returns only A's own rows`, async () => {
      const { data } = await alpha.owner.client.from(table).select('id');
      const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);

      expect(ids, `${table} exposed B's row in a broad select`).not.toContain(id());
    });
  }

  it('merchant_users: A sees its own membership and not B’s', async () => {
    const { data } = await alpha.owner.client.from('merchant_users').select('merchant_id, user_id');
    const rows = (data ?? []) as { merchant_id: string; user_id: string }[];

    expect(rows.every((row) => row.merchant_id === alpha.id)).toBe(true);
    expect(rows.some((row) => row.user_id === beta.owner.id)).toBe(false);
  });
});

describe('merchants cannot reach BioCode order data (docs/16 §3)', () => {
  /**
   * The most important assertion in the file.
   *
   * `orders` has no merchant policy at all — not a narrow one. That is the design: a column
   * allowlist has to be maintained as `orders` grows, and the first person to add a column forgets.
   * No policy means no join for any future feature to reach through.
   */
  it('orders: a merchant cannot select any order, including its own customer’s', async () => {
    const { data: all } = await alpha.owner.client.from('orders').select('id');
    expect(all ?? [], 'merchants must have no read path to orders').toHaveLength(0);

    const { data: direct } = await alpha.owner.client
      .from('orders')
      .select('id, email, total_cents')
      .eq('id', biocodeOrderId);
    expect(direct ?? []).toHaveLength(0);
  });

  it('order_fulfilments: a BioCode fulfilment is invisible to every merchant', async () => {
    for (const merchant of [alpha, beta]) {
      const { data } = await merchant.owner.client
        .from('order_fulfilments')
        .select('id')
        .eq('id', biocodeFulfilmentId);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it('order_items: a merchant sees only lines on its own fulfilment', async () => {
    const { data } = await alpha.owner.client.from('order_items').select('id, sku, fulfilment_id');
    const rows = (data ?? []) as { sku: string; fulfilment_id: string | null }[];

    expect(rows.every((row) => row.fulfilment_id === alpha.fulfilmentId)).toBe(true);
    expect(rows.some((row) => row.sku === 'SKU-BC'), 'BioCode line leaked').toBe(false);
    expect(rows.some((row) => row.sku === 'SKU-beta'), 'other merchant line leaked').toBe(false);
  });

  it('inventory_levels: BioCode stock is not a merchant’s business', async () => {
    const { data } = await alpha.owner.client.from('inventory_levels').select('on_hand');
    expect(data ?? []).toHaveLength(0);
  });
});

describe('merchants cannot escalate their own privileges (docs/16 §3)', () => {
  it('cannot approve itself', async () => {
    const { error } = await alpha.owner.client
      .from('merchants')
      .update({ status: 'approved', commission_pct: 0 })
      .eq('id', alpha.id);

    expect(error, 'the column guard must refuse').not.toBeNull();

    const { data } = await serviceClient()
      .from('merchants')
      .select('commission_pct')
      .eq('id', alpha.id)
      .single();
    expect(Number((data as { commission_pct: number }).commission_pct)).toBe(15);
  });

  it('can update its own contact details', async () => {
    const { error } = await alpha.owner.client
      .from('merchants')
      .update({ contact_name: 'New Owner Name' })
      .eq('id', alpha.id);

    expect(error, 'the legitimate half of the same policy must still work').toBeNull();
  });

  /** The field an account takeover would target, so it leaves a trail every time. */
  it('a bank change is allowed and writes an audit row', async () => {
    const before = await serviceClient()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'merchant.bank_changed');

    const { error } = await alpha.owner.client
      .from('merchants')
      .update({ iban: 'XK051111111111111111' })
      .eq('id', alpha.id);
    expect(error).toBeNull();

    const after = await serviceClient()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'merchant.bank_changed');

    expect((after.count ?? 0) - (before.count ?? 0)).toBe(1);
  });

  /**
   * From `draft`, deliberately.
   *
   * The first version of this test set an already-`approved` offer to `approved` and passed
   * vacuously: the guard fires on `new.status is distinct from old.status`, and that comparison was
   * false. A privilege test has to start from the state the privilege would actually be used in.
   */
  it('cannot approve its own offer', async () => {
    const db = serviceClient();
    await db.from('merchant_offers').update({ status: 'draft' }).eq('id', alpha.offerId);

    const { error } = await alpha.owner.client
      .from('merchant_offers')
      .update({ status: 'approved' })
      .eq('id', alpha.offerId);

    expect(error, 'only a reviewer says approved').not.toBeNull();

    const { data } = await db
      .from('merchant_offers')
      .select('status')
      .eq('id', alpha.offerId)
      .single();
    expect((data as { status: string }).status).toBe('draft');

    await db.from('merchant_offers').update({ status: 'approved' }).eq('id', alpha.offerId);
  });

  it('can move its own offer from draft to pending_review', async () => {
    const db = serviceClient();
    await db.from('merchant_offers').update({ status: 'draft' }).eq('id', alpha.offerId);

    const { error } = await alpha.owner.client
      .from('merchant_offers')
      .update({ status: 'pending_review' })
      .eq('id', alpha.offerId);

    expect(error, 'submitting for review is the merchant’s own move').toBeNull();

    await db.from('merchant_offers').update({ status: 'approved' }).eq('id', alpha.offerId);
  });

  it('cannot write a ledger row in its own favour', async () => {
    const { error } = await alpha.owner.client
      .from('merchant_ledger')
      .insert({ merchant_id: alpha.id, kind: 'adjustment', amount_cents: 1_000_000 });

    expect(error, 'the balance must be a consequence, not a claim').not.toBeNull();
  });

  /**
   * Asserted on the stored value, not on an error.
   *
   * `merchant_payouts` has no update policy for a merchant at all, and RLS answers an update with
   * no permitting policy by matching **zero rows** — no error, nothing written. Asserting
   * `error not toBeNull()` would have failed against a correctly locked table, which is the shape
   * of test that gets "fixed" by loosening the policy.
   */
  it('cannot mark its own payout paid', async () => {
    await alpha.owner.client
      .from('merchant_payouts')
      .update({ status: 'paid', reference: 'self-served' })
      .eq('id', alpha.payoutId);

    const { data } = await serviceClient()
      .from('merchant_payouts')
      .select('status, reference')
      .eq('id', alpha.payoutId)
      .single();

    const row = data as { status: string; reference: string | null };
    expect(row.status, 'a merchant cannot declare itself paid').toBe('pending');
    expect(row.reference).toBeNull();
  });

  it('cannot create an offer in another merchant’s name', async () => {
    const { error } = await alpha.owner.client.from('merchant_offers').insert({
      merchant_id: beta.id,
      variant_id: product.variantId,
      price_cents: 1,
      status: 'draft',
    });

    expect(error).not.toBeNull();
  });

  /** `delivered` is the courier's word, and it is what triggers the payout owed (docs/16 §7, §8). */
  it('cannot mark its own fulfilment delivered', async () => {
    const { error } = await alpha.owner.client
      .from('order_fulfilments')
      .update({ status: 'delivered' })
      .eq('id', alpha.fulfilmentId);

    expect(error, 'a merchant that could do this could trigger its own payout').not.toBeNull();
  });

  it('cannot rewrite its own commission on a fulfilment', async () => {
    const { error } = await alpha.owner.client
      .from('order_fulfilments')
      .update({ commission_cents: 0, merchant_due_cents: 999 })
      .eq('id', alpha.fulfilmentId);

    expect(error).not.toBeNull();
  });

  it('can move its own lane: assigned to accepted', async () => {
    const { error } = await alpha.owner.client
      .from('order_fulfilments')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', alpha.fulfilmentId);

    expect(error, 'the legitimate transition must work').toBeNull();
  });

  it('cannot skip its lane: accepted straight to shipped', async () => {
    const { error } = await alpha.owner.client
      .from('order_fulfilments')
      .update({ status: 'shipped' })
      .eq('id', alpha.fulfilmentId);

    expect(error, 'packed comes between').not.toBeNull();
  });
});

describe('merchant_fulfilment_view — the one read path (docs/16 §3)', () => {
  it('returns the packing data for a fulfilment the merchant owns', async () => {
    const { data, error } = await alpha.owner.client.rpc('merchant_fulfilment_view', {
      p_fulfilment_id: alpha.fulfilmentId,
    });

    expect(error).toBeNull();
    const view = data as Record<string, unknown>;
    expect(view.order_number, 'a reference both sides can say on the phone').toBeTruthy();
    expect(Array.isArray(view.items)).toBe(true);
    expect((view.items as unknown[]).length).toBe(1);
  });

  it('returns null for another merchant’s fulfilment', async () => {
    const { data } = await alpha.owner.client.rpc('merchant_fulfilment_view', {
      p_fulfilment_id: beta.fulfilmentId,
    });

    // Null rather than an error: silence tells a prober nothing about whether the id exists.
    expect(data).toBeNull();
  });

  it('returns null for a BioCode fulfilment', async () => {
    const { data } = await alpha.owner.client.rpc('merchant_fulfilment_view', {
      p_fulfilment_id: biocodeFulfilmentId,
    });
    expect(data).toBeNull();
  });

  /**
   * The data-minimisation assertion, written as a search of the whole payload.
   *
   * Asserting that specific keys are absent would pass while a nested object smuggled the email
   * through. Serialising the lot and looking for the values themselves is the only version that
   * still holds when somebody adds a field.
   */
  it('never contains the customer email, the order total, or any coupon', async () => {
    const { data } = await alpha.owner.client.rpc('merchant_fulfilment_view', {
      p_fulfilment_id: alpha.fulfilmentId,
    });

    const json = JSON.stringify(data);
    expect(json).not.toContain('buyer-alpha@biocode.test');
    expect(json, 'the order total is not the merchant’s business').not.toContain('1199');
    expect(json.toLowerCase()).not.toContain('coupon');
    expect(json.toLowerCase()).not.toContain('loyalty');
    expect(json).not.toContain('"email"');
  });

  it('withholds the address until the fulfilment is assigned', async () => {
    const db = serviceClient();

    // A candidate, not yet a fulfiller: the routing screen shows several, only one will ship it.
    await db
      .from('order_fulfilments')
      .update({ status: 'unassigned', merchant_id: alpha.id })
      .eq('id', alpha.fulfilmentId);

    const { data: hidden } = await alpha.owner.client.rpc('merchant_fulfilment_view', {
      p_fulfilment_id: alpha.fulfilmentId,
    });
    expect((hidden as Record<string, unknown>).ship_to, 'no address before assignment').toBeNull();

    await db
      .from('order_fulfilments')
      .update({ status: 'assigned' })
      .eq('id', alpha.fulfilmentId);

    const { data: shown } = await alpha.owner.client.rpc('merchant_fulfilment_view', {
      p_fulfilment_id: alpha.fulfilmentId,
    });
    const shipTo = (shown as Record<string, unknown>).ship_to as Record<string, unknown> | null;
    expect(shipTo, 'address released once assigned').not.toBeNull();
    expect(shipTo?.phone).toBe('+383 44 111 222');
  });
});

describe('everyone who is not a merchant sees nothing merchant-owned', () => {
  const merchantTables = [
    'merchant_offers',
    'merchant_documents',
    'product_proposals',
    'order_fulfilments',
    'merchant_ledger',
    'merchant_payouts',
  ];

  it('a customer sees no merchant rows', async () => {
    for (const table of merchantTables) {
      const { data } = await customer.client.from(table).select('id');
      expect(data ?? [], `${table} visible to a customer`).toHaveLength(0);
    }
  });

  /** `current_merchant_ids()` must return empty for a customer, or every policy above is moot. */
  it('current_merchant_ids is empty for a customer', async () => {
    const { data } = await customer.client.rpc('current_merchant_ids');
    expect(data ?? []).toHaveLength(0);
  });

  it('a customer cannot read the merchant directory through the table', async () => {
    const { data } = await customer.client.from('merchants').select('id, iban');
    expect(data ?? []).toHaveLength(0);
  });

  /** Staff are supposed to see all of it — the isolation is against merchants, not against support. */
  it('staff can read across merchants', async () => {
    const { data } = await staff.client.from('merchant_offers').select('id');
    const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);

    expect(ids).toContain(alpha.offerId);
    expect(ids).toContain(beta.offerId);
  });

  it('staff cannot change a commission — that is admin only', async () => {
    const { error } = await staff.client
      .from('merchants')
      .update({ commission_pct: 1 })
      .eq('id', alpha.id);

    const { data } = await serviceClient()
      .from('merchants')
      .select('commission_pct')
      .eq('id', alpha.id)
      .single();

    /*
     * Either the write is refused outright or it silently matches no row — RLS does the latter for
     * an `update` with no permitting policy. Both are acceptable; a changed value is not.
     */
    expect(Number((data as { commission_pct: number }).commission_pct)).toBe(15);
    void error;
  });
});

describe('a suspended merchant loses access but keeps its rows', () => {
  it('suspension empties current_merchant_ids and every dependent read', async () => {
    const db = serviceClient();

    const before = await beta.owner.client.from('merchant_offers').select('id');
    expect(before.data ?? [], 'approved merchant can read its offers').not.toHaveLength(0);

    await db.from('merchants').update({ status: 'suspended' }).eq('id', beta.id);

    const ids = await beta.owner.client.rpc('current_merchant_ids');
    expect(ids.data ?? [], 'suspension is enforced in the helper, so it applies everywhere').toHaveLength(0);

    const after = await beta.owner.client.from('merchant_offers').select('id');
    expect(after.data ?? []).toHaveLength(0);

    // The rows are still there for staff — suspension is not deletion.
    const staffView = await staff.client.from('merchant_offers').select('id').eq('id', beta.offerId);
    expect(staffView.data ?? []).toHaveLength(1);

    await db.from('merchants').update({ status: 'approved' }).eq('id', beta.id);
  });
});
