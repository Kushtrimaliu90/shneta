'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { signUp, type FormState } from '@/features/auth/actions';

export function SignUpForm({
  next,
  inviteCode,
}: {
  next?: string;
  /** docs/17 §1 — pre-filled from the `/r/{CODE}` cookie, read on the server. */
  inviteCode?: string | null;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(signUp, null);
  const t = useTranslations();

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  // Success is the same screen whether the address was new or already registered — the
  // action deliberately does not distinguish them (docs/05 §15, no enumeration).
  if (state?.ok) {
    return (
      <Alert tone="success" title={t('auth.signUp.checkEmailTitle')}>
        {t('auth.signUp.checkEmail')}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <input type="hidden" name="next" value={next ?? ''} />

      <Field
        id="fullName"
        label={t('auth.fields.fullName')}
        errors={fieldErrors?.fullName}
        required
      >
        {(props) => <Input {...props} name="fullName" autoComplete="name" />}
      </Field>

      <Field id="email" label={t('auth.fields.email')} errors={fieldErrors?.email} required>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" />}
      </Field>

      <Field
        id="password"
        label={t('auth.fields.password')}
        hint={t('auth.fields.passwordHint')}
        errors={fieldErrors?.password}
        required
      >
        {(props) => (
          <Input {...props} name="password" type="password" autoComplete="new-password" />
        )}
      </Field>

      {/*
        docs/17 §1 — the invite code.
        Last of the fields and marked optional, because it is: most people arrive without one, and a
        code sitting above the password reads like something they were supposed to have.

        The error message is the translated one, not the raw `INVALID_REFERRAL_CODE` that Zod puts in
        `fieldErrors` — that key is used only to decide whether the field is in error.
      */}
      <Field
        id="referralCode"
        label={t('auth.fields.referralCode')}
        hint={t('auth.fields.referralCodeHint')}
        errors={fieldErrors?.referralCode ? [t('auth.errors.invalidReferralCode')] : undefined}
      >
        {(props) => (
          <Input
            {...props}
            name="referralCode"
            defaultValue={inviteCode ?? ''}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            placeholder="BIO-XXXXX"
          />
        )}
      </Field>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="marketingOptIn"
          value="true"
          className="mt-0.5 size-4 shrink-0 rounded-[3px] border border-line-strong"
        />
        <span className="text-ink-600">{t('auth.signUp.marketing')}</span>
      </label>

      <div>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="terms"
            required
            aria-invalid={Boolean(fieldErrors?.terms)}
            aria-describedby={fieldErrors?.terms ? 'terms-error' : undefined}
            className="mt-0.5 size-4 shrink-0 rounded-[3px] border border-line-strong"
          />
          <span className="text-ink-600">
            {t.rich('auth.signUp.terms', {
              terms: (chunks) => (
                <Link href="/legal/terms" className="text-forest-700 underline underline-offset-4">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/legal/privacy"
                  className="text-forest-700 underline underline-offset-4"
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {fieldErrors?.terms && (
          <p id="terms-error" className="mt-1 text-[13px] text-error">
            {t('auth.errors.termsRequired')}
          </p>
        )}
      </div>

      <SubmitButton size="lg" block loadingLabel={t('common.loading')}>
        {t('auth.signUp.submit')}
      </SubmitButton>

      <p className="text-center text-sm text-ink-600">
        {t('auth.signUp.haveAccount')}{' '}
        <Link
          href="/auth/sign-in"
          className="rounded-sm font-medium text-forest-700 underline underline-offset-4"
        >
          {t('auth.signIn.submit')}
        </Link>
      </p>
    </form>
  );
}
