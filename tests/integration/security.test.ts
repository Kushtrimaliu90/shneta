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
  type TestUser,
} from './helpers';

/**
 * docs/09 §5 — the pre-launch security pass, as tests rather than as a checklist somebody ticked.
 *
 * The RLS matrix in `rls.test.ts` covers "can this role read that table". This file covers the
 * attacks that get past a correct policy: forging an id you do not own, tampering with a price on
 * its way to the server, and writing to a storage bucket that reads publicly.
 *
 * Each test is named after the attempt, not the mechanism, because that is how the checklist in
 * docs/09 §5 reads and how anyone auditing this will look for it.
 */

const created: string[] = [];

let attacker: TestUser;
let victim: TestUser;

beforeAll(async () => {
  attacker = await createUser();
  victim = await createUser();
  created.push(attacker.id, victim.id);
}, 60_000);

afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

/**
 * A cart for `attacker`, with any previous one cleared first.
 *
 * `one_active_cart_per_user` is a unique index, and checkout only converts the cart when it
 * succeeds — so a test that deliberately sends a bad coupon leaves an active cart behind and the
 * next `createCart` collides. The failure looks like a broken fixture rather than the previous
 * test's rejection, which is exactly the kind of coupling worth removing rather than sequencing
 * around.
 */
async function freshCart(variantId: string, quantity: number): Promise<string> {
  await serviceClient().from('carts').delete().eq('user_id', attacker.id).eq('status', 'active');
  return createCart(attacker.id, [{ variantId, quantity }]);
}

describe('IDOR — guessing another customer’s id gets you nothing', () => {
  it('cannot read another customer’s subscription', async () => {
    const service = serviceClient();

    const { data: created_ } = await service
      .from('subscriptions')
      .insert({
        user_id: victim.id,
        status: 'active',
        frequency_days: 30,
        next_run_at: new Date().toISOString().slice(0, 10),
        discount_pct: 10,
        shipping_address: { city: 'Prishtinë', country_code: 'XK' },
        payment_provider: 'cod',
      })
      .select('id')
      .single();

    const subscriptionId = (created_ as { id: string }).id;

    const { data: read } = await attacker.client
      .from('subscriptions')
      .select('id')
      .eq('id', subscriptionId);

    expect(read ?? [], 'the id is real; the row is not theirs').toHaveLength(0);
  });

  it('cannot cancel another customer’s subscription with a forged id', async () => {
    const service = serviceClient();

    const { data: created_ } = await service
      .from('subscriptions')
      .insert({
        user_id: victim.id,
        status: 'active',
        frequency_days: 30,
        next_run_at: new Date().toISOString().slice(0, 10),
        discount_pct: 10,
        shipping_address: { city: 'Prishtinë', country_code: 'XK' },
        payment_provider: 'cod',
      })
      .select('id')
      .single();

    const subscriptionId = (created_ as { id: string }).id;

    /*
     * The action layer does not check ownership — `p_own on subscriptions` does (see
     * `subscriptions/actions.ts`). This is the test that makes that claim true: an update with a
     * forged id must touch zero rows rather than somebody else's schedule.
     */
    const { data: updated } = await attacker.client
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscriptionId)
      .select('id');

    expect(updated ?? []).toHaveLength(0);

    const { data: after } = await service
      .from('subscriptions')
      .select('status')
      .eq('id', subscriptionId)
      .single();

    expect((after as { status: string }).status, 'still running').toBe('active');
  });

  it('cannot spend another customer’s subscription action token', async () => {
    /*
     * The one-click skip link (docs/13 §O5). The table has RLS enabled and **no policy**, so it
     * is unreachable by any client — the only door is the security-definer RPC, which is
     * single-use and bound to one action on one subscription.
     */
    const { data } = await attacker.client.from('subscription_action_tokens').select('token');
    expect(data ?? [], 'the table itself must be unreachable').toHaveLength(0);
  });

  it('cannot read another customer’s loyalty ledger', async () => {
    const service = serviceClient();
    await service.rpc('admin_adjust_loyalty', { p_user_id: victim.id, p_points: 5, p_note: 'x' });

    const { data } = await attacker.client
      .from('loyalty_transactions')
      .select('points')
      .eq('user_id', victim.id);

    expect(data ?? []).toHaveLength(0);
  });
});

