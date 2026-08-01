'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { approveProduct, rejectProduct, type CatalogState } from '@/features/catalog/admin-actions';

/**
 * docs/06 §14 — approve or reject, from the queue.
 *
 * The same two actions the product page header offers, deliberately duplicated here rather than
 * making the reviewer open each product: the queue already shows them the claim-bearing fields,
 * so sending them elsewhere to act on what they just read is a round trip for nothing.
 *
 * Rejection requires a note and the note is not optional — a product sent back with no reason
 * costs the product manager a conversation to find out what to change.
 */
export function ComplianceReview({ productId }: { productId: string }) {
  const [approveState, approveAction] = useActionState<CatalogState, FormData>(
    approveProduct,
    null,
  );
  const [rejectState, rejectAction] = useActionState<CatalogState, FormData>(rejectProduct, null);
  const [rejecting, setRejecting] = useState(false);

  const error = [approveState, rejectState].find((state) => state && !state.ok);

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={approveAction}>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="publish" value="true" />
          <SubmitButton size="sm" loadingLabel="Publishing…">
            Approve and publish
          </SubmitButton>
        </form>

        {/*
          Approve-and-publish or reject. Not "approve without publishing", even though the action
          supports it and an approved draft is a legitimate state: `approveProduct` with
          `publish: false` leaves the status at `pending_review`, so the item would stay in this
          queue with no sign it had been dealt with, and the next reviewer would read it again.

          A queue whose items do not leave when you act on them is broken. Making it work needs a
          status the schema does not have — "approved, awaiting launch" — which is docs/07 §10
          work, not something to improvise here. The product page is where an approval without a
          publication belongs, because it shows the approval state directly.
        */}
        {!rejecting && (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Reject…
          </button>
        )}
      </div>

      {rejecting && (
        <form action={rejectAction} className="mt-3">
          <label htmlFor={`reject-${productId}`} className="block text-xs font-medium text-ink-900">
            What has to change?
          </label>
          <input type="hidden" name="productId" value={productId} />
          <textarea
            id={`reject-${productId}`}
            name="note"
            rows={2}
            required
            minLength={3}
            className="mt-1 w-full max-w-xl rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-500">
            Recorded in the audit log. There is no automatic notification yet — tell the product
            manager directly.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <SubmitButton size="sm" variant="destructive" loadingLabel="Rejecting…">
              Reject and return to draft
            </SubmitButton>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className={buttonVariants({ variant: 'link', size: 'sm' })}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && !error.ok && (
        <Alert tone="error" className="mt-3">
          {CATALOG_ERRORS[error.error]}
        </Alert>
      )}
    </div>
  );
}
