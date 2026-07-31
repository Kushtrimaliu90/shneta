import { afterAll, describe, expect, it } from 'vitest';
import {
  anonClient,
  createCart,
  createProduct,
  createUser,
  deleteUser,
  required,
  serviceClient,
  type TestUser,
} from './helpers';

/**
 * The RLS matrix (docs/09 §1, §5). Mandatory in CI — this is the suite that proves the
 * security boundary is where the docs say it is.
 *
 * Several cases are regression tests for docs/13 §B.
 */

const service = serviceClient();
const anon = anonClient();
const users: TestUser[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user.id);
});

async function newUser(role = 'customer') {
  const user = await createUser(role);
  users.push(user);
  return user;
}

describe('the guarantee itself', () => {
  it('has RLS enabled on every public table', async () => {
    const { data, error } = await service.rpc('tables_without_rls');
    expect(error).toBeNull();
    expect(data, `tables missing RLS: ${JSON.stringify(data)}`).toEqual([]);
  });
});

describe('anonymous visitors', () => {
  it('read published products but not drafts', async () => {
    const published = await createProduct({ status: 'published' });
    const draft = await createProduct({ status: 'draft' });

    const { data: visible } = await anon
      .from('products')
      .select('id')
      .eq('id', published.productId);
    expect(visible).toHaveLength(1);

    const { data: hidden } = await anon.from('products').select('id').eq('id', draft.productId);
    expect(hidden).toEqual([]);
  });

  /*
   * docs/13 §B2 — the original tried to hide `cost_cents` with a column-level REVOKE that
   * Postgres ignores in the presence of a table-level grant, then granted it back to every
   * authenticated user. Cost now lives in its own staff-only table.
   */
  it('cannot read variant costs, and neither can a signed-in customer', async () => {
    const product = await createProduct();
    await service
      .from('product_variant_costs')
      .insert({ variant_id: product.variantId, cost_cents: 900 });

    const { data: anonRows } = await anon.from('product_variant_costs').select('cost_cents');
    expect(anonRows ?? []).toEqual([]);

    const customer = await newUser();
    const { data: customerRows } = await customer.client
      .from('product_variant_costs')
      .select('cost_cents');
    expect(customerRows ?? []).toEqual([]);

    // `select *` on the variant itself must still work — that was the other half of the bug.
    const { data: variant, error } = await anon
      .from('product_variants')
      .select('*')
      .eq('id', product.variantId)
      .single();
    expect(error).toBeNull();
    expect(variant).not.toHaveProperty('cost_cents');
  });

  /*
   * docs/13 §B7 — exact stock levels were world-readable under `using (true)`, which lets
   * a competitor compute units sold from the delta between two reads.
   */
  it('cannot read exact stock, only the bucketed view', async () => {
    const product = await createProduct({ stock: 42 });

    const { data: levels } = await anon
      .from('inventory_levels')
      .select('on_hand')
      .eq('variant_id', product.variantId);
    expect(levels ?? []).toEqual([]);

    const { data: bucket } = await anon
      .from('v_product_stock')
      .select('stock_status, is_available')
      .eq('variant_id', product.variantId)
      .single();
    expect(bucket).toEqual({ stock_status: 'in_stock', is_available: true });
  });

  it('cannot enumerate coupons', async () => {
    await service
      .from('coupons')
      .insert({ code: `SECRET${Date.now()}`, type: 'percentage', value: 50 });
    const { data } = await anon.from('coupons').select('code');
    expect(data ?? []).toEqual([]);
  });

  it('cannot read orders, profiles or audit logs', async () => {
    for (const table of ['orders', 'profiles', 'audit_logs', 'contact_messages', 'email_log']) {
      const { data } = await anon.from(table).select('*').limit(1);
      expect(data ?? [], `${table} must not be readable by anon`).toEqual([]);
    }
  });
});

describe('customer isolation', () => {
  it("cannot read another customer's order", async () => {
    const owner = await newUser();
    const other = await newUser();

    const { data: order } = await service
      .from('orders')
      .insert({
        user_id: owner.id,
        email: owner.email,
        phone: '+38344000000',
        subtotal_cents: 1000,
        total_cents: 1000,
        shipping_address: {},
        billing_address: {},
      })
      .select('id')
      .single();

    const { data: mine } = await owner.client
      .from('orders')
      .select('id')
      .eq('id', required(order, 'order').id);
    expect(mine).toHaveLength(1);

    const { data: theirs } = await other.client
      .from('orders')
      .select('id')
      .eq('id', required(order, 'order').id);
    expect(theirs).toEqual([]);
  });

  it("cannot read or write another customer's cart", async () => {
    const owner = await newUser();
    const attacker = await newUser();
    const product = await createProduct();
    const cartId = await createCart(owner.id, [{ variantId: product.variantId, quantity: 1 }]);

    const { data: read } = await attacker.client
      .from('cart_items')
      .select('id')
      .eq('cart_id', cartId);
    expect(read).toEqual([]);

    const { error: write } = await attacker.client
      .from('cart_items')
      .insert({ cart_id: cartId, variant_id: product.variantId, quantity: 9 });
    expect(write).not.toBeNull();
  });

  it("cannot read another customer's addresses", async () => {
    const owner = await newUser();
    const other = await newUser();

    await owner.client.from('addresses').insert({
      user_id: owner.id,
      recipient_name: 'Owner',
      phone: '+38344000001',
      line1: 'Rruga A',
      city: 'Prishtinë',
    });

    const { data } = await other.client.from('addresses').select('id');
    expect(data).toEqual([]);
  });
});

