import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { asLocalizedField } from '@/lib/i18n';
import { CACHE_TAGS, ISR_REVALIDATE_SECONDS } from '@/lib/constants';
import {
  ARTICLES_PER_PAGE,
  toArticleType,
  type ArticleCard,
  type ArticleDetail,
  type ArticleListResult,
  type ArticleType,
  type Banner,
  type FaqEntry,
  type PublicCoupon,
  type StaticPage,
} from '@/features/content/types';

/**
 * docs/05 §7, §11, §16 — the Knowledge Center, offers, FAQs and the static pages.
 *
 * The **public** client throughout, and every read wrapped in `unstable_cache` with a tag —
 * the same arrangement the catalogue reads got in docs/13 §K1, for the same reason. Content is
 * anonymous, cacheable and purged on write; touching the session here would make every page
 * that renders a banner dynamic (docs/13 §M1).
 */

/** Wraps a content read in the Data Cache under one tag. Mirrors `taxonomyCache`. */
function contentCache<A extends unknown[], R>(
  keyPrefix: string,
  tag: string,
  read: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return cache((...args: A) =>
    unstable_cache(() => read(...args), [keyPrefix, ...args.map((arg) => JSON.stringify(arg))], {
      tags: [tag],
      revalidate: ISR_REVALIDATE_SECONDS,
    })(),
  );
}

interface RawArticle {
  id: string;
  slug: string;
  type: string;
  title: unknown;
  excerpt: unknown;
  cover_path: string | null;
  published_at: string | null;
  reading_minutes: number | null;
  tags: string[] | null;
  updated_at: string;
}

const CARD_SELECT =
  'id, slug, type, title, excerpt, cover_path, published_at, reading_minutes, tags, updated_at';

function toCard(row: RawArticle): ArticleCard {
  return {
    slug: row.slug,
    type: toArticleType(row.type) ?? 'article',
    title: asLocalizedField(row.title),
    excerpt: asLocalizedField(row.excerpt),
    coverPath: row.cover_path,
    publishedAt: row.published_at,
    readingMinutes: row.reading_minutes,
    tags: row.tags ?? [],
  };
}

/**
 * docs/05 §7 — the hub.
 *
 * The type counts and the tag list come from a second, unfiltered read of the same table
 * rather than from the paginated result. Filter chips computed from the current page would
 * disappear as soon as you used one — the classic facet bug, where narrowing to "recipes"
 * leaves "recipes" as the only chip on screen and no way back.
 */
const readArticles = async (filters: {
  type?: ArticleType;
  tag?: string;
  page?: number;
}): Promise<ArticleListResult> => {
  const supabase = createPublicClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * ARTICLES_PER_PAGE;

  let query = supabase
    .from('articles')
    .select(CARD_SELECT, { count: 'exact' })
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .range(from, from + ARTICLES_PER_PAGE - 1);

  if (filters.type) query = query.eq('type', filters.type);
  if (filters.tag) query = query.contains('tags', [filters.tag]);

  const [{ data, error, count }, facets] = await Promise.all([
    query,
    supabase.from('articles').select('type, tags').eq('status', 'published').is('deleted_at', null),
  ]);

  if (error) {
    logger.error('readArticles failed', { cause: error.message });
    return { items: [], total: 0, page, pageCount: 1, countsByType: {}, tags: [] };
  }

  const countsByType: Record<string, number> = {};
  const tagCounts = new Map<string, number>();

  for (const row of (facets.data ?? []) as { type: string; tags: string[] | null }[]) {
    countsByType[row.type] = (countsByType[row.type] ?? 0) + 1;
    countsByType.all = (countsByType.all ?? 0) + 1;
    for (const tag of row.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return {
    items: ((data ?? []) as unknown as RawArticle[]).map(toCard),
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / ARTICLES_PER_PAGE)),
    countsByType,
    tags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
      .slice(0, 12),
  };
};

