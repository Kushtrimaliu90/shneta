'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { signIn, type FormState } from '@/features/auth/actions';

/**
 * docs/05 §15. Progressive enhancement throughout: this is a real `<form action={…}>`, so
 * it submits and works before hydration.
 *
 * `error` from the action is a message key, never prose, so it is translated here
 * (CLAUDE.md §3).
 */
export function SignInForm({
  next,
  linkError,
  /**
   * A social sign-in that came back without a session. Reported on this form rather than beside the
   * provider buttons because the recovery is here — the message tells them to use email and password,
   * so the alert belongs where that is done.
   */
  oauthError,
}: {
  next?: string;
  linkError?: boolean;
  oauthError?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(signIn, null);
  const t = useTranslations();

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {linkError && <Alert tone="error">{t('auth.errors.linkInvalid')}</Alert>}
      {oauthError && <Alert tone="error">{t('auth.errors.oauthFailed')}</Alert>}
      {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}

      <input type="hidden" name="next" value={next ?? ''} />

      <Field id="email" label={t('auth.fields.email')} errors={fieldErrors?.email} required>
        {(props) => <Input {...props} name="email" type="email" autoComplete="email" />}
      </Field>

      <Field
        id="password"
        label={t('auth.fields.password')}
        errors={fieldErrors?.password}
        required
      >
        {(props) => (
          <Input {...props} name="password" type="password" autoComplete="current-password" />
        )}
      </Field>

      <div className="flex justify-end">
        <Link
          href="/auth/forgot-password"
          className="rounded-sm text-sm text-forest-700 underline underline-offset-4"
        >
          {t('auth.signIn.forgot')}
        </Link>
      </div>

      <SubmitButton size="lg" block loadingLabel={t('common.loading')}>
        {t('auth.signIn.submit')}
      </SubmitButton>

      <p className="text-center text-sm text-ink-600">
        {t('auth.signIn.noAccount')}{' '}
        <Link
          href="/auth/sign-up"
          className="rounded-sm font-medium text-forest-700 underline underline-offset-4"
        >
          {t('auth.signIn.createAccount')}
        </Link>
      </p>
    </form>
  );
}
