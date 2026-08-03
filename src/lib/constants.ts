/**
 * Cross-cutting constants. docs/02 §12.
 * This module must stay dependency-free so it can be imported from client and server alike.
 */

/** docs/08 §1 — `sq` is the default and is served unprefixed. */
export const LOCALES = ['sq', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'sq';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** docs/00 decision log #4 — EUR only at launch; the column exists for later markets. */
export const DEFAULT_CURRENCY = 'EUR' as const;

/** docs/02 §12 — CET, valid for Kosovo. */
export const TIMEZONE = 'Europe/Belgrade' as const;

export const DEFAULT_COUNTRY_CODE = 'XK' as const;

/** docs/03 §13 — defaults, overridden by the `settings` table at runtime. */
export const DEFAULT_VAT_RATE_PERCENT = 18;
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Absolute ceiling enforced by the `cart_items.quantity` check constraint (docs/03 §6).
 * `settings.checkout.max_item_qty` may only tighten this, never raise it. See docs/13 §D5.
 */
export const MAX_CART_ITEM_QTY = 20;

/** docs/05 §9 — compare page caps at four products. */
export const MAX_COMPARE_ITEMS = 4;

/** docs/07 §8 — subscription cadences. */
export const SUBSCRIPTION_FREQUENCY_DAYS = [30, 45, 60, 90] as const;
export type SubscriptionFrequencyDays = (typeof SUBSCRIPTION_FREQUENCY_DAYS)[number];

/** docs/07 §3.1 — guest cart token cookie. */
export const CART_COOKIE_NAME = 'biocode_cart';
export const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** docs/13 §B1 — short-lived proof-of-purchase for the checkout success page. */
export const ORDER_ACCESS_COOKIE_NAME = 'biocode_order_access';
export const ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 30;

/** docs/02 §5 — the complete cache-tag vocabulary. Nothing outside this list may be tagged. */
export const CACHE_TAGS = {
  products: 'products',
  product: (slug: string) => `product:${slug}`,
  categories: 'categories',
  brands: 'brands',
  brand: (slug: string) => `brand:${slug}`,
  goals: 'goals',
  ingredients: 'ingredients',
  ingredient: (slug: string) => `ingredient:${slug}`,
  articles: 'articles',
  article: (slug: string) => `article:${slug}`,
  banners: 'banners',
  settings: 'settings',
  shipping: 'shipping',
} as const;

/**
 * docs/02 §5 — ISR window for catalog and content routes.
 *
 * NOTE: `export const revalidate` in a route segment must be a *literal*; Next statically
 * analyses segment config and rejects an imported identifier. Write `= 300` there and keep
 * it in sync with this value, which exists for non-segment uses (cache headers, tests).
 */
export const ISR_REVALIDATE_SECONDS = 300;

/** docs/02 §9 — rate limits, as [max, windowSeconds]. */
export const RATE_LIMITS = {
  signIn: [5, 15 * 60],
  signUp: [5, 15 * 60],
  forgotPassword: [3, 15 * 60],
  checkout: [10, 60 * 60],
  contact: [3, 60 * 60],
  reviewCreate: [5, 24 * 60 * 60],
  newsletter: [3, 60 * 60],
  finderSubmit: [10, 60 * 60],
  /** docs/15 §3 — generation is an unauthenticated write plus five reads. */
  protocolBuild: [10, 60 * 60],
  /*
   * docs/16 §4 — applying to sell is an unauthenticated write that creates a merchant row and can
   * send an invite email. Three an hour per address: a real applicant submits once, and a mistake
   * plus a retry is two.
   */
  merchantApply: [3, 60 * 60],
  orderLookup: [10, 60 * 60],
} as const satisfies Record<string, readonly [number, number]>;
