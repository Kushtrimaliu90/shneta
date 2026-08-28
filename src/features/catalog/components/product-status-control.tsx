'use client';

import { useActionState, useState } from 'react';
import { Copy } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { RemoveControl } from '@/components/ui/remove-control';
import {
  approveProduct,
  duplicateProduct,
  rejectProduct,
  removeProduct,
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
  productName,
  status,
  blockers,
  mayEdit,
  mayApprove,
}: {
  productId: string;
  /** Named in the removal confirmation, so it asks about a product rather than about a row. */
  productName: string;
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
  /*
   * No state read from this one: on success it redirects into the copy's editor, so there is nothing to
   * render afterwards. A failure still surfaces through the shared `error` below.
   */
  const [duplicateState, duplicateAction] = useActionState<CatalogState, FormData>(
    duplicateProduct,
    null,
  );
  const [rejecting, setRejecting] = useState(false);

  /*
   * Only `approved_by` matters to the guard once the other three are satisfied, but the
   * checklist counts all four — so "everything except approval" is what makes the approve
   * button meaningful.
   */
  const onlyNeedsApproval =
    blockers.length === 0 || (blockers.length === 1 && blockers[0]?.includes('approval'));

  const error = [statusState, approveState, rejectState, duplicateState].find(
    (state) => state && !state.ok,
  );

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="eyebrow">Status</h2>

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

        {/*
          Duplicate — docs/06 §3 asked for it and it was never built.

          Available at every status, including published: copying a live product is the common case, since
          the thing worth copying is usually the one already finished. The copy always arrives as an
          unapproved draft, so this cannot put anything on the shop.
        */}
        {mayEdit && (
          <form action={duplicateAction}>
            <input type="hidden" name="productId" value={productId} />
            <SubmitButton size="sm" variant="secondary" loadingLabel="Copying…">
              <Copy className="size-3.5" aria-hidden="true" />
              Duplicate
            </SubmitButton>
          </form>
        )}

        {/*
          Remove, at the far right and only when the product is not live.
          The action refuses a published product anyway, but offering a button that can only say no is
          worse than not offering it: archiving is the step it would tell them to take, and that button is
          already right here.
        */}
        {mayEdit && status !== 'published' && (
          <div className="ml-auto">
            <RemoveControl
              action={removeProduct}
              hiddenFields={{ productId }}
              label={productName}
              noun="product"
              errorCopy={CATALOG_ERRORS}
            />
          </div>
        )}
      </div>

      {rejecting && (
        <ActionForm
          action={rejectAction}
          state={rejectState}
          className="mt-4 border-t border-line pt-3"
        >
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
        </ActionForm>
      )}

      {error && !error.ok && (
        <Alert tone="error" className="mt-3">
          {CATALOG_ERRORS[error.error]}
        </Alert>
      )}
    </div>
  );
}