export const listArticles = contentCache('articles', CACHE_TAGS.articles, readArticles);

interface RawDetail extends RawArticle {
  body: unknown;
  seo: { title?: unknown; description?: unknown } | null;
  article_products: {
    products: {
      slug: string;
      name: unknown;
      brands: { name: string } | null;
      product_images: { storage_path: string; position: number }[];
      product_variants: { price_cents: number; is_default: boolean; is_active: boolean }[];
    } | null;
  }[];
  article_ingredients: { ingredients: { slug: string; name: unknown } | null }[];
}

const readArticle = async (slug: string): Promise<ArticleDetail | null> => {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from('articles')
    .select(
      `${CARD_SELECT}, body, seo,
       article_products ( products ( slug, name, brands ( name ),
         product_images ( storage_path, position ),
         product_variants ( price_cents, is_default, is_active ) ) ),
       article_ingredients ( ingredients ( slug, name ) )`,
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    logger.error('readArticle failed', { slug, cause: error.message });
    return null;
  }
  if (!data) return null;

  const raw = data as unknown as RawDetail;

  return {
    ...toCard(raw),
    id: raw.id,
    updatedAt: raw.updated_at,
    body: asLocalizedField(raw.body),
    seoTitle: asLocalizedField(raw.seo?.title),
    seoDescription: asLocalizedField(raw.seo?.description),
    /*
     * "Shop this article" drops a product whose join row survived but whose product row is no
     * longer visible — unpublished, or soft-deleted. RLS returns null for it, so the aside
     * quietly shows one card fewer instead of a link to a 404.
     */
    products: raw.article_products.flatMap((link) => {
      const product = link.products;
      if (!product) return [];
      const active = product.product_variants.filter((variant) => variant.is_active);
      const chosen = active.find((variant) => variant.is_default) ?? active[0];
      const images = [...product.product_images].sort((a, b) => a.position - b.position);
      return [
        {
          slug: product.slug,
          name: asLocalizedField(product.name),
          brandName: product.brands?.name ?? '',
          imagePath: images[0]?.storage_path ?? null,
          priceCents: chosen?.price_cents ?? null,
        },
      ];
    }),
    ingredients: raw.article_ingredients.flatMap((link) =>
      link.ingredients
        ? [{ slug: link.ingredients.slug, name: asLocalizedField(link.ingredients.name) }]
        : [],
    ),
  };
};

export const getArticle = cache((slug: string) =>
  unstable_cache(() => readArticle(slug), ['article', slug], {
    tags: [CACHE_TAGS.articles, CACHE_TAGS.article(slug)],
    revalidate: ISR_REVALIDATE_SECONDS,
  })(),
);

/** Three more of the same type, for the foot of an article. */
const readRelatedArticles = async (slug: string, type: ArticleType): Promise<ArticleCard[]> => {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('articles')
    .select(CARD_SELECT)
    .eq('status', 'published')
    .is('deleted_at', null)
    .eq('type', type)
    .neq('slug', slug)
    .order('published_at', { ascending: false })
    .limit(3);

  return ((data ?? []) as unknown as RawArticle[]).map(toCard);
};

export const listRelatedArticles = contentCache(
  'related-articles',
  CACHE_TAGS.articles,
  readRelatedArticles,
);

/** Every published slug, for `generateStaticParams` and the sitemap. */
export async function listArticleSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('articles')
    .select('slug, updated_at')
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(500);

  return ((data ?? []) as { slug: string; updated_at: string }[]).map((row) => ({
    slug: row.slug,
    updatedAt: row.updated_at,
  }));
}

/* -------------------------------------------------------------------------- */

