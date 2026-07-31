'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  requestCancelOrder,
  type CustomerCancelErrorKey,
  type CustomerCancelState,
} from '@/features/orders/actions';

/**
 * docs/07 §7.4 — a customer cancelling their own order while it is still pending.
 *
 * Two steps, not one. A single "Cancel order" button would sit next to the order total where a
 * mis-tap is easy and the consequence is irreversible — `cancelled` is a terminal state, so
 * there is no undo and support would have to place the order again by hand. Asking for a second
 * click costs one interaction and removes that class of mistake entirely.
 *
 * Not a `confirm()` dialog: those are unstyleable, are suppressed by some browsers, and cannot
 * be read by a screen reader in context. An inline panel with a real heading works everywhere.
 */
export function CustomerCancelForm({ orderNumber }: { orderNumber: string }) {
  const [state, formAction] = useActionState<CustomerCancelState, FormData>(
    requestCancelOrder,
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const t = useTranslations('order.myOrders');
  // Errors come back as full `order.cancel.errors.*` keys, so they resolve from the root.
  const tRoot = useTranslations();

  /**
   * Narrows the action's error union to a literal message key.
   *
   * `t(state.error)` will not typecheck against the generated message types, and the first
   * version of this dodged that by pointing the three errors at whatever nearby strings
   * existed — which meant a "not found" showed the customer a sentence about being too late.
   * A `switch` costs three lines and makes a missing translation a compile error.
   */
  function errorMessage(error: CustomerCancelErrorKey) {
    switch (error) {
      case 'order.cancel.errors.tooLate':
        return tRoot('order.cancel.errors.tooLate');
      case 'order.cancel.errors.notFound':
        return tRoot('order.cancel.errors.notFound');
      default:
        return tRoot('order.cancel.errors.generic');
    }
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          {t('cancel')}
        </button>
        {state && !state.ok && (
          <Alert tone="error" className="mt-3">
            {errorMessage(state.error)}
          </Alert>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-line-strong bg-surface p-4">
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <p className="text-sm font-medium text-ink-900">{t('cancelConfirm')}</p>

      <div className="mt-3 flex items-center gap-3">
        <SubmitButton size="sm" variant="destructive" loadingLabel={t('cancelling')}>
          {t('cancel')}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className={buttonVariants({ variant: 'link', size: 'sm' })}
        >
          {t('keepIt')}
        </button>
      </div>
    </form>
  );
}
