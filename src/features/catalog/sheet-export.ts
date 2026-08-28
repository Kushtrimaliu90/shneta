import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { fromCents } from '@/lib/money';
import type { ProductExportRow, VariantExportRow } from '@/lib/sheet/product-workbook';

/**
 * Reading the whole catalogue out, in the shape a spreadsheet wants.
 *
 * The row shapes themselves live in `lib/sheet/product-workbook.ts`, which owns what a cell is — `lib/` is
 * a dependency leaf and cannot import from here, so the contract points that way and this satisfies it.
 *
 * A separate module from `admin-queries.ts` because the shape is different in kind: everything here is a
 * **string destined for a cell**, flattened out of jsonb and out of five join tables, rather than the typed
 * objects the editor renders. Mixing the two would mean one file where `name` is sometimes an object and
 * sometimes two columns.
 *
 * ── Slugs, not UUIDs ──
 *
 * The brand, categories and goals come out as **slugs**. A cell reading `vitaminat, mineralet` is one
 * somebody can edit; a cell of UUIDs is one they can only corrupt. The importer resolves them back, and an
 * unknown slug becomes a named error on a named row — which a mistyped UUID never could.
 *
 * ── Five flat reads, not one nested embed ──
 *
 * A nested PostgREST embed across several relations returned empty in this codebase before, and did it
 * *silently* (docs/13 §AJ). That is the failure mode least acceptable on the read that feeds a file people
 * will edit and send back: a missing category would look like a deliberate blank and the import would
 * clear it. Five keyed reads are boring and verifiable, and the catalogue is seventy rows.
 */

/** `{sq, en}` read defensively — a missing locale is a blank cell, never a crash. */
function pair(value: unknown): { sq: string; en: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { sq: '', en: '' };
  const record = value as Record<string, unknown>;
  return {
    sq: typeof record.sq === 'string' ? record.sq : '',
    en: typeof record.en === 'string' ? record.en : '',
  };
}

function group<T>(list: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of list) {
    const id = key(row);
    out.set(id, [...(out.get(id) ?? []), row]);
  }
  return out;
}

/**
 * Every product an operator can see in the list, with every field they can change.
 *
 * Removed products are excluded, matching the list. A file that quietly contained rows the panel does not
 * show would be a file whose edits appear to do nothing.
 */
export async function productExportRows(): Promise<{
  products: ProductExportRow[];
  variants: VariantExportRow[];
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, status, name, subtitle, description, how_to_use, warnings, form, serving_size,
       dietary_tags, is_featured, seo, brands ( slug )`,
    )
    .is('deleted_at', null)
    .order('slug');

  if (error) {
    logger.error('productExportRows failed', { cause: error.message });
    return { products: [], variants: [] };
  }

  interface Raw {
    id: string;
    slug: string;
    status: string;
    name: unknown;
    subtitle: unknown;
    description: unknown;
    how_to_use: unknown;
    warnings: unknown;
    form: string | null;
    serving_size: string | null;
    dietary_tags: string[] | null;
    is_featured: boolean;
    seo: unknown;
    brands: { slug: string } | null;
  }

  const rows = (data ?? []) as unknown as Raw[];
  if (rows.length === 0) return { products: [], variants: [] };
  const ids = rows.map((row) => row.id);

  const [variants, categoryLinks, goalLinks, images, categories, goals] = await Promise.all([
    supabase
      .from('product_variants')
      .select('product_id, sku, name, price_cents, compare_at_price_cents, is_active, is_default')
      .in('product_id', ids)
      .order('sku'),
    supabase
      .from('product_categories')
      .select('product_id, category_id, is_primary')
      .in('product_id', ids),
    supabase.from('product_health_goals').select('product_id, goal_id').in('product_id', ids),
    supabase.from('product_images').select('product_id').in('product_id', ids),
    supabase.from('categories').select('id, slug'),
    supabase.from('health_goals').select('id, slug'),
  ]);

  const categorySlug = new Map(
    ((categories.data ?? []) as { id: string; slug: string }[]).map((row) => [row.id, row.slug]),
  );
  const goalSlug = new Map(
    ((goals.data ?? []) as { id: string; slug: string }[]).map((row) => [row.id, row.slug]),
  );

  const linkedCategories = group(
    (categoryLinks.data ?? []) as {
      product_id: string;
      category_id: string;
      is_primary: boolean;
    }[],
    (row) => row.product_id,
  );
  const linkedGoals = group(
    (goalLinks.data ?? []) as { product_id: string; goal_id: string }[],
    (row) => row.product_id,
  );
  const productImages = group(
    (images.data ?? []) as { product_id: string }[],
    (row) => row.product_id,
  );
  const productVariants = group(
    (variants.data ?? []) as {
      product_id: string;
      sku: string;
      name: unknown;
      price_cents: number;
      compare_at_price_cents: number | null;
      is_active: boolean;
      is_default: boolean;
    }[],
    (row) => row.product_id,
  );

  const products: ProductExportRow[] = rows.map((row) => {
    const name = pair(row.name);
    const subtitle = pair(row.subtitle);
    const description = pair(row.description);
    const howToUse = pair(row.how_to_use);
    const warnings = pair(row.warnings);
    const seo = (row.seo ?? {}) as { title?: unknown; description?: unknown };
    const seoTitle = pair(seo.title);
    const seoDescription = pair(seo.description);

    const links = linkedCategories.get(row.id) ?? [];
    const primary = links.find((link) => link.is_primary);

    return {
      id: row.id,
      slug: row.slug,
      status: row.status,
      brandSlug: row.brands?.slug ?? '',
      nameSq: name.sq,
      nameEn: name.en,
      subtitleSq: subtitle.sq,
      subtitleEn: subtitle.en,
      descriptionSq: description.sq,
      descriptionEn: description.en,
      howToUseSq: howToUse.sq,
      howToUseEn: howToUse.en,
      warningsSq: warnings.sq,
      warningsEn: warnings.en,
      form: row.form ?? '',
      servingSize: row.serving_size ?? '',
      dietaryTags: (row.dietary_tags ?? []).join(', '),
      categorySlugs: links
        .flatMap((link) => {
          const slug = categorySlug.get(link.category_id);
          return slug ? [slug] : [];
        })
        .join(', '),
      primaryCategorySlug: primary ? (categorySlug.get(primary.category_id) ?? '') : '',
      goalSlugs: (linkedGoals.get(row.id) ?? [])
        .flatMap((link) => {
          const slug = goalSlug.get(link.goal_id);
          return slug ? [slug] : [];
        })
        .join(', '),
      isFeatured: row.is_featured,
      seoTitleSq: seoTitle.sq,
      seoTitleEn: seoTitle.en,
      seoDescriptionSq: seoDescription.sq,
      seoDescriptionEn: seoDescription.en,
      variantCount: (productVariants.get(row.id) ?? []).length,
      imageCount: (productImages.get(row.id) ?? []).length,
    };
  });

  const variantRows: VariantExportRow[] = rows.flatMap((row) =>
    (productVariants.get(row.id) ?? []).map((variant) => {
      const name = pair(variant.name);
      return {
        productSlug: row.slug,
        sku: variant.sku,
        nameSq: name.sq,
        nameEn: name.en,
        price: fromCents(variant.price_cents),
        compareAtPrice:
          variant.compare_at_price_cents == null ? '' : fromCents(variant.compare_at_price_cents),
        isActive: variant.is_active,
        isDefault: variant.is_default,
      };
    }),
  );

  return { products, variants: variantRows };
}
