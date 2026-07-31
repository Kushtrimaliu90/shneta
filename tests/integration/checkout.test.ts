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
 * checkout_create_order — docs/09 §1, M1 acceptance.
 *
 * The RPC is the only write path for orders, so it carries the whole integrity story:
 * server-side pricing, stock, coupons, atomicity. Several cases below are explicit
 * regression tests for the defects in docs/13.
 */

const service = serviceClient();
const users: TestUser[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user.id);
});

async function newUser() {
  const user = await createUser();
  users.push(user);
  return user;
}

describe('happy path', () => {
  it('prices from the database, decrements stock and writes a matching ledger row', async () => {
    const user = await newUser();
    const product = await createProduct({ priceCents: 1990, stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 2 }]);
    const shipping = await defaultShippingMethodId();

    const { data, error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping }),
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({ total_cents: expect.any(Number) });
    expect(data.order_number).toMatch(/^SH-\d{4}-\d{6}-[0-9A-F]{4}$/);
    // docs/13 §B1 — the success page is gated on this, never on the order number.
    expect(data.access_token).toHaveLength(64);

    const { data: order } = await service
      .from('orders')
      .select('subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, status')
      .eq('id', data.order_id)
      .single();

    // 2 × 1990 = 3980 ≥ 3000, so standard delivery is free (docs/07 §2).
    expect(order?.subtotal_cents).toBe(3980);
    expect(order?.shipping_cents).toBe(0);
    expect(order?.total_cents).toBe(3980);
    // round(3980 × 18 / 118) = 607
    expect(order?.tax_cents).toBe(607);
    expect(order?.status).toBe('pending');

    const { data: stock } = await service
      .from('inventory_levels')
      .select('on_hand')
      .eq('variant_id', product.variantId)
      .single();
    expect(stock?.on_hand).toBe(8);

    const { data: movements } = await service
      .from('stock_movements')
      .select('type, quantity')
      .eq('variant_id', product.variantId)
      .eq('type', 'sale');
    expect(movements).toEqual([{ type: 'sale', quantity: -2 }]);
  });

  it('converts the cart so a double submit cannot create a second order', async () => {
    const user = await newUser();
    const product = await createProduct({ stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();
    const params = checkoutParams({ cartId: cart, shippingMethodId: shipping });

    const first = await user.client.rpc('checkout_create_order', params);
    expect(first.error).toBeNull();

    const second = await user.client.rpc('checkout_create_order', params);
    expect(second.error?.message).toContain('CART_NOT_FOUND');

    const { count } = await service
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(1);
  });
});

describe('stock and catalog validation', () => {
  it('refuses to oversell and names the SKU', async () => {
    const user = await newUser();
    const product = await createProduct({ stock: 1 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 5 }]);
    const shipping = await defaultShippingMethodId();

    const { error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping }),
    );

    expect(error?.message).toContain(`OUT_OF_STOCK:${product.sku}`);

    const { data: stock } = await service
      .from('inventory_levels')
      .select('on_hand')
      .eq('variant_id', product.variantId)
      .single();
    expect(stock?.on_hand).toBe(1); // rolled back
  });

  /*
   * docs/13 §A1 — the headline regression.
   *
   * The original RPC filtered the catalog in pass 1 but not in pass 2, so a variant
   * deactivated after add-to-cart was excluded from the subtotal yet still written as an
   * order item and decremented from stock: free goods, and stock driven negative.
   */
  it('rejects a cart line whose variant was deactivated after add-to-cart', async () => {
    const user = await newUser();
    const product = await createProduct({ stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 2 }]);
    const shipping = await defaultShippingMethodId();

    await service.from('product_variants').update({ is_active: false }).eq('id', product.variantId);

    const { error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping }),
    );

    expect(error?.message).toContain('CART_ITEM_UNAVAILABLE');

    const { count } = await service
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(0);

    const { data: stock } = await service
      .from('inventory_levels')
      .select('on_hand')
      .eq('variant_id', product.variantId)
      .single();
    expect(stock?.on_hand).toBe(10);
  });

  it('rejects a cart line whose product was unpublished after add-to-cart', async () => {
    const user = await newUser();
    const product = await createProduct({ stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();

    await service.from('products').update({ status: 'archived' }).eq('id', product.productId);

    const { error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping }),
    );
    expect(error?.message).toContain('CART_ITEM_UNAVAILABLE');
  });

  it('rejects an empty cart', async () => {
    const user = await newUser();
    const cart = await createCart(user.id, []);
    const shipping = await defaultShippingMethodId();

    const { error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping }),
    );
    expect(error?.message).toContain('CART_EMPTY');
  });

  it("refuses to check out another user's cart", async () => {
    const owner = await newUser();
    const attacker = await newUser();
    const product = await createProduct({ stock: 10 });
    const cart = await createCart(owner.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();

    const { error } = await attacker.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping }),
    );
    expect(error?.message).toContain('FORBIDDEN');
  });
});

