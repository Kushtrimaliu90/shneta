'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Plus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm, useSubmitted } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  deleteAddress,
  saveAddress,
  setDefaultAddress,
  type AddressState,
} from '@/features/account/address-actions';
import type { AddressRow } from '@/features/account/addresses';
import { cn } from '@/lib/utils';

/**
 * docs/05 §14 — the address book.
 *
 * One form per address, each posting its own action, for the reason the product editor gives:
 * a single form spanning every address would make "save" mean four things.
 */
export function AddressBook({ addresses }: { addresses: AddressRow[] }) {
  const t = useTranslations('account.addresses');
  const [creating, setCreating] = useState(false);
  const stopCreating = useCallback(() => setCreating(false), []);

  return (
    <div>
      <div className="mb-4">
        {creating ? (
          <AddressForm address={null} onDone={stopCreating} />
        ) : (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t('add')}
          </Button>
        )}
      </div>

      {addresses.length === 0 && !creating ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <MapPin className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">{t('empty')}</p>
          <p className="mt-1.5 text-sm text-ink-600">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((address) => (
            <AddressCard key={address.id} address={address} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddressCard({ address }: { address: AddressRow }) {
  const t = useTranslations('account.addresses');
  const [editing, setEditing] = useState(false);
  const stopEditing = useCallback(() => setEditing(false), []);

  const [deleteState, deleteAction] = useActionState<AddressState, FormData>(deleteAddress, null);
  const [defaultState, defaultAction] = useActionState<AddressState, FormData>(
    setDefaultAddress,
    null,
  );

  const failure = [deleteState, defaultState].find((state) => state && !state.ok);

  if (editing) {
    return (
      <li className="sm:col-span-2">
        <AddressForm address={address} onDone={stopEditing} />
      </li>
    );
  }

  return (
    <li
      className={cn(
        'rounded-lg border bg-surface p-4',
        address.isDefaultShipping ? 'border-forest-800' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-ink-900">
          {address.label || address.recipientName}
          {address.isDefaultShipping && (
            <span className="ml-2 rounded-sm bg-forest-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-forest-900">
              {t('defaultBadge')}
            </span>
          )}
        </p>
      </div>

      <address className="mt-1 text-sm text-ink-600 not-italic">
        <span className="block">{address.recipientName}</span>
        <span className="block">
          {address.line1}
          {address.line2 && <>, {address.line2}</>}
        </span>
        <span className="block">
          {address.postalCode && <span data-numeric>{address.postalCode} </span>}
          {address.city}
        </span>
        <span className="block" data-numeric>
          {address.phone}
        </span>
      </address>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>

        {!address.isDefaultShipping && (
          <form action={defaultAction}>
            <input type="hidden" name="id" value={address.id} />
            <SubmitButton size="sm" variant="ghost" loadingLabel={t('saving')}>
              {t('makeDefault')}
            </SubmitButton>
          </form>
        )}

        <form action={deleteAction} className="ml-auto">
          <input type="hidden" name="id" value={address.id} />
          <SubmitButton size="sm" variant="ghost" loadingLabel={t('saving')}>
            {t('remove')}
          </SubmitButton>
        </form>
      </div>

      {failure && !failure.ok && (
        <Alert tone="error" className="mt-3">
          {t(`errors.${failure.error.split('.').pop()}` as 'errors.generic')}
        </Alert>
      )}
    </li>
  );
}

const inputClass =
  'mt-1 h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900';
const labelClass = 'block text-sm font-medium text-ink-900';

/** Zod issue codes are identifiers; a person needs a sentence. */
const FIELD_MESSAGES: Record<string, string> = {
  REQUIRED: 'This is required.',
  INVALID_PHONE: 'A number like +383 44 123 456.',
};

function AddressForm({ address, onDone }: { address: AddressRow | null; onDone: () => void }) {
  const t = useTranslations('account.addresses');
  const [state, action] = useActionState<AddressState, FormData>(saveAddress, null);

  const error = (field: string): string | null => {
    if (!state || state.ok) return null;
    const issue = state.fieldErrors?.[field]?.[0];
    return issue ? (FIELD_MESSAGES[issue] ?? issue) : null;
  };

  // An effect, not a check during render: setting the parent's state while rendering a child
  // cascades, and it would re-fire on every render once the result had arrived.
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const key = address?.id ?? 'new';

  return (
    <ActionForm
      action={action}
      state={state}
      className="rounded-lg border border-line-strong bg-surface p-4"
    >
      {address && <input type="hidden" name="id" value={address.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`label-${key}`} className={labelClass}>
            {t('labelLabel')}
          </label>
          <input
            id={`label-${key}`}
            name="label"
            defaultValue={address?.label ?? ''}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-600">{t('labelHint')}</p>
        </div>

        <Field
          id={`recipient-${key}`}
          name="recipientName"
          label={t('recipient')}
          defaultValue={address?.recipientName ?? ''}
          error={error('recipientName')}
          required
          autoComplete="name"
        />
        <Field
          id={`phone-${key}`}
          name="phone"
          label={t('phone')}
          defaultValue={address?.phone ?? ''}
          error={error('phone')}
          required
          autoComplete="tel"
          inputMode="tel"
        />
        <Field
          id={`line1-${key}`}
          name="line1"
          label={t('line1')}
          defaultValue={address?.line1 ?? ''}
          error={error('line1')}
          required
          autoComplete="address-line1"
          className="sm:col-span-2"
        />
        <Field
          id={`line2-${key}`}
          name="line2"
          label={t('line2')}
          defaultValue={address?.line2 ?? ''}
          error={error('line2')}
          autoComplete="address-line2"
          className="sm:col-span-2"
        />
        <Field
          id={`city-${key}`}
          name="city"
          label={t('city')}
          defaultValue={address?.city ?? ''}
          error={error('city')}
          required
          autoComplete="address-level2"
        />
        <Field
          id={`postal-${key}`}
          name="postalCode"
          label={t('postalCode')}
          defaultValue={address?.postalCode ?? ''}
          error={error('postalCode')}
          autoComplete="postal-code"
        />
      </div>

      {/*
        Kosovo only in v1 (docs/07 §5), so the country is shown rather than chosen — a select with
        one option is a control that does nothing. The value is fixed server-side regardless.
      */}
      <p className="mt-3 text-sm text-ink-600">
        {t('country')}: <span className="text-ink-900">Kosovë (XK)</span>
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          name="isDefaultShipping"
          defaultChecked={address?.isDefaultShipping ?? false}
          className="size-4 rounded-sm border-line-strong"
        />
        {t('defaultShipping')}
      </label>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton loadingLabel={t('saving')}>{t('save')}</SubmitButton>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>

      {state && !state.ok && (
        <Alert tone="error" className="mt-3">
          {t(`errors.${state.error.split('.').pop()}` as 'errors.generic')}
        </Alert>
      )}
    </ActionForm>
  );
}

function Field({
  id,
  name,
  label,
  defaultValue,
  error,
  required,
  autoComplete,
  inputMode,
  className,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  error: string | null;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'tel';
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={useSubmitted(name, defaultValue)}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[13px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}
