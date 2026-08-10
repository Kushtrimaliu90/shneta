'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BadgeCheck, Star, ThumbsUp } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { ReviewSummaryPanel } from '@/features/reviews/components/review-summary';
import {
  createReview,
  fetchReviewPage,
  loadReviewContext,
  voteReviewHelpful,
  type ReviewState,
} from '@/features/reviews/actions';
import type { ReviewEligibility, ReviewPage } from '@/features/reviews/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §3 — the reviews block on the PDP.
 *
 * Server-rendered with page one so the text is in the cached HTML for search engines and for
 * anyone who never scrolls. Everything after that — paging, star filtering, whether *you* voted,
 * whether you may write one — is client state, because the page is a shared cache entry and
 * none of those are shared facts. See `listProductReviews` for why that split exists.
 *
 * The "write a review" area is the part worth getting right. docs/05 §3 asks it to **explain**
 * rather than disappear: a customer who cannot review learns why, and the reason is different
 * enough in each case to be worth its own sentence.
 */
export function ReviewsSection({
  productId,
  productSlug,
  initial,
}: {
  productId: string;
  productSlug: string;
  initial: ReviewPage;
}) {
  const t = useTranslations('review');
  const [data, setData] = useState(initial);
  const [rating, setRating] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [votedIds, setVotedIds] = useState<string[]>([]);

  // The per-viewer overlay, fetched once the cached page is on screen.
  useEffect(() => {
    let active = true;
    void loadReviewContext(
      productId,
      initial.items.map((item) => item.id),
    ).then((context) => {
      if (!active) return;
      setEligibility(context.eligibility);
      setVotedIds(context.votedIds);
    });
    return () => {
      active = false;
    };
  }, [productId, initial.items]);

  function load(page: number, nextRating: number | null) {
    startTransition(async () => {
      const next = await fetchReviewPage(productId, page, nextRating);
      setData(next);
      setRating(nextRating);
    });
  }

  return (
    <section id="reviews" className="mt-12 scroll-mt-24">
      <h2 className="font-display text-2xl font-semibold text-forest-900">{t('title')}</h2>

      {data.summary.total === 0 ? (
        <p className="mt-3 text-sm text-ink-600">{t('emptyState')}</p>
      ) : (
        <div className="mt-4">
          <ReviewSummaryPanel
            summary={data.summary}
            activeRating={rating}
            onSelectRating={(next) => load(1, next)}
          />
        </div>
      )}

      <div className="mt-5">
        <WriteReview productId={productId} productSlug={productSlug} eligibility={eligibility} />
      </div>

      {data.items.length > 0 && (
        <ul className={cn('mt-6 flex flex-col gap-5', pending && 'opacity-60')}>
          {data.items.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              hasVoted={votedIds.includes(review.id)}
              canVote={eligibility !== null && eligibility.kind !== 'signed_out'}
              onVoted={(voted) =>
                setVotedIds((current) =>
                  voted ? [...current, review.id] : current.filter((id) => id !== review.id),
                )
              }
            />
          ))}
        </ul>
      )}

      {rating !== null && data.items.length === 0 && (
        <p className="mt-6 text-sm text-ink-600">{t('noneAtRating')}</p>
      )}

      {/* Wraps for the same reason as the shop's pagination: the labels are words, not arrows. */}
      {data.pageCount > 1 && (
        <nav aria-label={t('pagination')} className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={data.page <= 1 || pending}
            onClick={() => load(data.page - 1, rating)}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('previous')}
          </button>
          <span className="text-sm text-ink-600" data-numeric>
            {t('pageOf', { page: data.page, total: data.pageCount })}
          </span>
          <button
            type="button"
            disabled={data.page >= data.pageCount || pending}
            onClick={() => load(data.page + 1, rating)}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('next')}
          </button>
        </nav>
      )}
    </section>
  );
}

function ReviewCard({
  review,
  hasVoted,
  canVote,
  onVoted,
}: {
  review: ReviewPage['items'][number];
  hasVoted: boolean;
  canVote: boolean;
  onVoted: (voted: boolean) => void;
}) {
  const t = useTranslations('review');
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState(review.helpfulCount);

  function vote() {
    // Optimistic: the count and the pressed state flip immediately, and the action recomputes
    // `helpful_count` from `review_votes` on the server either way.
    const next = !hasVoted;
    setCount((current) => Math.max(0, current + (next ? 1 : -1)));
    onVoted(next);

    startTransition(async () => {
      const form = new FormData();
      form.set('reviewId', review.id);
      if (hasVoted) form.set('voted', 'true');
      const result = await voteReviewHelpful(null, form);
      if (result && !result.ok) {
        setCount(review.helpfulCount);
        onVoted(!next);
      }
    });
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={cn(
                'size-3.5',
                star <= review.rating ? 'fill-lime-500 text-lime-500' : 'text-line-strong',
              )}
            />
          ))}
        </span>
        <span className="sr-only">{t('starsOf', { count: review.rating })}</span>

        <span className="text-sm font-medium text-ink-900">{review.authorName}</span>

        {review.isVerified && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            {t('verified')}
          </span>
        )}

        <time dateTime={review.createdAt} className="ml-auto text-xs text-ink-500" data-numeric>
          {new Date(review.createdAt).toISOString().slice(0, 10)}
        </time>
      </div>

      {review.title && <p className="mt-2 font-medium text-ink-900">{review.title}</p>}
      {review.body && (
        <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-600">
          {review.body}
        </p>
      )}

      {review.adminReply && (
        <div className="mt-3 rounded-sm border-l-2 border-forest-800 bg-forest-50 p-3">
          <p className="text-xs font-semibold text-forest-900">{t('shopReply')}</p>
          <p className="mt-1 text-sm text-ink-600">{review.adminReply}</p>
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          disabled={!canVote || pending}
          aria-pressed={hasVoted}
          onClick={vote}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors',
            hasVoted ? 'bg-forest-100 text-forest-900' : 'text-ink-600',
            canVote ? 'hover:bg-forest-50' : 'cursor-default',
          )}
        >
          <ThumbsUp className="size-3.5" aria-hidden="true" />
          {t('helpful')}
          {count > 0 && (
            <span data-numeric>
              (<span>{count}</span>)
            </span>
          )}
        </button>
      </div>
    </li>
  );
}

