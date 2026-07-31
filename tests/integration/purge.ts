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
 * Real catalogue data cannot match those, so this cannot destroy production content even
 * if aimed at it. It also refuses the production hostname outright.
 *
 * Deletion order matters: `stock_movements.variant_id` and `loyalty_transactions.order_id`
 * have no ON DELETE clause — those ledgers are deliberately durable — so their rows must
 * go before what they reference.
 */

const PRODUCTION_HOSTS = ['shneta.com', 'www.shneta.com'];

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

export async function purgeFixtures(
  url: string,
  serviceKey: string,
): Promise<Record<string, number>> {
  if (PRODUCTION_HOSTS.some((host) => url.includes(host))) {
    throw new Error(`Refusing to purge what looks like production: ${url}`);
  }

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

  // Guest carts from aborted runs have no owner to cascade from.
  record('carts (guest)', (await db.from('carts').delete().is('user_id', null).select('id')).data);

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
