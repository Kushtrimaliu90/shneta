'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { ORDER_ERRORS, TRANSITION_LABELS } from '@/features/admin/copy';
import {
  cancelOrder,
  createShipment,
  refundOrder,
  transitionOrder,
  type OrderActionState,
} from '@/features/orders/actions';
import { allowedTransitions, canRefund, type OrderStatus } from '@/features/orders/types';
import { fromCents, formatPrice } from '@/lib/money';

/**
 * docs/06 §2 — the header actions on an order.
 *
 * Buttons are rendered from `allowedTransitions`, so an illegal one is **absent** rather than
 * present-and-failing. The database is still the authority (`orders_before_status_change`), and
 * the gap between the two is real: two operators on the same order means the second gets
 * `invalidTransition`, which is why that error has its own sentence telling them to reload.
 *
 * Each action is its own `<form>` rather than one form with a hidden intent field, so every
 * button posts exactly what it means and `useFormStatus` disables only the one being pressed.
 *
 * "Notify customer" defaults to on, as the spec requires. It is a real checkbox and not a
 * hidden default, because the case for turning it off is real — re-confirming an order after
 * fixing a typo should not send a second confirmation.
 */

function ActionError({ state }: { state: OrderActionState }) {
  if (!state || state.ok) return null;
  return (
    <Alert tone="error" className="mt-3">
      {ORDER_ERRORS[state.error]}
    </Alert>
  );
}

/** The shared "notify customer" checkbox (docs/06 §2). */
function NotifyToggle({ id }: { id: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-ink-600">
      <input
        id={id}
        type="checkbox"
        name="notify"
        value="true"
        defaultChecked
        className="size-4 rounded-[3px] border border-line-strong"
      />
      Notify customer
    </label>
  );
}

export function OrderTransitions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(transitionOrder, null);
  // `shipped` is reached through the shipment dialog, which collects tracking as it goes.
  const targets = allowedTransitions(status).filter(
    (target) => target !== 'cancelled' && target !== 'shipped',
  );

  if (targets.length === 0) return <ActionError state={state} />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {targets.map((target) => (
          <form key={target} action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="to" value={target} />
            <input type="hidden" name="notify" value="true" />
            <SubmitButton size="sm" loadingLabel="Working…">
              {TRANSITION_LABELS[target] ?? target}
            </SubmitButton>
          </form>
        ))}
      </div>
      <ActionError state={state} />
    </div>
  );
}

/** docs/06 §2 — the shipment dialog: carrier, tracking, then the order becomes `shipped`. */
export function ShipmentForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(createShipment, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ size: 'sm' })}
      >
        Mark shipped…
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-md border border-line-strong bg-surface p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <h3 className="font-display text-sm font-semibold text-forest-900">Shipment details</h3>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label htmlFor="carrier" className="block text-xs font-medium text-ink-900">
            Courier
          </label>
          <input
            id="carrier"
            name="carrier"
            required
            className="mt-1 h-10 w-full rounded-sm border border-line-strong px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="trackingNumber" className="block text-xs font-medium text-ink-900">
            Tracking number
          </label>
          <input
            id="trackingNumber"
            name="trackingNumber"
            required
            className="mt-1 h-10 w-full rounded-sm border border-line-strong px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="trackingUrl" className="block text-xs font-medium text-ink-900">
            Tracking link <span className="text-ink-500">(optional)</span>
          </label>
          <input
            id="trackingUrl"
            name="trackingUrl"
            type="url"
            placeholder="https://…"
            className="mt-1 h-10 w-full rounded-sm border border-line-strong px-3 text-sm"
          />
        </div>

        <NotifyToggle id="notify-ship" />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save and mark shipped
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonVariants({ variant: 'link', size: 'sm' })}
        >
          Cancel
        </button>
      </div>

      <ActionError state={state} />
    </form>
  );
}

