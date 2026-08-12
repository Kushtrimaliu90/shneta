import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';
import type { ArticleStatus, ArticleType } from '@/features/content/types';

/** A localized jsonb column, read defensively — a missing locale is blank, never a crash. */
function pair(value: unknown): { sq: string; en: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { sq: '', en: '' };
  const record = value as Record<string, unknown>;
  return {
    sq: typeof record.sq === 'string' ? record.sq : '',
    en: typeof record.en === 'string' ? record.en : '',
  };
}

export interface ArticleListRow {
  id: string;
  slug: string;
  titleSq: string;
  type: ArticleType;
  status: ArticleStatus;
  publishedAt: string | null;
  updatedAt: string;
  hasEnglish: boolean;
  /** Set only in the removed view, so the bin can say when it went. */
  deletedAt: string | null;
}

export interface ArticleDetail {
  id: string;
  slug: string;
  title: { sq: string; en: string };
  excerpt: { sq: string; en: string };
  body: { sq: string; en: string };
  type: ArticleType;
  status: ArticleStatus;
  tags: string[];
  publishedAt: string | null;
  readingMinutes: number | null;
  productIds: string[];
  ingredientIds: string[];
  goalIds: string[];
}

/**
 * docs/06 §13 — the article list.
 *
 * `deleted_at` is excluded by default, because a removed article is gone from the editor's point of
 * view — while `archived` is a status the editor chose and must be able to reverse. Passing `removed`
 * asks for the other side of that filter, which is what makes a reversible removal reversible: without a
 * view of what has gone, Restore would have nothing to act on.
 */
export async function listAdminArticles(
  status?: ArticleStatus,
  removed = false,
): Promise<ArticleListRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('articles')
    .select('id, slug, title, type, status, published_at, updated_at, deleted_at')
    .order('updated_at', { ascending: false });

  query = removed ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listAdminArticles failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => {
    const title = pair(row.title);
    return {
      id: row.id,
      slug: row.slug,
      titleSq: title.sq,
      type: row.type,
      status: row.status,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      hasEnglish: title.en.length > 0,
      deletedAt: row.deleted_at ?? null,
    };
  });
}

export async function getAdminArticle(id: string): Promise<ArticleDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('articles')
    .select(
      `id, slug, title, excerpt, body, type, status, tags, published_at, reading_minutes,
       article_products ( product_id ),
       article_ingredients ( ingredient_id ),
       article_health_goals ( goal_id )`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    logger.error('getAdminArticle failed', { cause: error.message, id });
    return null;
  }
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    slug: string;
    title: Json;
    excerpt: Json;
    body: Json;
    type: ArticleType;
    status: ArticleStatus;
    tags: string[];
    published_at: string | null;
    reading_minutes: number | null;
    article_products: { product_id: string }[];
    article_ingredients: { ingredient_id: string }[];
    article_health_goals: { goal_id: string }[];
  };

  return {
    id: row.id,
    slug: row.slug,
    title: pair(row.title),
    excerpt: pair(row.excerpt),
    body: pair(row.body),
    type: row.type,
    status: row.status,
    tags: row.tags ?? [],
    publishedAt: row.published_at,
    readingMinutes: row.reading_minutes,
    productIds: (row.article_products ?? []).map((r) => r.product_id),
    ingredientIds: (row.article_ingredients ?? []).map((r) => r.ingredient_id),
    goalIds: (row.article_health_goals ?? []).map((r) => r.goal_id),
  };
}

export interface PickerOption {
  id: string;
  label: string;
}

/**
 * The three "related" pickers on the article editor, in one round trip.
 *
 * Everything, unpaginated, because these are lists of tens rather than thousands and a picker
 * that needs a search box for 24 products is a picker that has misjudged its own scale. Revisit
 * with the catalogue, not before.
 */
export async function getRelatedOptions(): Promise<{
  products: PickerOption[];
  ingredients: PickerOption[];
  goals: PickerOption[];
}> {
  const supabase = await createClient();

  const [products, ingredients, goals] = await Promise.all([
    supabase.from('products').select('id, name').is('deleted_at', null).order('slug'),
    supabase.from('ingredients').select('id, name').order('slug'),
    supabase.from('health_goals').select('id, name').order('sort_order'),
  ]);

  const label = (value: unknown): string => pair(value).sq || pair(value).en;

  return {
    products: (products.data ?? []).map((row) => ({ id: row.id, label: label(row.name) })),
    ingredients: (ingredients.data ?? []).map((row) => ({ id: row.id, label: label(row.name) })),
    goals: (goals.data ?? []).map((row) => ({ id: row.id, label: label(row.name) })),
  };
}

export interface FaqRow {
  id: string;
  question: { sq: string; en: string };
  answer: { sq: string; en: string };
  category: string;
  position: number;
  isActive: boolean;
}

export async function listAdminFaqs(): Promise<FaqRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('faqs')
    .select('id, question, answer, category, position, is_active')
    .order('category', { ascending: true })
    .order('position', { ascending: true });

  if (error) {
    logger.error('listAdminFaqs failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    question: pair(row.question),
    answer: pair(row.answer),
    category: row.category,
    position: row.position,
    isActive: row.is_active,
  }));
}

export interface PageRow {
  id: string;
  slug: string;
  title: { sq: string; en: string };
  body: { sq: string; en: string };
  status: ArticleStatus;
}

export async function listAdminPages(): Promise<PageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pages')
    .select('id, slug, title, body, status')
    .order('slug');

  if (error) {
    logger.error('listAdminPages failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: pair(row.title),
    body: pair(row.body),
    status: row.status,
  }));
}

export interface BannerRow {
  id: string;
  placement: string;
  title: { sq: string; en: string };
  subtitle: { sq: string; en: string };
  ctaLabel: { sq: string; en: string };
  ctaHref: string | null;
  startsAt: string | null;
  endsAt: string | null;
  position: number;
  isActive: boolean;
}

export async function listAdminBanners(): Promise<BannerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('banners')
    .select(
      'id, placement, title, subtitle, cta_label, cta_href, starts_at, ends_at, position, is_active',
    )
    .order('placement', { ascending: true })
    .order('position', { ascending: true });

  if (error) {
    logger.error('listAdminBanners failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    placement: row.placement,
    title: pair(row.title),
    subtitle: pair(row.subtitle),
    ctaLabel: pair(row.cta_label),
    ctaHref: row.cta_href,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    position: row.position,
    isActive: row.is_active,
  }));
}

/**
 * How many articles are in the bin.
 *
 * Read alongside the list so the tab can show a number even at zero — a tab that only appears when
 * occupied is a tab nobody finds the first time they look for what they just removed.
 */
export async function countRemovedArticles(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .not('deleted_at', 'is', null);

  if (error) {
    logger.error('countRemovedArticles failed', { cause: error.message });
    return 0;
  }
  return count ?? 0;
}
