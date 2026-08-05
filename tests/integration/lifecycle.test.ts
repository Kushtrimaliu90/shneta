import { afterAll, describe, expect, it } from 'vitest';
import {
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
 * Order lifecycle — docs/07 §7, docs/09 §1.
 *
 * The state machine is enforced in the database, so it is tested there: an invalid
 * transition must fail even when issued by a client that bypasses the UI entirely.
 */

const service = serviceClient();
const users: TestUser[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user.id);
});

async function placeOrder(options?: { priceCents?: number; stock?: number; quantity?: number }) {
  const user = await createUser();
  users.push(user);

  const product = await createProduct({
    priceCents: options?.priceCents ?? 5000,
    stock: options?.stock ?? 20,
  });
  const cart = await createCart(user.id, [
    { variantId: product.variantId, quantity: options?.quantity ?? 1 },
  ]);
  const shipping = await defaultShippingMethodId();

  const { data, error } = await user.client.rpc(
    'checkout_create_order',
    checkoutParams({ cartId: cart, shippingMethodId: shipping }),
  );
  if (error) throw new Error(`checkout failed: ${error.message}`);

  return { user, product, orderId: data.order_id as string, total: data.total_cents as number };
}

async function setStatus(orderId: string, status: string) {
  return service.from('orders').update({ status }).eq('id', orderId);
}

describe('state machine (docs/07 §7.1)', () => {
  it('walks pending → confirmed → processing → shipped → delivered', async () => {
    const { orderId } = await placeOrder();

    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      const { error } = await setStatus(orderId, status);
      expect(error, `transition to ${status} should be allowed`).toBeNull();
    }

    const { data } = await service
      .from('orders')
      .select('status, delivered_at')
      .eq('id', orderId)
      .single();
    expect(data?.status).toBe('delivered');
    expect(data?.delivered_at).not.toBeNull();
  });

  it('rejects a skipped transition', async () => {
    const { orderId } = await placeOrder();
    const { error } = await setStatus(orderId, 'shipped');
    expect(error?.message).toContain('INVALID_STATUS_TRANSITION');
  });

  it('rejects reviving a cancelled order', async () => {
    const { orderId } = await placeOrder();
    expect((await setStatus(orderId, 'cancelled')).error).toBeNull();
    expect((await setStatus(orderId, 'confirmed')).error?.message).toContain(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('records every transition as an order event', async () => {
    const { orderId } = await placeOrder();
    await setStatus(orderId, 'confirmed');

    const { data } = await service
      .from('order_events')
      .select('type, message')
      .eq('order_id', orderId)
      .order('created_at');

    expect(data?.[0]?.type).toBe('created');
    expect(data?.[1]).toMatchObject({ type: 'status_changed', message: 'pending → confirmed' });
  });
});

describe('delivery side effects (docs/07 §7.2)', () => {
  it('settles the COD payment and awards loyalty points', async () => {
    const { user, orderId, total } = await placeOrder({ priceCents: 5000, quantity: 1 });

    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      await setStatus(orderId, status);
    }

    const { data: order } = await service
      .from('orders')
      .select('payment_status')
      .eq('id', orderId)
      .single();
    expect(order?.payment_status).toBe('paid');

    const { data: payment } = await service
      .from('payments')
      .select('status')
      .eq('order_id', orderId)
      .single();
    expect(payment?.status).toBe('paid');

    // 1 point per whole euro at the default rate.
    const expectedPoints = Math.floor(total / 100);
    const { data: ledger } = await service
      .from('loyalty_transactions')
      .select('points, reason')
      .eq('order_id', orderId);
    expect(ledger).toEqual([{ points: expectedPoints, reason: 'earn_order' }]);

    const { data: profile } = await service
      .from('profiles')
      .select('loyalty_points')
      .eq('id', user.id)
      .single();
    expect(profile?.loyalty_points).toBe(expectedPoints);
  });

  /*
   * docs/13 §A5 — the before-trigger reads `payments` to decide COD settlement. As an
   * invoker-rights trigger that read ran under the caller's RLS, and warehouse_manager
   * has no select policy on `payments`, so `orders.payment_status` silently stayed
   * `pending` while `payments.status` became `paid`.
   */
  it('settles identically whether support or a warehouse manager marks it delivered', async () => {
    const warehouse = await createUser('warehouse_manager');
    users.push(warehouse);

    const { orderId } = await placeOrder();
    for (const status of ['confirmed', 'processing', 'shipped']) await setStatus(orderId, status);

    const { error } = await warehouse.client
      .from('orders')
      .update({ status: 'delivered' })
      .eq('id', orderId);
    expect(error).toBeNull();

    const { data: order } = await service
      .from('orders')
      .select('status, payment_status')
      .eq('id', orderId)
      .single();
    const { data: payment } = await service
      .from('payments')
      .select('status')
      .eq('order_id', orderId)
      .single();

    expect(order?.status).toBe('delivered');
    expect(order?.payment_status).toBe('paid');
    expect(payment?.status).toBe('paid');
  });
});

describe('cancellation restocks (docs/07 §7.2)', () => {
  it('returns stock and writes a cancel_restock movement', async () => {
    const { product, orderId } = await placeOrder({ stock: 20, quantity: 3 });

    const { data: afterSale } = await service
      .from('inventory_levels')
      .select('on_hand')
      .eq('variant_id', product.variantId)
      .single();
    expect(afterSale?.on_hand).toBe(17);

    await setStatus(orderId, 'cancelled');

    const { data: afterCancel } = await service
      .from('inventory_levels')
      .select('on_hand')
      .eq('variant_id', product.variantId)
      .single();
    expect(afterCancel?.on_hand).toBe(20);

    const { data: movements } = await service
      .from('stock_movements')
      .select('type, quantity')
      .eq('variant_id', product.variantId)
      .order('created_at');
    expect(movements).toEqual([
      { type: 'received', quantity: 20 },
      { type: 'sale', quantity: -3 },
      { type: 'cancel_restock', quantity: 3 },
    ]);
  });
});

describe('refunds (docs/07 §7.3, docs/13 §D4)', () => {
  it('caps the refund at the amount paid', async () => {
    const { orderId, total } = await placeOrder();

    const { error } = await service
      .from('refunds')
      .insert({ order_id: orderId, amount_cents: total + 1, reason: 'test overage' });
    expect(error?.message).toContain('REFUND_EXCEEDS_PAID_TOTAL');
  });

  it('marks a full refund and claws back the loyalty points earned', async () => {
    const { user, orderId, total } = await placeOrder({ priceCents: 5000 });
    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      await setStatus(orderId, status);
    }

    const earned = Math.floor(total / 100);
    const { data: before } = await service
      .from('profiles')
      .select('loyalty_points')
      .eq('id', user.id)
      .single();
    expect(before?.loyalty_points).toBe(earned);

    const { error } = await service
      .from('refunds')
      .insert({ order_id: orderId, amount_cents: total, reason: 'customer returned' });
    expect(error).toBeNull();

    const { data: order } = await service
      .from('orders')
      .select('payment_status')
      .eq('id', orderId)
      .single();
    expect(order?.payment_status).toBe('refunded');

    const { data: after } = await service
      .from('profiles')
      .select('loyalty_points')
      .eq('id', user.id)
      .single();
    expect(after?.loyalty_points).toBe(0);
  });

  it('marks a partial refund without zeroing the order', async () => {
    const { orderId, total } = await placeOrder();

    const { error } = await service
      .from('refunds')
      .insert({ order_id: orderId, amount_cents: Math.floor(total / 2), reason: 'partial' });
    expect(error).toBeNull();

    const { data: order } = await service
      .from('orders')
      .select('status, payment_status')
      .eq('id', orderId)
      .single();
    expect(order?.payment_status).toBe('partially_refunded');
    expect(order?.status).toBe('pending');
  });
});

