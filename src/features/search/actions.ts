'use server';

import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { MIN_QUERY_LENGTH } from '@/features/search/constants';

/**
 * docs/05 §8 — the instant search overlay, and the analytics behind every search.
 *
 * `searchQuick` is a **read** exposed as a server action, because the overlay is a client component
 * typing into a debounced box. It touches nothing and returns only published, anonymous-readable rows,
 * so exposing it as a POST endpoint costs nothing beyond what the `/search` page already renders.
 *
 * It is now **one** round trip rather than two. `search_suggest` does the products, the query
 * completions, the brands, the categories, the ingredients and the spelling correction in a single call,
 * and the products inside it come from `search_products` — the same RPC the results page and the shop
 * grid use. That last part is deliberate: a bespoke lighter query for the dropdown would be free to rank
 * differently from the page it links to, and "I saw it in the dropdown and it wasn't on the page" is a
 * worse bug than a few milliseconds.
 *
 * **Articles are here now.** This note used to say they were absent on purpose, because
 * `/knowledge/[slug]` did not exist when the overlay was written and a result linking to a 404 is worse
 * than a missing group. That route shipped with M8; the comment outlived the constraint, which is how a
 * deliberate omission quietly becomes an accidental gap. Migration 75 added the group.
 */

export interface QuickProduct {
  id: string;
  slug: string;
  name: LocalizedField;
  brandName: string;
  imagePath: string | null;
  priceCents: number;
  inStock: boolean;
  /** The short descriptor beside the price — 'Capsules', 'Powder'. */
  form: string | null;
  subtitle: LocalizedField;
}

export interface QuickTaxon {
  slug: string;
  name: LocalizedField;
}

export interface QuickArticle {
  slug: string;
  title: LocalizedField;
}

export interface QuickResults {
  products: QuickProduct[];
  articles: QuickArticle[];
  /** Completions for the word still being typed — "magne" → "magnesium". */
  terms: string[];
  brands: { slug: string; name: string }[];
  categories: QuickTaxon[];
  ingredients: QuickTaxon[];
  productTotal: number;
  didYouMean: string | null;
}

const EMPTY: QuickResults = {
  products: [],
  articles: [],
  terms: [],
  brands: [],
  categories: [],
  ingredients: [],
  productTotal: 0,
  didYouMean: null,
};

/** The `search_suggest` payload, narrowed. jsonb arrives as `unknown` and is not trusted. */
function readSuggest(value: unknown): QuickResults {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return EMPTY;
  const raw = value as Record<string, unknown>;

  const rows = (key: string): Record<string, unknown>[] => {
    const list = raw[key];
    return Array.isArray(list)
      ? (list.filter((r) => r != null && typeof r === 'object') as Record<string, unknown>[])
      : [];
  };

  const taxa = (key: string): QuickTaxon[] =>
    rows(key).map((r) => ({ slug: String(r.slug ?? ''), name: asLocalizedField(r.name) }));

  return {
    products: rows('products').map((r) => ({
      id: String(r.id ?? ''),
      slug: String(r.slug ?? ''),
      name: asLocalizedField(r.name),
      brandName: String(r.brandName ?? ''),
      imagePath: r.imagePath == null ? null : String(r.imagePath),
      priceCents: Number(r.priceCents ?? 0),
      inStock: Boolean(r.inStock),
      form: r.form == null ? null : String(r.form),
      subtitle: asLocalizedField(r.subtitle),
    })),
    articles: rows('articles').map((r) => ({
      slug: String(r.slug ?? ''),
      title: asLocalizedField(r.title),
    })),
    terms: Array.isArray(raw.terms)
      ? raw.terms.filter((t): t is string => typeof t === 'string')
      : [],
    brands: rows('brands').map((r) => ({ slug: String(r.slug ?? ''), name: String(r.name ?? '') })),
    categories: taxa('categories'),
    ingredients: taxa('ingredients'),
    productTotal: Number(raw.total ?? 0),
    didYouMean: typeof raw.didYouMean === 'string' && raw.didYouMean ? raw.didYouMean : null,
  };
}

export async function searchQuick(rawQuery: string, locale: Locale = 'sq'): Promise<QuickResults> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < MIN_QUERY_LENGTH) return EMPTY;

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc('search_suggest', {
      p_query: query,
      p_locale: locale,
      p_limit: 5,
    });

    if (error) {
      logger.error('search_suggest failed', { cause: error.message });
      return EMPTY;
    }

    return readSuggest(data);
  } catch (error) {
    logger.error('searchQuick failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return EMPTY;
  }
}

/**
 * Ingredient matching for the results page — by name in either language, by slug, and by the aliases in
 * `other_names`.
 *
 * Through an RPC now rather than a PostgREST `or(...ilike...)`. The old version filtered on name and slug
 * while *selecting* `other_names` and carrying a comment claiming it searched the synonyms; it never did,
 * so "acid askorbik" did not find ascorbic acid despite the alias sitting in the row that should have
 * matched. It also returned alphabetical order, which put whatever ingredient starts with an early letter
 * above the one the shopper named.
 */
export async function searchIngredients(rawQuery: string, limit = 20): Promise<QuickTaxon[]> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < MIN_QUERY_LENGTH) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('search_ingredients', {
    p_query: query,
    p_limit: limit,
  });

  if (error) {
    logger.error('search_ingredients failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({ slug: row.slug, name: asLocalizedField(row.name) }));
}

/**
 * Record a submitted search, and return the event id so a click can be attributed to it.
 *
 * Fire-and-forget from the caller's point of view: a failure here returns null and the page renders
 * exactly as it would have. Analytics is never worth a 500 on a page a customer is reading.
 *
 * **Only submitted searches.** The overlay fires a suggest query every 250 ms and none of those are
 * logged — they would multiply write volume roughly fivefold and fill the table with prefixes ("v", "vi",
 * "vit", "vita") that read as four failed searches and were one successful one.
 */
export async function logSearch(input: {
  query: string;
  locale: Locale;
  source: 'results' | 'overlay' | 'shop';
  resultCount: number;
  relaxed?: boolean;
  didYouMean?: string | null;
}): Promise<string | null> {
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc('log_search', {
      p_query: input.query.slice(0, 120),
      p_locale: input.locale,
      p_source: input.source,
      p_result_count: input.resultCount,
      p_relaxed: input.relaxed ?? false,
      p_did_you_mean: input.didYouMean ?? undefined,
    });

    if (error) {
      logger.error('log_search failed', { cause: error.message });
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Attribute a click to a logged search.
 *
 * The event id is the authorisation — an unguessable uuid this client received from its own `logSearch`
 * call moments earlier. The RPC bounds what that permits: the row must be under an hour old and the click
 * may be recorded once, so the worst a stolen id allows is setting a field that was going to be set.
 *
 * A query with results and no clicks is a *ranking* failure, and it is invisible unless both halves are
 * recorded. That is the whole reason this exists.
 */
export async function logSearchClick(
  eventId: string,
  productId: string,
  position: number,
): Promise<void> {
  try {
    const supabase = createPublicClient();
    await supabase.rpc('log_search_click', {
      p_event_id: eventId,
      p_product_id: productId,
      p_position: position,
    });
  } catch {
    // Deliberately silent — see logSearch.
  }
}
