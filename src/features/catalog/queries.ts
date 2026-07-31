import 'server-only';
import { cache } from 'react';
import { createPublicClient } from '@/lib/supabase/public';
import { asLocalizedField } from '@/lib/i18n';
import { logger } from '@/lib/logger';
import {
  PRODUCTS_PER_PAGE,
  type CategoryNode,
  type ProductDetail,
  type ProductFilters,
  type ProductListItem,
  type ProductListResult,
  type StockStatus,
} from '@/features/catalog/types';

/**
 * Catalog reads (docs/02 §7 — reads live in `queries.ts`).
 *
 * All of these use the **public** client: catalog pages are static/ISR (docs/02 §5), and
 * the cookie-reading server client would force them dynamic (docs/13 §G1). RLS still
 * applies as the anonymous role, so unpublished products are invisible here by policy
 * rather than by a `where` clause anyone could forget.
 *
 * `cache()` dedupes within a single render — a layout, a page and `generateMetadata` asking
 * for the same product share one round trip.
 */

function toRecord(value: unknown): Record<string, string> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (typeof inner === 'string') out[key] = inner;
  }
  return out;
}

function emptyList(page: number): ProductListResult {
  return { items: [], total: 0, page, pageCount: 0 };
}

/**
 * docs/05 §2 — one query serves PLP, category, brand, goal, ingredient and search, so the
 * filter, sort and pagination semantics cannot diverge between those surfaces.
 */
