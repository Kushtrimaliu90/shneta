import type { Locale } from '@/lib/constants';
import type { LocalizedField } from '@/lib/i18n';

/**
 * Catalog domain types. These are the *display* shapes — jsonb has already been narrowed
 * through `asLocalizedField` and money is integer cents, so components never touch raw rows.
 */

export type StockStatus = 'in_stock' | 'low' | 'out_of_stock';

/**
 * docs/16 §1 — who supplies a variant, as `variant_buy_box` decided it.
 *
 * Lives here rather than beside its query so the display types stay one import away from each other
 * and `supply.ts` does not have to import back out of `types.ts` into itself.
 *
 * There is no price on it, and that is the marketplace's central pricing rule made structural: the
 * canonical variant price is the only customer-facing price, whoever holds the stock. A merchant
 * offer's `price_cents` is what the merchant asks BioCode, and it never leaves the server.
 */
export interface VariantSupply {
  variantId: string;
  /** `none` means nobody has it. */
  source: 'biocode' | 'merchant' | 'none';
  stockStatus: StockStatus;
  merchantId: string | null;
  merchantSlug: string | null;
  merchantName: string | null;
  offerId: string | null;
  /** Days the merchant takes to hand the parcel over; null when BioCode ships it. */
  handlingDays: number | null;
  /** How many suppliers could serve this variant, BioCode included. */
  supplierCount: number;
}

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
  /**
   * docs/16 §1 — who is selling this one.
   *
   * Deliberately separate from `stockStatus`, which stays BioCode's own bucket. The marketplace is
   * a **supply** question and the stock line is an availability one; collapsing them would mean the
   * PDP claiming a variant is buyable at the moment `variant_buy_box` finds a merchant with stock,
   * which checkout cannot honour until routing exists (docs/16 §12 step 4).
   *
   * `null` when the lookup failed — the page renders as it did before the marketplace, which is the
   * only safe direction for a read that decides what a shopper is told.
   */
  supply: VariantSupply | null;
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
