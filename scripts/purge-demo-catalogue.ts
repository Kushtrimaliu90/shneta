/**
 * Removes the DEMO catalogue — the 24 fixture products, their variants and stock, and the
 * four test coupons — from whatever `.env.local` points at.
 *
 *   pnpm purge:demo --dry-run     # always do this first
 *   pnpm purge:demo --yes
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Why this script exists
 *
 * `docs/11` scopes `supabase/seeds/01–03` to local and staging: brand names like Optimum
 * Nutrition and Solgar are used as realistic fixtures with **placeholder logos**, and the
 * product copy was written to exercise the label UI, not to describe anything real.
 *
 * That is fine while one database is a test database. It stops being fine the moment the same
 * database serves customers, which is the configuration this project chose (docs/14 §7). Then
 * the demo catalogue is three separate problems:
 *
 *   1. A customer can buy a product that does not exist. There is stock on it, so checkout
 *      succeeds, money is owed on delivery, and nothing can be shipped.
 *   2. Real brand names on invented products with unlicensed logos is a trademark exposure,
 *      and the health copy has not had the claim-language review docs/08 §7 requires.
 *   3. WELCOME10, FALAS and EXPIRED5 are ACTIVE. A real order can be discounted 10% by a
 *      coupon that was seeded to make a test pass.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Safety
 *
 * Deletes only rows whose primary keys are the fixed fixture UUIDs from the seed files, plus
 * the four named coupon codes. It cannot touch a product added through the admin panel, since
 * that gets a `gen_random_uuid()` key which cannot collide with these.
 *
 * It **refuses** to delete a fixture product that has ever been ordered. If a customer really
 * bought one you have a fulfilment problem to resolve by hand, and silently deleting the
 * product would destroy the evidence: `order_items` snapshots the name and SKU, but
 * `order_items.variant_id` is `on delete set null`, so the link back to what was sold would
 * be gone. It reports those and leaves them alone.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envFromLocalFile } from '../tests/integration/purge';

/** The `b0…` block from `supabase/seeds/01-catalogue.sql` — 24 products. */
const DEMO_PRODUCT_PREFIX = 'b0000000-0000-4000-8000-';
/** The `a0…` block — 20 ingredients. */
const DEMO_INGREDIENT_PREFIX = 'a0000000-0000-4000-8000-';
/** The `d0…` block from `supabase/seeds/03-commerce.sql`. */
const DEMO_COUPON_CODES = ['WELCOME10', 'FALAS', 'EXPIRED5', 'SUB-10'];

interface Summary {
  deleted: Record<string, number>;
  keptBecauseOrdered: { slug: string; orders: number }[];
}

async function idsWithPrefix(db: SupabaseClient, table: string, prefix: string) {
  // PostgREST has no "starts with" for uuid, so filter client-side on the id list. These
  // tables hold tens of rows in this project, not millions.
  const { data, error } = await db.from(table).select('id, slug');
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as { id: string; slug: string }[]).filter((row) => row.id.startsWith(prefix));
}

