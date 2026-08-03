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
 * docs/16 §8 — the ledger, and the money that leaves it.
 *
 * The invariant every case here defends: **after a payout is built, the merchant's balance has dropped
 * by exactly what the statement says.** The signed single column is what makes that a plain sum rather
 * than a query with an "except the settled ones" clause, and a payout that failed to balance would show
 * up as a merchant being paid twice — which is the failure this suite exists for.
 *
 * Nothing is recomputed in TypeScript. `merchant_settlement` owns the arithmetic (§8), and a test that
 * re-implemented it could agree with a bug.
 */

const merchantIds: string[] = [];
const userIds: string[] = [];
const products: ProductFixture[] = [];
const orderIds: string[] = [];

let shippingMethodId: string;
let admin: TestUser;

async function createMerchant(
  name: string,
  options?: { commissionPct?: number; collectsCash?: boolean; shipping?: string },
): Promise<string> {
  const db = serviceClient();
  const stamp = `${Date.now()}-${merchantIds.length}`;

  const { data, error } = await db
    .from('merchants')
    .insert({
      slug: `led-${stamp}`,
      legal_name: `${name} SH.P.K.`,
      display_name: name,
      business_no: `ARBK-LD-${stamp}`,
      contact_name: 'Probe',
      contact_email: `led-${stamp}@biocode.test`,
      contact_phone: '+383 44 000 000',
      address: { city: 'Prishtinë', country_code: 'XK' },
      status: 'approved',
      commission_pct: options?.commissionPct ?? 20,
      collects_cash: options?.collectsCash ?? false,
      shipping_borne_by: options?.shipping ?? 'biocode',
      iban: 'XK051000000000001234',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`merchant insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;
  merchantIds.push(id);
  return id;
}

/** A delivered merchant fulfilment: the only state that owes anybody anything. */
async function deliveredOrder(
  merchantId: string,
  options?: { priceCents?: number; quantity?: number; provider?: 'cod' | 'bank_pos' },
): Promise<{ orderId: string; fulfilmentId: string; subtotalCents: number }> {
  const db = serviceClient();
  const priceCents = options?.priceCents ?? 2000;
  const quantity = options?.quantity ?? 1;

  const product = await createProduct({ stock: 0, priceCents });
  products.push(product);

  await db.from('merchant_offers').insert({
    merchant_id: merchantId,
    variant_id: product.variantId,
    price_cents: Math.round(priceCents * 0.6),
    stock_on_hand: 100,
    status: 'approved',
  });

  const cartId = await createCart(null, [{ variantId: product.variantId, quantity }]);
  const { data, error } = await db.rpc(
    'checkout_create_order',
    checkoutParams({
      cartId,
      email: `led-buyer-${Date.now()}-${orderIds.length}@biocode.test`,
      shippingMethodId,
      provider: options?.provider ?? 'bank_pos',
    }),
  );
  if (error) throw new Error(`checkout failed: ${error.message}`);

  const orderId = (data as { order_id: string }).order_id;
  orderIds.push(orderId);

  const { data: rows } = await db
    .from('order_fulfilments')
    .select('id, items_subtotal_cents')
    .eq('order_id', orderId)
    .eq('fulfiller_kind', 'merchant');

  const fulfilment = ((rows ?? []) as { id: string; items_subtotal_cents: number }[])[0];
  if (!fulfilment) throw new Error('no merchant fulfilment was created');

  /*
   * Straight to delivered through the fulfilment, which is the trigger's own path. Walking the order
   * through its whole status machine would test the order machine, not the ledger.
   */
  await db.from('order_fulfilments').update({ status: 'shipped' }).eq('id', fulfilment.id);
  await db.from('order_fulfilments').update({ status: 'delivered' }).eq('id', fulfilment.id);

  return {
    orderId,
    fulfilmentId: fulfilment.id,
    subtotalCents: fulfilment.items_subtotal_cents,
  };
}

async function ledger(merchantId: string): Promise<{ kind: string; amount_cents: number }[]> {
  const { data } = await serviceClient()
    .from('merchant_ledger')
    .select('kind, amount_cents')
    .eq('merchant_id', merchantId)
    .order('created_at');
  return (data ?? []) as { kind: string; amount_cents: number }[];
}

async function balance(merchantId: string): Promise<Record<string, number>> {
  const { data, error } = await serviceClient().rpc('merchant_balance', {
    p_merchant_id: merchantId,
  });
  if (error) throw new Error(`merchant_balance failed: ${error.message}`);
  return data as Record<string, number>;
}

const TODAY = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  shippingMethodId = await defaultShippingMethodId();
  admin = await createUser('admin');
  userIds.push(admin.id);
});

afterAll(async () => {
  const db = serviceClient();
  for (const id of merchantIds) {
    await db.from('merchant_ledger').delete().eq('merchant_id', id);
    await db.from('merchant_payouts').delete().eq('merchant_id', id);
    await db.from('merchant_offers').delete().eq('merchant_id', id);
  }
  for (const id of orderIds) {
    await db.from('refunds').delete().eq('order_id', id);
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

describe('delivery posts to the ledger (docs/16 §8)', () => {
  it('a delivered fulfilment writes a sale and a commission', async () => {
    const merchant = await createMerchant('Delivered', { commissionPct: 20 });
    const { subtotalCents } = await deliveredOrder(merchant, { priceCents: 2000 });

    const rows = await ledger(merchant);
    const sale = rows.find((row) => row.kind === 'sale');
    const commission = rows.find((row) => row.kind === 'commission');

    expect(sale?.amount_cents, 'positive: owed to the merchant').toBe(subtotalCents);
    expect(commission?.amount_cents, 'negative: owed by the merchant').toBe(-400);

    const totals = await balance(merchant);
    expect(totals.balance_cents).toBe(1600);
  });

  /**
   * Shipping only leaves the ledger when the merchant bears it. `biocode` and `customer` are BioCode's
   * problem and differ only in attribution (§8), so neither writes a row.
   */
  it('a merchant bearing shipping has it deducted', async () => {
    const merchant = await createMerchant('Pays Postage', {
      commissionPct: 10,
      shipping: 'merchant',
    });
    await deliveredOrder(merchant, { priceCents: 2000 });

    const rows = await ledger(merchant);
    const shipping = rows.find((row) => row.kind === 'shipping');

    // €2.00 is `settings.marketplace.shipping_cost_cents`.
    expect(shipping?.amount_cents).toBe(-200);
    expect((await balance(merchant)).balance_cents).toBe(2000 - 200 - 200);
  });

  it('BioCode bearing shipping writes no shipping row at all', async () => {
    const merchant = await createMerchant('Free Postage', { shipping: 'biocode' });
    await deliveredOrder(merchant, { priceCents: 2000 });

    const rows = await ledger(merchant);
    expect(rows.some((row) => row.kind === 'shipping')).toBe(false);
  });

  /**
   * The case the signed single column exists for: the merchant's own courier took the cash, so the
   * merchant is holding money that is not all its own and owes BioCode the commission.
   */
  it('a merchant collecting COD itself ends up owing BioCode the commission', async () => {
    const merchant = await createMerchant('Own Courier', {
      commissionPct: 20,
      collectsCash: true,
    });
    await deliveredOrder(merchant, { priceCents: 2000, provider: 'cod' });

    const rows = await ledger(merchant);
    expect(rows.find((row) => row.kind === 'cod_collected')?.amount_cents).toBe(-2000);

    // +2000 sale − 400 commission − 2000 cash held = −400, which is the commission owed.
    expect((await balance(merchant)).balance_cents).toBe(-400);
  });

  it('a COD order collected by BioCode leaves the merchant owed its net', async () => {
    const merchant = await createMerchant('BioCode Courier', {
      commissionPct: 20,
      collectsCash: false,
    });
    await deliveredOrder(merchant, { priceCents: 2000, provider: 'cod' });

    const rows = await ledger(merchant);
    expect(rows.some((row) => row.kind === 'cod_collected')).toBe(false);
    expect((await balance(merchant)).balance_cents).toBe(1600);
  });

  /** A shipped parcel owes nobody anything yet: it can still come back, and COD is uncollected. */
  it('shipping alone posts nothing', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('In Transit');
    const product = await createProduct({ stock: 0, priceCents: 2000 });
    products.push(product);

    await db.from('merchant_offers').insert({
      merchant_id: merchant,
      variant_id: product.variantId,
      price_cents: 1200,
      stock_on_hand: 10,
      status: 'approved',
    });

    const cartId = await createCart(null, [{ variantId: product.variantId, quantity: 1 }]);
    const { data } = await db.rpc(
      'checkout_create_order',
      checkoutParams({
        cartId,
        email: `transit-${Date.now()}@biocode.test`,
        shippingMethodId,
      }),
    );
    const orderId = (data as { order_id: string }).order_id;
    orderIds.push(orderId);

    const { data: rows } = await db
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .eq('fulfiller_kind', 'merchant');
    const fulfilmentId = ((rows ?? []) as { id: string }[])[0]?.id;

    await db.from('order_fulfilments').update({ status: 'shipped' }).eq('id', fulfilmentId);

    expect(await ledger(merchant)).toHaveLength(0);
  });

  /**
   * Idempotent per (fulfilment, kind), enforced by a unique index rather than by checking first —
   * because two concurrent callers both pass a check.
   */
  it('posting twice does not pay twice', async () => {
    const merchant = await createMerchant('Once Only');
    const { fulfilmentId } = await deliveredOrder(merchant, { priceCents: 2000 });

    const before = (await balance(merchant)).balance_cents;
    await serviceClient().rpc('post_fulfilment_to_ledger', { p_fulfilment_id: fulfilmentId });
    expect((await balance(merchant)).balance_cents).toBe(before);
    expect(await ledger(merchant)).toHaveLength(2);
  });

  /** Marking the *order* delivered has to reach the merchant side, or the merchant is never paid. */
  it('delivering the order delivers its shipped fulfilments', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Via Order');
    const product = await createProduct({ stock: 0, priceCents: 2000 });
    products.push(product);

    await db.from('merchant_offers').insert({
      merchant_id: merchant,
      variant_id: product.variantId,
      price_cents: 1200,
      stock_on_hand: 10,
      status: 'approved',
    });

    const cartId = await createCart(null, [{ variantId: product.variantId, quantity: 1 }]);
    const { data } = await db.rpc(
      'checkout_create_order',
      checkoutParams({
        cartId,
        email: `viaorder-${Date.now()}@biocode.test`,
        shippingMethodId,
      }),
    );
    const orderId = (data as { order_id: string }).order_id;
    orderIds.push(orderId);

    const { data: rows } = await db
      .from('order_fulfilments')
      .select('id')
      .eq('order_id', orderId)
      .eq('fulfiller_kind', 'merchant');
    const fulfilmentId = ((rows ?? []) as { id: string }[])[0]?.id;

    // Shipping the fulfilment moves the order to `shipped` through the sync trigger.
    await db.from('order_fulfilments').update({ status: 'shipped' }).eq('id', fulfilmentId);
    await db.from('orders').update({ status: 'delivered' }).eq('id', orderId);

    const { data: after } = await db
      .from('order_fulfilments')
      .select('status')
      .eq('id', fulfilmentId)
      .single();

    expect((after as { status: string }).status).toBe('delivered');
    expect((await balance(merchant)).balance_cents).toBe(1600);
  });
});

describe('refunds claw back proportionally (docs/16 §8)', () => {
  it('a full refund leaves a zero balance', async () => {
    const merchant = await createMerchant('Refunded Fully');
    const { orderId } = await deliveredOrder(merchant, { priceCents: 2000 });
    expect((await balance(merchant)).balance_cents).toBe(1600);

    const { data: order } = await serviceClient()
      .from('orders')
      .select('subtotal_cents')
      .eq('id', orderId)
      .single();

    await serviceClient().rpc('post_refund_to_ledger', {
      p_order_id: orderId,
      p_refund_cents: (order as { subtotal_cents: number }).subtotal_cents,
      p_note: 'Full refund',
    });

    /*
     * Reversing the whole fulfilment rather than the sale and the commission separately is what makes
     * this land exactly on zero instead of a rounding residue.
     */
    expect((await balance(merchant)).balance_cents).toBe(0);
  });

  it('a half refund reverses half of what was posted', async () => {
    const merchant = await createMerchant('Refunded Half');
    const { orderId } = await deliveredOrder(merchant, { priceCents: 2000, quantity: 2 });
    const owed = (await balance(merchant)).balance_cents ?? 0;

    const { data: order } = await serviceClient()
      .from('orders')
      .select('subtotal_cents')
      .eq('id', orderId)
      .single();

    const half = Math.round((order as { subtotal_cents: number }).subtotal_cents / 2);
    await serviceClient().rpc('post_refund_to_ledger', {
      p_order_id: orderId,
      p_refund_cents: half,
    });

    expect((await balance(merchant)).balance_cents).toBe(owed - Math.round(owed / 2));
  });

  /** A second partial refund must be admitted: a customer refunded twice is not hypothetical. */
  it('two partial refunds both post', async () => {
    const merchant = await createMerchant('Twice Refunded');
    const { orderId } = await deliveredOrder(merchant, { priceCents: 4000 });

    const db = serviceClient();
    await db.rpc('post_refund_to_ledger', { p_order_id: orderId, p_refund_cents: 1000 });
    await db.rpc('post_refund_to_ledger', { p_order_id: orderId, p_refund_cents: 1000 });

    const rows = await ledger(merchant);
    expect(rows.filter((row) => row.kind === 'refund')).toHaveLength(2);
  });

  it('a refund on a first-party order touches no merchant ledger', async () => {
    const db = serviceClient();
    const merchant = await createMerchant('Untouched');
    const product = await createProduct({ stock: 10, priceCents: 2000 });
    products.push(product);

    const cartId = await createCart(null, [{ variantId: product.variantId, quantity: 1 }]);
    const { data } = await db.rpc(
      'checkout_create_order',
      checkoutParams({
        cartId,
        email: `firstparty-${Date.now()}@biocode.test`,
        shippingMethodId,
      }),
    );
    const orderId = (data as { order_id: string }).order_id;
    orderIds.push(orderId);

    await db.rpc('post_refund_to_ledger', { p_order_id: orderId, p_refund_cents: 2000 });
    expect(await ledger(merchant)).toHaveLength(0);
  });
});

describe('building a payout (docs/16 §8)', () => {
  /**
   * **The invariant.** After building, the balance has dropped by exactly the statement's net — because
   * the build posts a negative `payout` row, not because anything is marked as spoken for.
   */
  it('drops the balance by exactly the net it reports', async () => {
    const merchant = await createMerchant('Settled', { commissionPct: 20 });
    await deliveredOrder(merchant, { priceCents: 2000 });
    await deliveredOrder(merchant, { priceCents: 3000 });

    const before = (await balance(merchant)).balance_cents;
    expect(before).toBe(1600 + 2400);

    const { data, error } = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchant,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    expect(error).toBeNull();
    const payout = data as { created: boolean; net_cents: number; payout_id: string };
    expect(payout.created).toBe(true);
    expect(payout.net_cents).toBe(before);

    expect((await balance(merchant)).balance_cents, 'settled to zero').toBe(0);

    const { data: row } = await serviceClient()
      .from('merchant_payouts')
      .select('gross_cents, commission_cents, net_cents, status, paid_at')
      .eq('id', payout.payout_id)
      .single();

    const statement = row as {
      gross_cents: number;
      commission_cents: number;
      net_cents: number;
      status: string;
      paid_at: string | null;
    };
    expect(statement.gross_cents).toBe(5000);
    expect(statement.commission_cents).toBe(1000);
    expect(statement.net_cents).toBe(4000);
    // Money has not moved yet — that is `mark_payout_paid`.
    expect(statement.status).toBe('pending');
    expect(statement.paid_at).toBeNull();
  });

  /** A merchant with nothing owed gets no statement. A €0.00 statement teaches people to ignore them. */
  it('writes nothing when there is nothing to settle', async () => {
    const merchant = await createMerchant('Nothing Owed');

    const { data } = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchant,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    expect((data as { created: boolean }).created).toBe(false);

    const { data: rows } = await serviceClient()
      .from('merchant_payouts')
      .select('id')
      .eq('merchant_id', merchant);
    expect(rows ?? []).toHaveLength(0);
  });

  /**
   * Building the same period twice must not pay twice. The second run finds the rows already covered by
   * the first payout's period and skips them.
   */
  it('building the same period twice settles nothing the second time', async () => {
    const merchant = await createMerchant('Double Build');
    await deliveredOrder(merchant, { priceCents: 2000 });

    const first = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchant,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });
    expect((first.data as { created: boolean }).created).toBe(true);

    const second = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchant,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });
    expect((second.data as { created: boolean }).created).toBe(false);

    expect((await balance(merchant)).balance_cents).toBe(0);
  });

  it('the run builds for every merchant with something owed and skips the rest', async () => {
    const owed = await createMerchant('Run Owed');
    const idle = await createMerchant('Run Idle');
    await deliveredOrder(owed, { priceCents: 2000 });

    const { data, error } = await admin.client.rpc('build_all_merchant_payouts', {
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    expect(error).toBeNull();
    const result = data as { payouts: { merchant_id: string }[] };
    const ids = result.payouts.map((entry) => entry.merchant_id);

    expect(ids).toContain(owed);
    expect(ids).not.toContain(idle);
  });

  it('a merchant cannot build its own payout', async () => {
    const merchant = await createMerchant('Self Pay');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchant, user_id: owner.id });

    await deliveredOrder(merchant, { priceCents: 2000 });

    const { error } = await owner.client.rpc('build_merchant_payout', {
      p_merchant_id: merchant,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });

  it('support cannot build a payout either — money is admin-only', async () => {
    const support = await createUser('support');
    userIds.push(support.id);
    const merchant = await createMerchant('Support Cannot');
    await deliveredOrder(merchant, { priceCents: 2000 });

    const { error } = await support.client.rpc('build_merchant_payout', {
      p_merchant_id: merchant,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });
});

describe('paying a payout (docs/16 §8)', () => {
  async function pendingPayout(): Promise<{ merchantId: string; payoutId: string }> {
    const merchantId = await createMerchant('To Be Paid');
    await deliveredOrder(merchantId, { priceCents: 2000 });

    const { data } = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchantId,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    return { merchantId, payoutId: (data as { payout_id: string }).payout_id };
  }

  it('records the transfer with its reference', async () => {
    const { payoutId } = await pendingPayout();

    const { error } = await admin.client.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: 'BKT-2026-0001',
    });
    expect(error).toBeNull();

    const { data } = await serviceClient()
      .from('merchant_payouts')
      .select('status, reference, paid_at')
      .eq('id', payoutId)
      .single();

    const row = data as { status: string; reference: string; paid_at: string | null };
    expect(row.status).toBe('paid');
    expect(row.reference).toBe('BKT-2026-0001');
    expect(row.paid_at).not.toBeNull();
  });

  /** A payout marked paid with nothing to trace it by is where every reconciliation argument starts. */
  it('refuses to mark one paid without a reference', async () => {
    const { payoutId } = await pendingPayout();

    const { error } = await admin.client.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: '  ',
    });

    expect(error?.message ?? '').toContain('REFERENCE_REQUIRED');
  });

  /** Paying does not post a second ledger row: the money left the balance when the payout was built. */
  it('paying does not move the balance again', async () => {
    const { merchantId, payoutId } = await pendingPayout();
    expect((await balance(merchantId)).balance_cents).toBe(0);

    await admin.client.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: 'BKT-2026-0002',
    });

    expect((await balance(merchantId)).balance_cents).toBe(0);
    expect((await ledger(merchantId)).filter((row) => row.kind === 'payout')).toHaveLength(1);
  });

  it('a paid payout cannot be paid again', async () => {
    const { payoutId } = await pendingPayout();
    await admin.client.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: 'BKT-2026-0003',
    });

    const { error } = await admin.client.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: 'BKT-2026-0004',
    });

    expect(error?.message ?? '').toContain('PAYOUT_NOT_PAYABLE');
  });

  it('a merchant cannot mark its own payout paid', async () => {
    const { merchantId, payoutId } = await pendingPayout();
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchantId, user_id: owner.id });

    const { error } = await owner.client.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: 'I paid myself',
    });

    expect(error?.message ?? '').toContain('FORBIDDEN');
  });
});

describe('the statement (docs/16 §8)', () => {
  it('a merchant reads its own, with the lines behind the number', async () => {
    const merchantId = await createMerchant('Statement Reader', { commissionPct: 20 });
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchantId, user_id: owner.id });

    await deliveredOrder(merchantId, { priceCents: 2000 });

    const { data: built } = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchantId,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });
    const payoutId = (built as { payout_id: string }).payout_id;

    const { data, error } = await owner.client.rpc('merchant_statement', {
      p_payout_id: payoutId,
    });

    expect(error).toBeNull();
    const statement = data as {
      payout: { net_cents: number; status: string };
      merchant: { iban_last4: string; commission_pct: number };
      lines: { kind: string; amount_cents: number; order_number: string | null }[];
    };

    expect(statement.payout.net_cents).toBe(1600);
    // Last four only, on a document that gets emailed and printed.
    expect(statement.merchant.iban_last4).toBe('1234');

    const kinds = statement.lines.map((line) => line.kind);
    expect(kinds).toContain('sale');
    expect(kinds).toContain('commission');
    expect(kinds, 'the payout row is not one of its own lines').not.toContain('payout');

    // Each line names the order it came from, which is what makes a statement checkable.
    expect(statement.lines.every((line) => line.order_number !== null)).toBe(true);
  });

  it('a merchant reading another’s payout gets null, not an error', async () => {
    const mine = await createMerchant('Mine');
    const theirs = await createMerchant('Theirs');

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient().from('merchant_users').insert({ merchant_id: mine, user_id: owner.id });

    await deliveredOrder(theirs, { priceCents: 2000 });
    const { data: built } = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: theirs,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    const { data, error } = await owner.client.rpc('merchant_statement', {
      p_payout_id: (built as { payout_id: string }).payout_id,
    });

    // Silence rather than a refusal: a merchant probing another's id learns nothing either way.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('staff read any statement', async () => {
    const merchantId = await createMerchant('Staff Read');
    await deliveredOrder(merchantId, { priceCents: 2000 });

    const { data: built } = await admin.client.rpc('build_merchant_payout', {
      p_merchant_id: merchantId,
      p_period_start: TODAY,
      p_period_end: TODAY,
    });

    const support = await createUser('support');
    userIds.push(support.id);

    const { data } = await support.client.rpc('merchant_statement', {
      p_payout_id: (built as { payout_id: string }).payout_id,
    });

    expect(data).not.toBeNull();
  });
});

describe('the ledger is append-only (docs/16 §3, §8)', () => {
  it('a merchant cannot write a ledger row', async () => {
    const merchantId = await createMerchant('No Writing');
    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient()
      .from('merchant_users')
      .insert({ merchant_id: merchantId, user_id: owner.id });

    const { error } = await owner.client.from('merchant_ledger').insert({
      merchant_id: merchantId,
      kind: 'adjustment',
      amount_cents: 100_000,
      note: 'a gift to myself',
    });

    expect(error, 'no insert policy exists for a merchant').not.toBeNull();
  });

  /**
   * No update or delete policy exists for anyone, including admin. A correction is another row — the
   * same discipline as `stock_movements` (docs/13 §A7), and the reason a statement can be trusted.
   */
  it('nobody updates or deletes a ledger row through the API', async () => {
    const merchantId = await createMerchant('Immutable');
    await deliveredOrder(merchantId, { priceCents: 2000 });

    const rows = await ledger(merchantId);
    expect(rows.length).toBeGreaterThan(0);

    const support = await createUser('support');
    userIds.push(support.id);

    const { data: sale } = await serviceClient()
      .from('merchant_ledger')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('kind', 'sale')
      .single();

    const saleId = (sale as { id: string }).id;

    const updated = await support.client
      .from('merchant_ledger')
      .update({ amount_cents: 999_999 })
      .eq('id', saleId)
      .select('id');
    expect(updated.data ?? [], 'an update matches zero rows').toHaveLength(0);

    const deleted = await support.client
      .from('merchant_ledger')
      .delete()
      .eq('id', saleId)
      .select('id');
    expect(deleted.data ?? [], 'a delete matches zero rows').toHaveLength(0);

    // Still there, unchanged.
    const after = await ledger(merchantId);
    expect(after.find((row) => row.kind === 'sale')?.amount_cents).toBe(2000);
  });

  it('a merchant sees its own ledger and no rival’s', async () => {
    const mine = await createMerchant('Ledger Mine');
    const theirs = await createMerchant('Ledger Theirs');

    const owner = await createUser('merchant');
    userIds.push(owner.id);
    await serviceClient().from('merchant_users').insert({ merchant_id: mine, user_id: owner.id });

    await deliveredOrder(mine, { priceCents: 2000 });
    await deliveredOrder(theirs, { priceCents: 3000 });

    const { data } = await owner.client.from('merchant_ledger').select('merchant_id');
    const ids = new Set((data ?? []).map((row) => (row as { merchant_id: string }).merchant_id));

    expect(ids.has(mine)).toBe(true);
    expect(ids.has(theirs)).toBe(false);
  });
});
