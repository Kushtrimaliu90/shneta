'use client';

import { useActionState } from 'react';
import { EyeOff } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { ORDER_ERRORS, formatAdminDateTime } from '@/features/admin/copy';
import { addInternalNote, type OrderActionState } from '@/features/orders/actions';
import type { OrderEvent } from '@/features/orders/types';

/**
 * docs/06 §2 — the full `order_events` timeline, plus a box to add an internal note.
 *
 * Every event the **staff** timeline shows is here, customer-visible or not, and the ones that
 * are not carry a visible marker. That marker matters more than it looks: an operator writing
 * "customer sounds unhappy, offering a discount" needs to be certain at a glance that the
 * customer will not read it back. Marking the private ones rather than the public ones is the
 * safer default — a missing badge reads as "visible", which is the conservative assumption.
 *
 * The customer's own timeline is a different render and does not filter in TypeScript: RLS
 * (`p_read on order_events`) hides non-visible rows from them entirely, so the private note
 * never reaches the browser.
 */

const TYPE_LABELS: Record<string, string> = {
  created: 'Order placed',
  status_changed: 'Status changed',
  note: 'Note',
  email_sent: 'Email sent',
  payment_update: 'Payment updated',
  refund: 'Refund',
};

export function OrderTimeline({ orderId, events }: { orderId: string; events: OrderEvent[] }) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(addInternalNote, null);

  return (
    <section aria-labelledby="timeline-heading">
      <h2
        id="timeline-heading"
        className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
      >
        Timeline
      </h2>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-ink-600">Nothing recorded yet.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-0">
          {events.map((event) => {
            const when = formatAdminDateTime(event.createdAt);
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2.5 text-sm last:border-0"
              >
                <time
                  dateTime={event.createdAt}
                  title={when.utc}
                  className="w-36 shrink-0 text-xs text-ink-500"
                  data-numeric
                >
                  {when.display}
                </time>
                <span className="font-medium text-forest-900">
                  {TYPE_LABELS[event.type] ?? event.type}
                </span>
                {event.message && <span className="min-w-0 text-ink-600">{event.message}</span>}
                {event.actorName && (
                  <span className="text-xs text-ink-500">by {event.actorName}</span>
                )}
                {!event.isCustomerVisible && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-ink-600 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white">
                    <EyeOff className="size-3" aria-hidden="true" />
                    Internal
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <ActionForm action={formAction} state={state} className="mt-5 max-w-xl">
        <input type="hidden" name="orderId" value={orderId} />
        <label htmlFor="note-message" className="block text-xs font-medium text-ink-900">
          Add an internal note
          <span className="ml-1 font-normal text-ink-500">— the customer never sees this</span>
        </label>
        <textarea
          id="note-message"
          name="message"
          rows={2}
          required
          maxLength={2000}
          className="mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink-900"
        />
        <div className="mt-2">
          <SubmitButton size="sm" variant="secondary" loadingLabel="Saving…">
            Add note
          </SubmitButton>
        </div>

        {state && !state.ok && (
          <Alert tone="error" className="mt-3">
            {ORDER_ERRORS[state.error]}
          </Alert>
        )}
      </ActionForm>
    </section>
  );
}
