'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { limit } from '@/lib/rate-limit';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { getCurrentUser, getProfile } from '@/features/auth/queries';
import {
  getReviewEligibility,
  getViewerVotes,
  listProductReviews,
} from '@/features/reviews/queries';
import {
  bulkApproveSchema,
  createReviewSchema,
  moderateReviewSchema,
  voteReviewSchema,
} from '@/features/reviews/schemas';
import type { ReviewEligibility, ReviewPage } from '@/features/reviews/types';

/**
 * docs/05 §3 and docs/06 §10 — writing, voting on and moderating reviews.
 *
 * The split in error unions mirrors `features/orders/actions.ts`: the customer-facing actions
 * return **message keys** that `messages/{sq,en}.json` defines and `t()` resolves, because the
 * storefront is localized; the moderation actions return dotted identifiers that the admin's
 * plain English record resolves, because the panel has no next-intl provider (docs/01 §3).
 *
 * The database owns what this file does not re-implement: `p_insert_own` proves the purchase
 * (docs/13 §B3), `refresh_product_rating` maintains the aggregate, and
 * `refresh_review_helpful_count` maintains the vote count. A review is created `pending` by the
 * column default and becomes visible only when someone approves it.
 */

/**
 * The two reads the reviews section makes from the browser.
 *
 * They live in a `'use server'` module, so both are POST endpoints — worth stating what that
 * exposes. `fetchReviewPage` returns approved reviews, which is public content already in the
 * page's HTML. `loadReviewContext` runs as the caller and returns only the caller's own votes
 * and eligibility; there is no id in the request that could ask about somebody else.
 *
 * They exist at all because the PDP is statically cached (see `listProductReviews`): paging,
 * filtering and per-viewer state cannot come from a shared cache entry.
 */
export async function fetchReviewPage(
  productId: string,
  page: number,
  rating: number | null,
): Promise<ReviewPage> {
  return listProductReviews(productId, {
    page: Number.isFinite(page) ? page : 1,
    rating: rating ?? undefined,
  });
}

export async function loadReviewContext(
  productId: string,
  reviewIds: string[],
): Promise<{ eligibility: ReviewEligibility; votedIds: string[] }> {
  const [eligibility, votedIds] = await Promise.all([
    getReviewEligibility(productId),
    getViewerVotes(reviewIds.slice(0, 50)),
  ]);
  return { eligibility, votedIds };
}

export type ReviewErrorKey =
  | 'review.errors.signedOut'
  | 'review.errors.notPurchased'
  | 'review.errors.alreadyReviewed'
  | 'review.errors.ratingRequired'
  | 'review.errors.rateLimited'
  | 'review.errors.generic';

export type ReviewState = ActionResult<{ id?: string }, ReviewErrorKey> | null;

function reviewFail(error: ReviewErrorKey): ReviewState {
  return fail<ReviewErrorKey, { id?: string }>(error);
}

/**
 * docs/05 §3 — create a review.
 *
 * Three things are proved before the insert, and the order matters:
 *
 *   1. signed in — anonymous reviews are not a feature, they are a spam vector;
 *   2. eligible — delivered order containing this product, and no review already;
 *   3. within budget — 5 a day (docs/02 §9), because (1) and (2) still leave a determined
 *      account able to review a hundred products in a minute.
 *
 * The order id comes from `getReviewEligibility`, never from the form. `p_insert_own` would
 * reject a forged one, but a rejection at the RLS layer surfaces as "something went wrong",
 * and the customer would have no idea what to change.
 */
