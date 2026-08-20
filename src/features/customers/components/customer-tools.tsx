'use client';

import { useActionState, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  adjustLoyalty,
  anonymizeCustomer,
  type CustomerErrorKey,
  type CustomerState,
} from '@/features/customers/actions';

const CUSTOMER_ERRORS: Record<CustomerErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that action.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.customers.errors.checkFields': 'Check the fields marked below.',
  'admin.customers.errors.notFound': 'That customer no longer exists.',
  'admin.customers.errors.insufficientPoints':
    'That would take the balance below zero. Check the ledger.',
  'admin.customers.errors.staffProtected':
    'Staff accounts cannot be erased — it would orphan their audit trail. Deactivate them in Settings → Team instead.',
  'admin.customers.errors.confirmMismatch':
    'That is not this customer’s email address. Nothing was changed.',
};

function errorOf(state: CustomerState): string | null {
  if (!state || state.ok) return null;
  const field = Object.values(state.fieldErrors ?? {})[0]?.[0];
  return field ?? CUSTOMER_ERRORS[state.error as CustomerErrorKey];
}

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

/** docs/06 §9 — manual points adjustment, with the mandatory note. */
export function LoyaltyAdjuster({ userId, balance }: { userId: string; balance: number }) {
  const [state, action] = useActionState<CustomerState, FormData>(adjustLoyalty, null);
  const error = errorOf(state);

  return (
    <ActionForm action={action} state={state} className="mt-3 flex flex-wrap items-start gap-3">
      <input type="hidden" name="userId" value={userId} />

      <div className="w-32">
        <label htmlFor="points" className={labelClass}>
          Points
        </label>
        <input
          id="points"
          name="points"
          type="number"
          placeholder="50"
          required
          className={inputClass}
          data-numeric
        />
        <p className="mt-1 text-[11px] text-ink-500">
          Balance <span data-numeric>{balance}</span>. Minus to take away.
        </p>
      </div>

      <div className="min-w-64 flex-1">
        <label htmlFor="loyalty-note" className={labelClass}>
          Reason <span className="text-error">*</span>
        </label>
        <input
          id="loyalty-note"
          name="note"
          required
          placeholder="Goodwill after a late delivery…"
          className={inputClass}
        />
      </div>

      <div className="pt-5">
        <SubmitButton size="sm" variant="secondary" loadingLabel="Applying…">
          Apply
        </SubmitButton>
      </div>

      {state?.ok && state.data.balance !== undefined && (
        <Alert tone="success" className="w-full">
          Done — the balance is now <span data-numeric>{state.data.balance}</span> points.
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="w-full">
          {error}
        </Alert>
      )}
    </ActionForm>
  );
}

/**
 * docs/06 §9 — erasure.
 *
 * Behind a disclosure, and gated on retyping the email. Both are deliberate friction on the one
 * action in the panel that cannot be undone: an operator who has typed the address has, by
 * definition, checked which account they are about to erase.
 */
export function AnonymizeCustomer({ userId, email }: { userId: string; email: string }) {
  const [state, action] = useActionState<CustomerState, FormData>(anonymizeCustomer, null);
  const [open, setOpen] = useState(false);
  const error = errorOf(state);

  if (state?.ok) {
    return (
      <Alert tone="success" className="mt-3">
        This customer has been erased. The orders remain, without their name, contact details or
        address.
      </Alert>
    );
  }

  return (
    <div className="mt-3">
      {!open ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Erase this customer&rsquo;s data
        </Button>
      ) : (
        <ActionForm
          action={action}
          state={state}
          className="rounded-lg border border-error bg-error/5 p-4"
        >
          <input type="hidden" name="userId" value={userId} />

          <p className="flex items-start gap-2 text-sm font-medium text-ink-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" />
            This cannot be undone.
          </p>
          <p className="mt-2 max-w-prose text-sm text-ink-600">
            The name, email, phone and addresses are removed from the profile, every order and every
            subscription. Orders themselves are kept — totals, dates and the delivery city — because
            the business has already reported on them and the law requires they be retained. The
            person can no longer sign in.
          </p>

          <label htmlFor="confirm-email" className="mt-3 block text-xs font-medium text-ink-900">
            Type <span className="font-mono">{email}</span> to confirm
          </label>
          <input
            id="confirm-email"
            name="confirmEmail"
            autoComplete="off"
            required
            className="mt-1 h-10 w-full max-w-sm rounded-sm border border-line-strong bg-surface px-3 text-sm"
          />

          <div className="mt-3 flex items-center gap-2">
            <SubmitButton size="sm" variant="destructive" loadingLabel="Erasing…">
              Erase permanently
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}
        </ActionForm>
      )}
    </div>
  );
}
