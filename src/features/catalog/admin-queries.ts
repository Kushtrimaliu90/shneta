import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { LocalizedField } from '@/lib/i18n';

/**
 * docs/06 §3 — catalogue reads for the admin panel.
 *
 * Separate from `features/catalog/queries.ts`, which serves the storefront, because the two
 * want opposite things. The storefront reads *published* products through `search_products`
 * with facets and ranking; the admin reads **every** product including drafts and archived
 * ones, needs the fields a customer never sees (cost, approval state, why publishing is
 * blocked), and must not be cached — an editor who saves and sees stale data will save again.
 *
 * Through the SSR client, so RLS decides. A content manager reaching `/admin/products` gets
 * nothing rather than a forbidden page; the page's own capability check sends them away first.
 */

export interface AdminProductRow {
  id: string;
  slug: string;
  name: LocalizedField;
  status: string;
  brandName: string;
  variantCount: number;
  imageCount: number;
  priceFromCents: number | null;
  isFeatured: boolean;
  updatedAt: string;
}

interface RawRow {
  id: string;
  slug: string;
  name: LocalizedField;
  status: string;
  is_featured: boolean;
  updated_at: string;
  brands: { name: string } | null;
  product_variants: { price_cents: number; is_active: boolean }[];
  product_images: { id: string }[];
}

const LIST_SELECT = `id, slug, name, status, is_featured, updated_at,
  brands ( name ),
  product_variants ( price_cents, is_active ),
  product_images ( id )`;

/** The `product_status` enum from docs/03 §1, narrowed so `.eq('status', …)` typechecks. */
export const PRODUCT_STATUSES = ['draft', 'pending_review', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function toProductStatus(value: string | null | undefined): ProductStatus | undefined {
  return (PRODUCT_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ProductStatus)
    : undefined;
}

export interface ProductFilters {
  status?: ProductStatus;
  search?: string;
}

export async function listAdminProducts(filters: ProductFilters): Promise<AdminProductRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('products')
    .select(LIST_SELECT)
    // Soft-deleted rows are excluded everywhere; "archived" is a status and stays visible,
    // because an archived product is something an operator may want to restore.
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (filters.status) query = query.eq('status', filters.status);

  if (filters.search) {
    // Same PostgREST-grammar escaping as the orders list: a stray comma would split the
    // expression and silently search for something else.
    const safe = filters.search.replace(/[,()*]/g, ' ').trim();
    if (safe)
      query = query.or(`slug.ilike.%${safe}%,name->>sq.ilike.%${safe}%,name->>en.ilike.%${safe}%`);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('listAdminProducts failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const activePrices = row.product_variants
      .filter((variant) => variant.is_active)
      .map((variant) => variant.price_cents);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      brandName: row.brands?.name ?? '—',
      variantCount: row.product_variants.filter((variant) => variant.is_active).length,
      imageCount: row.product_images.length,
      priceFromCents: activePrices.length > 0 ? Math.min(...activePrices) : null,
      isFeatured: row.is_featured,
      updatedAt: row.updated_at,
    };
  });
}

export async function countAdminProductsByStatus(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('products').select('status').is('deleted_at', null);

  if (error) {
    logger.error('countAdminProductsByStatus failed', { cause: error.message });
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    counts.all = (counts.all ?? 0) + 1;
  }
  return counts;
}

export interface AdminVariant {
  id: string;
  sku: string;
  name: LocalizedField;
  priceCents: number;
  compareAtPriceCents: number | null;
  isActive: boolean;
  isDefault: boolean;
  position: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  brandId: string;
  name: LocalizedField;
  subtitle: LocalizedField;
  description: LocalizedField;
  howToUse: LocalizedField;
  warnings: LocalizedField;
  form: string | null;
  servingSize: string | null;
  dietaryTags: string[];
  status: string;
  isFeatured: boolean;
  publishedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  variants: AdminVariant[];
  imageCount: number;
  primaryCategoryId: string | null;
  categoryIds: string[];
  goalIds: string[];
  /** Every reason this product cannot be published right now, in the order to fix them. */
  publishBlockers: string[];
}

interface RawProduct {
  id: string;
  slug: string;
  brand_id: string;
  name: LocalizedField;
  subtitle: LocalizedField;
  description: LocalizedField;
  how_to_use: LocalizedField;
  warnings: LocalizedField;
  form: string | null;
  serving_size: string | null;
  dietary_tags: string[];
  status: string;
  is_featured: boolean;
  published_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  product_variants: {
    id: string;
    sku: string;
    name: LocalizedField;
    price_cents: number;
    compare_at_price_cents: number | null;
    is_active: boolean;
    is_default: boolean;
    position: number;
  }[];
  product_images: { id: string }[];
  product_categories: { category_id: string; is_primary: boolean }[];
  product_health_goals: { goal_id: string }[];
}

