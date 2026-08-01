import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/12 M10 — the acceptance criteria that live in the database.
 *
 * Two of M10's four are here: the ledger invariant must hold through receive and adjust, and a
 * negative adjustment must not take on-hand below zero. The other two (the finder, the team
 * invite) are a pure function and a browser flow, tested where they live.
 *
 * Everything runs through a real signed-in client so RLS and the security-definer grants are
 * exercised, not bypassed — a warehouse manager receiving stock is the actual path.
 */

const created: string[] = [];

/**
 * The staff actors are created **once** for the whole file.
 *
 * Every `createUser` signs in, and Supabase's hosted auth limits sign-ins per hour per project
 * (docs/13 §N10). The first version of this file created a fresh actor per test — twenty in all —
 * and running it alongside the rest of the suite exhausted the quota, which then failed a dozen
 * unrelated tests with "Request rate limit reached". Nothing about those tests was wrong.
 *
 * Sharing is safe here because a role is not state: three tests using the same warehouse manager
 * cannot interfere, since each acts on its own product. Customers are still created per test
 * wherever the test *mutates* them — points, erasure — because there the identity is the fixture.
 */
let warehouse: TestUser;
let support: TestUser;
let admin: TestUser;

beforeAll(async () => {
  warehouse = await createUser('warehouse_manager');
  support = await createUser('support');
  admin = await createUser('admin');
  created.push(warehouse.id, support.id, admin.id);
}, 60_000);

afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

/** A customer whose identity this test is going to change. */
async function freshCustomer(): Promise<TestUser> {
  const user = await createUser();
  created.push(user.id);
  return user;
}

/** The drift view returns one row per variant whose `on_hand` disagrees with its ledger. */
async function driftFor(variantId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('v_stock_ledger_drift')
    .select('drift')
    .eq('variant_id', variantId);
  return (data ?? []).length;
}

async function onHand(variantId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('inventory_levels')
    .select('on_hand')
    .eq('variant_id', variantId)
    .single();
  return (data as { on_hand: number }).on_hand;
}

describe('inventory — the ledger invariant (docs/12 M10 acceptance)', () => {
  it('holds after receiving stock', async () => {
    const user = warehouse;
    const product = await createProduct({ stock: 10 });

    const { error } = await user.client.rpc('apply_stock_movement', {
      p_variant_id: product.variantId,
      p_warehouse_id: product.warehouseId,
      p_type: 'received',
      p_quantity: 25,
      p_batch_number: 'B-2026-08',
      p_note: 'integration test',
    });

    expect(error).toBeNull();
    expect(await onHand(product.variantId)).toBe(35);
    expect(await driftFor(product.variantId), 'on-hand must equal the sum of movements').toBe(0);
  });

  it('holds after a positive and a negative adjustment', async () => {
    const user = warehouse;
    const product = await createProduct({ stock: 20 });

    for (const quantity of [7, -3, -4, 1]) {
      const { error } = await user.client.rpc('apply_stock_movement', {
        p_variant_id: product.variantId,
        p_warehouse_id: product.warehouseId,
        p_type: 'adjustment',
        p_quantity: quantity,
        p_note: 'stock count',
      });
      expect(error, `adjustment of ${quantity}`).toBeNull();
    }

    expect(await onHand(product.variantId)).toBe(21);
    expect(await driftFor(product.variantId)).toBe(0);
  });

  it('refuses an adjustment that would take on-hand below zero', async () => {
    const user = warehouse;
    const product = await createProduct({ stock: 5 });

    const { error } = await user.client.rpc('apply_stock_movement', {
      p_variant_id: product.variantId,
      p_warehouse_id: product.warehouseId,
      p_type: 'adjustment',
      p_quantity: -6,
      p_note: 'too much',
    });

    expect(error, 'docs/06 §8 — negative adjustments cannot take on-hand < 0').not.toBeNull();
    expect(error?.message).toContain('INSUFFICIENT_STOCK');

    // And the refusal is atomic: no movement row was left behind.
    expect(await onHand(product.variantId)).toBe(5);
    expect(await driftFor(product.variantId)).toBe(0);
  });

  it('refuses a role that is not warehouse or product management', async () => {
    const user = support;
    const product = await createProduct({ stock: 5 });

    const { error } = await user.client.rpc('apply_stock_movement', {
      p_variant_id: product.variantId,
      p_warehouse_id: product.warehouseId,
      p_type: 'received',
      p_quantity: 10,
    });

    expect(error).not.toBeNull();
    expect(await onHand(product.variantId), 'nothing moved').toBe(5);
  });
});

describe('loyalty adjustment (docs/06 §9)', () => {
  it('writes a ledger row and the balance follows', async () => {
    const customer = await freshCustomer();

    const { data, error } = await support.client.rpc('admin_adjust_loyalty', {
      p_user_id: customer.id,
      p_points: 250,
      p_note: 'goodwill',
    });

    expect(error).toBeNull();
    expect((data as { balance: number }).balance).toBe(250);

    const { data: profile } = await serviceClient()
      .from('profiles')
      .select('loyalty_points')
      .eq('id', customer.id)
      .single();

    expect((profile as { loyalty_points: number }).loyalty_points).toBe(250);

    const { data: ledger } = await serviceClient()
      .from('loyalty_transactions')
      .select('points, reason, note')
      .eq('user_id', customer.id);

    expect(ledger).toHaveLength(1);
    expect(ledger?.[0]).toMatchObject({ points: 250, reason: 'adjustment', note: 'goodwill' });
  });

  it('refuses to take the balance below zero rather than clamping', async () => {
    /*
     * `sync_loyalty_balance` clamps the *balance* with `greatest(0, …)`. If the RPC allowed the
     * row anyway, the ledger would say -500 and the balance 0 — the exact drift the ledger
     * design exists to prevent.
     */
    const customer = await freshCustomer();

    const { error } = await support.client.rpc('admin_adjust_loyalty', {
      p_user_id: customer.id,
      p_points: -500,
      p_note: 'should fail',
    });

    expect(error?.message).toContain('INSUFFICIENT_POINTS');

    const { count } = await serviceClient()
      .from('loyalty_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', customer.id);

    expect(count, 'no ledger row was written').toBe(0);
  });

  it('is closed to a customer', async () => {
    const customer = await freshCustomer();

    const { error } = await customer.client.rpc('admin_adjust_loyalty', {
      p_user_id: customer.id,
      p_points: 10_000,
      p_note: 'free points please',
    });

    expect(error, 'a customer cannot mint their own points').not.toBeNull();
  });
});

