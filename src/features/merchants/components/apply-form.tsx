'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  submitMerchantApplication,
  type MerchantErrorKey,
  type MerchantState,
} from '@/features/merchants/actions';

/**
 * docs/16 §4 — the application to sell on BioCode.
 *
 * **One page, five sections, submitted once.** The brief asks for a multi-step form that saves as a
 * draft, and that is the right shape for a form somebody returns to — but an applicant has no
 * account yet, so there is nowhere to save a draft *to*. Persisting it would mean either a
 * browser-local copy that vanishes on the applicant's other device, or a half-populated `merchants`
 * row with no owner, which is a row the admin queue would then have to learn to ignore.
 *
 * So the fields are grouped as the steps would have been, every answer stays in the form until it is
 * submitted, and the one genuinely multi-step part — uploading documents — happens *after*
 * submission, when the merchant row and the membership exist and RLS can scope the upload to a
 * folder. That ordering is forced by the storage policy, not chosen.
 */
export function MerchantApplyForm({ commissionDefault }: { commissionDefault: number }) {
  const t = useTranslations('merchant.apply');
  const [state, action] = useActionState<MerchantState, FormData>(
    submitMerchantApplication,
    null,
  );

  if (state?.ok) {
    return (
      <Alert tone="success" title={t('sentTitle')}>
        <p>{t('sentBody')}</p>
        <p className="mt-2">{t('sentNext')}</p>
      </Alert>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-10">
      {state && !state.ok && (
        <Alert tone="error">{t(errorKey(state.error))}</Alert>
      )}

      <Section title={t('identityTitle')} hint={t('identityHint')}>
        <Field name="legalName" label={t('legalName')} hint={t('legalNameHint')} required />
        <Field name="displayName" label={t('displayName')} hint={t('displayNameHint')} required />
        <Field name="businessNo" label={t('businessNo')} hint={t('businessNoHint')} required />
        <Field name="vatNo" label={t('vatNo')} />
      </Section>

      <Section title={t('contactTitle')}>
        <Field name="contactName" label={t('contactName')} required />
        <Field name="contactEmail" label={t('contactEmail')} type="email" hint={t('contactEmailHint')} required />
        <Field name="contactPhone" label={t('contactPhone')} type="tel" required />
      </Section>

      <Section title={t('addressTitle')}>
        <Field name="addressLine" label={t('addressLine')} required />
        <Field name="city" label={t('city')} required />
        <Field name="postalCode" label={t('postalCode')} />
      </Section>

      <Section title={t('catalogTitle')} hint={t('catalogHint')}>
        <Field name="categories" label={t('categories')} textarea required />
        <Field name="catalogSize" label={t('catalogSize')} hint={t('catalogSizeHint')} />
        <Checkbox name="imports" label={t('imports')} hint={t('importsHint')} />
      </Section>

      <Section title={t('bankTitle')} hint={t('bankHint')}>
        <Field name="bankName" label={t('bankName')} required />
        <Field name="iban" label={t('iban')} hint={t('ibanHint')} required />
      </Section>

      <Section title={t('agreeTitle')}>
        <p className="text-sm text-ink-600">
          {t('commissionNote', { pct: commissionDefault })}
        </p>
        <Checkbox name="acceptsCommission" label={t('acceptsCommission')} required />
        <Checkbox
          name="acceptsTerms"
          required
          label={t('acceptsTerms')}
          /*
           * The terms open in a new tab rather than navigating away. A half-completed application
           * lost to a click on the thing the form told the applicant to read would be a form
           * actively punishing the careful reader.
           */
          extra={
            <Link
              href="/legal/marketplace-terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-forest-700 underline underline-offset-4"
            >
              {t('readTerms')}
            </Link>
          }
        />
      </Section>

      <div>
        <SubmitButton size="lg" loadingLabel={t('sending')}>
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}

/** The action's error union → its message key, exhaustively. A new key fails the build here. */
function errorKey(error: MerchantErrorKey) {
  switch (error) {
    case 'merchant.errors.tooMany':
      return 'errorTooMany' as const;
    case 'merchant.errors.duplicate':
      return 'errorDuplicate' as const;
    case 'merchant.errors.invalid':
      return 'errorInvalid' as const;
    case 'admin.errors.forbidden':
      return 'errorGeneric' as const;
    default:
      return 'errorGeneric' as const;
  }
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="font-display text-lg font-semibold text-forest-900">{title}</legend>
      {hint && <p className="-mt-2 text-sm text-ink-600">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  name,
  label,
  hint,
  type = 'text',
  required = false,
  textarea = false,
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <label className={`flex flex-col gap-1 text-sm ${textarea ? 'sm:col-span-2' : ''}`}>
      <span className="font-medium text-ink-900">
        {label}
        {required && (
          <span className="ml-0.5 text-error" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {textarea ? (
        <textarea
          name={name}
          required={required}
          rows={3}
          aria-describedby={hintId}
          className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
        />
      ) : (
        <input
          type={type}
          name={name}
          required={required}
          aria-describedby={hintId}
          className="h-11 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
        />
      )}
      {hint && (
        <span id={hintId} className="text-xs text-ink-600">
          {hint}
        </span>
      )}
    </label>
  );
}

function Checkbox({
  name,
  label,
  hint,
  required = false,
  extra,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="sm:col-span-2">
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name={name}
          required={required}
          className="mt-0.5 size-4 shrink-0 accent-forest-700"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-ink-900">
            {label}
            {required && (
              <span className="ml-0.5 text-error" aria-hidden="true">
                *
              </span>
            )}
          </span>
          {hint && <span className="text-xs text-ink-600">{hint}</span>}
          {extra}
        </span>
      </label>
    </div>
  );
}