export async function createReview(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const user = await getCurrentUser();
  if (!user) return reviewFail('review.errors.signedOut');

  const parsed = createReviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return reviewFail('review.errors.ratingRequired');
  const input = parsed.data;

  const eligibility = await getReviewEligibility(input.productId);
  if (eligibility.kind === 'signed_out') return reviewFail('review.errors.signedOut');
  if (eligibility.kind === 'not_purchased') return reviewFail('review.errors.notPurchased');
  if (eligibility.kind === 'already_reviewed') return reviewFail('review.errors.alreadyReviewed');

  /*
   * Keyed on the **user**, not the IP.
   *
   * Everywhere else in this codebase the limiter keys on the address, because those actions are
   * reachable without an account and the address is all there is. This one already requires a
   * signed-in customer with a delivered order, so the account is the stronger identity: an
   * office or a phone network sharing one address must not run out of reviews because a
   * colleague wrote five.
   */
  const withinBudget = await limit('reviewCreate', user.id);
  if (!withinBudget) return reviewFail('review.errors.rateLimited');

  try {
    const supabase = await createClient();
    const profile = await getProfile();

    /*
     * `author_name` is a snapshot, not a join to `profiles`.
     *
     * A review is a public statement made at a point in time. Reading the name live would mean
     * a customer who later changes their display name silently rewrites the byline on every
     * review they have ever left — and deleting the account would blank them all. The column
     * exists for exactly this reason; the fallback is the first name only, which is what most
     * shops show.
     */
    const authorName = (profile?.fullName ?? '').trim().split(/\s+/)[0] || 'Klient';

    const { data, error } = await supabase
      .from('reviews')
      .insert({
        product_id: input.productId,
        user_id: user.id,
        order_id: eligibility.orderId,
        rating: input.rating,
        title: input.title || null,
        body: input.body || null,
        author_name: authorName,
      })
      .select('id')
      .single();

    if (error) {
      logger.error('createReview failed', { cause: error.message });
      return reviewFail('review.errors.generic');
    }

    /*
     * No cache purge here, and that is deliberate: a pending review changes nothing a visitor
     * can see. The purge belongs to approval, which is where the PDP's content actually changes.
     */
    revalidatePath('/account/reviews');
    return ok({ id: (data as { id: string }).id });
  } catch (error) {
    logger.error('createReview threw', describeError(error));
    return reviewFail('review.errors.generic');
  }
}

/**
 * docs/05 §3 — "was this helpful". A toggle, not a counter you can only push up.
 *
 * `review_votes` has a composite primary key on (review_id, user_id), so one vote per person is
 * a database fact rather than a UI convention, and `refresh_review_helpful_count` recomputes
 * `helpful_count` from the table on every insert and delete.
 */
export async function voteReviewHelpful(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const user = await getCurrentUser();
  if (!user) return reviewFail('review.errors.signedOut');

  const parsed = voteReviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return reviewFail('review.errors.generic');

  try {
    const supabase = await createClient();

    const { error } = parsed.data.voted
      ? await supabase
          .from('review_votes')
          .delete()
          .eq('review_id', parsed.data.reviewId)
          .eq('user_id', user.id)
      : await supabase
          .from('review_votes')
          .insert({ review_id: parsed.data.reviewId, user_id: user.id });

    if (error) {
      // A duplicate is not an error worth showing: two tabs, one vote, and the state the
      // customer wanted is the state they now have.
      if (!error.message.includes('duplicate key')) {
        logger.error('voteReviewHelpful failed', { cause: error.message });
        return reviewFail('review.errors.generic');
      }
    }

    return ok({});
  } catch (error) {
    logger.error('voteReviewHelpful threw', describeError(error));
    return reviewFail('review.errors.generic');
  }
}

/*
 * ---------------------------------------------------------------------------------------
 * Moderation (docs/06 §10) — admin-facing, so dotted identifiers rather than message keys.
 * ---------------------------------------------------------------------------------------
 */

export type ModerationErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.reviews.errors.notFound'
  | 'admin.reviews.errors.reasonRequired'
  | 'admin.reviews.errors.replyRequired';

export type ModerationState = ActionResult<{ id?: string }, ModerationErrorKey> | null;

function moderationFail(error: ModerationErrorKey): ModerationState {
  return fail<ModerationErrorKey, { id?: string }>(error);
}

