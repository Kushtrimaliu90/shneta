import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { asLocalizedField } from '@/lib/i18n';
import { getCurrentUser } from '@/features/auth/queries';
import {
  REVIEWS_PER_PAGE,
  toReviewStatus,
  type ModerationReview,
  type OwnReview,
  type ReviewEligibility,
  type ReviewPage,
  type ReviewStatus,
  type ReviewSummary,
  type ReviewView,
} from '@/features/reviews/types';

/**
 * docs/05 §3 and docs/06 §10 — review reads.
 *
 * Through the SSR client, so RLS decides. `p_read on reviews` returns approved rows to anyone,
 * plus your own at any status, plus everything to support and content managers — which means
 * this one function serves the PDP, the author's own page and the moderation queue without a
 * single role check in TypeScript. The status filter below is about *what to show*, never about
 * what the caller is allowed to see.
 */

interface RawReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  author_name: string;
  created_at: string;
  helpful_count: number;
  admin_reply: string | null;
  order_id: string | null;
  user_id: string;
  status: string;
}

const REVIEW_SELECT =
  'id, rating, title, body, author_name, created_at, helpful_count, admin_reply, order_id, user_id, status';

function toView(row: RawReview, viewerId: string | null, votedIds: Set<string>): ReviewView {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: row.author_name,
    createdAt: row.created_at,
    helpfulCount: row.helpful_count,
    adminReply: row.admin_reply,
    isVerified: row.order_id !== null,
    hasVoted: votedIds.has(row.id),
    isOwn: viewerId !== null && row.user_id === viewerId,
    status: toReviewStatus(row.status) ?? 'pending',
  };
}

const EMPTY_SUMMARY: ReviewSummary = { average: 0, total: 0, distribution: [0, 0, 0, 0, 0] };

/**
 * The rating distribution, counted from the approved rows themselves.
 *
 * Not from `products.rating_avg` / `rating_count`: those are maintained by
 * `refresh_product_rating` and are the right source for a *card*, but they carry no breakdown,
 * and a summary whose bars disagree with its average is worse than no bars. One extra query on
 * a page that is already fetching reviews.
 */
async function readSummary(
  supabase: ReturnType<typeof createPublicClient>,
  productId: string,
): Promise<ReviewSummary> {
  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .eq('product_id', productId)
    .eq('status', 'approved');

  if (error) {
    logger.error('Review summary failed', { productId, cause: error.message });
    return EMPTY_SUMMARY;
  }

  const rows = (data ?? []) as { rating: number }[];
  if (rows.length === 0) return EMPTY_SUMMARY;

  /*
   * Counted into a mutable array and frozen into the tuple at the end.
   *
   * `noUncheckedIndexedAccess` types `distribution[i]` as `number | undefined` even on a
   * fixed-length tuple, so `+= 1` does not compile. Writing `distribution[i] = (distribution[i]
   * ?? 0) + 1` would compile and would be a lie — the index is provably in range. Counting into
   * a plain array and asserting the shape once is honest about where the knowledge is.
   */
  const counts = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const row of rows) {
    sum += row.rating;
    const index = Math.min(4, Math.max(0, row.rating - 1));
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const distribution: [number, number, number, number, number] = [
    counts[0] ?? 0,
    counts[1] ?? 0,
    counts[2] ?? 0,
    counts[3] ?? 0,
    counts[4] ?? 0,
  ];

  return {
    average: Math.round((sum / rows.length) * 10) / 10,
    total: rows.length,
    distribution,
  };
}

/**
 * docs/05 §3 — approved reviews for one product, five to a page.
 *
 * **Read with the anonymous public client, deliberately.** The PDP is statically generated
 * (`generateStaticParams` + ISR), and `lib/supabase/server.ts` touches `cookies()`, which would
 * opt the whole page into dynamic rendering — the same trap `createPublicClient` was introduced
 * for in docs/13 §G. So this returns exactly what a logged-out visitor may see, which is also
 * exactly what belongs in a cached page: approved reviews, no viewer state.
 *
 * Who voted for what, and whether *you* may write a review, are per-person facts. They arrive
 * after mount through `loadReviewContext`, which is a server action and therefore dynamic.
 * Baking either into a shared cache entry would show one customer another's state.
 *
 * `rating` filters to a single star bucket, which is what the distribution bars link to.
 */
