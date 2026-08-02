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
 *   · brands      `slug LIKE 'brand-%'`
 *   · products    `slug LIKE 'product-%'`
 *   · categories  `slug LIKE 'category-%'`
 *   · goals       `slug LIKE 'goal-%'`
 *   · ingredients `slug LIKE 'ingredient-%'`
 *   · emails      `LIKE '%@biocode.test'`
 * Real catalogue data cannot match those — the seeded catalogue is slugged in Albanian.
 *
 * Deletion order matters: `stock_movements.variant_id` and `loyalty_transactions.order_id`
 * have no ON DELETE clause — those ledgers are deliberately durable — so their rows must
 * go before what they reference.
 */

/**
 * The database this is allowed to delete from must say so out loud.
 *
 * The previous guard refused a list of `biocode.com` hostnames, which was security theatre:
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

/**
 * The second guard: refuse a database that holds an order from a real person.
 *
 * `assertPurgeable` asks whether the target *declares itself* a test database. That is a
 * statement of intent in a file, and intent is exactly what goes stale — docs/14 §7 requires
 * `SUPABASE_TEST_PROJECT` to be deleted on launch day, which means the whole protection rests on
 * somebody remembering to do it at the moment they are busiest. This asks the database instead:
 * is there anything in here that a customer put there?
 *
 * Two guards, two failure modes. A misconfigured env var is caught by the first. A correctly
 * configured env var that nobody updated when the shop went live is caught by this one. Neither
 * subsumes the other, and this project runs one Supabase project for dev, test and production
 * (docs/14 §7), so it needs both.
 *
 * **What counts as real.** Any order whose email is neither a `@biocode.test` fixture nor an
 * `@deleted.invalid` anonymisation left by the GDPR-erasure tests. Both are residue this suite
 * created; anything else was placed by a person.
 *
 * A query failure throws rather than passing. A safety check that cannot see the data has not
 * verified anything, and treating "I could not look" as "it is fine" is how these get useless.
 */
export async function assertNoRealOrders(url: string, key: string): Promise<void> {
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) return;

  const client = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await client
    .from('orders')
    .select('order_number, created_at')
    .not('email', 'ilike', '%@biocode.test')
    .not('email', 'ilike', '%@deleted.invalid')
    .limit(3);

  if (error) {
    throw new Error(
      `Refusing to run: could not check ${url} for real orders (${error.message}).\n` +
        'The guard has to be able to see the data to clear it.',
    );
  }

  if (data && data.length > 0) {
    const sample = (data as { order_number: string; created_at: string }[])
      .map((row) => `${row.order_number} (${row.created_at.slice(0, 10)})`)
      .join(', ');

    throw new Error(
      `Refusing to run against ${url}: it holds ${data.length === 3 ? 'at least 3' : data.length} ` +
        `order(s) that no test created — ${sample}.\n\n` +
        'This database is serving real customers. The test suites place orders, consume stock and\n' +
        'delete rows; none of that belongs here. Point them at a separate project and remove\n' +
        'SUPABASE_TEST_PROJECT from this environment (docs/14 §7).',
    );
  }
}

/**
 * A minimal `.env` reader for the scripts and suites that run outside Next.
 *
 * **Unwraps matching surrounding quotes, because dotenv does.** Next loads `.env.local` through
 * `@next/env` and strips them, so the application saw `BIOCODE <porosite@shtrejt.com>` while
 * everything reading through this function saw `"BIOCODE <porosite@shtrejt.com>"` — quotes
 * included. Two readers of one file disagreeing about its contents is the kind of bug that only
 * shows up in the one place the value has to be exactly right.
 *
 * Here that place was `pnpm email:test`, which posts `EMAIL_FROM` straight to Resend as the
 * `from` address. A quoted value is not a valid address, so the tool for proving email works was
 * the one thing guaranteed not to. Quoting is *required* for this variable, since the value
 * contains spaces and angle brackets.
 */
