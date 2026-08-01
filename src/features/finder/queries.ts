import 'server-only';
import { unstable_cache } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/public';
import { CACHE_TAGS, ISR_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { mapProductRow } from '@/features/catalog/queries';
import type { ProductListItem } from '@/features/catalog/types';
import type { Candidate } from '@/features/finder/scoring';

/**
 * docs/05 §10 — the candidate pool the finder scores.
 *
 * One cached read of the whole published catalogue rather than a query per answer combination.
 * The catalogue is two dozen products and the scoring is pure, so filtering in TypeScript is
 * both faster than a round trip and — more importantly — the thing the unit tests exercise. A
 * finder whose rules live half in SQL and half in code has rules nobody can test.
 *
 * Cached under `CACHE_TAGS.products`, so publishing a product or receiving stock (both of which
 * purge that tag) is reflected on the next request.
 */
const readCandidates = async (): Promise<Candidate[]> => {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, dietary_tags, form, rating_avg, rating_count, is_featured,
       product_health_goals ( health_goals ( slug ) ),
       product_variants ( price_cents, is_default, is_active )`,
    )
    .eq('status', 'published')
    .is('deleted_at', null);

  if (error) {
    logger.error('finder candidates failed', { cause: error.message });
    return [];
  }

  type Raw = {
    id: string;
    slug: string;
    dietary_tags: string[] | null;
    form: string | null;
    rating_avg: number | null;
    rating_count: number | null;
    is_featured: boolean;
    product_health_goals: { health_goals: { slug: string } | null }[];
    product_variants: { price_cents: number; is_default: boolean; is_active: boolean }[];
  };

  const rows = (data ?? []) as unknown as Raw[];

  /*
   * Stock is read separately through `v_product_stock`, the security-definer view that exposes a
   * bucket rather than a count (docs/03). Embedding `inventory_levels` here would fail — it is
   * staff-only — and this read is anonymous by design.
   */
  const { data: stock } = await supabase.from('v_product_stock').select('variant_id, is_available');
  const available = new Set(
    ((stock ?? []) as { variant_id: string; is_available: boolean }[])
      .filter((row) => row.is_available)
      .map((row) => row.variant_id),
  );

  const { data: variantMap } = await supabase
    .from('product_variants')
    .select('id, product_id')
    .eq('is_active', true);

  const inStockProducts = new Set(
    ((variantMap ?? []) as { id: string; product_id: string }[])
      .filter((row) => available.has(row.id))
      .map((row) => row.product_id),
  );

  return rows.map((row) => {
    const activeVariants = (row.product_variants ?? []).filter((v) => v.is_active);
    const defaultVariant = activeVariants.find((v) => v.is_default) ?? activeVariants[0];

    return {
      productId: row.id,
      slug: row.slug,
      goalSlugs: (row.product_health_goals ?? [])
        .map((link) => link.health_goals?.slug)
        .filter((slug): slug is string => Boolean(slug)),
      dietaryTags: row.dietary_tags ?? [],
      form: row.form,
      ratingAvg: row.rating_avg ?? 0,
      ratingCount: row.rating_count ?? 0,
      inStock: inStockProducts.has(row.id),
      priceCents: defaultVariant?.price_cents ?? 0,
      isFeatured: row.is_featured,
    };
  });
};

export const getFinderCandidates = unstable_cache(readCandidates, ['finder-candidates'], {
  tags: [CACHE_TAGS.products],
  revalidate: ISR_REVALIDATE_SECONDS,
});

export interface FinderGoal {
  slug: string;
  name: unknown;
  icon: string | null;
}

/** The goals offered in steps 1 and 2, in the order the taxonomy defines. */
const readFinderGoals = async (): Promise<FinderGoal[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('health_goals')
    .select('slug, name, icon')
    .eq('is_active', true)
    .order('sort_order');

  if (error) {
    logger.error('finder goals failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({ slug: row.slug, name: row.name, icon: row.icon }));
};

export const getFinderGoals = unstable_cache(readFinderGoals, ['finder-goals'], {
  tags: [CACHE_TAGS.goals],
  revalidate: ISR_REVALIDATE_SECONDS,
});

/**
 * The product cards for one routine, in the routine's order.
 *
 * Through the same `search_products` RPC the shop listing uses, so a card here carries exactly
 * what a card anywhere else does — price, image, rating, stock badge. The limit is raised
 * because a routine's five products can sit anywhere in the catalogue, and the alternative
 * (paging until they are all found) is several round trips to answer a question one can.
 */
export async function getRoutineProducts(productIds: string[]): Promise<ProductListItem[]> {
  if (productIds.length === 0) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('search_products', {
    p_sort: 'rating',
    p_limit: 250,
    p_offset: 0,
  });

  if (error) {
    logger.error('finder routine products failed', { cause: error.message });
    return [];
  }

  const byId = new Map(
    ((data ?? []) as unknown as Record<string, unknown>[])
      .map(mapProductRow)
      .map((item) => [item.id, item]),
  );

  // Reordered to match the routine — the RPC sorts by rating, the routine by score.
  return productIds
    .map((id) => byId.get(id))
    .filter((item): item is ProductListItem => item !== undefined);
}
