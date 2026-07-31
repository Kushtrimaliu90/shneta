'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { localizePath } from '@/lib/i18n';
import { clientEnv } from '@/lib/env.client';
import { limitByIp } from '@/lib/rate-limit';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { mergeGuestCart } from '@/features/cart/actions';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
  updateProfileSchema,
} from '@/features/auth/schemas';

/**
 * docs/02 §7 — every mutation: parse → auth/role check → rate limit → act → revalidate →
 * return `ActionResult`. Unexpected errors are logged and returned as a generic key; the
 * client never sees an internal message.
 *
 * `error` carries a **message key**, not prose, so the UI translates it (CLAUDE.md §3).
 *
 * On failure these return rather than throw, so `useActionState` can render field errors
 * and the form keeps working without JavaScript.
 */
/**
 * Both unions are **i18n message keys**, not prose. Narrowing them here is what lets a
 * component write `t(state.error)` and have the compiler check the key against
 * `messages/sq.json` — a typo fails the build instead of rendering blank at a customer.
 */
export type AuthErrorKey =
  | 'auth.errors.invalidCredentials'
  | 'auth.errors.checkFields'
  | 'auth.errors.tooManyAttempts'
  | 'auth.errors.resetLinkInvalid'
  | 'auth.errors.notSignedIn'
  | 'auth.errors.generic';

export type AuthSuccessKey =
  | 'auth.signUp.checkEmail'
  | 'auth.forgotPassword.sent'
  | 'account.settings.saved'
  | 'account.settings.passwordChanged';

type AuthData = { message?: AuthSuccessKey };

export type FormState = ActionResult<AuthData, AuthErrorKey> | null;

/** Shape `useActionState` expects. */
type FormAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

/**
 * Thin wrappers that pin both generic parameters of `ActionResult`.
 *
 * Without them every call site needs `fail<AuthErrorKey, AuthData>(…)`: inference alone
 * widens `error` to `string` and leaves `data` as `void`, neither of which matches
 * `FormState`. Pinning once here keeps the actions readable and keeps the compiler
 * checking that every key is a real message key.
 */
const authFail = (error: AuthErrorKey, fieldErrors?: Record<string, string[]>): FormState =>
  fail<AuthErrorKey, AuthData>(error, fieldErrors);

const authFieldErrors = (
  error: AuthErrorKey,
  flattened: { fieldErrors: Record<string, string[] | undefined> },
): FormState => fromFieldErrors<AuthErrorKey, AuthData>(error, flattened);

const authOk = (message?: AuthSuccessKey): FormState => ok<AuthData>({ message });

async function clientHeaders() {
  return headers();
}

/**
 * Redirects without losing the locale.
 *
 * A bare `redirect('/account')` always lands on the unprefixed — Albanian — route, so
 * signing in from `/en/auth/sign-in` silently switched the user's language mid-journey.
 * `localizePath` is idempotent, so a `next` value that already carries `/en` is handled too.
 *
 * Callers `return` this rather than `await` it: TypeScript does not treat an awaited
 * never-returning call as terminating control flow, so `await` leaves the action's inferred
 * return type as `FormState | undefined`.
 */
