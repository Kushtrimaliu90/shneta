'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { lookupOrder, type LookupState } from '@/features/checkout/lookup-action';

/**
 * docs/05 §13 — order number plus email.
 *
 * On success the action redirects, so this component only ever renders the form and the one
 * generic failure message. The order itself is rendered server-side on the next page.
 */
export function OrderLookupForm() {
  const [state, formAction] = useActionState<LookupState, FormData>(lookupOrder, null);
  const t = useTranslations();

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      {/*
        `defaultValue` from the returned state, so a failed attempt does not wipe a
        20-character order number the customer was already unsure of. `key` is not needed:
        the inputs are uncontrolled and React keeps the newest defaultValue on re-render.
      */}
      <Field
        id="orderNumber"
        label={t('order.lookup.orderNumberLabel')}
        hint={t('order.lookup.orderNumberHint')}
        required
      >
        {(props) => (
          <Input
            {...props}
            name="orderNumber"
            autoComplete="off"
            defaultValue={state?.values.orderNumber}
          />
        )}
      </Field>

      <Field id="email" label={t('order.lookup.emailLabel')} required>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state?.values.email}
          />
        )}
      </Field>

      <SubmitButton size="lg" block loadingLabel={t('order.lookup.searching')}>
        {t('order.lookup.submit')}
      </SubmitButton>
    </form>
  );
}
