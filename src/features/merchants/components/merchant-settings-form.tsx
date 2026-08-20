'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateMerchantProfile, type ProfileState } from '@/features/merchants/profile-actions';
import type { MyMerchant } from '@/features/merchants/queries';
import { settingsErrorLeaf } from '@/features/merchants/error-keys';

/**
 * docs/16 §5 — the merchant's own details.
 *
 * The read-only block at the top is not decoration: those are the fields the merchant *cannot* change
 * and the ones they will look for first. Showing them greyed out with a reason is the difference
 * between "this is fixed by our agreement" and "this form is broken".
 *
 * The IBAN field is empty and stays empty. The portal only ever holds the last four digits, so there
 * is nothing to prefill with that is both safe and correct — and an empty field that means "unchanged"
 * cannot be saved back over a real IBAN by somebody who just wanted to fix a phone number.
 */
export function MerchantSettingsForm({ merchant }: { merchant: MyMerchant }) {
  const t = useTranslations('merchant.settings');
  const [state, action] = useActionState<ProfileState, FormData>(
    async (previous, formData) => updateMerchantProfile(previous, formData),
    null,
  );

  const [settlement, setSettlement] = useState(merchant.settlementMethod);

  const { address } = merchant;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="fixed" className="flex flex-col gap-3">
        <h3 id="fixed" className="font-display text-lg font-semibold text-forest-900">
          {t('fixedTitle')}
        </h3>
        <p className="text-sm text-ink-600">{t('fixedIntro')}</p>

        <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-cream p-4 text-sm sm:grid-cols-2">
          <Row label={t('legalName')}>{merchant.legalName}</Row>
          <Row label={t('displayName')}>{merchant.displayName}</Row>
          <Row label={t('commission')}>{merchant.commissionPct}%</Row>
          <Row label={t('contactEmail')}>{merchant.contactEmail}</Row>
        </dl>
      </section>

      <ActionForm action={action} state={state} className="flex flex-col gap-5">
        <section aria-labelledby="editable" className="flex flex-col gap-4">
          <h3 id="editable" className="font-display text-lg font-semibold text-forest-900">
            {t('editableTitle')}
          </h3>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="contactName" label={t('contactName')} required>
              {(field) => (
                <Input {...field} name="contactName" defaultValue={merchant.contactName} />
              )}
            </Field>

            <Field id="contactPhone" label={t('contactPhone')} required>
              {(field) => (
                <Input
                  {...field}
                  name="contactPhone"
                  type="tel"
                  defaultValue={merchant.contactPhone}
                />
              )}
            </Field>

            <Field id="addressLine" label={t('addressLine')} required>
              {(field) => <Input {...field} name="addressLine" defaultValue={address.line1} />}
            </Field>

            <Field id="city" label={t('city')} required>
              {(field) => <Input {...field} name="city" defaultValue={address.city} />}
            </Field>

            <Field id="postalCode" label={t('postalCode')}>
              {(field) => <Input {...field} name="postalCode" defaultValue={address.postalCode} />}
            </Field>
          </div>
        </section>

        <section aria-labelledby="bank" className="flex flex-col gap-4">
          <h3 id="bank" className="font-display text-lg font-semibold text-forest-900">
            {t('settlementTitle')}
          </h3>
          <p className="text-sm text-ink-600">{t('settlementIntro')}</p>

          {/*
            Switchable, because a merchant who started on cash and later opened a business account
            should not have to reapply to be paid into it. Switching *to* bank transfer with nothing
            on file is refused by the action — the portal holds only the last four digits, so whether
            an IBAN exists is a question about the stored row, not this form.
          */}
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t('settlementTitle')}</legend>
            {(['bank_transfer', 'cash'] as const).map((method) => (
              <label key={method} className="flex items-start gap-2.5 text-sm">
                <input
                  type="radio"
                  name="settlementMethod"
                  value={method}
                  checked={settlement === method}
                  onChange={() => setSettlement(method)}
                  className="mt-0.5 size-4 shrink-0 accent-forest-700"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-ink-900">
                    {method === 'cash' ? t('settlementCash') : t('settlementBank')}
                  </span>
                  <span className="text-xs text-ink-600">
                    {method === 'cash' ? t('settlementCashHint') : t('settlementBankHint')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {settlement === 'bank_transfer' && (
            <>
              <p className="text-sm text-ink-600">{t('bankIntro')}</p>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="bankName" label={t('bankName')} required>
                  {(field) => (
                    <Input {...field} name="bankName" defaultValue={merchant.bankName ?? ''} />
                  )}
                </Field>

                <Field
                  id="iban"
                  label={t('iban')}
                  hint={
                    merchant.ibanLast4
                      ? t('ibanHintOnFile', { last4: merchant.ibanLast4 })
                      : t('ibanHintNone')
                  }
                >
                  {(field) => (
                    <Input
                      {...field}
                      name="iban"
                      autoComplete="off"
                      placeholder={t('ibanPlaceholder')}
                    />
                  )}
                </Field>
              </div>
            </>
          )}
        </section>

        {state?.ok && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-success">
            {t('saved')}
          </p>
        )}
        {state && !state.ok && (
          <Alert tone="error">{t(`errors.${settingsErrorLeaf(state.error)}`)}</Alert>
        )}

        <div>
          <SubmitButton>{t('save')}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{children}</dd>
    </div>
  );
}