export async function listProductReviews(
  productId: string,
  options: { page?: number; rating?: number } = {},
): Promise<ReviewPage> {
  const supabase = createPublicClient();
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * REVIEWS_PER_PAGE;

  const summary = await readSummary(supabase, productId);

  let query = supabase
    .from('reviews')
    .select(REVIEW_SELECT, { count: 'exact' })
    .eq('product_id', productId)
    .eq('status', 'approved')
    // Most helpful first, then newest: a review nobody found useful should not head the list
    // purely because it was written last.
    .order('helpful_count', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + REVIEWS_PER_PAGE - 1);

  if (options.rating) query = query.eq('rating', options.rating);

  const { data, error, count } = await query;

  if (error) {
    logger.error('listProductReviews failed', { productId, cause: error.message });
    return { items: [], summary, page, pageCount: 1 };
  }

  const rows = (data ?? []) as unknown as RawReview[];

  return {
    items: rows.map((row) => toView(row, null, new Set())),
    summary,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / REVIEWS_PER_PAGE)),
  };
}

/**
 * The per-viewer half of the reviews section: which reviews you have voted for, and whether you
 * may write one. Called from a server action after the cached page has already rendered.
 */
export async function getViewerVotes(reviewIds: string[]): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user || reviewIds.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from('review_votes')
    .select('review_id')
    .eq('user_id', user.id)
    .in('review_id', reviewIds);

  return ((data ?? []) as { review_id: string }[]).map((row) => row.review_id);
}

/**
 * Whether the signed-in reader may write a review for this product, and why not if not.
 *
 * docs/05 §3 asks the PDP to *explain* rather than hide the control, so the four states are
 * returned rather than one boolean. The eligible branch carries the order id, because
 * `p_insert_own` requires a real order containing this product and the client cannot be trusted
 * to pick one.
 *
 * "Delivered" is the bar, not "placed": reviewing something that has not arrived is the main
 * way review sections fill with noise, and docs/09 journey 6 walks buy → delivered → review.
 */
export const getReviewEligibility = cache(async (productId: string): Promise<ReviewEligibility> => {
  const user = await getCurrentUser();
  if (!user) return { kind: 'signed_out' };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('product_id', productId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) return { kind: 'already_reviewed' };

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, status, order_items!inner(product_id)')
    .eq('user_id', user.id)
    .eq('status', 'delivered')
    .eq('order_items.product_id', productId)
    .order('placed_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.error('Review eligibility failed', { productId, cause: error.message });
    return { kind: 'not_purchased' };
  }

  const order = ((orders ?? []) as { id: string }[])[0];
  return order ? { kind: 'eligible', orderId: order.id } : { kind: 'not_purchased' };
});

interface RawModerationRow extends RawReview {
  rejection_reason: string | null;
  product_id: string;
  products: { slug: string; name: unknown } | null;
}

/** docs/06 §10 — the moderation queue. */
export async function listReviewsForModeration(status: ReviewStatus): Promise<ModerationReview[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .select(`${REVIEW_SELECT}, rejection_reason, product_id, products ( slug, name )`)
    // Oldest first while pending — a queue where the oldest item is never reached is not a
    // queue — but newest first once decided, where the question is "what did we just do".
    .eq('status', status)
    .order('created_at', { ascending: status === 'pending' })
    .limit(100);

  if (error) {
    logger.error('listReviewsForModeration failed', { status, cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawModerationRow[]).map((row) => ({
    ...toView(row, null, new Set()),
    productId: row.product_id,
    productSlug: row.products?.slug ?? '',
    productName: asLocalizedField(row.products?.name),
    rejectionReason: row.rejection_reason,
  }));
}

export async function countReviewsByStatus(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('reviews').select('status');

  if (error) {
    logger.error('countReviewsByStatus failed', { cause: error.message });
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

interface RawOwnReview extends RawReview {
  rejection_reason: string | null;
  products: {
    slug: string;
    name: unknown;
    product_images: { storage_path: string; position: number }[];
  } | null;
}

/** docs/05 §14 — the customer's own reviews, at every status. */
export async function listOwnReviews(): Promise<OwnReview[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reviews')
    .select(
      `${REVIEW_SELECT}, rejection_reason, products ( slug, name, product_images ( storage_path, position ) )`,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error('listOwnReviews failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawOwnReview[]).map((row) => {
    const images = [...(row.products?.product_images ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    return {
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      status: toReviewStatus(row.status) ?? 'pending',
      rejectionReason: row.rejection_reason,
      adminReply: row.admin_reply,
      productSlug: row.products?.slug ?? '',
      productName: asLocalizedField(row.products?.name),
      productImagePath: images[0]?.storage_path ?? null,
    };
  });
}
