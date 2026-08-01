'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { bulkApproveReviews, type ModerationState } from '@/features/reviews/actions';

/**
 * docs/06 §10 — bulk approve.
 *
 * An **empty** form element that the checkboxes in each card attach to by `form="bulk-approve"`.
 * The alternative is wrapping the whole list in a form, which would nest the per-card reject and
 * reply forms inside it — invalid HTML, and browsers respond by dropping the inner ones, so the
 * reject button would silently submit the outer form instead.
 */
export function BulkApprove({ count }: { count: number }) {
  const [state, formAction] = useActionState<ModerationState, FormData>(bulkApproveReviews, null);

  if (count === 0) return null;

  return (
    <div className="mt-4">
      <form id="bulk-approve" action={formAction}>
        <SubmitButton size="sm" variant="secondary" loadingLabel="Approving…">
          Approve selected
        </SubmitButton>
      </form>
      <p className="mt-1 text-xs text-ink-500">
        Tick the reviews above, then approve them together. Nothing is selected by default —
        approving in bulk is for a queue you have already read.
      </p>
      {state && !state.ok && (
        <Alert tone="error" className="mt-3">
          Something went wrong. Please try again.
        </Alert>
      )}
    </div>
  );
}
