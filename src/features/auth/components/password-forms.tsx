'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Field } from '@/components/ui/field';
import { ActionForm } from '@/components/ui/action-form';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  requestPasswordReset,
  resetPassword,
  sendMagicLink,
  type FormState,
} from '@/features/auth/actions';

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
          className="rounded-sm text-center text-sm text-forest-700 underline underline-offset-4"
        >
          {t('auth.forgotPassword.backToSignIn')}
        </Link>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <ActionForm action={formAction} state={state} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <Field id="email" label={t('auth.fields.email')} errors={fieldErrors?.email} required>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" />}
      </Field>

      <SubmitButton size="lg" block loadingLabel={t('common.loading')}>
        {t('auth.forgotPassword.submit')}
      </SubmitButton>

      <Link
        href="/auth/sign-in"
        className="rounded-sm text-center text-sm text-forest-700 underline underline-offset-4"
      >
        {t('auth.forgotPassword.backToSignIn')}
      </Link>
    </ActionForm>
  );
}

/**
 * Reached through the recovery link, which the callback route has already exchanged for a
 * session — so the user is authenticated here and simply sets a new password.
 */
export function ResetPasswordForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(resetPassword, null);
  const t = useTranslations();

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <ActionForm action={formAction} state={state} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <input type="hidden" name="next" value={next ?? ''} />

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
    </ActionForm>
  );
}

/**
 * docs/05 §15.2 — the sign-in link request.
 *
 * Deliberately the same shape as `ForgotPasswordForm` above: one email field, one button, and one
 * answer whether or not the address has an account. They are the same interaction — "prove you can
 * open this inbox" — and the only difference is what the link does when it lands.
 *
 * Its own page rather than a second button on the sign-in form. Sharing that form would mean one email
 * field serving two actions with a password box between them marked required, and a visitor who wanted
 * a link would have to work out that they should leave it empty. One purpose per page is worth the
 * extra click, and it matches `/auth/forgot-password`, which already works exactly this way.
 */
export function MagicLinkForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(sendMagicLink, null);
  const t = useTranslations();

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={t('auth.magicLink.sentTitle')}>
          {t('auth.magicLink.sent')}
        </Alert>
        <Link
          href="/auth/sign-in"
          className="rounded-sm text-center text-sm text-forest-700 underline underline-offset-4"
        >
          {t('auth.magicLink.backToSignIn')}
        </Link>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <ActionForm action={formAction} state={state} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <input type="hidden" name="next" value={next ?? ''} />

      <Field id="email" label={t('auth.fields.email')} errors={fieldErrors?.email} required>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" />}
      </Field>

      <SubmitButton size="lg" block loadingLabel={t('common.loading')}>
        {t('auth.magicLink.submit')}
      </SubmitButton>

      <Link
        href="/auth/sign-in"
        className="rounded-sm text-center text-sm text-forest-700 underline underline-offset-4"
      >
        {t('auth.magicLink.backToSignIn')}
      </Link>
    </ActionForm>
  );
}
