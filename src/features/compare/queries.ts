import 'server-only';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';
import { servingsFrom } from '@/features/compare/constants';

/**
 * docs/05 §9 — everything the comparison table lines up.
 *
 * The **public** client, because `/compare?ids=…` is a shareable URL: the person the link was
 * sent to may not be signed in, and the table must render the same either way. RLS gives the
 * anonymous role published products only, which is also exactly what belongs behind a link
 * anyone might open.
 */

export interface CompareIngredient {
  slug: string;
  name: LocalizedField;
  amount: number | null;
  unit: string | null;
  nrvPct: number | null;
}

export interface CompareProduct {
  id: string;
  slug: string;
  name: LocalizedField;
  brandName: string;
  imagePath: string | null;
  form: string | null;
  servingSize: string | null;
  dietaryTags: string[];
  ratingAvg: number;
  ratingCount: number;
  certifications: string[];
  ingredients: CompareIngredient[];
  variantId: string | null;
  priceCents: number | null;
  compareAtPriceCents: number | null;
  inStock: boolean;
  /**
   * How many servings the pack holds, parsed out of `serving_size` when it says so.
   * `null` when the label does not carry the information — see `servingsFrom`.
   */
  servings: number | null;
}

interface RawCompare {
  id: string;
  slug: string;
  name: unknown;
  form: string | null;
  serving_size: string | null;
  dietary_tags: string[] | null;
  rating_avg: number;
  rating_count: number;
  brands: { name: string } | null;
  product_images: { storage_path: string; position: number }[];
  product_variants: {
    id: string;
    price_cents: number;
    compare_at_price_cents: number | null;
    is_default: boolean;
    is_active: boolean;
  }[];
  product_certifications: { certifications: { name: unknown } | null }[];
  product_ingredients: {
    amount: number | null;
    unit: string | null;
    nrv_pct: number | null;
    position: number;
    ingredients: { slug: string; name: unknown } | null;
  }[];
}

export async function listCompareProducts(ids: string[]): Promise<CompareProduct[]> {
  if (ids.length === 0) return [];

  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, name, form, serving_size, dietary_tags, rating_avg, rating_count,
       brands ( name ),
       product_images ( storage_path, position ),
       product_variants ( id, price_cents, compare_at_price_cents, is_default, is_active ),
       product_certifications ( certifications ( name ) ),
       product_ingredients ( amount, unit, nrv_pct, position, ingredients ( slug, name ) )`,
    )
    .in('id', ids)
    .eq('status', 'published')
    .is('deleted_at', null);

  if (error) {
    logger.error('listCompareProducts failed', { cause: error.message });
    return [];
  }

  const rows = (data ?? []) as unknown as RawCompare[];

  const variantIds = rows.flatMap((row) => {
    const active = row.product_variants.filter((variant) => variant.is_active);
    const chosen = active.find((variant) => variant.is_default) ?? active[0];
    return chosen ? [chosen.id] : [];
  });

  const stock = new Map<string, boolean>();
  if (variantIds.length > 0) {
    const { data: levels } = await supabase
      .from('v_product_stock')
      .select('variant_id, stock_status')
      .in('variant_id', variantIds);

    for (const level of (levels ?? []) as {
      variant_id: string | null;
      stock_status: string | null;
    }[]) {
      if (level.variant_id) stock.set(level.variant_id, level.stock_status !== 'out_of_stock');
    }
  }

  const products = rows.map((row): CompareProduct => {
    const active = row.product_variants.filter((variant) => variant.is_active);
    const chosen = active.find((variant) => variant.is_default) ?? active[0];
    const images = [...row.product_images].sort((a, b) => a.position - b.position);

    return {
      id: row.id,
      slug: row.slug,
      name: asLocalizedField(row.name),
      brandName: row.brands?.name ?? '',
      imagePath: images[0]?.storage_path ?? null,
      form: row.form,
      servingSize: row.serving_size,
      dietaryTags: row.dietary_tags ?? [],
      ratingAvg: Number(row.rating_avg ?? 0),
      ratingCount: Number(row.rating_count ?? 0),
      certifications: row.product_certifications.flatMap((link) => {
        const name = asLocalizedField(link.certifications?.name);
        const label = name?.en ?? name?.sq;
        return label ? [label] : [];
      }),
      ingredients: [...row.product_ingredients]
        .sort((a, b) => a.position - b.position)
        .flatMap((link) =>
          link.ingredients
            ? [
                {
                  slug: link.ingredients.slug,
                  name: asLocalizedField(link.ingredients.name),
                  amount: link.amount === null ? null : Number(link.amount),
                  unit: link.unit,
                  nrvPct: link.nrv_pct === null ? null : Number(link.nrv_pct),
                },
              ]
            : [],
        ),
      variantId: chosen?.id ?? null,
      priceCents: chosen?.price_cents ?? null,
      compareAtPriceCents: chosen?.compare_at_price_cents ?? null,
      inStock: chosen ? (stock.get(chosen.id) ?? false) : false,
      servings: servingsFrom(row.serving_size),
    };
  });

  /*
   * Returned in the order the URL asked for.
   *
   * `in()` returns rows in whatever order Postgres finds them, so without this the columns
   * reshuffle between renders of the same link — and docs/05 §9 requires a shareable URL to
   * reproduce the table, which includes which product is in which column.
   */
  return ids.flatMap((id) => {
    const found = products.find((product) => product.id === id);
    return found ? [found] : [];
  });
}