describe('coupons', () => {
  async function makeCoupon(fields: Record<string, unknown>) {
    const code = `TEST${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { error } = await service.from('coupons').insert({ code, is_active: true, ...fields });
    if (error) throw new Error(error.message);
    return code;
  }

  it('applies a percentage discount with floor semantics', async () => {
    const user = await newUser();
    const product = await createProduct({ priceCents: 1499, stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();
    const code = await makeCoupon({ type: 'percentage', value: 10 });

    const { data, error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping, couponCode: code }),
    );
    expect(error).toBeNull();

    const { data: order } = await service
      .from('orders')
      .select('discount_cents, subtotal_cents, shipping_cents, total_cents')
      .eq('id', data.order_id)
      .single();

    // floor(1499 × 10 / 100) = 149, matching lib/money.ts exactly.
    expect(order?.discount_cents).toBe(149);
    // 1499 − 149 = 1350 < 3000, so the €2 delivery fee stands.
    expect(order?.shipping_cents).toBe(200);
    expect(order?.total_cents).toBe(1550);
  });

  it('rejects a coupon below its minimum subtotal', async () => {
    const user = await newUser();
    const product = await createProduct({ priceCents: 500, stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();
    const code = await makeCoupon({ type: 'percentage', value: 10, min_subtotal_cents: 1500 });

    const { error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping, couponCode: code }),
    );
    expect(error?.message).toContain('COUPON_MIN_NOT_MET');
  });

  it('rejects an unknown or inactive coupon', async () => {
    const user = await newUser();
    const product = await createProduct({ stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();

    const { error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({
        cartId: cart,
        shippingMethodId: shipping,
        couponCode: 'NOPE-DOES-NOT-EXIST',
      }),
    );
    expect(error?.message).toContain('COUPON_INVALID');
  });

  it('zeroes delivery for a free_shipping coupon', async () => {
    const user = await newUser();
    const product = await createProduct({ priceCents: 500, stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();
    const code = await makeCoupon({ type: 'free_shipping', value: 0 });

    const { data } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping, couponCode: code }),
    );

    const { data: order } = await service
      .from('orders')
      .select('shipping_cents, discount_cents, total_cents')
      .eq('id', data.order_id)
      .single();

    expect(order?.shipping_cents).toBe(0);
    expect(order?.discount_cents).toBe(0);
    expect(order?.total_cents).toBe(500);
  });

  /*
   * docs/13 §A3 — a system coupon must stay `is_active = true`, because the RPC looks
   * coupons up with `… and is_active`. The spec's "hidden is_active" would have made the
   * subscription discount permanently unappliable.
   */
  it('applies an active system coupon while keeping it out of public listings', async () => {
    const user = await newUser();
    const product = await createProduct({ priceCents: 2000, stock: 10 });
    const cart = await createCart(user.id, [{ variantId: product.variantId, quantity: 1 }]);
    const shipping = await defaultShippingMethodId();
    const code = await makeCoupon({ type: 'percentage', value: 10, is_system: true });

    const { data, error } = await user.client.rpc(
      'checkout_create_order',
      checkoutParams({ cartId: cart, shippingMethodId: shipping, couponCode: code }),
    );
    expect(error).toBeNull();

    const { data: order } = await service
      .from('orders')
      .select('discount_cents')
      .eq('id', data.order_id)
      .single();
    expect(order?.discount_cents).toBe(200);

    const { data: publicCoupons } = await service
      .from('coupons')
      .select('code')
      .eq('is_system', false)
      .eq('code', code);
    expect(publicCoupons).toEqual([]);
  });
});

describe('ledger invariant (docs/07 §11)', () => {
  it('on_hand always equals the sum of stock_movements', async () => {
    const { data: drift } = await service.from('v_stock_ledger_drift').select('*');
    expect(drift).toEqual([]);
  });
});
