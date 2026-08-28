'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { canDeleteLive, canRemovePublished } from '@/features/catalog/removal';
import { FORM_LEVEL } from '@/lib/field-errors';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/06 §13 — articles, pages, FAQs and banners.
 *
 * Four entities, one file, for the reason `taxonomy-actions.ts` gives: they are the same write —
 * some bilingual jsonb, a position, an active flag — and four files would each grow their own
 * idea of what a slug collision looks like.
 *
 * Separate from `admin-actions.ts`, which owns the contact inbox: that is an operations screen
 * for support, this is authoring for a content manager, and they have different capabilities.
 *
 * The rule that is easy to lose here: **`sq` is required, `en` is optional** (docs/06 §13). The
 * shop is Albanian-first; an article that exists only in English is a page a customer in Kosovo
 * cannot read.
 */

export type ContentErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.content.errors.checkFields'
  | 'admin.content.errors.slugTaken'
  | 'admin.content.errors.notFound'
  /** A removal the rules refuse; the reason arrives in `fieldErrors._form`. */
  | 'admin.content.errors.removeBlocked';

export type ContentState = ActionResult<{ id?: string }, ContentErrorKey> | null;

function contentFail(error: ContentErrorKey): ContentState {
  return fail<ContentErrorKey, { id?: string }>(error);
}

/** `{ sq, en }`, with an empty `en` dropped so the column never stores `""` as a translation. */
function localized(sq: string, en: string): Json {
  return (en.trim() ? { sq, en: en.trim() } : { sq }) as unknown as Json;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// -----------------------------------------------------------------------------
// Articles
// -----------------------------------------------------------------------------

const articleSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'At least three characters.')
    .max(80)
    .regex(slugPattern, 'Lowercase letters, numbers and hyphens — for example vitamina-d.'),
  titleSq: z.string().trim().min(3, 'Required — the Albanian title.').max(160),
  titleEn: z.string().trim().max(160).optional().or(z.literal('')),
  excerptSq: z.string().trim().max(400).optional().or(z.literal('')),
  excerptEn: z.string().trim().max(400).optional().or(z.literal('')),
  bodySq: z.string().trim().min(1, 'Required — the Albanian body.').max(60_000),
  bodyEn: z.string().trim().max(60_000).optional().or(z.literal('')),
  type: z.enum(['article', 'guide', 'recipe', 'research', 'news']),
  status: z.enum(['draft', 'in_review', 'published', 'archived']),
  tags: z.string().trim().max(300).optional().or(z.literal('')),
});

/** Roughly 200 words a minute, floored at one — shown as "5 min read" on the article. */
function readingMinutes(body: string): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * The ids behind one `RelatedPicker`.
 *
 * `formData.getAll`, not `Object.fromEntries`: the picker is a group of checkboxes sharing one
 * name, so the entry appears once per checked box and `fromEntries` would keep only the last —
 * silently reducing "five related products" to one. That is why these three are read straight
 * off the FormData rather than going through the Zod object above.
 */
