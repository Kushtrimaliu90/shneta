'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import {
  approveProduct,
  rejectProduct,
  setProductStatus,
  type CatalogState,
} from '@/features/catalog/admin-actions';

/**
 * docs/07 §10 — draft → pending_review → published | back to draft with a note.
 *
 * Each role sees only its own half of the workflow, which is the point: a product manager can
 * submit but not approve, and compliance can approve but not edit the claims they are approving.
 * Giving one person both would make the review a formality.
 *
 * "Approve and publish" is **disabled while blockers remain** rather than hidden. Hiding it
 * would leave compliance wondering whether they lack the permission or the product lacks a
 * photo; disabled next to a checklist answers that without them asking anyone.
 */
export function ProductStatusControl({
  productId,
  status,
  blockers,
  mayEdit,
  mayApprove,
}: {
  productId: string;
  status: string;
  blockers: string[];
  mayEdit: boolean;
  mayApprove: boolean;
}) {
  const [statusState, statusAction] = useActionState<CatalogState, FormData>(
    setProductStatus,
    null,
  );
  const [approveState, approveAction] = useActionState<CatalogState, FormData>(
    approveProduct,
    null,
  );
  const [rejectState, rejectAction] = useActionState<CatalogState, FormData>(rejectProduct, null);
  const [rejecting, setRejecting] = useState(false);

  /*
   * Only `approved_by` matters to the guard once the other three are satisfied, but the
   * checklist counts all four — so "everything except approval" is what makes the approve
   * button meaningful.
   */
  const onlyNeedsApproval =
    blockers.length === 0 || (blockers.length === 1 && blockers[0]?.includes('approval'));

  const error = [statusState, approveState, rejectState].find((state) => state && !state.ok);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
        Status
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {mayEdit && status === 'draft' && (
          <form action={statusAction}>
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="to" value="pending_review" />
            <SubmitButton size="sm" loadingLabel="Submitting…">
              Submit for review
            </SubmitButton>
          </form>
        )}

        {mayEdit && status === 'pending_review' && (
          <form action={statusAction}>
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="to" value="draft" />
            <SubmitButton size="sm" variant="secondary" loadingLabel="Working…">
              Withdraw from review
            </SubmitButton>
          </form>
        )}

        {mayApprove && status !== 'published' && (
          <form action={approveAction} className="flex items-center gap-2">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="publish" value="true" />
            <SubmitButton size="sm" disabled={!onlyNeedsApproval} loadingLabel="Publishing…">
              Approve and publish
            </SubmitButton>
            {!onlyNeedsApproval && (
              <span className="text-xs text-ink-500">Blocked — see the checklist above.</span>
            )}
          </form>
        )}

        {mayApprove && status === 'pending_review' && !rejecting && (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Reject…
          </button>
        )}

        {mayEdit && status === 'published' && (
          <form action={statusAction}>
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="to" value="archived" />
            <SubmitButton size="sm" variant="secondary" loadingLabel="Archiving…">
              Archive
            </SubmitButton>
          </form>
        )}

        {mayEdit && status === 'archived' && (
          <form action={statusAction}>
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="to" value="draft" />
            <SubmitButton size="sm" variant="secondary" loadingLabel="Restoring…">
              Restore to draft
            </SubmitButton>
          </form>
        )}
      </div>

      {rejecting && (
        <form action={rejectAction} className="mt-4 border-t border-line pt-3">
          <input type="hidden" name="productId" value={productId} />
          <label htmlFor="reject-note" className="block text-xs font-medium text-ink-900">
            Why is this being sent back?
          </label>
          <textarea
            id="reject-note"
            name="note"
            rows={2}
            required
            minLength={3}
            className="mt-1 w-full max-w-xl rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-500">
            {/*
              Honest about a v1 limitation rather than implying a notification exists.
              docs/06 §14 wants the product manager notified; there is no in-app notification
              surface yet, so the note lands in the audit log and has to be passed on.
            */}
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