/** The product slug behind a review, needed to purge the PDP it appears on. */
async function productOfReview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reviewId: string,
): Promise<{ id: string; slug: string } | null> {
  const { data } = await supabase
    .from('reviews')
    .select('product_id, products ( slug )')
    .eq('id', reviewId)
    .maybeSingle();

  const row = data as { product_id: string; products: { slug: string } | null } | null;
  return row?.products ? { id: row.product_id, slug: row.products.slug } : null;
}

/**
 * Approve, reject with a reason, or reply publicly.
 *
 * One action for three verbs because they are one decision made in one place, and splitting
 * them would mean three near-identical capability checks, audits and purges — the shape that
 * drifted in M6's taxonomy code before it was collapsed into one module.
 *
 * Approving purges the product's tag: the PDP renders approved reviews and
 * `refresh_product_rating` has just changed the aggregate every card shows.
 */
export async function moderateReview(
  _previous: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const gate = await requireCapability('reviews.moderate');
  if (!gate.ok) return moderationFail(gate.error);

  const parsed = moderateReviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return moderationFail('admin.errors.generic');
  const { reviewId, action, reason, reply } = parsed.data;

  // docs/06 §10 — the reason is shown to the customer, so a rejection without one is not a
  // rejection, it is a disappearance.
  if (action === 'reject' && !reason) return moderationFail('admin.reviews.errors.reasonRequired');
  if (action === 'reply' && !reply) return moderationFail('admin.reviews.errors.replyRequired');

  try {
    const supabase = await createClient();
    const product = await productOfReview(supabase, reviewId);
    if (!product) return moderationFail('admin.reviews.errors.notFound');

    const patch =
      action === 'approve'
        ? { status: 'approved' as const, rejection_reason: null }
        : action === 'reject'
          ? { status: 'rejected' as const, rejection_reason: reason || null }
          : { admin_reply: reply || null };

    const { error } = await supabase.from('reviews').update(patch).eq('id', reviewId);

    if (error) {
      logger.error('moderateReview failed', { action, cause: error.message });
      return moderationFail('admin.errors.generic');
    }

    await audit(`review.${action}`, 'review', reviewId, null, { reason, reply });

    revalidatePublic([CACHE_TAGS.products, CACHE_TAGS.product(product.slug)]);
    revalidatePath('/admin/reviews');
    return ok({ id: reviewId });
  } catch (error) {
    logger.error('moderateReview threw', describeError(error));
    return moderationFail('admin.errors.generic');
  }
}

/**
 * docs/06 §10 — bulk approve.
 *
 * One statement rather than a loop of `moderateReview`, because a partial failure halfway
 * through twenty individual updates leaves the queue in a state nobody chose. The purge that
 * follows is the coarse `products` tag plus each affected slug.
 */
export async function bulkApproveReviews(
  _previous: ModerationState,
  formData: FormData,
): Promise<ModerationState> {
  const gate = await requireCapability('reviews.moderate');
  if (!gate.ok) return moderationFail(gate.error);

  const parsed = bulkApproveSchema.safeParse({ reviewIds: formData.getAll('reviewIds') });
  if (!parsed.success) return moderationFail('admin.errors.generic');

  try {
    const supabase = await createClient();

    const { data: affected } = await supabase
      .from('reviews')
      .select('products ( slug )')
      .in('id', parsed.data.reviewIds);

    const { error } = await supabase
      .from('reviews')
      .update({ status: 'approved', rejection_reason: null })
      .in('id', parsed.data.reviewIds);

    if (error) {
      logger.error('bulkApproveReviews failed', { cause: error.message });
      return moderationFail('admin.errors.generic');
    }

    await audit('review.bulk_approve', 'review', null, null, {
      count: parsed.data.reviewIds.length,
    });

    const slugs = ((affected ?? []) as { products: { slug: string } | null }[]).flatMap((row) =>
      row.products ? [CACHE_TAGS.product(row.products.slug)] : [],
    );
    revalidatePublic([CACHE_TAGS.products, ...slugs]);
    revalidatePath('/admin/reviews');
    return ok({});
  } catch (error) {
    logger.error('bulkApproveReviews threw', describeError(error));
    return moderationFail('admin.errors.generic');
  }
}