async function localizedRedirect(path: string): Promise<never> {
  const locale = await getLocale();
  redirect(localizePath(path, locale));
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export const signIn: FormAction = async (_prevState, formData) => {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.invalidCredentials', parsed.error.flatten());
  }

  // docs/02 §9 — 5 per 15 minutes.
  if (!(await limitByIp('signIn', await clientHeaders()))) {
    return authFail('auth.errors.tooManyAttempts');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    /*
     * docs/05 §15 — one message for every failure mode. Distinguishing "no such user" from
     * "wrong password" turns the form into an account-existence oracle, and "email not
     * confirmed" leaks the same fact.
     */
    logger.info('Sign-in rejected', { reason: error.code ?? error.message });
    return authFail('auth.errors.invalidCredentials');
  }

  // docs/07 §3.3 — carry a guest cart across the sign-in boundary. Idempotent and
  // failure-tolerant: it never blocks the sign-in it is attached to.
  await mergeGuestCart();

  revalidatePath('/', 'layout');
  // Outside any try/catch: redirect() signals by throwing, and catching it would swallow
  // the navigation and render a blank success state instead.
  return localizedRedirect(safeNextPath(parsed.data.next));
};

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export const signUp: FormAction = async (_prevState, formData) => {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  if (!(await limitByIp('signUp', await clientHeaders()))) {
    return authFail('auth.errors.tooManyAttempts');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/auth/callback?next=${encodeURIComponent(
        safeNextPath(parsed.data.next),
      )}`,
      data: {
        full_name: parsed.data.fullName,
        marketing_opt_in: parsed.data.marketingOptIn,
      },
    },
  });

  if (error) {
    logger.warn('Sign-up rejected', { reason: error.code ?? error.message });
    // Supabase returns a specific error for an existing address; surfacing it would confirm
    // the account exists. Fall through to the same "check your email" screen either way.
    if (error.code === 'user_already_exists' || error.status === 422) {
      return authOk('auth.signUp.checkEmail');
    }
    return authFail('auth.errors.generic');
  }

  /*
   * `marketing_opt_in` rides in `raw_user_meta_data`, which the `handle_new_user` trigger
   * does not copy (docs/03 §3 only takes full_name). Written here, after the row exists.
   */
  if (parsed.data.marketingOptIn && data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ marketing_opt_in: true })
      .eq('id', data.user.id);
    if (profileError) {
      logger.warn('Could not persist marketing opt-in', { cause: profileError.message });
    }
  }

  return authOk('auth.signUp.checkEmail');
};

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export const requestPasswordReset: FormAction = async (_prevState, formData) => {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  if (!(await limitByIp('forgotPassword', await clientHeaders()))) {
    return authFail('auth.errors.tooManyAttempts');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/auth/callback?next=/auth/reset-password`,
  });

  if (error) logger.warn('Password reset request failed', { reason: error.message });

  // Always the same answer, error or not — "if the email exists, we sent a link"
  // (docs/05 §15).
  return authOk('auth.forgotPassword.sent');
};

export const resetPassword: FormAction = async (_prevState, formData) => {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    // The recovery link has expired or was already consumed.
    return authFail('auth.errors.resetLinkInvalid');
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    logger.warn('Password reset failed', { reason: error.message });
    return authFail('auth.errors.generic');
  }

  revalidatePath('/', 'layout');
  return localizedRedirect('/account?password=updated');
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  return localizedRedirect('/');
}

// ---------------------------------------------------------------------------
// Account settings (docs/05 §14)
// ---------------------------------------------------------------------------

export const updateProfile: FormAction = async (_prevState, formData) => {
  const parsed = updateProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return authFail('auth.errors.notSignedIn');

    // RLS (`p_self_update`) restricts this to the caller's own row; the `eq` is belt and
    // braces, and makes the intent obvious at the call site.
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: parsed.data.fullName,
        phone: parsed.data.phone || null,
        preferred_locale: parsed.data.preferredLocale,
        marketing_opt_in: parsed.data.marketingOptIn,
      })
      .eq('id', userData.user.id);

    if (error) {
      logger.error('Profile update failed', { cause: error.message });
      return authFail('auth.errors.generic');
    }
  } catch (error) {
    logger.error('Profile update threw', describeError(error));
    return authFail('auth.errors.generic');
  }

  revalidatePath('/account', 'layout');
  return authOk('account.settings.saved');
};

export const changePassword: FormAction = async (_prevState, formData) => {
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return authFail('auth.errors.notSignedIn');

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      logger.warn('Password change failed', { reason: error.message });
      return authFail('auth.errors.generic');
    }
  } catch (error) {
    logger.error('Password change threw', describeError(error));
    return authFail('auth.errors.generic');
  }

  return authOk('account.settings.passwordChanged');
};
