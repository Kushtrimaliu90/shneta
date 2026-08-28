'use client';

import { useActionState, useState } from 'react';
import { BadgeCheck, Star } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { RemoveControl } from '@/components/ui/remove-control';
import { FormLevelErrors } from '@/components/ui/field-error';
import {
  deleteReview,
  moderateReview,
  type ModerationErrorKey,
  type ModerationState,
} from '@/features/reviews/actions';
import type { ModerationReview } from '@/features/reviews/types';
import { cn } from '@/lib/utils';

/**
 * docs/06 §10 — one review in the moderation queue.
 *
 * English strings inline, like the rest of the panel: the admin has no next-intl provider
 * (docs/01 §3), so a `Record` keyed on the error union is what makes a missing message a
 * compile error.
 */
const ERRORS: Record<ModerationErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that action.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.reviews.errors.notFound': 'That review no longer exists.',
  'admin.reviews.errors.reasonRequired':
    'A rejection needs a reason — the customer is shown it, and "no reason" reads as the review being lost.',
  'admin.reviews.errors.replyRequired': 'Write the reply before sending it.',
  // The specific reason arrives in `fieldErrors._form` and is rendered under this line.
  'admin.reviews.errors.deleteBlocked': 'This cannot be deleted yet.',
};

export function ModerationCard({
  review,
  selectable,
}: {
  review: ModerationReview;
  selectable: boolean;
}) {
  const [state, formAction] = useActionState<ModerationState, FormData>(moderateReview, null);
  const [mode, setMode] = useState<'idle' | 'reject' | 'reply'>('idle');

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {selectable && (
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            {/*
              Part of the surrounding bulk-approve form, not this card's own form: a checkbox
              inside a nested form would not be submitted with the outer one.
            */}
            <input
              type="checkbox"
              name="reviewIds"
              value={review.id}
              form="bulk-approve"
              className="size-4 rounded-[3px] border border-line-strong"
            />
            <span className="sr-only">Select for bulk approval</span>
          </label>
        )}

        <span className="flex" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={cn(
                'size-3.5',
                star <= review.rating ? 'fill-forest-500 text-forest-500' : 'text-line-strong',
              )}
            />
          ))}
        </span>
        <span className="sr-only">{review.rating} out of 5</span>

        <span className="text-sm font-medium text-ink-900">{review.authorName}</span>

        {review.isVerified && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <BadgeCheck className="size-3.5" aria-hidden="true" />
            Verified purchase
          </span>
        )}

        <a
          href={`/en/product/${review.productSlug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-xs text-forest-800 underline underline-offset-4"
        >
          {review.productSlug} ↗
        </a>

        <time dateTime={review.createdAt} className="ml-auto text-xs text-ink-500" data-numeric>
          {review.createdAt.slice(0, 10)}
        </time>
      </div>

      {review.title && <p className="mt-2 font-medium text-ink-900">{review.title}</p>}
      {review.body ? (
        <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-600">
          {review.body}
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-500">A rating with no text.</p>
      )}

      {review.rejectionReason && (
        <p className="mt-2 text-xs text-ink-600">Rejected: {review.rejectionReason}</p>
      )}

      {review.adminReply && (
        <div className="mt-2 rounded-sm border-l-2 border-forest-800 bg-forest-50 p-2.5 text-sm text-ink-600">
          {review.adminReply}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {review.status !== 'approved' && (
          <form action={formAction}>
            <input type="hidden" name="reviewId" value={review.id} />
            <input type="hidden" name="action" value="approve" />
            <SubmitButton size="sm" loadingLabel="Approving…">
              Approve
            </SubmitButton>
          </form>
        )}

        {review.status !== 'rejected' && mode !== 'reject' && (
          <button
            type="button"
            onClick={() => setMode('reject')}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Reject…
          </button>
        )}

        {mode !== 'reply' && (
          <button
            type="button"
            onClick={() => setMode('reply')}
            className={buttonVariants({ variant: 'link', size: 'sm' })}
          >
            {review.adminReply ? 'Edit reply' : 'Reply publicly'}
          </button>
        )}
      </div>

      {mode === 'reject' && (
        <ActionForm action={formAction} state={state} className="mt-3 border-t border-line pt-3">
          <input type="hidden" name="reviewId" value={review.id} />
          <input type="hidden" name="action" value="reject" />
          <label htmlFor={`reason-${review.id}`} className="block text-xs font-medium text-ink-900">
            Why is this not being published?
          </label>
          <textarea
            id={`reason-${review.id}`}
            name="reason"
            rows={2}
            required
            className="mt-1 w-full max-w-xl rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-500">Shown to the customer on their reviews page.</p>
          <div className="mt-2 flex items-center gap-2">
            <SubmitButton size="sm" variant="destructive" loadingLabel="Rejecting…">
              Reject
            </SubmitButton>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className={buttonVariants({ variant: 'link', size: 'sm' })}
            >
              Cancel
            </button>
          </div>
        </ActionForm>
      )}

      {mode === 'reply' && (
        <ActionForm action={formAction} state={state} className="mt-3 border-t border-line pt-3">
          <input type="hidden" name="reviewId" value={review.id} />
          <input type="hidden" name="action" value="reply" />
          <label htmlFor={`reply-${review.id}`} className="block text-xs font-medium text-ink-900">
            Public reply
          </label>
          <textarea
            id={`reply-${review.id}`}
            name="reply"
            rows={2}
            required
            defaultValue={review.adminReply ?? ''}
            className="mt-1 w-full max-w-xl rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-500">
            {/* docs/08 §7 — a shop reply is shop copy, and the claims rules apply to it. */}
            Shown under the review on the product page. The claims rules apply here too.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <SubmitButton size="sm" loadingLabel="Saving…">
              Publish reply
            </SubmitButton>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className={buttonVariants({ variant: 'link', size: 'sm' })}
            >
              Cancel
            </button>
          </div>
        </ActionForm>
      )}

      {state && !state.ok && (
        <Alert tone="error" className="mt-3">
          {ERRORS[state.error]}
          <FormLevelErrors errors={state.fieldErrors ?? {}} />
        </Alert>
      )}

      {/*
        Delete, for spam — not a third moderation outcome.

        Set apart from the Approve/Reject row and only offered once the review is not approved, because
        rejecting is the action that takes a review off the product page *and* out of the star rating,
        reversibly, with a reason the customer sees. Deleting is for the case where there is nothing worth
        keeping and nobody to explain it to, and it cannot be undone: the rating trigger fires on DELETE,
        so the stars correct themselves, and the audit row is the only copy left.
      */}
      {review.status !== 'approved' && (
        <div className="mt-3 border-t border-line pt-3">
          <RemoveControl
            action={deleteReview}
            hiddenFields={{ reviewId: review.id }}
            label={review.title || `${review.rating}-star review by ${review.authorName}`}
            noun="review"
            errorCopy={ERRORS}
            consequences={[
              'Not recoverable. The star rating recalculates itself; the audit log keeps what the review said.',
            ]}
          />
        </div>
      )}
    </li>
  );
}
