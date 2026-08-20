'use client';

import { useActionState, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { decideBatch, type DecideBatchState } from '@/features/merchants/batch-actions';
import { decideProposal, type ProposalState } from '@/features/merchants/proposal-actions';
import type { BatchWithRows } from '@/features/merchants/batch-queries';

/**
 * docs/16 §9.1 — reviewing a pasted catalogue.
 *
 * ── A table, not two hundred cards ──
 *
 * The single-proposal card shows one product's whole argument, which is right when somebody is deciding one
 * product. Two hundred of them is a scroll nobody finishes, and a reviewer reading a catalogue is doing a
 * different job: scanning for the rows that are wrong. So the rows are a table with the four columns that
 * decide it — the product, what identifies it, what they hold, what they would ask — and the photographs as
 * thumbnails, because "is this the real box?" cannot be answered from a filename.
 *
 * ── Reject per row, approve the batch ──
 *
 * The asymmetry is the design. Rejecting is a judgement about one product and needs its own reason the
 * merchant can act on, so each row has its own form. Approving is a judgement about the sheet, so it is one
 * action that takes every row still pending — and leaves rows already rejected exactly as they are.
 *
 * Admin UI is English-only (CLAUDE.md §3).
 */
export function BatchReview({ batch }: { batch: BatchWithRows }) {
  const [panel, setPanel] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  const [state, action] = useActionState<DecideBatchState, FormData>(async (previous, formData) => {
    const result = await decideBatch(previous, formData);
    if (result?.ok) setPanel(null);
    return result;
  }, null);

  const [rowState, rowAction] = useActionState<ProposalState, FormData>(
    async (previous, formData) => {
      const result = await decideProposal(previous, formData);
      if (result?.ok) setRejecting(null);
      return result;
    },
    null,
  );

  const open = batch.status === 'pending';
  const pending = batch.rows.filter(
    (row) => row.status === 'pending' || row.status === 'needs_info',
  );
  const rejected = batch.rows.filter((row) => row.status === 'rejected');
  const withoutImages = pending.filter((row) => row.imagePaths.length === 0).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900">
            {batch.merchantName ?? 'Merchant'} — {batch.rowCount} row(s)
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            sent {batch.createdAt.slice(0, 10)} · {pending.length} still pending · {rejected.length}{' '}
            rejected
          </p>
          {batch.note && <p className="mt-1 text-sm text-ink-900">{batch.note}</p>}
        </div>
        <span className="bg-ink-100 rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-900">
          {batch.status}
        </span>
      </header>

      {/*
        Said before approving, not after.

        Approving copies each row's photographs onto its draft product, and a row with none produces a draft
        the catalogue team has to photograph itself. That is a legitimate outcome — but it should be a choice.
      */}
      {open && withoutImages > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-ink-900">
          <span data-numeric>{withoutImages}</span> of {pending.length} pending row(s) have no
          photographs. Those drafts will need images before they can be published.
        </p>
      )}

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.error === 'admin.errors.forbidden'
            ? 'Deciding a batch needs the product-manager capability.'
            : 'Could not record the decision. A rejection needs a note of at least five characters.'}
        </p>
      )}

      {state?.ok && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-success">
          {state.data.decided} row(s) decided. {state.data.promoted} draft product(s) created
          {state.data.awaiting > 0 && `, ${state.data.awaiting} queued for the nightly job`}.
        </p>
      )}

      {open && (
        <div className="flex flex-wrap gap-2 border-b border-line pb-4">
          <Button size="sm" onClick={() => setPanel(panel === 'approve' ? null : 'approve')}>
            Approve the {pending.length} pending row(s)
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setPanel(panel === 'reject' ? null : 'reject')}
          >
            Reject the whole batch
          </Button>
        </div>
      )}

      {panel && (
        <ActionForm
          action={action}
          state={state}
          className="flex flex-col gap-3 rounded-md border border-line bg-cream p-4"
        >
          <input type="hidden" name="batchId" value={batch.id} />
          <input type="hidden" name="decision" value={panel} />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">
              {panel === 'approve'
                ? 'Note for the merchant (optional)'
                : 'Why the batch is rejected'}
            </span>
            <textarea
              name="note"
              rows={3}
              required={panel === 'reject'}
              minLength={panel === 'reject' ? 5 : 0}
              className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
            />
            <span className="text-xs text-ink-600">
              {panel === 'approve'
                ? 'Every row still pending becomes an approved proposal and then a draft product. Rows you rejected individually stay rejected.'
                : 'Every row still pending is rejected with this note. The merchant reads it.'}
            </span>
          </label>

          <div className="flex gap-2">
            <SubmitButton size="sm" variant={panel === 'reject' ? 'destructive' : 'primary'}>
              {panel === 'approve' ? 'Approve' : 'Reject'}
            </SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      )}

      {rowState && !rowState.ok && (
        <p role="alert" className="text-sm text-error">
          Could not reject that row. A note of at least five characters is required.
        </p>
      )}

      <ScrollRegion label="Proposed products in this batch">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">Proposed products in this batch</caption>
          <thead>
            <tr className="border-b border-line-strong text-left">
              <Th>Product</Th>
              <Th>Identifiers</Th>
              <Th>Hold</Th>
              <Th>Ask</Th>
              <Th>Photographs</Th>
              <Th>Status</Th>
              {open && <Th>Reject</Th>}
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row) => (
              <tr key={row.id} className="border-b border-line align-top">
                <Td>
                  <span className="font-medium text-ink-900">{row.productName}</span>
                  <span className="block text-[13px] text-ink-500">
                    {row.brandName}
                    {row.form && ` · ${row.form}`}
                    {row.variantName && ` · ${row.variantName}`}
                  </span>
                  {row.note && (
                    <span className="mt-1 block text-[13px] whitespace-pre-line text-ink-600">
                      {row.note}
                    </span>
                  )}
                </Td>
                <Td>
                  {row.barcode ? <span data-numeric>{row.barcode}</span> : '—'}
                  {row.merchantSku && (
                    <span className="block font-ui text-[11px] text-ink-500">
                      {row.merchantSku}
                    </span>
                  )}
                  {row.sourceUrl && (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-forest-800 underline"
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      source
                    </a>
                  )}
                </Td>
                <Td>{row.stockOnHand}</Td>
                <Td>{formatPrice(row.askingPriceCents, 'en')}</Td>
                <Td>
                  {row.imagePaths.length === 0 ? (
                    <span className="text-[13px] text-ink-500">none</span>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {row.imagePaths.map((path) => {
                        const src = `/admin/merchants/proposal-image?path=${encodeURIComponent(path)}`;
                        return (
                          <li key={path}>
                            <a href={src} target="_blank" rel="noopener noreferrer">
                              {/*
                                A plain `img`: the source redirects to a signed URL on a private bucket,
                                which the optimiser cannot fetch and should not cache.
                              */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={src}
                                alt={`Proposed product photograph — ${row.productName}`}
                                className="size-12 rounded-sm border border-line object-cover"
                              />
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Td>
                <Td>
                  <span
                    className={cn(
                      'rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold whitespace-nowrap',
                      row.status === 'approved'
                        ? 'bg-success text-white'
                        : row.status === 'rejected'
                          ? 'bg-error text-white'
                          : row.status === 'needs_info'
                            ? 'bg-warning text-white'
                            : 'bg-ink-600 text-white',
                    )}
                  >
                    {row.status.replace('_', ' ')}
                  </span>
                  {row.reviewerNote && (
                    <span className="mt-1 block text-[13px] text-ink-600">{row.reviewerNote}</span>
                  )}
                  {row.createdProductId && (
                    <a
                      href={`/admin/products/${row.createdProductId}`}
                      className="mt-1 block text-[13px] text-forest-800 underline"
                    >
                      draft product
                    </a>
                  )}
                </Td>

                {open && (
                  <Td>
                    {row.status === 'rejected' ? (
                      <span className="text-[13px] text-ink-500">—</span>
                    ) : rejecting === row.id ? (
                      <ActionForm
                        action={rowAction}
                        state={rowState}
                        className="flex flex-col gap-1.5"
                      >
                        <input type="hidden" name="proposalId" value={row.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <label className="flex flex-col gap-1">
                          <span className="sr-only">Why {row.productName} is rejected</span>
                          <textarea
                            name="note"
                            rows={2}
                            required
                            minLength={5}
                            placeholder="Why not?"
                            className="w-44 rounded-sm border border-line-strong bg-surface p-1.5 text-[13px]"
                          />
                        </label>
                        <div className="flex gap-1">
                          <SubmitButton size="sm" variant="destructive">
                            Reject
                          </SubmitButton>
                          <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>
                            Cancel
                          </Button>
                        </div>
                      </ActionForm>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setRejecting(row.id)}>
                        Reject
                      </Button>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="py-2 pr-3 text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-2 pr-3 text-ink-900">{children}</td>;
}
