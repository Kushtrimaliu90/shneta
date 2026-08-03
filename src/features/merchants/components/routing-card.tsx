'use client';

import { useActionState } from 'react';
import { AlertTriangle, Banknote, Clock, Star } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  assignFulfilment,
  releaseFulfilment,
  type RoutingState,
} from '@/features/merchants/routing-actions';
import type {
  Candidate,
  FulfilmentLine,
  RoutingQueueRow,
} from '@/features/merchants/routing-queries';
import { firstFailure } from '@/features/merchants/action-state';

/**
 * docs/16 §6 — one routing decision.
 *
 * ── The number an admin is actually choosing on ──
 *
 * Each candidate shows what it **asks** for the whole fulfilment and what **settlement pays** it for
 * the same lines. The gap is BioCode's margin on routing there, and when it is negative routing to that
 * merchant costs money — flagged in cents rather than left for somebody to work out.
 *
 * The candidate holding the stock reservation is marked, because confirming it is the common case and
 * the one that moves nothing: the buy box already chose it at checkout, and re-routing means taking
 * stock off one merchant and putting it on another.
 *
 * Admin UI is English-only (CLAUDE.md §3).
 */
export function RoutingCard({
  row,
  lines,
  candidates,
}: {
  row: RoutingQueueRow;
  lines: FulfilmentLine[];
  candidates: Candidate[];
}) {
  const [state, action] = useActionState<RoutingState, FormData>(
    async (previous, formData) => assignFulfilment(previous, formData),
    null,
  );
  const [releaseState, release] = useActionState<RoutingState, FormData>(
    async (previous, formData) => releaseFulfilment(previous, formData),
    null,
  );

  const failure = firstFailure([state, releaseState]);

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-forest-900" data-numeric>
            {row.orderNumber}
          </h3>
          <p className="text-sm text-ink-600">
            {row.lineCount} line(s), {row.unitCount} unit(s) ·{' '}
            {formatPrice(row.itemsSubtotalCents, 'en')} · placed {row.placedAt.slice(0, 10)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {row.isCod && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/5 px-1.5 py-0.5 text-[11px] font-semibold text-ink-900">
              <Banknote className="size-3.5" aria-hidden="true" />
              COD
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold',
              // 24 h is the acceptance SLA in the terms; a queue item older than that is the problem.
              row.waitingHours >= 24 ? 'bg-error text-white' : 'bg-ink-600 text-white',
            )}
          >
            <Clock className="size-3.5" aria-hidden="true" />
            {row.waitingHours}h
          </span>
        </div>
      </header>

      <ul className="flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li key={line.itemId} className="flex flex-wrap gap-x-2 text-ink-900">
            <span className="font-ui font-semibold" data-numeric>
              ×{line.quantity}
            </span>
            <span>{line.name}</span>
            <span className="text-ink-500">{line.sku}</span>
          </li>
        ))}
      </ul>

      {failure && (
        <p role="alert" className="text-sm text-error">
          {failure.error === 'routing.errors.cannotCover'
            ? 'That merchant can no longer cover every line — its stock moved since this page loaded.'
            : failure.error === 'routing.errors.inProgress'
              ? 'The merchant has already accepted this. Cancel it instead of re-routing.'
              : failure.error === 'admin.errors.forbidden'
                ? 'Routing needs the support or warehouse capability.'
                : 'Could not save the routing decision.'}
        </p>
      )}

      {candidates.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-error/40 bg-error/5 p-4">
          <p className="flex items-start gap-2 text-sm text-ink-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" />
            <span>
              No approved merchant currently holds enough stock for every line. Restock BioCode and
              fulfil it first-party, or cancel the order and tell the customer.
            </span>
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              Merchants that can cover every line of this fulfilment
            </caption>
            <thead>
              <tr className="border-b border-line bg-cream text-left">
                <Th>Merchant</Th>
                <Th>They ask</Th>
                <Th>Settlement pays</Th>
                <Th>BioCode margin</Th>
                <Th>Handling</Th>
                <Th>
                  <span className="sr-only">Assign</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => {
                const margin = candidate.merchantDueCents - candidate.askingTotalCents;
                const loses = margin < 0;

                return (
                  <tr key={candidate.merchantId} className="border-b border-line last:border-0">
                    <td className="px-3 py-3">
                      <p className="font-medium text-ink-900">
                        {candidate.merchantName}
                        {candidate.isCurrent && (
                          <span className="ml-1.5 rounded-sm bg-forest-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-forest-900">
                            holds stock
                          </span>
                        )}
                      </p>
                      <p className="flex items-center gap-1 text-[13px] text-ink-500">
                        <Star className="size-3.5" aria-hidden="true" />
                        {candidate.ratingAvg.toFixed(1)} · {candidate.commissionPct}% commission
                      </p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" data-numeric>
                      {formatPrice(candidate.askingTotalCents, 'en')}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" data-numeric>
                      {formatPrice(candidate.merchantDueCents, 'en')}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 whitespace-nowrap font-medium',
                        loses ? 'text-error' : 'text-forest-900',
                      )}
                      data-numeric
                    >
                      {loses ? '−' : '+'}
                      {formatPrice(Math.abs(margin), 'en')}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {candidate.maxHandlingDays} day(s)
                    </td>
                    <td className="px-3 py-3">
                      <form action={action}>
                        <input type="hidden" name="fulfilmentId" value={row.fulfilmentId} />
                        <input type="hidden" name="merchantId" value={candidate.merchantId} />
                        <SubmitButton
                          size="sm"
                          variant={candidate.isCurrent ? 'primary' : 'secondary'}
                        >
                          {candidate.isCurrent ? 'Confirm' : 'Route here'}
                        </SubmitButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {row.status === 'assigned' && (
        <form action={release} className="border-t border-line pt-4">
          <input type="hidden" name="fulfilmentId" value={row.fulfilmentId} />
          <input type="hidden" name="reason" value="Taken back by BioCode" />
          <SubmitButton size="sm" variant="ghost">
            Take it back
          </SubmitButton>
          {/* Returns the reservation to the merchant: it ships nothing, so it keeps its stock. */}
          <p className="mt-1 text-[13px] text-ink-500">
            Returns this to the queue and gives the merchant its stock back.
          </p>
        </form>
      )}
    </article>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
    >
      {children}
    </th>
  );
}
