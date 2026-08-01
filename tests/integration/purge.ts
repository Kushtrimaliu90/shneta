import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Removes integration-test fixtures from the target database.
 *
 * Why this exists: the suite creates brands, products, variants, stock, carts and orders,
 * and originally cleaned up only auth users. Running it against the hosted dev project
 * left 63 **published** fake products behind, which then showed up in `sitemap.xml` and
 * would have shown on the storefront. Cleanup has to be automatic, not remembered.
 *
 * Safety: only the fixture naming conventions are ever matched —
 *   · brands   `slug LIKE 'brand-%'`
 *   · products `slug LIKE 'product-%'`
 *   · emails   `LIKE '%@shneta.test'`
 * Real catalogue data cannot match those.
 *
 * Deletion order matters: `stock_movements.variant_id` and `loyalty_transactions.order_id`
 * have no ON DELETE clause — those ledgers are deliberately durable — so their rows must
 * go before what they reference.
 */

/**
 * The database this is allowed to delete from must say so out loud.
 *
 * The previous guard refused a list of `shneta.com` hostnames, which was security theatre:
 * a Supabase database is never *at* the site's hostname, it is at
 * `<ref>.supabase.co`. The check could not have fired for any real target. It was written
 * when dev and prod were assumed to be different projects; the moment one project became
 * both, it protected nothing.
 *
 * So it is inverted and fails **closed**. `SUPABASE_TEST_PROJECT` must be set and must match
 * the project ref in the URL being purged. A fresh clone, a CI job with the wrong secret, or
 * a laptop whose `.env.local` points at production all refuse to delete anything, because
 * absence of the variable is treated as "not a test database" rather than "probably fine".
 *
 * Declaring the ref rather than a boolean is deliberate: `ALLOW_CLEANUP=1` left in a shell
 * profile would follow you to whatever you pointed at next, whereas a ref stops matching the
 * moment the target changes.
 *
 * Exported because the same question gates three things, and cleanup is the least important
 * of them: the integration suite and the E2E suite call this **before writing anything**.
 * A suite that creates fake orders in a live database and then tidies up perfectly has still
 * put fake orders in front of whoever was watching the admin order list.
 */
export function assertPurgeable(url: string): void {
  /*
   * Read through `envFromLocalFile` and not `process.env` alone. Vitest and Playwright both
   * load `.env.local` for the *app*, not into this process's environment, so a declaration
   * sitting in that file was invisible here — the guard refused a database that had in fact
   * declared itself. A safety check that cannot be satisfied gets switched off by whoever
   * hits it next, which is worse than not having one.
   */
  const env = { ...envFromLocalFile(), ...process.env };
  const declared = (env.SUPABASE_TEST_PROJECT ?? '').trim();
  const ref = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|red)/i.exec(url)?.[1] ?? '';
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);

  // The local Supabase stack is disposable by definition — `supabase db reset` recreates it.
  if (isLocal) return;

  if (!declared) {
    throw new Error(
      `Refusing to write to or delete from ${url}: SUPABASE_TEST_PROJECT is not set.\n` +
        'This database is not declared as a test target. If it really is one, set\n' +
        `SUPABASE_TEST_PROJECT=${ref || '<project-ref>'} in .env.local.\n` +
        'If it holds real orders, point the test suites somewhere else — see docs/14 §7.',
    );
  }

  if (declared !== ref) {
    throw new Error(
      `Refusing to write to or delete from ${url}: SUPABASE_TEST_PROJECT is "${declared}" but the\n` +
        `target project is "${ref}". One of the two is wrong, and guessing which is not safe.`,
    );
  }
}

export function envFromLocalFile(path = '.env.local'): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2].trim();
    }
  } catch {
    // Falls through to process.env, which is how CI supplies these.
  }
  return env;
}

type Recorder = (label: string, rows: { length: number } | null | undefined) => void;

/**
 * Gives back the stock a test order consumed, before the order row is deleted.
 *
 * This matters because the E2E checkout journeys buy from the **real seeded catalogue** —
 * there is no way to place a believable order otherwise. Each run therefore decrements
 * `on_hand` for real fixture variants, and without this the suite would quietly drain the
 * catalogue until `NOW-D3-120` reported out of stock and journey 1 started failing for a
 * reason that has nothing to do with the code.
 *
 * It writes a compensating `cancel_restock` movement through `apply_stock_movement()`
 * rather than deleting the original `sale` rows and patching `on_hand`. Three reasons:
 *   · `v_stock_ledger_drift` must stay empty — deleting a movement without touching
 *     `on_hand` creates drift, and touching `on_hand` directly is exactly what
 *     docs/13 §A7 forbids.
 *   · it is what a real cancellation does, so the cleanup exercises a production path.
 *   · the ledger stays a truthful history: the sale happened, then it was reversed.
 */