export const getAdminProduct = cache(async (id: string): Promise<AdminProduct | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, brand_id, name, subtitle, description, how_to_use, warnings, form,
       serving_size, dietary_tags, status, is_featured, published_at, approved_by, approved_at,
       product_variants ( id, sku, name, price_cents, compare_at_price_cents, is_active, is_default, position ),
       product_images ( id ),
       product_categories ( category_id, is_primary ),
       product_health_goals ( goal_id )`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    logger.error('getAdminProduct failed', { cause: error.message });
    return null;
  }
  if (!data) return null;

  const raw = data as unknown as RawProduct;
  const activeVariants = raw.product_variants.filter((variant) => variant.is_active);
  const primary = raw.product_categories.find((link) => link.is_primary);

  /*
   * The blockers are computed here, from the same four conditions `guard_product_publish`
   * enforces, and shown in the editor as a checklist.
   *
   * That is duplication, and it is the right kind: the trigger is the rule and this is the
   * explanation. Without it the operator learns what is missing one item at a time, by trying
   * to publish and reading an exception — four round trips to discover four things. They are
   * side by side in the source so a change to one is an obvious prompt to change the other.
   */
  const publishBlockers: string[] = [];
  if (activeVariants.length === 0) publishBlockers.push('Add at least one active variant');
  if (raw.product_images.length === 0) publishBlockers.push('Add at least one image');
  if (!primary) publishBlockers.push('Choose a primary category');
  if (!raw.approved_by) publishBlockers.push('Needs compliance approval');

  return {
    id: raw.id,
    slug: raw.slug,
    brandId: raw.brand_id,
    name: raw.name,
    subtitle: raw.subtitle,
    description: raw.description,
    howToUse: raw.how_to_use,
    warnings: raw.warnings,
    form: raw.form,
    servingSize: raw.serving_size,
    dietaryTags: raw.dietary_tags,
    status: raw.status,
    isFeatured: raw.is_featured,
    publishedAt: raw.published_at,
    approvedBy: raw.approved_by,
    approvedAt: raw.approved_at,
    variants: [...raw.product_variants]
      .sort((a, b) => a.position - b.position)
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        priceCents: variant.price_cents,
        compareAtPriceCents: variant.compare_at_price_cents,
        isActive: variant.is_active,
        isDefault: variant.is_default,
        position: variant.position,
      })),
    imageCount: raw.product_images.length,
    primaryCategoryId: primary?.category_id ?? null,
    categoryIds: raw.product_categories.map((link) => link.category_id),
    goalIds: raw.product_health_goals.map((link) => link.goal_id),
    publishBlockers,
  };
});

/** Options for the brand, category and goal selects. Small tables; read whole. */
export const getEditorOptions = cache(
  async (): Promise<{
    brands: { id: string; name: string }[];
    categories: { id: string; name: LocalizedField }[];
    goals: { id: string; name: LocalizedField }[];
  }> => {
    const supabase = await createClient();

    const [brands, categories, goals] = await Promise.all([
      supabase.from('brands').select('id, name').order('name'),
      // `sort_order`, not `position` — the column is named differently here than on
      // shipping_methods, and the first version of this ordered by a column that does not
      // exist. See the note below on why that was so hard to see.
      supabase.from('categories').select('id, name').order('sort_order'),
      supabase.from('health_goals').select('id, name').order('sort_order'),
    ]);

    /*
     * Failures are logged, not swallowed.
     *
     * These three used to be `data ?? []`, so a query that errored produced an empty select
     * with no trace anywhere. The symptom was an editor whose category list simply was not
     * there, and a test that hung for ninety seconds waiting for a checkbox — neither of which
     * points at "you ordered by a column that does not exist".
     *
     * Returning `[]` on failure is still right: a broken options list should not take the whole
     * editor down when the rest of it is fine. But it has to say so.
     */
    for (const [table, result] of [
      ['brands', brands],
      ['categories', categories],
      ['health_goals', goals],
    ] as const) {
      if (result.error) {
        logger.error('Editor options query failed', { table, cause: result.error.message });
      }
    }

    return {
      brands: (brands.data ?? []) as { id: string; name: string }[],
      categories: (categories.data ?? []) as { id: string; name: LocalizedField }[],
      goals: (goals.data ?? []) as { id: string; name: LocalizedField }[],
    };
  },
);
