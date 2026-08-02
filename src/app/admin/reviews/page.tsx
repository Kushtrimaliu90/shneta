import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { MessageSquare } from 'lucide-react';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { countReviewsByStatus, listReviewsForModeration } from '@/features/reviews/queries';
import { toReviewStatus, REVIEW_STATUSES } from '@/features/reviews/types';
import { ModerationCard } from '@/features/reviews/components/moderation-card';
import { BulkApprove } from '@/features/reviews/components/bulk-approve';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Reviews' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TAB_LABELS: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Published',
  rejected: 'Rejected',
};

/**
 * docs/06 §10 — the review moderation queue.
 *
 * Pending first and oldest first within it, because this is a queue: the value is in clearing
 * it, and a list ordered newest-first leaves the oldest review permanently at the bottom.
 *
 * Approving purges the product's cache tag — `refresh_product_rating` has just changed the
 * aggregate every card and every listing shows, so the PDP is not the only stale page.
 */
export default async function AdminReviewsPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'reviews.moderate')) redirect('/admin');

  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = toReviewStatus(raw) ?? 'pending';

  const [reviews, counts] = await Promise.all([
    listReviewsForModeration(status),
    countReviewsByStatus(),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold text-carbon-900">Reviews</h1>
      <p className="mt-1 text-sm text-ink-600">
        Every review is read before it is published. Nothing a customer writes appears on the
        storefront until it is approved here.
      </p>

      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-1.5">
        {REVIEW_STATUSES.map((value) => {
          const active = value === status;
          return (
            <Link
              key={value}
              href={`/admin/reviews?status=${value}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                  : 'border-line-strong text-ink-600 hover:bg-carbon-50',
              )}
            >
              {TAB_LABELS[value] ?? value}
              <span className="font-ui text-xs text-ink-600" data-numeric>
                {counts[value] ?? 0}
              </span>
            </Link>
          );
        })}
      </nav>

      {reviews.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <MessageSquare className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-carbon-900">
            {status === 'pending'
              ? 'Nothing is waiting'
              : `No ${TAB_LABELS[status]?.toLowerCase()} reviews`}
          </p>
          <p className="mt-1.5 text-sm text-ink-600">
            {status === 'pending'
              ? 'Reviews appear here as customers write them.'
              : 'Nothing has landed in this state yet.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-4">
            {reviews.map((review) => (
              <ModerationCard key={review.id} review={review} selectable={status === 'pending'} />
            ))}
          </ul>
          {status === 'pending' && <BulkApprove count={reviews.length} />}
        </>
      )}
    </div>
  );
}
