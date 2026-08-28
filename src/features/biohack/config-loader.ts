import 'server-only';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { CACHE_TAGS } from '@/lib/constants';
import { loadConfig } from '@/features/biohack/config-mapper';
import type { CatalogProduct, ProtocolConfig } from '@/features/biohack/types';

/**
 * docs/15 §2 — the request-side wrappers around `config-mapper`.
 *
 * **Service client, on purpose, and listed in docs/02 §6.** The config tables have no anon
 * policy: a visitor generating a protocol must not be able to read the weights, the draft copy
 * compliance has not approved, or the conflict matrix. So the engine's inputs are fetched with
 * the service role and never leave the server — only the *result* reaches the browser.
 */

const BIOHACK_CONFIG_TAG = 'biohack-config';

/** Purged when compliance approves a version. */
export const BIOHACK_TAGS = { config: BIOHACK_CONFIG_TAG } as const;

/** One config version, uncached. The simulator uses this to read a **draft**. */
export async function readConfig(configId?: string): Promise<ProtocolConfig | null> {
  return loadConfig(createAdminClient(), configId);
}

/**
 * The approved config, cached across requests and purged on approval.
 *
 * Uncached this is five round trips per generation; docs/15 asks for p95 under 300 ms and the
 * engine itself takes about a millisecond, so all of the budget is here. `unstable_cache` rather
 * than React's `cache()` for the reason docs/13 §K1 records: only the Data Cache survives between
 * requests, and only `revalidateTag` empties it.
 */
export const getApprovedConfig = unstable_cache(
  async () => loadConfig(createAdminClient()),
  ['biohack-approved-config'],
  { tags: [BIOHACK_CONFIG_TAG] },
);

/**
 * The purchasable catalogue the engine resolves ingredients against.
 *
 * Anon client and tagged `products`, so it rides the same invalidation as everything else in the
 * catalogue: publishing a product or receiving stock purges it (docs/13 §K1).
 *
 * Price per serving is derived rather than stored. `servings` is not a column — `serving_size` is
 * free text like "2 kapsula" — so the honest approximation is the variant price over the pack
 * size when one can be parsed, and the price itself when it cannot. The ranking only needs the
 * order to be right, and a product with no parseable size ranks as though it were a single
 * serving, which is conservative: it looks expensive, so it never wins by accident.
 */
const readCatalog = async (): Promise<CatalogProduct[]> => {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, dietary_tags, rating_avg, is_featured, serving_size,
       product_ingredients ( ingredients ( slug ) ),
       product_variants ( id, price_cents, is_default, is_active )`,
    )
    .eq('status', 'published')
    .is('deleted_at', null);

  if (error) {
    logger.error('biohack catalog read failed', { cause: error.message });
    return [];
  }

  const { data: stock } = await supabase.from('v_product_stock').select('variant_id, is_available');
  const available = new Set(
    ((stock ?? []) as { variant_id: string; is_available: boolean }[])
      .filter((s) => s.is_available)
      .map((s) => s.variant_id),
  );

  type Raw = {
    id: string;
    slug: string;
    dietary_tags: string[] | null;
    rating_avg: number | null;
    is_featured: boolean;
    serving_size: string | null;
    product_ingredients: { ingredients: { slug: string } | null }[];
    product_variants: {
      id: string;
      price_cents: number;
      is_default: boolean;
      is_active: boolean;
    }[];
  };

  return ((data ?? []) as unknown as Raw[]).flatMap((row) => {
    const active = (row.product_variants ?? []).filter((v) => v.is_active);
    const variant = active.find((v) => v.is_default) ?? active[0];
    if (!variant) return [];

    const servings = Number.parseInt(row.serving_size ?? '', 10);
    const perServing =
      Number.isFinite(servings) && servings > 0
        ? Math.round(variant.price_cents / servings)
        : variant.price_cents;

    return [
      {
        productId: row.id,
        slug: row.slug,
        variantId: variant.id,
        ingredientSlugs: (row.product_ingredients ?? [])
          .map((pi) => pi.ingredients?.slug)
          .filter((s): s is string => Boolean(s)),
        dietaryTags: row.dietary_tags ?? [],
        priceCents: variant.price_cents,
        pricePerServingCents: perServing,
        ratingAvg: row.rating_avg ?? 0,
        isFeatured: row.is_featured,
        inStock: available.has(variant.id),
      },
    ];
  });
};

export const getProtocolCatalog = unstable_cache(readCatalog, ['biohack-catalog'], {
  tags: [CACHE_TAGS.products],
});
