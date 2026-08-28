'use client';

import { useActionState, useMemo, useState } from 'react';
import { BulkCheckbox, BulkDecideBar } from '@/features/merchants/components/bulk-decide';
import { OfferReview } from '@/features/merchants/components/offer-review';
import { ProposalReview } from '@/features/merchants/components/proposal-review';
import { decideOffersBulk, type BulkOfferState } from '@/features/merchants/offer-actions';
import { decideProposalsBulk, type BulkProposalState } from '@/features/merchants/proposal-actions';
import { OFFER_BULK_MAX, PROPOSAL_BULK_MAX } from '@/features/merchants/decisions';
import type { ReviewOffer } from '@/features/merchants/offer-admin-queries';
import type { Proposal } from '@/features/merchants/proposal-queries';

/**
 * A review queue with multi-select.
 *
 * ── Why the selection lives here and not in the bar ──
 *
 * "Select all" and the per-row boxes have to agree, so exactly one component may own the set. That has to
 * be the one rendering both, which is this. The bar gets the array and two callbacks; the cards get a
 * checkbox each. Neither holds selection state of its own.
 *
 * ── Why the checkbox sits beside the card rather than inside it ──
 *
 * Every card already contains its own single-decision form. An input inside that form would submit with
 * it, so the checkbox carries `form="<bulk form id>"` to belong to the bar's form instead — and putting it
 * in the gutter rather than threading a prop through the card keeps the single-decision components
 * untouched. They were correct before this feature and are unchanged by it.
 *
 * ── Selection is cleared only on a decision that changed something ──
 *
 * `revalidatePath` re-renders the list, so a decided row leaves the queue and its id would otherwise
 * linger in the set, counting toward a total that no longer contains it. Rows that were skipped stay
 * selected on purpose: they are exactly what the reviewer may want to look at and try again.
 */

/** Cleared on any decision that moved at least one row. */
function useSelection<T extends { id: string }>(rows: readonly T[]) {
  const [selected, setSelected] = useState<string[]>([]);

  /*
   * Intersected with what is on screen, every render. A revalidation removes decided rows, and an id
   * that no longer exists must not sit in the set inflating the count or riding along in the next
   * submission.
   */
  const present = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const live = useMemo(() => selected.filter((id) => present.has(id)), [selected, present]);

  return {
    selected: live,
    isSelected: (id: string) => present.has(id) && live.includes(id),
    toggle: (id: string) =>
      setSelected((current) =>
        current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
      ),
    selectAll: () => setSelected(rows.map((row) => row.id)),
    clear: () => setSelected([]),
  };
}

const FORM_ID = 'bulk-decide';

export function OfferReviewQueue({ offers }: { offers: ReviewOffer[] }) {
  const selection = useSelection(offers);

  const [state, action] = useActionState<BulkOfferState, FormData>(async (previous, formData) => {
    const result = await decideOffersBulk(previous, formData);
    if (result?.ok && result.data.decided > 0) selection.clear();
    return result;
  }, null);

  const labelFor = (id: string) => offers.find((offer) => offer.id === id)?.sku;

  return (
    <div className="flex flex-col gap-4">
      <BulkDecideBar
        formId={FORM_ID}
        action={action}
        state={state}
        selected={selection.selected}
        total={offers.length}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
        cap={OFFER_BULK_MAX}
        nouns={{ one: 'offer', many: 'offers' }}
        labelFor={labelFor}
      />

      <ul className="flex flex-col gap-4">
        {offers.map((offer) => (
          <li key={offer.id} className="flex items-start gap-3">
            <div className="pt-6">
              <BulkCheckbox
                formId={FORM_ID}
                fieldName="offerIds"
                id={offer.id}
                label={`${offer.sku} from ${offer.merchantName}`}
                checked={selection.isSelected(offer.id)}
                onToggle={selection.toggle}
              />
            </div>
            <div className="min-w-0 flex-1">
              <OfferReview offer={offer} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProposalReviewQueue({
  proposals,
  nightlyRate,
}: {
  proposals: Proposal[];
  /** How many drafts the housekeeping cron creates per run, so the report can be honest about the tail. */
  nightlyRate: number;
}) {
  const selection = useSelection(proposals);

  const [state, action] = useActionState<BulkProposalState, FormData>(
    async (previous, formData) => {
      const result = await decideProposalsBulk(previous, formData);
      if (result?.ok && result.data.decided > 0) selection.clear();
      return result;
    },
    null,
  );

  const labelFor = (id: string) => proposals.find((proposal) => proposal.id === id)?.productName;

  return (
    <div className="flex flex-col gap-4">
      <BulkDecideBar
        formId={FORM_ID}
        action={action}
        state={state}
        selected={selection.selected}
        total={proposals.length}
        onSelectAll={selection.selectAll}
        onClear={selection.clear}
        cap={PROPOSAL_BULK_MAX}
        nouns={{ one: 'proposal', many: 'proposals' }}
        labelFor={labelFor}
        nightlyRate={nightlyRate}
      />

      <ul className="flex flex-col gap-4">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="flex items-start gap-3">
            <div className="pt-6">
              <BulkCheckbox
                formId={FORM_ID}
                fieldName="proposalIds"
                id={proposal.id}
                label={`${proposal.productName} from ${proposal.merchantName ?? 'merchant'}`}
                checked={selection.isSelected(proposal.id)}
                onToggle={selection.toggle}
              />
            </div>
            <div className="min-w-0 flex-1">
              <ProposalReview proposal={proposal} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