describe('price tampering — the server reprices, whatever the client sends', () => {
  it('a customer cannot change a catalogue price', async () => {
    const product = await createProduct({ priceCents: 1990 });

    const { data } = await attacker.client
      .from('product_variants')
      .update({ price_cents: 1 })
      .eq('id', product.variantId)
      .select('id');

    expect(data ?? [], 'writes to the catalogue are product-manager only').toHaveLength(0);
  });

  it('the order total comes from the catalogue, not from the cart row', async () => {
    /*
     * `cart_items` deliberately has **no price column** — quantity and a variant id, nothing
     * else. That is the structural reason a forged cart cannot produce a forged total, and this
     * asserts it end to end: the customer owns the cart row and can write to it, and the order
     * still costs what the shop says.
     */
    const product = await createProduct({ priceCents: 2500, stock: 10 });
    const cartId = await freshCart(product.variantId, 2);

    // Everything the customer can legitimately change about their own line.
    const { error: tamperError } = await attacker.client
      .from('cart_items')
      .update({ quantity: 2 })
      .eq('cart_id', cartId);
    expect(tamperError).toBeNull();

    const { data, error } = await attacker.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId, shippingMethodId: await defaultShippingMethodId() }),
    );

    expect(error).toBeNull();
    const orderId = (data as { order_id: string }).order_id;

    const { data: order } = await serviceClient()
      .from('orders')
      .select('subtotal_cents')
      .eq('id', orderId)
      .single();

    expect((order as { subtotal_cents: number }).subtotal_cents, '2 × €25.00').toBe(5000);
  });

  it('a forged coupon code cannot invent a discount', async () => {
    const product = await createProduct({ priceCents: 2000, stock: 5 });
    const cartId = await freshCart(product.variantId, 1);

    const { data, error } = await attacker.client.rpc(
      'checkout_create_order',
      checkoutParams({
        cartId,
        shippingMethodId: await defaultShippingMethodId(),
        couponCode: 'FREE-EVERYTHING-99',
      }),
    );

    /*
     * Either outcome is acceptable — refusing an unknown code, or ignoring it. What is not
     * acceptable is a discount, so that is what the assertion is about.
     */
    if (!error) {
      const { data: order } = await serviceClient()
        .from('orders')
        .select('discount_cents')
        .eq('id', (data as { order_id: string }).order_id)
        .single();
      expect((order as { discount_cents: number }).discount_cents).toBe(0);
    }
  });

  it('a customer cannot rewrite the money on a placed order', async () => {
    const product = await createProduct({ priceCents: 3000, stock: 5 });
    const cartId = await freshCart(product.variantId, 1);

    const { data } = await attacker.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId, shippingMethodId: await defaultShippingMethodId() }),
    );
    const orderId = (data as { order_id: string }).order_id;

    const { data: updated } = await attacker.client
      .from('orders')
      .update({ total_cents: 1 })
      .eq('id', orderId)
      .select('id');

    expect(updated ?? [], 'orders are staff-update only').toHaveLength(0);
  });
});

describe('storage — a public read is not a public write', () => {
  const BUCKETS = ['product-images', 'brand-assets', 'content'] as const;

  for (const bucket of BUCKETS) {
    it(`an anonymous visitor cannot write to ${bucket}`, async () => {
      const { error } = await anonClient()
        .storage.from(bucket)
        .upload(`attack-${Date.now()}.txt`, new Blob(['x']), { contentType: 'text/plain' });

      expect(error, `${bucket} accepted an anonymous upload`).not.toBeNull();
    });

    it(`a signed-in customer cannot write to ${bucket}`, async () => {
      const { error } = await attacker.client.storage
        .from(bucket)
        .upload(`attack-${Date.now()}.txt`, new Blob(['x']), { contentType: 'text/plain' });

      expect(error, `${bucket} accepted a customer upload`).not.toBeNull();
    });
  }

  it('lab-reports is not listable by a customer', async () => {
    /*
     * The one private bucket. Certificates of analysis are batch documents; the app mints signed
     * URLs for the ones it chooses to show, and the bucket itself must never enumerate.
     */
    const { data } = await attacker.client.storage.from('lab-reports').list();
    expect(data ?? []).toHaveLength(0);
  });

  it('lab-reports is not listable anonymously', async () => {
    const { data } = await anonClient().storage.from('lab-reports').list();
    expect(data ?? []).toHaveLength(0);
  });
});

describe('rate limiting is a real budget, not a declaration', () => {
  it('refuses the eleventh checkout attempt in an hour', async () => {
    /*
     * docs/09 §5 — "coupon brute-force hits rate limit". `previewCoupon` is the endpoint a guess
     * would hammer, and it shares the `checkout` budget: 10 per hour per IP.
     *
     * Exercised against the RPC the limiter wraps rather than through the action, because the
     * action needs a request context. What is under test is the budget arithmetic — that the
     * eleventh call in the window is refused — not the plumbing above it.
     */
    const key = `checkout:test-${Date.now()}`;
    const service = serviceClient();

    const results: boolean[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const { data } = await service.rpc('check_rate_limit', {
        p_key: key,
        p_max: 10,
        p_window: '01:00:00',
      });
      results.push(data === true);
    }

    expect(results.slice(0, 10).every(Boolean), 'the first ten are within budget').toBe(true);
    expect(results[10], 'the eleventh is refused').toBe(false);
  });
});
