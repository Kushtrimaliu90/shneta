import type { LocalizedField } from '@/lib/i18n';

/**
 * docs/03 §1 — the `article_type` and `article_status` enums.
 *
 * Here rather than in `admin-queries.ts` because the article editor is a client component and
 * needs them as *values* to render its selects. `admin-queries.ts` is `server-only`, and
 * importing a value from it into a client component fails the build — the same class of mistake
 * as docs/13 §M3's `'use server'` export, caught the same way: at build time, loudly.
 */
export const ARTICLE_TYPES = ['guide', 'article', 'recipe', 'research', 'news'] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const ARTICLE_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export function toArticleStatus(value: string | null | undefined): ArticleStatus | undefined {
  return (ARTICLE_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ArticleStatus)
    : undefined;
}

export function toArticleType(value: string | null | undefined): ArticleType | undefined {
  return (ARTICLE_TYPES as readonly string[]).includes(value ?? '')
    ? (value as ArticleType)
    : undefined;
}

/** A card in the Knowledge Center grid. */
export interface ArticleCard {
  slug: string;
  type: ArticleType;
  title: LocalizedField;
  excerpt: LocalizedField;
  coverPath: string | null;
  publishedAt: string | null;
  readingMinutes: number | null;
  tags: string[];
}

export interface ArticleListResult {
  items: ArticleCard[];
  total: number;
  page: number;
  pageCount: number;
  /** How many published articles carry each type, for the filter row's counts. */
  countsByType: Record<string, number>;
  /** Every tag in use, most common first. */
  tags: string[];
}

export interface RelatedProduct {
  slug: string;
  name: LocalizedField;
  brandName: string;
  imagePath: string | null;
  priceCents: number | null;
}

export interface ArticleDetail extends ArticleCard {
  id: string;
  updatedAt: string;
  /** Markdown, per locale. Rendered by `ArticleBody`, never with `dangerouslySetInnerHTML`. */
  body: LocalizedField;
  seoTitle: LocalizedField;
  seoDescription: LocalizedField;
  products: RelatedProduct[];
  ingredients: { slug: string; name: LocalizedField }[];
}

export interface FaqEntry {
  id: string;
  category: string;
  question: LocalizedField;
  answer: LocalizedField;
}

export interface StaticPage {
  slug: string;
  title: LocalizedField;
  body: LocalizedField;
  seoTitle: LocalizedField;
  seoDescription: LocalizedField;
  updatedAt: string;
}

export interface Banner {
  placement: string;
  title: LocalizedField;
  subtitle: LocalizedField;
  ctaLabel: LocalizedField;
  ctaHref: string | null;
  imagePath: string | null;
}

/** docs/05 §11 — a coupon a visitor may claim from the offers page. */
export interface PublicCoupon {
  code: string;
  type: string;
  value: number;
  minSubtotalCents: number | null;
  endsAt: string | null;
}

export const ARTICLES_PER_PAGE = 9;
