'use client';

import { useActionState, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { decideProposal, type ProposalState } from '@/features/merchants/proposal-actions';
import type { Proposal } from '@/features/merchants/proposal-queries';

/**
 * docs/16 §4 — deciding one proposal.
 *
 * The card shows the two things that let a reviewer verify the product exists and can be imported legally
 * — the barcode and the merchant's source link — beside the two that decide whether the margin works: the
 * stock they hold and what they would ask. Nothing else is asked of the merchant, because everything else
 * belongs to the canonical product BioCode writes.
 *
 * `needs_info` is a real outcome here, unlike on a merchant application. The RLS policy lets a merchant
 * *edit and resubmit* a proposal in that state, which is the whole point of asking.
 *
 * Admin UI is English-only (CLAUDE.md §3).
 */
export function ProposalReview({ proposal }: { proposal: Proposal }) {
  const [panel, setPanel] = useState<'reject' | 'info' | 'approve' | null>(null);

  const [state, action] = useActionState<ProposalState, FormData>(
    async (previous, formData) => {
      const result = await decideProposal(previous, formData);
      if (result?.ok) setPanel(null);
      return result;
    },
    null,
  );

  const open = proposal.status === 'pending' || proposal.status === 'needs_info';

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-forest-900">
            {proposal.productName}
          </h3>
          <p className="text-sm text-ink-600">
            {proposal.brandName}
            {proposal.form && ` · ${proposal.form}`}
            {proposal.variantName && ` · ${proposal.variantName}`}
          </p>
          <p className="mt-1 text-sm text-ink-900">
            <span className="font-medium">{proposal.merchantName ?? 'Merchant'}</span>
            <span className="text-ink-500"> · proposed {proposal.createdAt.slice(0, 10)}</span>
          </p>
        </div>

        <span className="rounded-sm bg-ink-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-900">
          {proposal.status.replace('_', ' ')}
        </span>
      </header>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Row label="They hold">{proposal.stockOnHand} unit(s)</Row>
        <Row label="They ask">{formatPrice(proposal.askingPriceCents, 'en')}</Row>
        <Row label="Barcode">
          {proposal.barcode ? <span data-numeric>{proposal.barcode}</span> : '—'}
        </Row>
        <Row label="Source">
          {proposal.sourceUrl ? (
            <a
              href={proposal.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 text-forest-800 underline"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              open
            </a>
          ) : (
            '—'
          )}
        </Row>
      </dl>

      <div>
        <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
          What the merchant says
        </p>
        <p className="mt-1 text-sm whitespace-pre-line text-ink-900">{proposal.note}</p>
      </div>

      {proposal.reviewerNote && (
        <p className="rounded-md border border-line bg-cream p-3 text-sm text-ink-900">
          <span className="font-medium">Reviewer note:</span> {proposal.reviewerNote}
        </p>
      )}

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.error === 'admin.errors.forbidden'
            ? 'Reviewing proposals needs the product-manager capability.'
            : 'Could not save the decision. A note of at least five characters is required to reject or ask for more.'}
        </p>
      )}

      {open && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" onClick={() => setPanel(panel === 'approve' ? null : 'approve')}>
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPanel(panel === 'info' ? null : 'info')}
          >
            Ask for more
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setPanel(panel === 'reject' ? null : 'reject')}
          >
            Reject
          </Button>
        </div>
      )}

      {panel && (
        <form action={action} className="flex flex-col gap-3 rounded-md border border-line bg-cream p-4">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input
            type="hidden"
            name="decision"
            value={panel === 'approve' ? 'approve' : panel === 'reject' ? 'reject' : 'needs_info'}
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">
              {panel === 'approve'
                ? 'What did you create? (optional)'
                : panel === 'reject'
                  ? 'Why this is rejected'
                  : 'What is missing'}
            </span>
            <textarea
              name="note"
              rows={3}
              required={panel !== 'approve'}
              minLength={panel === 'approve' ? 0 : 5}
              className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
            />
            <span className="text-xs text-ink-600">
              {panel === 'approve'
                ? 'The merchant reads this. Tell them the product name or SKU so they can make an offer on it.'
                : 'The merchant reads this, and a proposal returned for more information can be edited and resubmitted.'}
            </span>
          </label>

          <div className="flex gap-2">
            <SubmitButton size="sm" variant={panel === 'reject' ? 'destructive' : 'primary'}>
              {panel === 'approve' ? 'Approve' : panel === 'reject' ? 'Reject' : 'Send request'}
            </SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="text-ink-900">{children}</dd>
    </div>
  );
}