function idList(formData: FormData, name: string): string[] {
  const values = formData
    .getAll(name)
    .map((value) => String(value).trim())
    .filter((value) => UUID.test(value));
  return [...new Set(values)];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveArticle(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = articleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<ContentErrorKey, { id?: string }>(
      'admin.content.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const id = input.id || undefined;

  const patch = {
    slug: input.slug,
    title: localized(input.titleSq, input.titleEn ?? ''),
    excerpt: localized(input.excerptSq ?? '', input.excerptEn ?? ''),
    body: localized(input.bodySq, input.bodyEn ?? ''),
    type: input.type,
    status: input.status,
    tags: (input.tags ?? '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    reading_minutes: readingMinutes(input.bodySq),
  };

  try {
    const supabase = await createClient();
    let articleId = id;
    let slug = input.slug;

    if (id) {
      const { data: before } = await supabase
        .from('articles')
        .select('slug, status, published_at')
        .eq('id', id)
        .maybeSingle();

      if (!before) return contentFail('admin.content.errors.notFound');
      const existing = before as { slug: string; status: string; published_at: string | null };

      /*
       * CLAUDE.md §10 — slugs are immutable after publish. A published URL is in search results,
       * in somebody's bookmarks and possibly on a printed leaflet; changing it silently 404s all
       * three. The editor disables the field once published, and this is what makes that true
       * rather than decorative.
       */
      slug = existing.published_at ? existing.slug : input.slug;

      /*
       * `published_at` is stamped the first time an article goes live and never moved again.
       * Re-stamping on each save would reorder the Knowledge Center every time a typo is fixed.
       */
      const publishedAt =
        input.status === 'published'
          ? (existing.published_at ?? new Date().toISOString())
          : existing.published_at;

      const { error } = await supabase
        .from('articles')
        .update({ ...patch, slug, published_at: publishedAt })
        .eq('id', id);

      if (error) {
        if (error.code === '23505') return contentFail('admin.content.errors.slugTaken');
        logger.error('saveArticle update failed', { cause: error.message, id });
        return contentFail('admin.errors.generic');
      }

      await audit('article.update', 'article', id, existing, { ...patch, slug });
    } else {
      const { data, error } = await supabase
        .from('articles')
        .insert({
          ...patch,
          published_at: input.status === 'published' ? new Date().toISOString() : null,
        })
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') return contentFail('admin.content.errors.slugTaken');
        logger.error('saveArticle insert failed', { cause: error.message });
        return contentFail('admin.errors.generic');
      }

      articleId = (data as { id: string }).id;
      await audit('article.create', 'article', articleId, null, patch);
    }

    if (articleId) {
      await saveArticleRelations(articleId, {
        products: idList(formData, 'productIds'),
        ingredients: idList(formData, 'ingredientIds'),
        goals: idList(formData, 'goalIds'),
      });
    }

    revalidatePublic([CACHE_TAGS.articles, CACHE_TAGS.article(slug)]);
    revalidatePath('/admin/content');
    return ok({ id: articleId });
  } catch (error) {
    logger.error('saveArticle threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

/**
 * Replaces the three join tables for one article.
 *
 * Delete-then-insert rather than a diff. These are pure link tables with no columns of their own
 * and at most a handful of rows, so a diff would be more code to get wrong for no observable
 * difference.
 */
async function saveArticleRelations(
  articleId: string,
  related: { products: string[]; ingredients: string[]; goals: string[] },
): Promise<void> {
  const supabase = await createClient();

  await Promise.all([
    supabase.from('article_products').delete().eq('article_id', articleId),
    supabase.from('article_ingredients').delete().eq('article_id', articleId),
    supabase.from('article_health_goals').delete().eq('article_id', articleId),
  ]);

  const inserts: Promise<unknown>[] = [];

  if (related.products.length > 0) {
    inserts.push(
      Promise.resolve(
        supabase
          .from('article_products')
          .insert(related.products.map((product_id) => ({ article_id: articleId, product_id }))),
      ),
    );
  }
  if (related.ingredients.length > 0) {
    inserts.push(
      Promise.resolve(
        supabase
          .from('article_ingredients')
          .insert(
            related.ingredients.map((ingredient_id) => ({ article_id: articleId, ingredient_id })),
          ),
      ),
    );
  }
  if (related.goals.length > 0) {
    inserts.push(
      Promise.resolve(
        supabase
          .from('article_health_goals')
          .insert(related.goals.map((goal_id) => ({ article_id: articleId, goal_id }))),
      ),
    );
  }

  await Promise.all(inserts);
}

// -----------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------

const pageSchema = z.object({
  id: z.string().uuid(),
  titleSq: z.string().trim().min(1, 'Required.').max(120),
  titleEn: z.string().trim().max(120).optional().or(z.literal('')),
  bodySq: z.string().trim().min(1, 'Required.').max(60_000),
  bodyEn: z.string().trim().max(60_000).optional().or(z.literal('')),
  status: z.enum(['draft', 'in_review', 'published', 'archived']),
});

/**
 * docs/06 §13 — the fixed pages: about, terms, privacy, shipping-returns.
 *
 * Edit only. There is no create and no delete: the storefront routes to these slugs by name, so
 * a fifth page would have no route and a deleted one would 404 a link in the footer. Adding a
 * page is a code change, which is honest about what it actually is.
 */
export async function savePage(_previous: ContentState, formData: FormData): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = pageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<ContentErrorKey, { id?: string }>(
      'admin.content.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('pages')
      .select('slug, status')
      .eq('id', input.id)
      .maybeSingle();

    if (!before) return contentFail('admin.content.errors.notFound');

    const patch = {
      title: localized(input.titleSq, input.titleEn ?? ''),
      body: localized(input.bodySq, input.bodyEn ?? ''),
      status: input.status,
    };

    const { error } = await supabase.from('pages').update(patch).eq('id', input.id);

    if (error) {
      logger.error('savePage failed', { cause: error.message, id: input.id });
      return contentFail('admin.errors.generic');
    }

    await audit('page.update', 'page', input.id, before, patch);

    // Pages are cached under the articles tag — see `contentCache` in `content/queries.ts`.
    revalidatePublic([CACHE_TAGS.articles]);
    revalidatePath('/admin/content/pages');
    return ok({ id: input.id });
  } catch (error) {
    logger.error('savePage threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

// -----------------------------------------------------------------------------
// FAQs
// -----------------------------------------------------------------------------

const faqSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  questionSq: z.string().trim().min(3, 'Required.').max(300),
  questionEn: z.string().trim().max(300).optional().or(z.literal('')),
  answerSq: z.string().trim().min(3, 'Required.').max(4000),
  answerEn: z.string().trim().max(4000).optional().or(z.literal('')),
  category: z.string().trim().min(1, 'Required.').max(40),
  position: z.coerce.number().int().min(0).max(500),
  isActive: z.string().optional(),
});

export async function saveFaq(_previous: ContentState, formData: FormData): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = faqSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<ContentErrorKey, { id?: string }>(
      'admin.content.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const patch = {
    question: localized(input.questionSq, input.questionEn ?? ''),
    answer: localized(input.answerSq, input.answerEn ?? ''),
    category: input.category,
    position: input.position,
    is_active: input.isActive === 'on',
  };

  try {
    const supabase = await createClient();

    if (input.id) {
      const { error } = await supabase.from('faqs').update(patch).eq('id', input.id);
      if (error) {
        logger.error('saveFaq update failed', { cause: error.message });
        return contentFail('admin.errors.generic');
      }
      await audit('faq.update', 'faq', input.id, null, patch);
    } else {
      const { data, error } = await supabase.from('faqs').insert(patch).select('id').single();
      if (error) {
        logger.error('saveFaq insert failed', { cause: error.message });
        return contentFail('admin.errors.generic');
      }
      await audit('faq.create', 'faq', (data as { id: string }).id, null, patch);
    }

    /*
     * The FAQ page carries FAQPage JSON-LD (docs/08 §4), so a stale cache is not merely old copy —
     * it is structured data telling Google an answer the shop no longer gives.
     */
    revalidatePublic([CACHE_TAGS.articles]);
    revalidatePath('/admin/content/faqs');
    return ok({ id: input.id || undefined });
  } catch (error) {
    logger.error('saveFaq threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

// -----------------------------------------------------------------------------
// Banners
// -----------------------------------------------------------------------------

const bannerSchema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  placement: z.string().trim().min(1, 'Required.').max(40),
  titleSq: z.string().trim().min(1, 'Required.').max(120),
  titleEn: z.string().trim().max(120).optional().or(z.literal('')),
  subtitleSq: z.string().trim().max(240).optional().or(z.literal('')),
  subtitleEn: z.string().trim().max(240).optional().or(z.literal('')),
  ctaLabelSq: z.string().trim().max(60).optional().or(z.literal('')),
  ctaLabelEn: z.string().trim().max(60).optional().or(z.literal('')),
  ctaHref: z.string().trim().max(200).optional().or(z.literal('')),
  startsAt: z.string().trim().optional().or(z.literal('')),
  endsAt: z.string().trim().optional().or(z.literal('')),
  position: z.coerce.number().int().min(0).max(100),
  isActive: z.string().optional(),
});

export async function saveBanner(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = bannerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<ContentErrorKey, { id?: string }>(
      'admin.content.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const patch = {
    placement: input.placement,
    title: localized(input.titleSq, input.titleEn ?? ''),
    subtitle: localized(input.subtitleSq ?? '', input.subtitleEn ?? ''),
    cta_label: localized(input.ctaLabelSq ?? '', input.ctaLabelEn ?? ''),
    cta_href: input.ctaHref || null,
    starts_at: input.startsAt ? `${input.startsAt}T00:00:00Z` : null,
    ends_at: input.endsAt ? `${input.endsAt}T23:59:59Z` : null,
    position: input.position,
    is_active: input.isActive === 'on',
  };

  try {
    const supabase = await createClient();

    if (input.id) {
      const { error } = await supabase.from('banners').update(patch).eq('id', input.id);
      if (error) {
        logger.error('saveBanner update failed', { cause: error.message });
        return contentFail('admin.errors.generic');
      }
      await audit('banner.update', 'banner', input.id, null, patch);
    } else {
      const { data, error } = await supabase.from('banners').insert(patch).select('id').single();
      if (error) {
        logger.error('saveBanner insert failed', { cause: error.message });
        return contentFail('admin.errors.generic');
      }
      await audit('banner.create', 'banner', (data as { id: string }).id, null, patch);
    }

    revalidatePublic([CACHE_TAGS.banners]);
    revalidatePath('/admin/content/banners');
    return ok({ id: input.id || undefined });
  } catch (error) {
    logger.error('saveBanner threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

// ── Removing an article ─────────────────────────────────────────────────────

const articleIdSchema = z.object({ articleId: z.string().uuid() });

/**
 * Removes an article from the panel, reversibly.
 *
 * `articles` is the only one of the four entities in this file with a `deleted_at` column, so it is the
 * only one that can be removed. Pages, FAQs and banners are hidden instead — a page by its status, the
 * other two by `is_active` — and every one of those controls already exists.
 *
 * Sets `deleted_at`, which is the whole mechanism: `p_read on articles` is `(status = 'published' and
 * deleted_at is null)`, so the article leaves the knowledge centre, the sitemap and every anonymous read
 * at the database.
 *
 * Refuses a published article, for the same reason a published product is refused: unpublishing is the
 * control for "take it off the site", and collapsing the two would mean the fastest way to pull a live
 * article is the same click as the one that hides it from the panel.
 */
export async function removeArticle(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = articleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return contentFail('admin.content.errors.checkFields');
  const { articleId } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('articles')
      .select('slug, status, title, deleted_at')
      .eq('id', articleId)
      .maybeSingle();

    if (!before) return contentFail('admin.content.errors.notFound');
    const article = before as {
      slug: string;
      status: string;
      title: unknown;
      deleted_at: string | null;
    };
    if (article.deleted_at !== null) return ok({ id: articleId });

    const verdict = canRemovePublished(article.status, 'article');
    if (!verdict.allowed) {
      return fromFieldErrors<ContentErrorKey, { id?: string; slug?: string }>(
        'admin.content.errors.removeBlocked',
        { fieldErrors: { [FORM_LEVEL]: [verdict.reason, verdict.instead ?? ''].filter(Boolean) } },
      );
    }

    const { error } = await supabase
      .from('articles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', articleId)
      // Guarded, so a stale tab cannot remove an article published since the page loaded.
      .neq('status', 'published')
      .is('deleted_at', null);

    if (error) {
      logger.error('removeArticle failed', { cause: error.message });
      return contentFail('admin.errors.generic');
    }

    await audit('article.removed', 'article', articleId, { status: article.status }, {
      slug: article.slug,
      title: article.title,
    } as unknown as Json);

    revalidatePublic([CACHE_TAGS.articles, CACHE_TAGS.article(article.slug)]);
    revalidatePath('/admin/content');
    return ok({ id: articleId });
  } catch (error) {
    logger.error('removeArticle threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

/** Puts a removed article back, at whatever status it held — which is never `published`. */
export async function restoreArticle(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = articleIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return contentFail('admin.content.errors.checkFields');

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('articles')
      .update({ deleted_at: null })
      .eq('id', parsed.data.articleId)
      .not('deleted_at', 'is', null)
      .select('slug')
      .maybeSingle();

    if (error) {
      logger.error('restoreArticle failed', { cause: error.message });
      return contentFail('admin.errors.generic');
    }
    if (!data) return ok({ id: parsed.data.articleId });

    const slug = (data as { slug: string }).slug;
    await audit('article.restored', 'article', parsed.data.articleId, null, {
      slug,
    } as unknown as Json);

    revalidatePublic([CACHE_TAGS.articles, CACHE_TAGS.article(slug)]);
    revalidatePath('/admin/content');
    return ok({ id: parsed.data.articleId });
  } catch (error) {
    logger.error('restoreArticle threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

// ── Deleting a page, an FAQ or a banner ─────────────────────────────────────

/**
 * These three are **deleted outright**, not removed.
 *
 * None has a `deleted_at` column, and all three have **zero inbound foreign keys** — nothing can be
 * orphaned by their going. They are small, cheap to retype, and each already has its own way of being
 * hidden, which is what makes a genuine delete the right verb rather than a euphemism.
 *
 * The rule is the one every other entity follows: **what is live must be taken down first.** A published
 * page, an active FAQ or banner. Every one of those has a reversible control for it a few pixels away,
 * and taking that step is what makes the deletion safe to confirm rather than a decision made at speed.
 */
const contentIdSchema = z.object({ id: z.string().uuid() });

function deleteRefused(verdict: { reason: string; instead?: string }): ContentState {
  return fromFieldErrors<ContentErrorKey, { id?: string }>('admin.content.errors.removeBlocked', {
    fieldErrors: { [FORM_LEVEL]: [verdict.reason, verdict.instead ?? ''].filter(Boolean) },
  });
}

export async function deletePage(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = contentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return contentFail('admin.content.errors.checkFields');
  const { id } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('pages')
      .select('slug, status, title')
      .eq('id', id)
      .maybeSingle();
    if (!before) return contentFail('admin.content.errors.notFound');
    const page = before as { slug: string; status: string; title: unknown };

    /*
     * A published page is refused. These are the legal pages — terms, privacy, returns — reachable from
     * the footer of every page on the shop, and one going missing is a 404 on a document a customer has
     * a right to read. Setting it back to draft removes it from the shop and is a single reversible step.
     */
    const verdict = canDeleteLive(
      page.status === 'published',
      'page',
      'Set it back to draft first — that takes it off the shop and can be undone.',
    );
    if (!verdict.allowed) return deleteRefused(verdict);

    const { error } = await supabase.from('pages').delete().eq('id', id).neq('status', 'published');
    if (error) {
      logger.error('deletePage failed', { cause: error.message });
      return contentFail('admin.errors.generic');
    }

    /*
     * Audited with the whole row in `before`, not just its id.
     *
     * This is the one place where that matters more than usual: there is no bin to recover from, so the
     * audit row is the only record that the page existed and what it said.
     */
    await audit('page.deleted', 'page', id, page as unknown as Json, null);

    revalidatePublic([CACHE_TAGS.articles]);
    revalidatePath('/admin/content/pages');
    return ok({ id });
  } catch (error) {
    logger.error('deletePage threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

export async function deleteFaq(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = contentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return contentFail('admin.content.errors.checkFields');
  const { id } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('faqs')
      .select('question, answer, category, is_active')
      .eq('id', id)
      .maybeSingle();
    if (!before) return contentFail('admin.content.errors.notFound');
    const faq = before as { is_active: boolean };

    const verdict = canDeleteLive(
      faq.is_active,
      'question',
      'Switch it off first — customers stop seeing it immediately, and you can switch it back.',
    );
    if (!verdict.allowed) return deleteRefused(verdict);

    const { error } = await supabase.from('faqs').delete().eq('id', id).eq('is_active', false);
    if (error) {
      logger.error('deleteFaq failed', { cause: error.message });
      return contentFail('admin.errors.generic');
    }

    await audit('faq.deleted', 'faq', id, before as unknown as Json, null);

    revalidatePublic([CACHE_TAGS.articles]);
    revalidatePath('/admin/content/faqs');
    return ok({ id });
  } catch (error) {
    logger.error('deleteFaq threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}

export async function deleteBanner(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const gate = await requireCapability('content.manage');
  if (!gate.ok) return contentFail(gate.error);

  const parsed = contentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return contentFail('admin.content.errors.checkFields');
  const { id } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('banners')
      .select('placement, title, is_active, starts_at, ends_at')
      .eq('id', id)
      .maybeSingle();
    if (!before) return contentFail('admin.content.errors.notFound');
    const banner = before as { is_active: boolean };

    const verdict = canDeleteLive(
      banner.is_active,
      'banner',
      'Switch it off first. Its dates may already have passed, but the switch is what decides whether it can show.',
    );
    if (!verdict.allowed) return deleteRefused(verdict);

    const { error } = await supabase.from('banners').delete().eq('id', id).eq('is_active', false);
    if (error) {
      logger.error('deleteBanner failed', { cause: error.message });
      return contentFail('admin.errors.generic');
    }

    await audit('banner.deleted', 'banner', id, before as unknown as Json, null);

    // The same tag `saveBanner` purges — a banner is read through `banners`, not through `articles`.
    revalidatePublic([CACHE_TAGS.banners]);
    revalidatePath('/admin/content/banners');
    return ok({ id });
  } catch (error) {
    logger.error('deleteBanner threw', describeError(error));
    return contentFail('admin.errors.generic');
  }
}