export const listProducts = cache(
  async (filters: ProductFilters = {}): Promise<ProductListResult> => {
    const page = Math.max(1, filters.page ?? 1);
    const supabase = createPublicClient();

    const { data, error } = await supabase.rpc('search_products', {
      p_query: filters.q ?? undefined,
      p_category_slugs: filters.category?.length ? filters.category : undefined,
      p_brand_slugs: filters.brand?.length ? filters.brand : undefined,
      p_goal_slugs: filters.goal?.length ? filters.goal : undefined,
      p_ingredient_slugs: filters.ingredient?.length ? filters.ingredient : undefined,
      p_dietary_tags: filters.tag?.length ? filters.tag : undefined,
      p_forms: undefined,
      p_min_price_cents: filters.minPrice ?? undefined,
      p_max_price_cents: filters.maxPrice ?? undefined,
      p_min_rating: filters.minRating ?? undefined,
      p_in_stock_only: filters.inStock ?? false,
      p_on_sale_only: filters.onSale ?? false,
      p_sort: filters.sort ?? 'relevance',
      p_limit: PRODUCTS_PER_PAGE,
      p_offset: (page - 1) * PRODUCTS_PER_PAGE,
    });

    if (error) {
      logger.error('search_products failed', { cause: error.message });
      return emptyList(page);
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    // `total_count` rides along as a window function, so the count costs no second query.
    const total = Number(rows[0]?.total_count ?? 0);

    const items: ProductListItem[] = rows.map((row) => ({
      id: String(row.product_id),
      slug: String(row.slug),
      name: asLocalizedField(row.name),
      subtitle: asLocalizedField(row.subtitle),
      brandName: String(row.brand_name ?? ''),
      brandSlug: String(row.brand_slug ?? ''),
      form: row.form == null ? null : String(row.form),
      dietaryTags: Array.isArray(row.dietary_tags) ? (row.dietary_tags as string[]) : [],
      ratingAvg: Number(row.rating_avg ?? 0),
      ratingCount: Number(row.rating_count ?? 0),
      isFeatured: Boolean(row.is_featured),
      variantId: String(row.variant_id),
      sku: String(row.sku),
      priceCents: Number(row.price_cents ?? 0),
      compareAtPriceCents:
        row.compare_at_price_cents == null ? null : Number(row.compare_at_price_cents),
      imagePath: row.image_path == null ? null : String(row.image_path),
      inStock: Boolean(row.in_stock),
    }));

    return {
      items,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
    };
  },
);

/** docs/05 §3 — everything the PDP renders, in one round trip. */
export const getProduct = cache(async (slug: string): Promise<ProductDetail | null> => {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, name, subtitle, description, how_to_use, warnings, form, serving_size,
       dietary_tags, rating_avg, rating_count, updated_at,
       brands!inner ( slug, name ),
       product_variants ( id, sku, name, options, price_cents, compare_at_price_cents, is_default, position, is_active ),
       product_images ( storage_path, alt, position ),
       product_categories ( is_primary, categories ( slug, name ) ),
       product_health_goals ( health_goals ( slug, name ) ),
       product_certifications ( certifications ( slug, name ) ),
       product_ingredients ( amount, unit, nrv_pct, position, ingredients ( slug, name, evidence ) )`,
    )
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    logger.error('getProduct failed', { slug, cause: error.message });
    return null;
  }
  if (!data) return null;

  /*
   * One cast, at the boundary. PostgREST's nested-select types do not survive inference
   * through five embedded relations, so the shape is declared once here and everything
   * downstream is fully typed.
   */
  const record = data as unknown as {
    id: string;
    slug: string;
    name: unknown;
    subtitle: unknown;
    description: unknown;
    how_to_use: unknown;
    warnings: unknown;
    form: string | null;
    serving_size: string | null;
    dietary_tags: string[] | null;
    rating_avg: number;
    rating_count: number;
    updated_at: string;
    brands: { slug: string; name: string };
    product_variants: {
      id: string;
      sku: string;
      name: unknown;
      options: unknown;
      price_cents: number;
      compare_at_price_cents: number | null;
      is_default: boolean;
      position: number;
      is_active: boolean;
    }[];
    product_images: { storage_path: string; alt: unknown; position: number }[];
    product_categories: {
      is_primary: boolean;
      categories: { slug: string; name: unknown } | null;
    }[];
    product_health_goals: { health_goals: { slug: string; name: unknown } | null }[];
    product_certifications: { certifications: { slug: string; name: unknown } | null }[];
    product_ingredients: {
      amount: number | null;
      unit: string | null;
      nrv_pct: number | null;
      position: number;
      ingredients: { slug: string; name: unknown; evidence: string | null } | null;
    }[];
  };

  // Stock comes from the bucketed view, never from inventory_levels — exact counts are
  // staff-only (docs/13 §B7).
  const variantIds = record.product_variants.filter((v) => v.is_active).map((v) => v.id);
  const stockByVariant = new Map<string, StockStatus>();

  if (variantIds.length > 0) {
    const { data: stock } = await supabase
      .from('v_product_stock')
      .select('variant_id, stock_status')
      .in('variant_id', variantIds);

    for (const entry of (stock ?? []) as { variant_id: string; stock_status: string }[]) {
      stockByVariant.set(entry.variant_id, entry.stock_status as StockStatus);
    }
  }

  const primary = record.product_categories.find((link) => link.is_primary)?.categories ?? null;

  return {
    id: record.id,
    slug: record.slug,
    name: asLocalizedField(record.name),
    subtitle: asLocalizedField(record.subtitle),
    description: asLocalizedField(record.description),
    howToUse: asLocalizedField(record.how_to_use),
    warnings: asLocalizedField(record.warnings),
    form: record.form,
    servingSize: record.serving_size,
    dietaryTags: record.dietary_tags ?? [],
    ratingAvg: Number(record.rating_avg ?? 0),
    ratingCount: Number(record.rating_count ?? 0),
    updatedAt: record.updated_at,
    brand: { slug: record.brands.slug, name: record.brands.name },
    primaryCategory: primary ? { slug: primary.slug, name: asLocalizedField(primary.name) } : null,
    variants: record.product_variants
      .filter((variant) => variant.is_active)
      .sort((a, b) => a.position - b.position)
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: asLocalizedField(variant.name),
        options: toRecord(variant.options),
        priceCents: variant.price_cents,
        compareAtPriceCents: variant.compare_at_price_cents,
        isDefault: variant.is_default,
        stockStatus: stockByVariant.get(variant.id) ?? 'out_of_stock',
      })),
    /*
     * `flatMap` with an early `[]` rather than `filter(...).map(x => x.rel!.slug)`:
     * non-null assertions are banned (CLAUDE.md §1), and a filter does not narrow the type
     * for the map that follows anyway.
     */
    ingredients: [...record.product_ingredients]
      .sort((a, b) => a.position - b.position)
      .flatMap((link) => {
        const ingredient = link.ingredients;
        if (!ingredient) return [];
        return [
          {
            slug: ingredient.slug,
            name: asLocalizedField(ingredient.name),
            amount: link.amount === null ? null : Number(link.amount),
            unit: link.unit,
            nrvPct: link.nrv_pct === null ? null : Number(link.nrv_pct),
            evidence: ingredient.evidence,
          },
        ];
      }),
    goals: record.product_health_goals.flatMap((link) => {
      const goal = link.health_goals;
      return goal ? [{ slug: goal.slug, name: asLocalizedField(goal.name) }] : [];
    }),
    certifications: record.product_certifications.flatMap((link) => {
      const certification = link.certifications;
      return certification
        ? [{ slug: certification.slug, name: asLocalizedField(certification.name) }]
        : [];
    }),
    images: [...record.product_images]
      .sort((a, b) => a.position - b.position)
      .map((image) => ({ path: image.storage_path, alt: asLocalizedField(image.alt) })),
  };
});

/** The category tree for the mega menu, PLP sidebar and breadcrumbs. */
export const getCategoryTree = cache(async (): Promise<CategoryNode[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, description, parent_id, sort_order')
    .order('sort_order');

  if (error) {
    logger.error('getCategoryTree failed', { cause: error.message });
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    slug: string;
    name: unknown;
    description: unknown;
    parent_id: string | null;
  }[];

  const nodes = new Map<string, CategoryNode>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        slug: row.slug,
        name: asLocalizedField(row.name),
        description: asLocalizedField(row.description),
        parentId: row.parent_id,
        children: [],
      },
    ]),
  );

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
});

export const getCategoryBySlug = cache(async (slug: string): Promise<CategoryNode | null> => {
  const tree = await getCategoryTree();
  const walk = (nodes: CategoryNode[]): CategoryNode | null => {
    for (const node of nodes) {
      if (node.slug === slug) return node;
      const found = walk(node.children);
      if (found) return found;
    }
    return null;
  };
  return walk(tree);
});

export const listBrands = cache(async () => {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('brands')
    .select('slug, name, country_code, logo_path')
    .order('sort_order');
  return (data ?? []) as {
    slug: string;
    name: string;
    country_code: string | null;
    logo_path: string | null;
  }[];
});

export const listGoals = cache(async () => {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('health_goals')
    .select('slug, name, tagline, icon')
    .order('sort_order');
  return (data ?? []).map((row) => {
    const goal = row as { slug: string; name: unknown; tagline: unknown; icon: string | null };
    return {
      slug: goal.slug,
      name: asLocalizedField(goal.name),
      tagline: asLocalizedField(goal.tagline),
      icon: goal.icon,
    };
  });
});

/** Bestsellers for the home page. docs/05 §1 falls back to `is_featured` before sales exist. */
export const listFeaturedProducts = cache(async (limit = 8): Promise<ProductListItem[]> => {
  const featured = await listProducts({ sort: 'rating' });
  const sorted = [...featured.items].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured));
  return sorted.slice(0, limit);
});