describe('GDPR erasure (docs/06 §9)', () => {
  it('scrubs the person and keeps the commercial record', async () => {
    const customer = await freshCustomer();

    const service = serviceClient();

    await service.from('addresses').insert({
      user_id: customer.id,
      recipient_name: 'Test Personi',
      phone: '+38344111222',
      line1: 'Rruga e Testit 1',
      city: 'Prishtinë',
      country_code: 'XK',
    });

    const { data: order, error: orderError } = await service
      .from('orders')
      .insert({
        user_id: customer.id,
        email: customer.email,
        phone: '+38344111222',
        status: 'delivered',
        payment_status: 'paid',
        subtotal_cents: 2000,
        shipping_cents: 200,
        tax_cents: 0,
        discount_cents: 0,
        total_cents: 2200,
        shipping_address: {
          recipient_name: 'Test Personi',
          phone: '+38344111222',
          line1: 'Rruga e Testit 1',
          city: 'Prishtinë',
          country_code: 'XK',
        },
        billing_address: {
          recipient_name: 'Test Personi',
          phone: '+38344111222',
          line1: 'Rruga e Testit 1',
          city: 'Prishtinë',
          country_code: 'XK',
        },
        shipping_method: { name: { sq: 'Standard' }, price_cents: 200 },
      })
      .select('id, total_cents')
      .single();

    expect(orderError, 'order fixture must insert').toBeNull();
    const orderId = (order as { id: string }).id;

    const { error } = await admin.client.rpc('admin_anonymize_customer', {
      p_user_id: customer.id,
    });
    expect(error).toBeNull();

    const { data: profile } = await service
      .from('profiles')
      .select('email, full_name, phone, deleted_at')
      .eq('id', customer.id)
      .single();

    const scrubbed = profile as {
      email: string;
      full_name: string | null;
      phone: string | null;
      deleted_at: string | null;
    };

    expect(scrubbed.email).not.toBe(customer.email);
    expect(scrubbed.email).toContain('@deleted.invalid');
    expect(scrubbed.full_name).toBeNull();
    expect(scrubbed.phone).toBeNull();
    expect(scrubbed.deleted_at).not.toBeNull();

    const { count: addressCount } = await service
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', customer.id);
    expect(addressCount, 'addresses are pure PII and go entirely').toBe(0);

    const { data: keptOrder } = await service
      .from('orders')
      .select('total_cents, email, phone, shipping_address')
      .eq('id', orderId)
      .single();

    const kept = keptOrder as {
      total_cents: number;
      email: string;
      phone: string;
      shipping_address: Record<string, unknown>;
    };

    expect(kept.total_cents, 'the money stays — the business reported on it').toBe(2200);
    expect(kept.email).toContain('@deleted.invalid');
    expect(kept.phone).toBe('');
    expect(kept.shipping_address.recipient_name).toBeUndefined();
    expect(kept.shipping_address.line1).toBeUndefined();
    expect(kept.shipping_address.city, 'the delivery city is kept for reporting').toBe('Prishtinë');
  });

  it('refuses to erase a staff account', async () => {
    const colleague = support;

    const { error } = await admin.client.rpc('admin_anonymize_customer', {
      p_user_id: colleague.id,
    });

    expect(error?.message, 'it would orphan their audit trail').toContain(
      'CANNOT_ANONYMISE_STAFF',
    );
  });

  it('is closed to support — erasure is admin only', async () => {
    const customer = await freshCustomer();

    const { error } = await support.client.rpc('admin_anonymize_customer', {
      p_user_id: customer.id,
    });

    expect(error).not.toBeNull();
  });
});

describe('the admin views respect RLS', () => {
  it('shows a customer only themselves in v_admin_customers', async () => {
    const customer = await freshCustomer();
    // Any other profile will do — support is one, and it must not be visible either.
    const other = support;

    const { data } = await customer.client.from('v_admin_customers').select('id');
    const ids = (data ?? []).map((row) => (row as { id: string }).id);

    expect(ids).toContain(customer.id);
    expect(ids, 'security_invoker means the view is not a permission').not.toContain(other.id);
  });

  it('shows support every customer', async () => {
    const customer = await freshCustomer();

    const { data } = await support.client
      .from('v_admin_customers')
      .select('id, orders_count, lifetime_cents')
      .eq('id', customer.id);

    expect(data).toHaveLength(1);
    expect((data?.[0] as { orders_count: number }).orders_count).toBe(0);
  });

  it('hides inventory from a customer', async () => {
    const customer = await freshCustomer();
    await createProduct({ stock: 5 });

    const { data } = await customer.client.from('v_admin_inventory').select('variant_id');

    expect(data ?? [], 'inventory_levels is staff-only, and the view inherits that').toHaveLength(0);
  });
});