describe('order immutability (docs/13 §B6)', () => {
  it('support cannot rewrite the total on a placed order', async () => {
    const support = await createUser('support');
    users.push(support);
    const { orderId } = await placeOrder();

    const { error } = await support.client
      .from('orders')
      .update({ total_cents: 1 })
      .eq('id', orderId);
    expect(error?.message).toContain('ORDER_FIELD_IMMUTABLE');
  });

  it('support can still advance the status', async () => {
    const support = await createUser('support');
    users.push(support);
    const { orderId } = await placeOrder();

    const { error } = await support.client
      .from('orders')
      .update({ status: 'confirmed' })
      .eq('id', orderId);
    expect(error).toBeNull();
  });
});

describe('loyalty redemption (docs/13 §B4)', () => {
  /*
   * The order is €600 rather than €200 because docs/17 §0.1 changed what redemption costs.
   *
   * It used to be a fixed tier: spend 100 points, get a €5 coupon — which is 5 % back at one point per
   * euro. There is now one point value (`point_value_cents = 1`, so 100 points = €1) and a
   * `min_redeem_points` floor of 500, and the no-argument call redeems that minimum. A customer with
   * 200 points can no longer redeem at all, which is why this test failed with `INSUFFICIENT_POINTS`
   * rather than because anything was broken.
   *
   * The coupon is still worth exactly 500 cents — 500 points × 1 cent — so every assertion below it is
   * unchanged. What moved is the price of it.
   */
  it('mints a single-use coupon and deducts the points atomically', async () => {
    const { user, orderId } = await placeOrder({ priceCents: 60000 });
    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      await setStatus(orderId, status);
    }

    const { data, error } = await user.client.rpc('redeem_loyalty_points');
    expect(error).toBeNull();
    expect(data.code).toMatch(/^LOY-[0-9A-F]{6}$/);
    expect(data.value_cents).toBe(500);

    const { data: profile } = await service
      .from('profiles')
      .select('loyalty_points')
      .eq('id', user.id)
      .single();
    expect(profile?.loyalty_points).toBe(600 - 500);

    const { data: coupon } = await service
      .from('coupons')
      .select('type, value, max_uses, is_system, is_active')
      .eq('code', data.code)
      .single();
    expect(coupon).toMatchObject({
      type: 'fixed',
      value: 500,
      max_uses: 1,
      is_system: true,
      is_active: true,
    });
  });

  it('refuses when the balance is short', async () => {
    const user = await createUser();
    users.push(user);
    const { error } = await user.client.rpc('redeem_loyalty_points');
    expect(error?.message).toContain('INSUFFICIENT_POINTS');
  });
});