async function run(db: SupabaseClient, apply: boolean): Promise<Summary> {
  const deleted: Record<string, number> = {};
  const count = (label: string, n: number) => {
    if (n > 0) deleted[label] = (deleted[label] ?? 0) + n;
  };

  const products = await idsWithPrefix(db, 'products', DEMO_PRODUCT_PREFIX);

  // --- which of them have been sold? ----------------------------------------
  const keptBecauseOrdered: { slug: string; orders: number }[] = [];
  const safeIds: string[] = [];

  for (const product of products) {
    const { count: ordered, error } = await db
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', product.id);
    if (error) throw new Error(`order_items: ${error.message}`);

    if ((ordered ?? 0) > 0) keptBecauseOrdered.push({ slug: product.slug, orders: ordered ?? 0 });
    else safeIds.push(product.id);
  }

  if (!apply) {
    count('products', safeIds.length);
    count('ingredients', (await idsWithPrefix(db, 'ingredients', DEMO_INGREDIENT_PREFIX)).length);
    const { count: coupons } = await db
      .from('coupons')
      .select('id', { count: 'exact', head: true })
      .in('code', DEMO_COUPON_CODES);
    count('coupons', coupons ?? 0);
    return { deleted, keptBecauseOrdered };
  }

  // --- variants first, then everything hanging off them ---------------------
  if (safeIds.length > 0) {
    const { data: variants } = await db
      .from('product_variants')
      .select('id')
      .in('product_id', safeIds);
    const variantIds = (variants ?? []).map((v) => v.id);

    if (variantIds.length > 0) {
      // Ledgers have no ON DELETE clause — deliberately durable — so they go first.
      for (const table of [
        'stock_movements',
        'cart_items',
        'subscription_items',
        'inventory_levels',
        'product_variant_costs',
        'wishlist_items',
      ]) {
        // Every one of these keys the variant by the same column name.
        const { data, error } = await db
          .from(table)
          .delete()
          .in('variant_id', variantIds)
          .select('*');
        // A table that does not exist yet (wishlist_items lands with M7) is not an error here.
        if (error && !/does not exist|schema cache/i.test(error.message)) {
          throw new Error(`${table}: ${error.message}`);
        }
        count(table, data?.length ?? 0);
      }
    }

    for (const table of ['reviews', 'product_relations', 'product_images']) {
      const { data, error } = await db.from(table).delete().in('product_id', safeIds).select('*');
      if (error && !/does not exist|schema cache/i.test(error.message)) {
        throw new Error(`${table}: ${error.message}`);
      }
      count(table, data?.length ?? 0);
    }

    count(
      'product_variants',
      (await db.from('product_variants').delete().in('product_id', safeIds).select('id')).data
        ?.length ?? 0,
    );
    count(
      'products',
      (await db.from('products').delete().in('id', safeIds).select('id')).data?.length ?? 0,
    );
  }

  /*
   * Ingredients go only if no surviving product references them — an ordered fixture product
   * that is being kept still needs its label to render.
   */
  const ingredients = await idsWithPrefix(db, 'ingredients', DEMO_INGREDIENT_PREFIX);
  for (const ingredient of ingredients) {
    const { count: used } = await db
      .from('product_ingredients')
      .select('product_id', { count: 'exact', head: true })
      .eq('ingredient_id', ingredient.id);

    if ((used ?? 0) > 0) continue;
    const { data } = await db.from('ingredients').delete().eq('id', ingredient.id).select('id');
    count('ingredients', data?.length ?? 0);
  }

  count(
    'coupons',
    (await db.from('coupons').delete().in('code', DEMO_COUPON_CODES).select('id')).data?.length ??
      0,
  );

  return { deleted, keptBecauseOrdered };
}

async function main(): Promise<void> {
  const env = { ...envFromLocalFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url || !key) {
    console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const apply = process.argv.includes('--yes');
  const dryRun = process.argv.includes('--dry-run');

  if (!apply && !dryRun) {
    console.error(
      'Refusing to guess. Pass --dry-run to see what would go, or --yes to do it.\n' +
        'This deletes the demo catalogue and is not reversible without re-running the seeds.',
    );
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log(`${apply ? 'DELETING from' : 'DRY RUN against'}: ${url}\n`);

  const { deleted, keptBecauseOrdered } = await run(db, apply);

  const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    console.log('Nothing to remove — the demo catalogue is already gone.');
  } else {
    for (const [table, n] of Object.entries(deleted)) console.log(`  ${table}: ${n}`);
    console.log(`\n${apply ? 'Deleted' : 'Would delete'} ${total} rows.`);
  }

  if (keptBecauseOrdered.length > 0) {
    console.log('\n⚠ KEPT — these fixture products have been ordered by someone:');
    for (const { slug, orders } of keptBecauseOrdered) {
      console.log(`    ${slug} — ${orders} order item(s)`);
    }
    console.log(
      '\n  A demo product was sold. Resolve the order first (contact the customer, cancel\n' +
        '  and refund), then re-run. Deleting it now would break the link from the order to\n' +
        '  what was actually bought.',
    );
  }

  if (!apply) console.log('\nRe-run with --yes to apply.');
}

main().catch((error: unknown) => {
  console.error(`purge:demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
