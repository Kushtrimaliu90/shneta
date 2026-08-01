'use server';

import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';
import { listProducts } from '@/features/catalog/queries';
import { MIN_QUERY_LENGTH } from '@/features/search/constants';

/**
 * docs/05 §8 — the instant search overlay.
 *
 * `searchQuick` is a **read** exposed as a server action, because the overlay is a client
 * component typing into a debounced box. It touches nothing and returns only published,
 * anonymous-readable rows, so exposing it as a POST endpoint costs nothing beyond what the
 * `/search` page already renders.
 *
 * Products come through `search_products`, the same RPC the shop grid uses, so the overlay and
 * the results page rank identically — and typo tolerance (FTS with a trigram fallback) comes
 * along for free. "vitamn c" finds Vitamin C because the RPC says so, not because this file
 * does anything clever.
 *
 * **Articles are absent, deliberately.** docs/05 §8 lists them as the second result group, and
 * `/knowledge/[slug]` does not exist until M8 — so an article result would be a link to a 404.
 * Ingredients take their place; they have real pages and a shopper searching "magnesium" is
 * often looking for the ingredient rather than one product.
 */

export interface QuickProduct {
  slug: string;
  name: LocalizedField;
  brandName: string;
  imagePath: string | null;
  priceCents: number;
}

export interface QuickIngredient {
  slug: string;
  name: LocalizedField;
}

export interface QuickResults {
  products: QuickProduct[];
  ingredients: QuickIngredient[];
  productTotal: number;
}

const EMPTY: QuickResults = { products: [], ingredients: [], productTotal: 0 };

export async function searchQuick(rawQuery: string): Promise<QuickResults> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < MIN_QUERY_LENGTH) return EMPTY;

  try {
    const [products, ingredients] = await Promise.all([
      listProducts({ q: query, sort: 'relevance' }),
      searchIngredients(query, 3),
    ]);

    return {
      products: products.items.slice(0, 5).map((item) => ({
        slug: item.slug,
        name: item.name,
        brandName: item.brandName,
        imagePath: item.imagePath,
        priceCents: item.priceCents,
      })),
      ingredients,
      productTotal: products.total,
    };
  } catch (error) {
    logger.error('searchQuick failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return EMPTY;
  }
}

/**
 * Ingredient matching, by name in either language and by the synonyms in `other_names`.
 *
 * `ilike` rather than the trigram similarity the product RPC uses. The ingredient table is
 * hundreds of rows, not thousands, and the queries that reach it are usually the exact word
 * ("magnesium") rather than a typo — a substring match is predictable and needs no index to
 * stay fast at this size. If the A–Z list grows past a few thousand, this becomes a `search_*`
 * RPC like the products one.
 */
export async function searchIngredients(rawQuery: string, limit = 20): Promise<QuickIngredient[]> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < MIN_QUERY_LENGTH) return [];

  // PostgREST grammar: a comma splits the `or` expression and a `*` is its wildcard, so both
  // have to go before the value is interpolated — same escaping as the admin lists.
  const safe = query.replace(/[,()*]/g, ' ').trim();
  if (!safe) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('ingredients')
    .select('slug, name, other_names')
    .or(`name->>sq.ilike.%${safe}%,name->>en.ilike.%${safe}%,slug.ilike.%${safe}%`)
    .order('slug')
    .limit(limit);

  if (error) {
    logger.error('searchIngredients failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as { slug: string; name: unknown }[]).map((row) => ({
    slug: row.slug,
    name: asLocalizedField(row.name),
  }));
}