const readFaqs = async (): Promise<FaqEntry[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('faqs')
    .select('id, category, question, answer')
    .eq('is_active', true)
    .order('category')
    .order('position');

  if (error) {
    logger.error('readFaqs failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as { id: string; category: string; question: unknown; answer: unknown }[]
  ).map((row) => ({
    id: row.id,
    category: row.category,
    question: asLocalizedField(row.question),
    answer: asLocalizedField(row.answer),
  }));
};

export const listFaqs = contentCache('faqs', CACHE_TAGS.articles, readFaqs);

const readPage = async (slug: string): Promise<StaticPage | null> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('pages')
    .select('slug, title, body, seo, updated_at')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error) {
    logger.error('readPage failed', { slug, cause: error.message });
    return null;
  }
  if (!data) return null;

  const row = data as {
    slug: string;
    title: unknown;
    body: unknown;
    seo: { title?: unknown; description?: unknown } | null;
    updated_at: string;
  };

  return {
    slug: row.slug,
    title: asLocalizedField(row.title),
    body: asLocalizedField(row.body),
    seoTitle: asLocalizedField(row.seo?.title),
    seoDescription: asLocalizedField(row.seo?.description),
    updatedAt: row.updated_at,
  };
};

export const getPage = contentCache('page', CACHE_TAGS.articles, readPage);

/**
 * docs/05 §11 — banners for one placement, inside their window.
 *
 * The window is filtered here rather than in SQL because the row is cached: a banner whose
 * `starts_at` passes during the cache window would otherwise stay hidden until the tag is
 * purged. Reading all of them and filtering at render time costs nothing at this size and is
 * correct at any moment.
 */
const readBanners = async (placement: string): Promise<Banner[]> => {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('banners')
    .select('placement, title, subtitle, cta_label, cta_href, image_path, starts_at, ends_at')
    .eq('placement', placement)
    .eq('is_active', true)
    .order('position');

  const now = Date.now();

  return (
    (data ?? []) as {
      placement: string;
      title: unknown;
      subtitle: unknown;
      cta_label: unknown;
      cta_href: string | null;
      image_path: string | null;
      starts_at: string | null;
      ends_at: string | null;
    }[]
  )
    .filter(
      (row) =>
        (row.starts_at === null || Date.parse(row.starts_at) <= now) &&
        (row.ends_at === null || Date.parse(row.ends_at) > now),
    )
    .map((row) => ({
      placement: row.placement,
      title: asLocalizedField(row.title),
      subtitle: asLocalizedField(row.subtitle),
      ctaLabel: asLocalizedField(row.cta_label),
      ctaHref: row.cta_href,
      imagePath: row.image_path,
    }));
};

export const listBanners = contentCache('banners', CACHE_TAGS.banners, readBanners);

/**
 * docs/05 §11 — claimable coupons.
 *
 * Through `list_public_coupons()`, which owns the definition of "public": not system, active,
 * inside its window, not exhausted. See migration 15 for why that is a function rather than an
 * RLS policy — the acceptance criterion is that an expired coupon never renders, and that is a
 * question with one right answer, not a row-visibility rule for every caller to re-derive.
 */
const readPublicCoupons = async (): Promise<PublicCoupon[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('list_public_coupons');

  if (error) {
    logger.error('readPublicCoupons failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    code: row.code,
    type: row.type,
    value: row.value,
    minSubtotalCents: row.min_subtotal_cents,
    endsAt: row.ends_at,
  }));
};

export const listPublicCoupons = contentCache('coupons', CACHE_TAGS.products, readPublicCoupons);

/**
 * docs/11 §2 — the `store` settings row: the address and phone the contact page shows.
 *
 * `settings` is readable by anyone (the storefront needs the tax rate and the free-shipping
 * threshold), so this is one more anonymous, cached read rather than anything privileged.
 */
const readStoreSettings = async (): Promise<{
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}> => {
  const supabase = createPublicClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'store').maybeSingle();

  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null);

  return {
    name: text('name') ?? 'SHNETA',
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
  };
};

export const getStoreSettings = contentCache('store', CACHE_TAGS.settings, readStoreSettings);
