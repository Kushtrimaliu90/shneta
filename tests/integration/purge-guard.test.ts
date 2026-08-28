import { describe, expect, it } from 'vitest';
import { serviceClient } from './helpers';
import { assertNoRealOrders, assertPurgeable, envFromLocalFile } from './purge';

/**
 * docs/14 §7 — the two guards that stand between `pnpm test:e2e` and customer data.
 *
 * This project runs **one Supabase project for dev, test and production**. Everything else in
 * this suite is a test of the shop; this is a test of the thing that decides whether the suite
 * is allowed to run at all, and an untested guard is a guess.
 *
 * The pair is deliberate and neither subsumes the other:
 *
 *   · `assertPurgeable` reads config. It catches a misconfigured environment, throws during
 *     import, and needs no database access — the earliest possible refusal.
 *   · `assertNoRealOrders` reads the database. It catches the case config cannot: an
 *     environment that still declares itself a test target long after it stopped being one,
 *     which is exactly what docs/14 §7 step 3 asks a human to remember on launch day.
 */

const env = { ...envFromLocalFile(), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('assertPurgeable — the config guard', () => {
  it('accepts the declared target', () => {
    expect(() => assertPurgeable(url)).not.toThrow();
  });

  it('refuses a project that is not the declared one', () => {
    expect(() => assertPurgeable('https://someoneelses.supabase.co')).toThrow(/Refusing/);
  });

  it('treats a local stack as disposable without any declaration', () => {
    expect(() => assertPurgeable('http://127.0.0.1:54321')).not.toThrow();
  });
});

describe('assertNoRealOrders — the data guard', () => {
  it('clears the database as it stands', async () => {
    await expect(assertNoRealOrders(url, key)).resolves.toBeUndefined();
  });

  /**
   * The one that matters, and the only way to prove the filter is right: put a row in that looks
   * like a customer's and check the guard notices.
   *
   * `SH-9999-` prefixed so `purgeFixtures` can sweep it if this test dies before its `finally` —
   * otherwise a failure here would leave a row that refuses every subsequent run.
   */
  it('refuses once an order exists that no test created', async () => {
    const db = serviceClient();
    const orderNumber = `SH-9999-${Date.now().toString().slice(-6)}-GRD1`;

    const { data: order, error } = await db
      .from('orders')
      .insert({
        order_number: orderNumber,
        email: 'a.real.customer@gmail.com',
        phone: '+383 44 000 001',
        status: 'pending',
        subtotal_cents: 1000,
        shipping_cents: 200,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 1200,
        shipping_address: { city: 'Prishtinë', country_code: 'XK' },
        billing_address: { city: 'Prishtinë', country_code: 'XK' },
        shipping_method: { name: 'Standard' },
      })
      .select('id')
      .single();

    if (error) throw new Error(`fixture order failed: ${error.message}`);

    try {
      await expect(assertNoRealOrders(url, key)).rejects.toThrow(/serving real customers/);
    } finally {
      await db
        .from('orders')
        .delete()
        .eq('id', (order as { id: string }).id);
    }

    // Clean again once it is gone — the guard is about the data, not a latch.
    await expect(assertNoRealOrders(url, key)).resolves.toBeUndefined();
  });

  it('ignores the anonymised orders the GDPR-erasure tests leave behind', async () => {
    const db = serviceClient();
    const { data } = await db
      .from('orders')
      .select('email')
      .ilike('email', '%@deleted.invalid')
      .limit(1);

    /*
     * Not an assertion that such rows exist — a freshly purged database has none. It asserts the
     * exclusion is real: those rows are anonymisation residue this suite created, and treating
     * them as customer data would have blocked every run from the day the erasure tests first
     * ran. That is how a good guard becomes a disabled one.
     */
    if ((data ?? []).length > 0) {
      await expect(assertNoRealOrders(url, key)).resolves.toBeUndefined();
    }
  });
});
