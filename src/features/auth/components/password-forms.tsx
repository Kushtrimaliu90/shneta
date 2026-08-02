'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { requestPasswordReset, resetPassword, type FormState } from '@/features/auth/actions';

/** docs/05 §15 — always answers "if the email exists, we sent a link". */
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<FormState, FormData>(requestPasswordReset, null);
  const t = useTranslations();

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('auth.forgotPassword.sentTitle')}>
          {t('auth.forgotPassword.sent')}
        </Alert>
        <Link
          href="/auth/sign-in"
          className="rounded-sm text-center text-sm text-carbon-700 underline underline-offset-4"
        >
          {t('auth.forgotPassword.backToSignIn')}
        </Link>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <Field id="email" label={t('auth.fields.email')} errors={fieldErrors?.email} required>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" />}
      </Field>

      <SubmitButton size="lg" block loadingLabel={t('common.loading')}>
        {t('auth.forgotPassword.submit')}
      </SubmitButton>

      <Link
        href="/auth/sign-in"
        className="rounded-sm text-center text-sm text-carbon-700 underline underline-offset-4"
      >
        {t('auth.forgotPassword.backToSignIn')}
      </Link>
    </form>
  );
}

/**
 * Reached through the recovery link, which the callback route has already exchanged for a
 * session — so the user is authenticated here and simply sets a new password.
 */
export function ResetPasswordForm() {
  const [state, formAction] = useActionState<FormState, FormData>(resetPassword, null);
  const t = useTranslations();

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <Field
        id="password"
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
        id="confirmPassword"
        label={t('auth.fields.confirmPassword')}
        errors={fieldErrors?.confirmPassword}
        required
      >
        {(props) => (
          <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" />
        )}
      </Field>

      <SubmitButton size="lg" block loadingLabel={t('common.loading')}>
        {t('auth.resetPassword.submit')}
      </SubmitButton>
    </form>
  );
}