async function restockTestOrders(
  db: SupabaseClient,
  orderIds: string[],
  record: Recorder,
): Promise<void> {
  const { data: warehouse } = await db
    .from('warehouses')
    .select('id')
    .eq('is_default', true)
    .maybeSingle();

  // Same warehouse the checkout RPC sells from (rpc_checkout.sql — `where is_default`).
  if (!warehouse) return;

  const { data: items } = await db
    .from('order_items')
    .select('order_id, variant_id, quantity')
    .in('order_id', orderIds)
    .not('variant_id', 'is', null);

  const restocked: { length: number }[] = [];

  for (const item of items ?? []) {
    const { error } = await db.rpc('apply_stock_movement', {
      p_variant_id: item.variant_id,
      p_warehouse_id: warehouse.id,
      p_type: 'cancel_restock',
      p_quantity: item.quantity,
      p_reference_type: 'order',
      p_reference_id: item.order_id,
      p_note: 'Test fixture cleanup — reversing an E2E order.',
    });
    if (!error) restocked.push({ length: 1 });
  }

  record('stock restocked', restocked.length > 0 ? restocked : null);
}

export async function purgeFixtures(
  url: string,
  serviceKey: string,
): Promise<Record<string, number>> {
  assertPurgeable(url);

  const db: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const counts: Record<string, number> = {};
  const record = (label: string, rows: { length: number } | null | undefined) => {
    const n = rows?.length ?? 0;
    if (n > 0) counts[label] = (counts[label] ?? 0) + n;
  };

  // --- catalogue fixtures ----------------------------------------------------
  const { data: products } = await db.from('products').select('id').like('slug', 'product-%');
  const productIds = (products ?? []).map((row) => row.id);

  if (productIds.length > 0) {
    /*
     * Storage objects go before the rows that reference them.
     *
     * `product_images` cascades from `products`, so deleting a fixture product removes its rows
     * — but nothing removes the bytes, and the E2E upload test puts a real PNG in the bucket on
     * every run. Left alone that is a slow leak of objects nothing points at, invisible until
     * somebody opens the storage browser and finds a thousand of them.
     *
     * `createImageUploadUrl` paths every upload under `{productId}/`, so the product id is the
     * folder and one `list` per fixture product finds everything it owns.
     */
    const orphanedObjects: string[] = [];
    for (const productId of productIds) {
      const { data: objects } = await db.storage.from('product-images').list(productId);
      for (const object of objects ?? []) orphanedObjects.push(`${productId}/${object.name}`);
    }

    if (orphanedObjects.length > 0) {
      const { data: removed } = await db.storage.from('product-images').remove(orphanedObjects);
      record('storage objects', removed);
    }

    const { data: variants } = await db
      .from('product_variants')
      .select('id')
      .in('product_id', productIds);
    const variantIds = (variants ?? []).map((row) => row.id);

    if (variantIds.length > 0) {
      record(
        'stock_movements',
        (await db.from('stock_movements').delete().in('variant_id', variantIds).select('id')).data,
      );
      record(
        'cart_items',
        (await db.from('cart_items').delete().in('variant_id', variantIds).select('id')).data,
      );
      record(
        'subscription_items',
        (await db.from('subscription_items').delete().in('variant_id', variantIds).select('id'))
          .data,
      );
      record(
        'inventory_levels',
        (
          await db
            .from('inventory_levels')
            .delete()
            .in('variant_id', variantIds)
            .select('variant_id')
        ).data,
      );
      record(
        'product_variant_costs',
        (
          await db
            .from('product_variant_costs')
            .delete()
            .in('variant_id', variantIds)
            .select('variant_id')
        ).data,
      );
    }

    record(
      'order_items',
      (await db.from('order_items').delete().in('product_id', productIds).select('id')).data,
    );
    record(
      'reviews',
      (await db.from('reviews').delete().in('product_id', productIds).select('id')).data,
    );
    record(
      'product_variants',
      (await db.from('product_variants').delete().in('product_id', productIds).select('id')).data,
    );
    record('products', (await db.from('products').delete().in('id', productIds).select('id')).data);
  }

  record('brands', (await db.from('brands').delete().like('slug', 'brand-%').select('id')).data);

  // --- orders ---------------------------------------------------------------
  const { data: orders } = await db.from('orders').select('id').like('email', '%@shneta.test');
  const orderIds = (orders ?? []).map((row) => row.id);

  if (orderIds.length > 0) {
    await restockTestOrders(db, orderIds, record);

    record(
      'loyalty_transactions',
      (await db.from('loyalty_transactions').delete().in('order_id', orderIds).select('id')).data,
    );
    record(
      'refunds',
      (await db.from('refunds').delete().in('order_id', orderIds).select('id')).data,
    );
    record('orders', (await db.from('orders').delete().in('id', orderIds).select('id')).data);
  }

  // --- auth users (profiles, carts and addresses cascade from here) ---------
  const { data: profiles } = await db.from('profiles').select('id').like('email', '%@shneta.test');
  let deletedUsers = 0;
  for (const profile of profiles ?? []) {
    const { error } = await db.auth.admin.deleteUser(profile.id);
    if (!error) deletedUsers += 1;
  }
  if (deletedUsers > 0) counts['auth users'] = deletedUsers;

  /*
   * Guest carts from aborted runs have no owner to cascade from, so they need collecting
   * explicitly — but `delete().is('user_id', null)` was the one deletion in this file with no
   * fixture scope at all. On a database that also serves real shoppers it would empty every
   * anonymous basket on the site, every time anyone ran the suite. Nobody would report it:
   * the customer just finds their cart empty and assumes they imagined adding things.
   *
   * Now scoped to **empty** guest carts, which is both sufficient and free of consequence.
   * Sufficient because the integration fixtures' cart items are deleted with their variants
   * just above, leaving the shells behind. Free of consequence because an empty cart holds
   * nothing to lose: `findActiveCart()` returns null when the token no longer resolves and
   * `ensureCart()` simply mints a new one, so even a real shopper whose cart happened to be
   * empty notices nothing.
   *
   * Guest carts that still hold items are deliberately left alone — a stray one is inert
   * (carting reserves no stock, and it appears nowhere) and the housekeeping cron expires it
   * on the normal `cart_expiry_days` schedule. Reaching further than this is not worth the
   * risk of being wrong about whose basket it is.
   */
  const { data: guestCarts } = await db
    .from('carts')
    .select('id, cart_items(id)')
    .is('user_id', null);

  const emptyIds = (guestCarts ?? [])
    .filter((cart) => (cart.cart_items as { id: string }[]).length === 0)
    .map((cart) => cart.id);

  if (emptyIds.length > 0) {
    record(
      'carts (guest, empty)',
      (await db.from('carts').delete().in('id', emptyIds).select('id')).data,
    );
  }

  record('coupons', (await db.from('coupons').delete().like('code', 'TEST%').select('id')).data);
  record('coupons', (await db.from('coupons').delete().like('code', 'SECRET%').select('id')).data);
  record('coupons', (await db.from('coupons').delete().like('code', 'DEL%').select('id')).data);

  /*
   * `LOY-` coupons are minted by `redeem_loyalty_points()`, so the redemption test leaves
   * them behind — but in a real dev project they can also belong to a genuine customer.
   * Only orphans are removed: ones whose owning profile no longer exists. The owner id is
   * recorded in `note` as "Loyalty redemption for <uuid>".
   */
  const { data: loyaltyCoupons } = await db
    .from('coupons')
    .select('id, note')
    .like('code', 'LOY-%');

  const orphanIds: string[] = [];
  for (const coupon of loyaltyCoupons ?? []) {
    const ownerId = /Loyalty redemption for ([0-9a-f-]{36})/i.exec(coupon.note ?? '')?.[1];
    if (!ownerId) continue;
    const { count } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('id', ownerId);
    if ((count ?? 0) === 0) orphanIds.push(coupon.id);
  }
  if (orphanIds.length > 0) {
    record(
      'coupons (orphan LOY)',
      (await db.from('coupons').delete().in('id', orphanIds).select('id')).data,
    );
  }
  record(
    'newsletter_subscribers',
    (await db.from('newsletter_subscribers').delete().like('email', '%@shneta.test').select('id'))
      .data,
  );
  record(
    'rate_limits',
    (await db.from('rate_limits').delete().like('key', '%test-%').select('key')).data,
  );

  return counts;
}

export function describeCounts(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return 'nothing to purge';
  const parts = Object.entries(counts).map(([label, n]) => `${label}: ${n}`);
  return `${total} rows (${parts.join(', ')})`;
}
