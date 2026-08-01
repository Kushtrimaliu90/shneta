import type { Locale } from '@/lib/constants';
import type { LocalizedField } from '@/lib/i18n';

/**
 * Catalog domain types. These are the *display* shapes — jsonb has already been narrowed
 * through `asLocalizedField` and money is integer cents, so components never touch raw rows.
 */

export type StockStatus = 'in_stock' | 'low' | 'out_of_stock';

/** A row from `search_products`, ready for a ProductCard. */
export interface ProductListItem {
  id: string;
  slug: string;
  name: LocalizedField;
  subtitle: LocalizedField;
  brandName: string;
  brandSlug: string;
  form: string | null;
  dietaryTags: string[];
  ratingAvg: number;
  ratingCount: number;
  isFeatured: boolean;
  variantId: string;
  sku: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  imagePath: string | null;
  inStock: boolean;
}

export interface ProductVariantDetail {
  id: string;
  sku: string;
  name: LocalizedField;
  options: Record<string, string>;
  priceCents: number;
  compareAtPriceCents: number | null;
  isDefault: boolean;
  stockStatus: StockStatus;
}

export interface IngredientRow {
  slug: string;
  name: LocalizedField;
  amount: number | null;
  unit: string | null;
  nrvPct: number | null;
  evidence: string | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: LocalizedField;
  subtitle: LocalizedField;
  description: LocalizedField;
  howToUse: LocalizedField;
  warnings: LocalizedField;
  form: string | null;
  servingSize: string | null;
  dietaryTags: string[];
  ratingAvg: number;
  ratingCount: number;
  updatedAt: string;
  brand: { slug: string; name: string };
  primaryCategory: { slug: string; name: LocalizedField } | null;
  variants: ProductVariantDetail[];
  ingredients: IngredientRow[];
  goals: { slug: string; name: LocalizedField }[];
  certifications: { slug: string; name: LocalizedField }[];
  images: { path: string; alt: LocalizedField }[];
  /**
   * docs/06 §3.5 — the SEO overrides, or nulls when the editor left them blank.
   * `generateMetadata` prefers these and falls back to the name and subtitle.
   */
  seoTitle: LocalizedField;
  seoDescription: LocalizedField;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: LocalizedField;
  description: LocalizedField;
  parentId: string | null;
  children: CategoryNode[];
}

/** docs/05 §2 — the shareable filter state. Every field maps to a URL query parameter. */
export interface ProductFilters {
  q?: string;
  category?: string[];
  brand?: string[];
  goal?: string[];
  ingredient?: string[];
  tag?: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStock?: boolean;
  onSale?: boolean;
  sort?: ProductSort;
  page?: number;
}

export const PRODUCT_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export function isProductSort(value: unknown): value is ProductSort {
  return typeof value === 'string' && (PRODUCT_SORTS as readonly string[]).includes(value);
}

/** docs/05 §2 — 24 products per page. */
export const PRODUCTS_PER_PAGE = 24;

export interface ProductListResult {
  items: ProductListItem[];
  total: number;
  page: number;
  pageCount: number;
}

/** Helper for components that need a locale-aware display name in one call. */
export type WithLocale<T> = T & { locale: Locale };
