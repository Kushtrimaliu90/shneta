'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { changePassword, updateProfile, type FormState } from '@/features/auth/actions';
import { LOCALES } from '@/lib/constants';
import type { Profile } from '@/features/auth/queries';

/** docs/05 §14 — name, phone, locale preference, marketing opt-in. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, formAction] = useActionState<FormState, FormData>(updateProfile, null);
  const t = useTranslations();

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.ok && state.data?.message && <Alert tone="success">{t(state.data.message)}</Alert>}
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <Field
        id="fullName"
        label={t('auth.fields.fullName')}
        errors={fieldErrors?.fullName}
        required
      >
        {(props) => (
          <Input {...props} name="fullName" defaultValue={profile.fullName} autoComplete="name" />
        )}
      </Field>

      {/* Email is changed through Supabase's confirm-both-addresses flow, not here. */}
      <Field id="email" label={t('auth.fields.email')}>
        {(props) => (
          <Input
            {...props}
            name="email"
            defaultValue={profile.email}
            disabled
            readOnly
            required={false}
          />
        )}
      </Field>

      <Field
        id="phone"
        label={t('auth.fields.phone')}
        hint={t('auth.fields.phoneHint')}
        errors={fieldErrors?.phone}
      >
        {(props) => (
          <Input
            {...props}
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={profile.phone ?? ''}
            autoComplete="tel"
            required={false}
          />
        )}
      </Field>

      <Field id="preferredLocale" label={t('account.settings.language')}>
        {(props) => (
          <select
            {...props}
            name="preferredLocale"
            defaultValue={profile.preferredLocale}
            required={false}
            className="h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900"
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {t(`locale.${locale}`)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="marketingOptIn"
          value="true"
          defaultChecked={profile.marketingOptIn}
          className="mt-0.5 size-4 shrink-0 rounded-[3px] border border-line-strong"
        />
        <span className="text-ink-600">{t('auth.signUp.marketing')}</span>
      </label>

      <div>
        <SubmitButton loadingLabel={t('common.loading')}>{t('account.settings.save')}</SubmitButton>
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<FormState, FormData>(changePassword, null);
  const t = useTranslations();

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.ok && state.data?.message && <Alert tone="success">{t(state.data.message)}</Alert>}
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <Field
        id="newPassword"
        label={t('auth.fields.newPassword')}
        hint={t('auth.fields.passwordHint')}
        errors={fieldErrors?.password}
        required
      >
        {(props) => (
          <Input {...props} name="password" type="password" autoComplete="new-password" />
        )}
      </Field>

      <Field
        id="confirmNewPassword"
        label={t('auth.fields.confirmPassword')}
        errors={fieldErrors?.confirmPassword}
        required
      >
        {(props) => (
          <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" />
        )}
      </Field>

      <div>
        <SubmitButton variant="secondary" loadingLabel={t('common.loading')}>
          {t('account.settings.changePassword')}
        </SubmitButton>
      </div>
    </form>
  );
}
