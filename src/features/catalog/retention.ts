import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';

/**
 * Emptying the bin, eventually.
 *
 * ── What this is for ──
 *
 * Removal is reversible and deliberately keeps the record's slug reserved, which is right for the first
 * few weeks and wrong forever: a bin nobody empties becomes a second catalogue, and every slug in it is a
 * web address that can never be reused. So a record that has sat removed long enough and has nothing
 * attached is destroyed on a schedule.
 *
 * ── Why the delay is long ──
 *
 * Ninety days. The mistake this protects against — "we removed it, and three weeks later somebody asked
 * for it back" — happens on the scale of a season, not a sprint, and there is no cost to waiting: a
 * removed record is already invisible to customers and to the panel. Short retention would trade a real
 * safety net for disk space nobody is short of.
 *
 * ── The same guard as the manual path, deliberately ──
 *
 * Nothing is destroyed here that an operator could not have destroyed by hand. `canPurge` decides both,
 * so the cron cannot be a back door around a refusal: a product with an order line, a review, a merchant
 * offer or stock history stays in the bin indefinitely, and that is the correct outcome — its history is
 * worth more than its slug. Those rows are counted as `kept` so a bin that never empties is visible
 * rather than mysterious.
 *
 * ── Why the service client ──
 *
 * The cron has no session. It is on the docs/02 §6 list for that reason, and `canPurge` is the authority
 * on what may go — not the client's privileges.
 */

export const RETENTION_DAYS = 90;

export interface RetentionResult {
  /** Rows destroyed on this run. */
  purged: number;
  /** Rows old enough but still attached to something, so left alone. */
  kept: number;
  failed: number;
}

/**
 * Destroys removed products, brands and categories that are past retention and provably empty.
 *
 * Bounded per run: this shares a 60-second cron with nine other steps, and a bin that needs more than one
 * night to drain is a bin nobody is waiting on.
 */
export async function sweepRetention(limit = 20): Promise<RetentionResult> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result: RetentionResult = { purged: 0, kept: 0, failed: 0 };

  try {
    /*
     * Products first, then their taxonomy.
     *
     * The order matters: a brand is refused while any product still points at it, including a removed
     * one. Destroying eligible products in the same run therefore unblocks their brands for the *next*
     * run rather than this one — which is slower but avoids ordering two guards against each other
     * inside a single pass.
     */
    const { data: products } = await admin
      .from('products')
      .select('id, slug')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
      .limit(limit);

    for (const row of (products ?? []) as { id: string; slug: string }[]) {
      const blocked = await productIsAttached(row.id);
      if (blocked) {
        result.kept += 1;
        continue;
      }
      const { error } = await admin.from('products').delete().eq('id', row.id);
      if (error) {
        result.failed += 1;
        logger.error('retention: product delete failed', { slug: row.slug, cause: error.message });
      } else {
        result.purged += 1;
      }
    }

    for (const table of ['brands', 'categories'] as const) {
      const { data: rows } = await admin
        .from(table)
        .select('id, slug')
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff)
        .limit(limit);

      for (const row of (rows ?? []) as { id: string; slug: string }[]) {
        const blocked =
          table === 'brands'
            ? await countRows(admin, 'products', 'brand_id', row.id)
            : (await countRows(admin, 'categories', 'parent_id', row.id)) +
              (await countRows(admin, 'product_categories', 'category_id', row.id));

        if (blocked > 0) {
          result.kept += 1;
          continue;
        }
        const { error } = await admin.from(table).delete().eq('id', row.id);
        if (error) {
          result.failed += 1;
          logger.error('retention: delete failed', { table, slug: row.slug, cause: error.message });
        } else {
          result.purged += 1;
        }
      }
    }

    if (result.purged > 0 || result.failed > 0) {
      logger.info('retention sweep', { ...result, retentionDays: RETENTION_DAYS });
    }
    return result;
  } catch (error) {
    logger.error('sweepRetention threw', describeError(error));
    return result;
  }
}

/** A plain count, so the caller reads as a list of questions rather than of query builders. */
async function countRows(
  admin: ReturnType<typeof createAdminClient>,
  table: 'products' | 'categories' | 'product_categories',
  column: string,
  value: string,
): Promise<number> {
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  return count ?? 0;
}

/**
 * Whether anything is attached to a product that would make destroying it a loss.
 *
 * The same set the manual path checks, expressed as a short-circuiting boolean because the cron only
 * needs to know *whether* to skip — it has nobody to explain the details to. The manual path counts them
 * all so it can name them.
 */
async function productIsAttached(productId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: variantRows } = await admin
    .from('product_variants')
    .select('id')
    .eq('product_id', productId);
  const variantIds = ((variantRows ?? []) as { id: string }[]).map((row) => row.id);

  /*
   * Written out rather than looped over a table/column pair: the column name differs per table, and a
   * tuple loop widens it into a union the generated types rightly reject. Three questions in a row also
   * read more plainly than one clever iteration.
   */
  const orders = await admin
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if ((orders.count ?? 0) > 0) return true;

  const reviews = await admin
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if ((reviews.count ?? 0) > 0) return true;

  const proposals = await admin
    .from('product_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('created_product_id', productId);
  if ((proposals.count ?? 0) > 0) return true;

  if (variantIds.length === 0) return false;

  for (const table of ['stock_movements', 'subscription_items', 'merchant_offers'] as const) {
    const { count } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in('variant_id', variantIds);
    if ((count ?? 0) > 0) return true;
  }

  return false;
}