describe('privilege escalation', () => {
  /** docs/13 §A4 — blocked for a signed-in customer, permitted for the service role. */
  it('a customer cannot promote themselves', async () => {
    const user = await newUser();
    const { error } = await user.client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', user.id);
    expect(error).not.toBeNull();

    const { data } = await service.from('profiles').select('role').eq('id', user.id).single();
    expect(data?.role).toBe('customer');
  });

  it('the service role can assign a role (team invite, prod bootstrap)', async () => {
    const staff = await newUser('support');
    const { data } = await service.from('profiles').select('role').eq('id', staff.id).single();
    expect(data?.role).toBe('support');
  });

  it('a customer cannot award themselves loyalty points', async () => {
    const user = await newUser();
    const { error } = await user.client
      .from('profiles')
      .update({ loyalty_points: 99999 })
      .eq('id', user.id);
    expect(error).not.toBeNull();
  });
});

describe('review integrity', () => {
  /*
   * docs/13 §B3 — `order_id` was unconstrained while the PDP renders a "verified
   * purchase" badge whenever it is set, so the badge could simply be claimed.
   */
  it('rejects a verified-purchase claim against an order the author does not own', async () => {
    const buyer = await newUser();
    const faker = await newUser();
    const product = await createProduct();

    const { data: order } = await service
      .from('orders')
      .insert({
        user_id: buyer.id,
        email: buyer.email,
        phone: '+38344000000',
        subtotal_cents: 1000,
        total_cents: 1000,
        shipping_address: {},
        billing_address: {},
      })
      .select('id')
      .single();

    const { error } = await faker.client.from('reviews').insert({
      product_id: product.productId,
      user_id: faker.id,
      order_id: required(order, 'order').id,
      author_name: 'Faker',
      rating: 5,
    });
    expect(error).not.toBeNull();
  });

  it('accepts an unverified review with no order attached', async () => {
    const user = await newUser();
    const product = await createProduct();

    const { error } = await user.client.from('reviews').insert({
      product_id: product.productId,
      user_id: user.id,
      author_name: 'Klienti',
      rating: 4,
      body: 'Produkt i mirë.',
    });
    expect(error).toBeNull();
  });

  /** docs/13 §A2 — the original trigger raised `record "new" is not assigned yet` here. */
  it('survives deleting a review and recomputes the aggregate', async () => {
    const user = await newUser();
    const product = await createProduct();

    const { data: review } = await service
      .from('reviews')
      .insert({
        product_id: product.productId,
        user_id: user.id,
        author_name: 'Klienti',
        rating: 5,
        status: 'approved',
      })
      .select('id')
      .single();

    const { data: afterInsert } = await service
      .from('products')
      .select('rating_avg, rating_count')
      .eq('id', product.productId)
      .single();
    expect(afterInsert?.rating_count).toBe(1);
    expect(Number(afterInsert?.rating_avg)).toBe(5);

    const { error } = await service
      .from('reviews')
      .delete()
      .eq('id', required(review, 'review').id);
    expect(error).toBeNull();

    const { data: afterDelete } = await service
      .from('products')
      .select('rating_avg, rating_count')
      .eq('id', product.productId)
      .single();
    expect(afterDelete?.rating_count).toBe(0);
    expect(Number(afterDelete?.rating_avg)).toBe(0);
  });
});

describe('coupon lifecycle (docs/13 §B4)', () => {
  it('support can read coupons but cannot delete them', async () => {
    const support = await newUser('support');
    const code = `DEL${Date.now()}`;
    const { data: coupon } = await service
      .from('coupons')
      .insert({ code, type: 'fixed', value: 100 })
      .select('id')
      .single();

    const { data: readable } = await support.client
      .from('coupons')
      .select('id')
      .eq('id', required(coupon, 'coupon').id);
    expect(readable).toHaveLength(1);

    await support.client.from('coupons').delete().eq('id', required(coupon, 'coupon').id);

    const { data: stillThere } = await service
      .from('coupons')
      .select('id')
      .eq('id', required(coupon, 'coupon').id);
    expect(stillThere).toHaveLength(1);
  });
});

describe('rate limiter (docs/13 §A6)', () => {
  it('enforces a daily window as a day, not as an hour', async () => {
    const key = `test-daily-${Date.now()}`;
    const results: boolean[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data } = await anon.rpc('check_rate_limit', {
        p_key: key,
        p_max: 5,
        p_window: '1 day',
      });
      results.push(data as boolean);
    }
    expect(results).toEqual([true, true, true, true, true, false]);

    // The bucket must be a single day-aligned window, not one per hour.
    const { data: buckets } = await serviceClient()
      .from('rate_limits')
      .select('window_start, count')
      .eq('key', key);
    expect(buckets).toHaveLength(1);
    expect(buckets?.[0]?.count).toBe(6);
  });
});