export function envFromLocalFile(path = '.env.local'): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match?.[1] || match[2] === undefined) continue;

      const raw = match[2].trim();
      const quoted =
        raw.length >= 2 &&
        ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));

      env[match[1]] = quoted ? raw.slice(1, -1) : raw;
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

  /*
   * Brands, and the logos under them.
   *
   * Same leak as product images and the same fix: `brand_assets` objects are pathed
   * `{brandId}/…` by `createBrandLogoUploadUrl`, and nothing in the database references them, so
   * dropping the row leaves the bytes. The ids have to be read before the delete, not after.
   */
  const { data: brands } = await db.from('brands').select('id').like('slug', 'brand-%');
  const brandIds = (brands ?? []).map((row) => row.id);

  if (brandIds.length > 0) {
    const brandObjects: string[] = [];
    for (const brandId of brandIds) {
      const { data: objects } = await db.storage.from('brand-assets').list(brandId);
      for (const object of objects ?? []) brandObjects.push(`${brandId}/${object.name}`);
    }
    if (brandObjects.length > 0) {
      const { data: removed } = await db.storage.from('brand-assets').remove(brandObjects);
      record('brand logos', removed);
    }
  }

  record('brands', (await db.from('brands').delete().like('slug', 'brand-%').select('id')).data);

  /*
   * Taxonomy fixtures from the M6 admin tests.
   *
   * Deleted last of the catalogue group and by prefix only — `category-%`, `goal-%`,
   * `ingredient-%`. The seeded catalogue uses Albanian slugs (`vitaminat`, `gjumi`), so a real
   * row cannot match, and a category created by a test is otherwise indistinguishable from one
   * an operator made by hand.
   *
   * Children before parents: a test that creates a sub-category leaves `parent_id` pointing at
   * another fixture row, and `categories.parent_id` is `on delete restrict`.
   */
  record(
    'categories (children)',
    (
      await db
        .from('categories')
        .delete()
        .like('slug', 'category-%')
        .not('parent_id', 'is', null)
        .select('id')
    ).data,
  );
  record(
    'categories',
    (await db.from('categories').delete().like('slug', 'category-%').select('id')).data,
  );
  record(
    'health_goals',
    (await db.from('health_goals').delete().like('slug', 'goal-%').select('id')).data,
  );
  record(
    'ingredients',
    (await db.from('ingredients').delete().like('slug', 'ingredient-%').select('id')).data,
  );

  /*
   * --- orders ---------------------------------------------------------------
   *
   * Matched on the fixture email, **plus** the `SH-9999-` order-number prefix.
   *
   * That prefix exists for one test: the one proving `assertNoRealOrders` fires, which has to
   * insert an order that deliberately looks like a real customer's. If that test dies between
   * the insert and its `finally`, the row it leaves behind would trip the guard and refuse every
   * later run — a test capable of bricking the suite. The prefix makes `pnpm purge:test-data`
   * the recovery, instead of someone working out what to delete by hand.
   *
   * Real order numbers are `SH-<year>-<sequence>-<suffix>`, so `SH-9999-` cannot collide.
   */
  const { data: byEmail } = await db.from('orders').select('id').like('email', '%@biocode.test');
  const { data: byNumber } = await db.from('orders').select('id').like('order_number', 'SH-9999-%');
  const orderIds = [
    ...new Set([...(byEmail ?? []), ...(byNumber ?? [])].map((row) => row.id)),
  ];

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

  /*
   * --- auth users (profiles, carts, addresses, reviews and wishlists cascade) -------------
   *
   * The M7 journeys review and save **seeded** products, not fixture ones, so the
   * `product-%` sweep above cannot reach those rows. They come out here instead:
   * `reviews.user_id` and `wishlist_items.user_id` both cascade from `profiles`, which
   * cascades from the auth user.
   *
   * Deleting a review also fires `refresh_product_rating`, so a seeded product's `rating_avg`
   * returns to what it was — without which every run would leave the demo catalogue a little
   * more highly rated by nobody.
   */
  const { data: profiles } = await db.from('profiles').select('id').like('email', '%@biocode.test');
  const profileIds = (profiles ?? []).map((row) => row.id);

  if (profileIds.length > 0) {
    /*
     * Eleven tables reference `profiles(id)` with **no ON DELETE clause**, which in Postgres
     * means NO ACTION — a restriction. Deleting an auth user cascades to its profile, that
     * violates the first of those constraints, and the whole transaction aborts. GoTrue reports
     * it as a bare `500`, `supabase-js` surfaces an `AuthRetryableFetchError` whose `message`
     * is `{}`, and the loop below used to write `if (!error) deletedUsers += 1` — so a cleanup
     * that deleted nothing at all reported "nothing to purge".
     *
     * It had been failing since M5, when staff actions started writing `audit_logs`. By the end
     * of M7 the database held **580** fixture profiles, and six orphaned reviews had pushed a
     * seeded product's rating to 4.0 from nobody.
     *
     * The FKs are right and are not being changed: an audit row that can lose its actor is not
     * an audit row, and the same reasoning already protects `stock_movements` and
     * `loyalty_transactions` (see the note at the top of this file). What was missing is that
     * fixture *actors* need the same treatment as fixture *ledgers* — clear the references
     * first, then delete.
     *
     * `audit_logs` rows are deleted outright because an audit trail of test activity is itself
     * test data. Everywhere else the reference is nulled: the row belongs to the shop, only the
     * "who" was a fixture.
     */
    record(
      'audit_logs',
      (await db.from('audit_logs').delete().in('actor_id', profileIds).select('id')).data,
    );

    const detach = async (
      table:
        | 'products'
        | 'product_variant_costs'
        | 'stock_movements'
        | 'order_events'
        | 'refunds'
        | 'articles'
        | 'loyalty_transactions'
        | 'contact_messages'
        | 'settings',
      column: string,
    ) => {
      const { error } = await db
        .from(table)
        .update({ [column]: null })
        .in(column, profileIds);
      if (error) counts[`${table}.${column} detach failed`] = 1;
    };

    await detach('products', 'approved_by');
    await detach('product_variant_costs', 'updated_by');
    await detach('stock_movements', 'created_by');
    await detach('order_events', 'created_by');
    await detach('refunds', 'created_by');
    await detach('articles', 'author_id');
    await detach('loyalty_transactions', 'created_by');
    await detach('contact_messages', 'replied_by');
    await detach('settings', 'updated_by');

    // `coupon_redemptions.user_id` is NOT NULL, so the row goes rather than the reference.
    record(
      'coupon_redemptions',
      (await db.from('coupon_redemptions').delete().in('user_id', profileIds).select('coupon_id'))
        .data,
    );
  }

  let deletedUsers = 0;
  const userFailures: string[] = [];
  for (const id of profileIds) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) userFailures.push(error.message || error.name);
    else deletedUsers += 1;
  }
  if (deletedUsers > 0) counts['auth users'] = deletedUsers;

  /*
   * Reported, not swallowed. A purge that cannot delete its users has left the database dirtier
   * than it found it, and the one thing it must not do is say so quietly.
   */
  if (userFailures.length > 0) {
    counts[`auth users FAILED (${userFailures[0] ?? 'unknown'})`] = userFailures.length;
  }

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
    (await db.from('newsletter_subscribers').delete().like('email', '%@biocode.test').select('id'))
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
