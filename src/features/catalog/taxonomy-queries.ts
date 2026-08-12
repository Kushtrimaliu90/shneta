import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField } from '@/lib/i18n';
import type { TaxonomyKind } from '@/features/catalog/taxonomy-actions';

/**
 * docs/06 §4–§7 — admin reads for brands, categories, health goals and ingredients.
 *
 * Uncached, through the SSR client, for the same reason as `admin-queries.ts`: an editor who
 * saves and is shown stale data saves again.
 *
 * Every row carries a **usage count**, because the only genuinely dangerous action on this
 * screen is hiding something products still point at. A count next to the row is what turns
 * that from a surprise into a decision.
 */

export interface Bilingual {
  sq: string;
  en: string;
}

export interface TaxonomyRow {
  id: string;
  slug: string;
  nameSq: string;
  nameEn: string;
  isActive: boolean;
  sortOrder: number;
  /** Products referencing this row. Brands count products; the rest count join rows. */
  usageCount: number;
  /** Categories only — sub-categories that would be promoted to the top level if this is hidden. */
  childCount: number;
  parentId: string | null;
  icon: string | null;
  countryCode: string | null;
  websiteUrl: string | null;
  logoPath: string | null;
  evidence: string | null;
  ingredientCategory: string | null;
  otherNames: string[];
  /** Bilingual prose keyed by form-field prefix: description, tagline, summary, benefits… */
  prose: Record<string, Bilingual>;
}

function pair(value: unknown): Bilingual {
  const field = asLocalizedField(value);
  return { sq: field?.sq ?? '', en: field?.en ?? '' };
}

/** Turns a list of foreign keys into `{ [id]: count }`. */
function tally(rows: { id: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.id) counts[row.id] = (counts[row.id] ?? 0) + 1;
  }
  return counts;
}

const EMPTY = {
  childCount: 0,
  parentId: null,
  icon: null,
  countryCode: null,
  websiteUrl: null,
  logoPath: null,
  evidence: null,
  ingredientCategory: null,
  otherNames: [] as string[],
};

/**
 * Every row of one taxonomy, with usage counts.
 *
 * Counted in JavaScript from the whole join table rather than with a correlated count per row.
 * These tables are in the hundreds — the join table for a catalogue ten times this size is still
 * a single small round trip, whereas a count per row is one query per list item.
 */
export const listTaxonomy = cache(async (kind: TaxonomyKind): Promise<TaxonomyRow[]> => {
  const supabase = await createClient();

  switch (kind) {
    case 'brand': {
      const [{ data, error }, links] = await Promise.all([
        supabase
          .from('brands')
          .select(
            'id, slug, name, description, is_active, sort_order, country_code, website_url, logo_path',
          )
          .is('deleted_at', null)
          .order('sort_order')
          .order('name'),
        supabase.from('products').select('brand_id').is('deleted_at', null),
      ]);

      if (error) {
        logger.error('listTaxonomy(brand) failed', { cause: error.message });
        return [];
      }

      const counts = tally(
        ((links.data ?? []) as { brand_id: string | null }[]).map((row) => ({ id: row.brand_id })),
      );

      return (data ?? []).map((row) => ({
        ...EMPTY,
        id: row.id,
        slug: row.slug,
        // A brand name is plain text, not jsonb — a trademark is spelled the same in both
        // languages, and offering a translation invites two spellings of it.
        nameSq: row.name,
        nameEn: '',
        isActive: row.is_active,
        sortOrder: row.sort_order,
        usageCount: counts[row.id] ?? 0,
        countryCode: row.country_code,
        websiteUrl: row.website_url,
        logoPath: row.logo_path,
        prose: { description: pair(row.description) },
      }));
    }

    case 'category': {
      const [{ data, error }, links] = await Promise.all([
        supabase
          .from('categories')
          .select('id, slug, name, description, is_active, sort_order, parent_id, icon, image_path')
          .is('deleted_at', null)
          .order('sort_order'),
        supabase.from('product_categories').select('category_id'),
      ]);

      if (error) {
        logger.error('listTaxonomy(category) failed', { cause: error.message });
        return [];
      }

      const counts = tally(
        ((links.data ?? []) as { category_id: string }[]).map((row) => ({ id: row.category_id })),
      );
      const rows = data ?? [];
      const children = tally(rows.map((row) => ({ id: row.parent_id })));

      return rows.map((row) => {
        const name = pair(row.name);
        return {
          ...EMPTY,
          /* The uploader writes image_path here; the shared EMPTY nulls it. */
          logoPath: row.image_path ?? null,
          id: row.id,
          slug: row.slug,
          nameSq: name.sq,
          nameEn: name.en,
          isActive: row.is_active,
          sortOrder: row.sort_order,
          usageCount: counts[row.id] ?? 0,
          childCount: children[row.id] ?? 0,
          parentId: row.parent_id,
          icon: row.icon,
          prose: { description: pair(row.description) },
        };
      });
    }

    case 'goal': {
      const [{ data, error }, links] = await Promise.all([
        supabase
          .from('health_goals')
          .select('id, slug, name, tagline, description, is_active, sort_order, icon, image_path')
          .order('sort_order'),
        supabase.from('product_health_goals').select('goal_id'),
      ]);

      if (error) {
        logger.error('listTaxonomy(goal) failed', { cause: error.message });
        return [];
      }

      const counts = tally(
        ((links.data ?? []) as { goal_id: string }[]).map((row) => ({ id: row.goal_id })),
      );

      return (data ?? []).map((row) => {
        const name = pair(row.name);
        return {
          ...EMPTY,
          /* The uploader writes image_path here; the shared EMPTY nulls it. */
          logoPath: row.image_path ?? null,
          id: row.id,
          slug: row.slug,
          nameSq: name.sq,
          nameEn: name.en,
          isActive: row.is_active,
          sortOrder: row.sort_order,
          usageCount: counts[row.id] ?? 0,
          icon: row.icon,
          prose: { tagline: pair(row.tagline), description: pair(row.description) },
        };
      });
    }

    case 'ingredient': {
      const [{ data, error }, links] = await Promise.all([
        supabase
          .from('ingredients')
          .select(
            'id, slug, name, summary, benefits, dosage_notes, safety_notes, evidence, category, other_names, is_active',
          )
          .order('slug'),
        supabase.from('product_ingredients').select('ingredient_id'),
      ]);

      if (error) {
        logger.error('listTaxonomy(ingredient) failed', { cause: error.message });
        return [];
      }

      const counts = tally(
        ((links.data ?? []) as { ingredient_id: string }[]).map((row) => ({
          id: row.ingredient_id,
        })),
      );

      return (data ?? []).map((row) => {
        const name = pair(row.name);
        return {
          ...EMPTY,
          id: row.id,
          slug: row.slug,
          nameSq: name.sq,
          nameEn: name.en,
          isActive: row.is_active,
          // No `sort_order` column — the A–Z list on the storefront orders by slug.
          sortOrder: 0,
          usageCount: counts[row.id] ?? 0,
          evidence: row.evidence,
          ingredientCategory: row.category,
          otherNames: row.other_names ?? [],
          prose: {
            summary: pair(row.summary),
            benefits: pair(row.benefits),
            dosage: pair(row.dosage_notes),
            safety: pair(row.safety_notes),
          },
        };
      });
    }
  }
});