/**
 * The four states of "write a review".
 *
 * `null` while the context loads — deliberately rendering nothing rather than the signed-out
 * prompt, because flashing "sign in to review" at a customer who is signed in and then swapping
 * it is worse than a moment of blank space.
 */
function WriteReview({
  productId,
  productSlug,
  eligibility,
}: {
  productId: string;
  productSlug: string;
  eligibility: ReviewEligibility | null;
}) {
  const t = useTranslations('review');
  const [open, setOpen] = useState(false);

  if (eligibility === null) return null;

  if (eligibility.kind === 'signed_out') {
    return (
      <p className="text-sm text-ink-600">
        {t.rich('signInToReview', {
          link: (chunks) => (
            <Link
              href={`/auth/sign-in?next=/product/${productSlug}`}
              className="rounded-sm text-forest-800 underline underline-offset-4"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    );
  }

  if (eligibility.kind === 'already_reviewed') {
    return <p className="text-sm text-ink-600">{t('alreadyReviewed')}</p>;
  }

  if (eligibility.kind === 'not_purchased') {
    // docs/05 §3 — explain, do not just hide. This is also the friendly explanation docs/12
    // M7 names in its acceptance criteria.
    return <p className="text-sm text-ink-600">{t('onlyBuyersCanReview')}</p>;
  }

  return open ? (
    <ReviewForm productId={productId} onDone={() => setOpen(false)} />
  ) : (
    <button type="button" onClick={() => setOpen(true)} className={buttonVariants({ size: 'sm' })}>
      {t('writeOne')}
    </button>
  );
}

function ReviewForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const t = useTranslations('review');
  /*
   * A second, un-namespaced hook purely for the error branch.
   *
   * `ReviewErrorKey` is a union of **full** message keys (`review.errors.signedOut`) so that
   * `t(result.error)` type-checks against the message file — the point of narrowing the union in
   * docs/02 §7. Resolving them through the `review` namespace would need the prefix stripped at
   * runtime, which is exactly the stringly-typed step the union exists to avoid.
   */
  const tRoot = useTranslations();
  const [state, formAction] = useActionState<ReviewState, FormData>(createReview, null);
  const [rating, setRating] = useState(0);

  if (state?.ok) {
    return (
      <Alert tone="success" title={t('thanksTitle')}>
        {t('thanksBody')}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-line-strong bg-surface p-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="rating" value={rating} />

      <fieldset>
        <legend className="text-sm font-medium text-ink-900">{t('yourRating')}</legend>
        {/*
          Five buttons rather than a hidden radio group so the whole control is reachable by
          keyboard and each star announces the score it sets — "3 out of 5", not "star".
        */}
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-pressed={rating === star}
              aria-label={t('starsOf', { count: star })}
              className="rounded-sm p-0.5"
            >
              <Star
                className={cn(
                  'size-7',
                  star <= rating ? 'fill-lime-500 text-lime-500' : 'text-line-strong',
                )}
              />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <label htmlFor="review-title" className="block text-sm font-medium text-ink-900">
          {t('titleLabel')}
        </label>
        <input
          id="review-title"
          name="title"
          maxLength={120}
          className="mt-1 h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="review-body" className="block text-sm font-medium text-ink-900">
          {t('bodyLabel')}
        </label>
        <textarea
          id="review-body"
          name="body"
          rows={4}
          maxLength={4000}
          className="mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm"
        />
        {/* docs/08 §7 — a customer may say anything about their experience, but the shop must
            not publish a medical claim, and moderation is where that is caught. */}
        <p className="mt-1 text-xs text-ink-500">{t('moderationNote')}</p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" disabled={rating === 0} loadingLabel={t('submitting')}>
          {t('submit')}
        </SubmitButton>
        <button
          type="button"
          onClick={onDone}
          className={buttonVariants({ variant: 'link', size: 'sm' })}
        >
          {t('cancel')}
        </button>
      </div>

      {state && !state.ok && (
        <Alert tone="error" className="mt-3">
          {tRoot(state.error)}
        </Alert>
      )}
    </form>
  );
}
