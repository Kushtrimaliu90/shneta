import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Star } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { ProductImage } from '@/components/storefront/product-image';
import { listOwnReviews } from '@/features/reviews/queries';
import type { ReviewStatus } from '@/features/reviews/types';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — per-visitor, never cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'review.account',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

const STATUS_TONE: Record<ReviewStatus, string> = {
  pending: 'bg-warning text-white',
  approved: 'bg-success text-white',
  rejected: 'bg-ink-600 text-white',
};

/**
 * docs/05 §14 — the customer's own reviews, at every status.
 *
 * The page exists mainly for the two states the PDP cannot show: a review waiting to be read,
 * and one that was not published. A customer who writes something and never sees it again
 * assumes it was lost — so the pending note says a person reads each one, and a rejection
 * carries the moderator's reason rather than vanishing.
 *
 * Scoped by RLS, not by a filter here: `p_read on reviews` returns your own rows at any status.
 */
export default async function AccountReviewsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [reviews, t] = await Promise.all([listOwnReviews(), getTranslations('review.account')]);

  if (reviews.length === 0) {
    return (
      <div>
        <h2 className="font-display text-2xl font-semibold text-forest-900">{t('title')}</h2>
        <EmptyState icon={Star} title={t('empty')} body={t('emptyHint')} className="mt-6" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-forest-900">{t('title')}</h2>

      <ul className="mt-6 flex flex-col gap-4">
        {reviews.map((review) => {
          const productName = pickLocale(review.productName, locale);

          return (
            <li key={review.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex gap-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-sm bg-cream">
                  <ProductImage
                    path={review.productImagePath}
                    alt={productName}
                    sizes="64px"
                    className="size-16 p-1.5"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/product/${review.productSlug}`}
                      className="rounded-sm font-medium text-forest-800 underline underline-offset-4"
                    >
                      {productName}
                    </Link>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
                        STATUS_TONE[review.status],
                      )}
                    >
                      {t(
                        review.status === 'approved'
                          ? 'statusApproved'
                          : review.status === 'rejected'
                            ? 'statusRejected'
                            : 'statusPending',
                      )}
                    </span>
                  </div>

                  <span className="mt-1.5 flex" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={cn(
                          'size-3.5',
                          star <= review.rating
                            ? 'fill-lime-500 text-lime-500'
                            : 'text-line-strong',
                        )}
                      />
                    ))}
                  </span>

                  {review.title && (
                    <p className="mt-1.5 font-medium text-ink-900">{review.title}</p>
                  )}
                  {review.body && (
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-600">
                      {review.body}
                    </p>
                  )}

                  {review.status === 'pending' && (
                    <p className="mt-2 text-xs text-ink-500">{t('pendingNote')}</p>
                  )}
                  {review.status === 'rejected' && review.rejectionReason && (
                    <p className="mt-2 text-xs text-ink-600">
                      {t('rejectedNote', { reason: review.rejectionReason })}
                    </p>
                  )}
                  {review.adminReply && (
                    <div className="mt-2 rounded-sm border-l-2 border-forest-800 bg-forest-50 p-2.5 text-sm text-ink-600">
                      {review.adminReply}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