/** Parent options for the category editor: id + Albanian name, active ones first. */
export async function listCategoryParents(): Promise<{ id: string; name: string }[]> {
  const rows = await listTaxonomy('category');
  return rows.map((row) => ({ id: row.id, name: row.nameSq || row.slug }));
}

/**
 * The removed brands and categories, for the bin at the foot of their screen.
 *
 * Only these two kinds: `health_goals` and `ingredients` have no `deleted_at` column, so there is
 * nothing to list. Returns the minimum a Restore row needs — a name to recognise it by and the date it
 * went — rather than reusing `TaxonomyRow`, most of which is editor state that a removed row has no use
 * for.
 */
export interface RemovedTaxonomyRow {
  id: string;
  slug: string;
  name: string;
  deletedAt: string | null;
}

export const listRemovedTaxonomy = cache(
  async (kind: 'brand' | 'category'): Promise<RemovedTaxonomyRow[]> => {
    const supabase = await createClient();
    const table = kind === 'brand' ? 'brands' : 'categories';

    const { data, error } = await supabase
      .from(table)
      .select('id, slug, name, deleted_at')
      .not('deleted_at', 'is', null)
      // Most recently removed first: the thing an operator wants back is usually the last one they lost.
      .order('deleted_at', { ascending: false })
      .limit(50);

    if (error) {
      logger.error('listRemovedTaxonomy failed', { kind, cause: error.message });
      return [];
    }

    return ((data ?? []) as { id: string; slug: string; name: unknown; deleted_at: string | null }[]).map(
      (row) => ({
        id: row.id,
        slug: row.slug,
        /*
         * A brand name is plain text and a category name is jsonb, which is why this is not
         * `pickLocale` on both. The English key first, then Albanian, then the slug — the panel is
         * English-only, and a slug is always better than an empty cell.
         */
        name:
          typeof row.name === 'string'
            ? row.name
            : ((row.name as Record<string, string> | null)?.en ??
              (row.name as Record<string, string> | null)?.sq ??
              row.slug),
        deletedAt: row.deleted_at,
      }),
    );
  },
);

/**
 * What is still attached to a removed brand or category, for the permanent-delete guard.
 *
 * Counts rows **regardless of their own removed state**: a removed product still carries a `brand_id`,
 * so destroying its brand would leave it pointing at nothing if it were ever restored. The same reasoning
 * covers a removed child category. This is the one place where "removed" must not mean "ignore".
 */
export async function taxonomyAttachments(
  kind: 'brand' | 'category',
  id: string,
): Promise<{ products: number; children: number }> {
  const supabase = await createClient();

  if (kind === 'brand') {
    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', id);
    return { products: count ?? 0, children: 0 };
  }

  const [{ count: children }, { count: products }] = await Promise.all([
    supabase.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id),
    supabase
      .from('product_categories')
      .select('product_id', { count: 'exact', head: true })
      .eq('category_id', id),
  ]);

  return { products: products ?? 0, children: children ?? 0 };
}
