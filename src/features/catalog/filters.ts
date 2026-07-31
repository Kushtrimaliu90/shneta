import { isProductSort, type ProductFilters, type ProductSort } from '@/features/catalog/types';

/**
 * docs/05 §2 — filters live in the URL so they are shareable and the back button restores
 * state. This module is the single translator between query string and `ProductFilters`, so
 * the two can never disagree.
 *
 * Everything is parsed defensively: a hand-edited URL is untrusted input, and a bad `page`
 * or `minPrice` must degrade to the default rather than reach the RPC.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function asArray(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined;
  const list = (Array.isArray(value) ? value : value.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z0-9-]{1,96}$/.test(entry));
  return list.length > 0 ? list : undefined;
}

function asPositiveInt(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function asFlag(value: string | string[] | undefined): boolean | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '1' || raw === 'true' ? true : undefined;
}

export function parseFilters(params: RawSearchParams): ProductFilters {
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const sortRaw = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const minPrice = asPositiveInt(params.minPrice);
  const maxPrice = asPositiveInt(params.maxPrice);
  const rating = asPositiveInt(params.rating);

  return {
    q: q?.trim() ? q.trim().slice(0, 120) : undefined,
    category: asArray(params.category),
    brand: asArray(params.brand),
    goal: asArray(params.goal),
    ingredient: asArray(params.ingredient),
    tag: asArray(params.tag),
    // Prices arrive in euros in the URL because that is what a human reads; cents are the
    // internal unit (CLAUDE.md §2).
    minPrice: minPrice == null ? undefined : minPrice * 100,
    maxPrice: maxPrice == null ? undefined : maxPrice * 100,
    minRating: rating != null && rating >= 1 && rating <= 5 ? rating : undefined,
    inStock: asFlag(params.inStock),
    onSale: asFlag(params.onSale),
    sort: isProductSort(sortRaw) ? sortRaw : undefined,
    page: asPositiveInt(params.page) || 1,
  };
}

/**
 * Builds a query string with one value changed. Used by every filter chip, sort control and
 * pagination link, so toggling a filter always resets to page 1 — landing on page 4 of a
 * three-page result is the classic filter bug.
 */
export function buildQuery(
  current: ProductFilters,
  change: Partial<ProductFilters> & {
    toggle?: { key: 'brand' | 'goal' | 'tag' | 'category'; value: string };
  },
): string {
  const next: ProductFilters = { ...current, ...change, page: change.page ?? 1 };

  if (change.toggle) {
    const { key, value } = change.toggle;
    const existing = current[key] ?? [];
    next[key] = existing.includes(value)
      ? existing.filter((entry) => entry !== value)
      : [...existing, value];
    if (next[key]?.length === 0) next[key] = undefined;
  }

  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  for (const key of ['category', 'brand', 'goal', 'ingredient', 'tag'] as const) {
    const list = next[key];
    if (list?.length) params.set(key, list.join(','));
  }
  if (next.minPrice != null) params.set('minPrice', String(Math.round(next.minPrice / 100)));
  if (next.maxPrice != null) params.set('maxPrice', String(Math.round(next.maxPrice / 100)));
  if (next.minRating != null) params.set('rating', String(next.minRating));
  if (next.inStock) params.set('inStock', '1');
  if (next.onSale) params.set('onSale', '1');
  if (next.sort && next.sort !== 'relevance') params.set('sort', next.sort);
  if (next.page && next.page > 1) params.set('page', String(next.page));

  const query = params.toString();
  return query ? `?${query}` : '';
}

/** True when anything narrows the result set — drives the "clear all" affordance. */
export function hasActiveFilters(filters: ProductFilters): boolean {
  return Boolean(
    filters.q ||
    filters.brand?.length ||
    filters.goal?.length ||
    filters.tag?.length ||
    filters.ingredient?.length ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    filters.minRating != null ||
    filters.inStock ||
    filters.onSale,
  );
}

export const SORT_OPTIONS: readonly ProductSort[] = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'rating',
];

/** docs/03 §4 — the dietary tags the schema allows. */
export const DIETARY_TAGS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'sugar_free',
  'lactose_free',
  'halal',
  'non_gmo',
] as const;

export type DietaryTag = (typeof DIETARY_TAGS)[number];

/**
 * `ingredients.category` is a free-form `text` column, so the same narrowing applies as for
 * dietary tags: anything unrecognised groups under "other" rather than rendering a raw
 * message key at a customer.
 */
export const INGREDIENT_CATEGORIES = [
  'vitamin',
  'mineral',
  'herb',
  'amino_acid',
  'protein',
  'fatty_acid',
  'fibre',
  'other',
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export function ingredientCategory(value: string | null): IngredientCategory {
  return (INGREDIENT_CATEGORIES as readonly string[]).includes(value ?? '')
    ? (value as IngredientCategory)
    : 'other';
}

/**
 * `products.dietary_tags` is a free-form `text[]` in Postgres, so a row can carry a tag we
 * have no label for. Narrowing here means `t('shop.tags.' + tag)` typechecks, and an
 * unrecognised tag is skipped rather than rendering a raw key at a customer.
 */
export function knownDietaryTags(tags: readonly string[]): DietaryTag[] {
  return tags.filter((tag): tag is DietaryTag => (DIETARY_TAGS as readonly string[]).includes(tag));
}
