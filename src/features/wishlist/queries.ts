import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';
import { getCurrentUser } from '@/features/auth/queries';

/**
 * docs/05 §14 — the saved products.
 *
 * Scoped by RLS (`p_own on wishlist_items`), not by a filter here. The embedded product read is
 * scoped by the catalogue policy in turn, so a product that has since been unpublished simply
 * comes back null and is dropped — a wishlist quietly loses an item rather than rendering a
 * card that leads to a 404.
 */

export interface WishlistEntry {
  productId: string;
  slug: string;
  name: LocalizedField;
  brandName: string;
  imagePath: string | null;
  priceCents: number | null;
  compareAtPriceCents: number | null;
  variantId: string | null;
  inStock: boolean;
  addedAt: string;
}

interface RawEntry {
  product_id: string;
  created_at: string;
  products: {
    slug: string;
    name: unknown;
    brands: { name: string } | null;
    product_images: { storage_path: string; position: number }[];
    product_variants: {
      id: string;
      price_cents: number;
      compare_at_price_cents: number | null;
      is_default: boolean;
      is_active: boolean;
    }[];
  } | null;
}

export async function listWishlist(): Promise<WishlistEntry[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('wishlist_items')
    .select(
      `product_id, created_at,
       products (
         slug, name,
         brands ( name ),
         product_images ( storage_path, position ),
         product_variants ( id, price_cents, compare_at_price_cents, is_default, is_active )
       )`,
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('listWishlist failed', { cause: error.message });
    return [];
  }

  const rows = (data ?? []) as unknown as RawEntry[];
  const entries: WishlistEntry[] = [];

  /*
   * Stock is one extra query for the whole list rather than one per row. `v_product_stock` is
   * the same view the PLP and PDP read, so "in stock" means the same thing in all three places.
   */
  const variantIds = rows.flatMap((row) => {
    const active = (row.products?.product_variants ?? []).filter((variant) => variant.is_active);
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

  for (const row of rows) {
    const product = row.products;
    if (!product) continue;

    const active = product.product_variants.filter((variant) => variant.is_active);
    const chosen = active.find((variant) => variant.is_default) ?? active[0];
    const images = [...product.product_images].sort((a, b) => a.position - b.position);

    entries.push({
      productId: row.product_id,
      slug: product.slug,
      name: asLocalizedField(product.name),
      brandName: product.brands?.name ?? '',
      imagePath: images[0]?.storage_path ?? null,
      priceCents: chosen?.price_cents ?? null,
      compareAtPriceCents: chosen?.compare_at_price_cents ?? null,
      variantId: chosen?.id ?? null,
      inStock: chosen ? (stock.get(chosen.id) ?? false) : false,
      addedAt: row.created_at,
    });
  }

  return entries;
}