/** Cancelling asks for a reason: it goes on the timeline and into the customer's email. */
export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(cancelOrder, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        Cancel order…
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-md border border-error/40 bg-surface p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <h3 className="font-display text-sm font-semibold text-forest-900">Cancel this order</h3>
      <p className="mt-1 text-xs text-ink-600">
        Stock goes back automatically. This cannot be undone.
      </p>

      <div className="mt-3">
        <label htmlFor="cancel-reason" className="block text-xs font-medium text-ink-900">
          Reason (the customer sees this)
        </label>
        <input
          id="cancel-reason"
          name="reason"
          required
          minLength={3}
          className="mt-1 h-10 w-full rounded-sm border border-line-strong px-3 text-sm"
        />
      </div>

      <div className="mt-3">
        <NotifyToggle id="notify-cancel" />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" variant="destructive" loadingLabel="Cancelling…">
          Cancel order
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonVariants({ variant: 'link', size: 'sm' })}
        >
          Keep it
        </button>
      </div>

      <ActionError state={state} />
    </form>
  );
}

/**
 * docs/07 §7.3 — the refund dialog.
 *
 * Pre-filled with the **remaining** amount, not the order total, so the common case (refund
 * what is left) is one click and a partial refund is an edit rather than a calculation. The cap
 * itself is enforced by `refunds_after_insert`; this is convenience, and the error exists for
 * the case where two operators refund at once.
 */
export function RefundForm({
  orderId,
  totalCents,
  refundedCents,
}: {
  orderId: string;
  totalCents: number;
  refundedCents: number;
}) {
  const [state, formAction] = useActionState<OrderActionState, FormData>(refundOrder, null);
  const [open, setOpen] = useState(false);

  const remaining = Math.max(0, totalCents - refundedCents);
  if (remaining === 0) {
    return (
      <p className="text-xs text-ink-600">Fully refunded ({formatPrice(refundedCents, 'en')}).</p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        Refund…
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-md border border-line-strong bg-surface p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <h3 className="font-display text-sm font-semibold text-forest-900">Issue a refund</h3>
      <p className="mt-1 text-xs text-ink-600">
        Up to {formatPrice(remaining, 'en')} remaining
        {refundedCents > 0 ? ` — ${formatPrice(refundedCents, 'en')} already refunded` : ''}.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label htmlFor="refund-amount" className="block text-xs font-medium text-ink-900">
            Amount (EUR)
          </label>
          <input
            id="refund-amount"
            name="amount"
            required
            inputMode="decimal"
            defaultValue={fromCents(remaining)}
            className="mt-1 h-10 w-40 rounded-sm border border-line-strong px-3 text-sm"
            data-numeric
          />
        </div>
        <div>
          <label htmlFor="refund-reason" className="block text-xs font-medium text-ink-900">
            Reason
          </label>
          <input
            id="refund-reason"
            name="reason"
            required
            minLength={3}
            className="mt-1 h-10 w-full rounded-sm border border-line-strong px-3 text-sm"
          />
        </div>

        <label htmlFor="refund-restock" className="flex items-start gap-2 text-xs text-ink-600">
          <input
            id="refund-restock"
            type="checkbox"
            name="restock"
            value="true"
            className="mt-0.5 size-4 rounded-[3px] border border-line-strong"
          />
          {/* docs/07 §7.3 — v1 restocks on a full refund only; say so rather than imply more. */}
          <span>Return items to stock (full refunds only in this version)</span>
        </label>

        <NotifyToggle id="notify-refund" />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Refunding…">
          Issue refund
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonVariants({ variant: 'link', size: 'sm' })}
        >
          Cancel
        </button>
      </div>

      <ActionError state={state} />
    </form>
  );
}

/** Groups the destructive and money actions, shown only where they are legal. */
export function OrderDangerZone({
  orderId,
  status,
  totalCents,
  refundedCents,
  mayRefund,
}: {
  orderId: string;
  status: OrderStatus;
  totalCents: number;
  refundedCents: number;
  mayRefund: boolean;
}) {
  const cancellable = allowedTransitions(status).includes('cancelled');
  const refundable = mayRefund && canRefund(status);

  if (!cancellable && !refundable) return null;

  return (
    <div className="mt-8 border-t border-line pt-6">
      <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
        Cancel and refund
      </h2>
      <div className="mt-3 flex flex-col gap-4">
        {cancellable && <CancelOrderForm orderId={orderId} />}
        {refundable && (
          <RefundForm orderId={orderId} totalCents={totalCents} refundedCents={refundedCents} />
        )}
      </div>
    </div>
  );
}
