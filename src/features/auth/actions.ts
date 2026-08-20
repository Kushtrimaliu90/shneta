'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { localizePath } from '@/lib/i18n';
import { clientEnv } from '@/lib/env.client';
import { REFERRAL_COOKIE_NAME } from '@/lib/constants';
import { normalizeReferralCode } from '@/features/referrals/schemas';
import { limitByIp } from '@/lib/rate-limit';
import { keepSubmitted } from '@/lib/keep-submitted';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { mergeGuestCart } from '@/features/cart/actions';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  safeNextPath,
  signInSchema,
  magicLinkSchema,
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
  | 'auth.magicLink.sent'
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

export const signIn: FormAction = keepSubmitted(async (_prevState, formData) => {
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
});

// ---------------------------------------------------------------------------
// Magic link (docs/05 §15.2)
// ---------------------------------------------------------------------------

/**
 * Emails a one-time sign-in link.
 *
 * ── `shouldCreateUser: false`, and this is the important line in the file ──
 *
 * Left at its default, `signInWithOtp` **creates an account** for any address it has not seen. That
 * would make this form a second, silent registration path — one that collects no name and, more
 * seriously, never asks anyone to accept the terms. `signUpSchema` requires `terms` explicitly because
 * docs/05 §15 says acceptance must be, and a shop selling supplements cannot have a back door that
 * skips it. So this signs people in and refuses to invent them; registering stays on `/auth/sign-up`,
 * where the name is collected and the box is ticked.
 *
 * ── One answer, always ──
 *
 * An unknown address makes Supabase return an error here. Surfacing it would turn the form into an
 * account-existence oracle — type an address, learn whether that person shops here — which is the same
 * leak `signIn` and `requestPasswordReset` are careful to avoid. So the reply is identical either way,
 * and the log line is the only place the difference is recorded.
 *
 * ── Every send is an email, which is why this is behind a flag ──
 *
 * Password sign-in costs nothing to attempt. This one sends mail on every single use, and the auth
 * emails still go through Supabase's built-in sender (docs/10 §4), which is rate-limited to a handful
 * an hour and is not intended for production. Turned on before Resend SMTP is configured, sign-in
 * would simply stop working for everyone once a few people tried it — see `env.client.ts`.
 */
export const sendMagicLink: FormAction = keepSubmitted(async (_prevState, formData) => {
  const parsed = magicLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  if (!(await limitByIp('magicLink', await clientHeaders()))) {
    return authFail('auth.errors.tooManyAttempts');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/auth/callback?next=${encodeURIComponent(
        safeNextPath(parsed.data.next),
      )}`,
    },
  });

  if (error) {
    /*
     * Expected for any address without an account, which is why this is `info` and not `warn`: it is
     * the ordinary case, not a fault. A genuine fault — a misconfigured mailer, a spent quota — lands
     * here too, so the reason is kept.
     */
    logger.info('Magic link not sent', { reason: error.code ?? error.message });
  }

  return authOk('auth.magicLink.sent');
});

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export const signUp: FormAction = keepSubmitted(async (_prevState, formData) => {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return authFieldErrors('auth.errors.checkFields', parsed.error.flatten());
  }

  if (!(await limitByIp('signUp', await clientHeaders()))) {
    return authFail('auth.errors.tooManyAttempts');
  }

  /*
   * docs/17 §1 — the invite code travels in user metadata, and `handle_new_user` links it.
   *
   * Not through an RPC after sign-up: with email confirmation on, `auth.signUp` returns a user and
   * no session, so an `auth.uid()`-keyed call would have nobody to act as. The trigger runs at the
   * moment the profile appears and works either way.
   *
   * The source is derived by comparing what was submitted with what the cookie holds — the truthful
   * way to tell "followed the share link" from "typed a code a friend read out", since the field is
   * pre-filled from that cookie and editable. It is a label for the admin queue, so getting it
   * wrong costs nothing; asking the browser to declare it would let the browser lie for free.
   */
  const cookieStore = await cookies();
  const cookieCode = cookieStore.get(REFERRAL_COOKIE_NAME)?.value;
  const referralCode = parsed.data.referralCode;
  const referralSource =
    referralCode && cookieCode && normalizeReferralCode(cookieCode) === referralCode
      ? 'link'
      : 'signup';

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
        ...(referralCode ? { referral_code: referralCode, referral_source: referralSource } : {}),
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

  /*
   * The cookie has been spent. Clearing it stops a month-old invite reappearing in the field for the
   * next person to register on a shared computer — a phone in a family, or a laptop in a shop.
   *
   * Cleared whether or not a code was submitted: reaching this line means an account was created, and
   * an invite that the new customer chose not to use is not one to keep offering.
   */
  cookieStore.delete(REFERRAL_COOKIE_NAME);

  return authOk('auth.signUp.checkEmail');
});

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export const requestPasswordReset: FormAction = keepSubmitted(async (_prevState, formData) => {
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
});

export const resetPassword: FormAction = keepSubmitted(async (_prevState, formData) => {
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
  /*
   * `/account?password=updated` unless the link said otherwise — an invited seller is sent to
   * `/merchant`, where the thing they were invited to actually is.
   */
  return localizedRedirect(safeNextPath(parsed.data.next, '/account?password=updated'));
});

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

export const updateProfile: FormAction = keepSubmitted(async (_prevState, formData) => {
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
});

export const changePassword: FormAction = keepSubmitted(async (_prevState, formData) => {
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
});
