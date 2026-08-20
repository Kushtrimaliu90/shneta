import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/schemas';
import { normalizeReferralCode } from '@/features/referrals/schemas';
import { REFERRAL_COOKIE_NAME } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * Exchanges the code from a Supabase email link (verification, password recovery, invite) **or from a
 * social sign-in** for a session, then forwards the user on.
 *
 * One route for both, because the exchange is identical — OAuth was already served by this handler
 * before any social provider was configured; see `/api/auth/oauth` for the half that starts a flow.
 *
 * Lives under `/api` on purpose: `/auth/*` is inside the localized tree, so a callback
 * there would be rewritten to `/sq/auth/callback` and the URL registered with Supabase
 * would have to encode a locale. This path is excluded from the intl middleware, so one
 * redirect URL works for both locales.
 *
 * Register it in the Supabase dashboard under Auth → URL Configuration:
 *   {SITE_URL}/api/auth/callback
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'), '/account');

  // Supabase reports link failures (expired, already used) on the query string.
  const errorCode = searchParams.get('error') ?? searchParams.get('error_code');
  if (errorCode) {
    logger.info('Auth callback returned an error', { errorCode });
    return NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.info('Code exchange failed', { reason: error.message });
    return NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);
  }

  /*
   * Referral attribution for social sign-ups.
   *
   * The email sign-up path puts the invite code in `raw_user_meta_data` and `handle_new_user` links it
   * inside the same transaction that creates the profile. **`signInWithOAuth` cannot carry user
   * metadata**, so a visitor who followed `/r/{CODE}` and then chose "Continue with Google" would have
   * been credited to nobody — silently, and unfixably once the grace window closed.
   *
   * So it is claimed here instead, through `claim_referral_code` — the same RPC the account page uses.
   * Deliberately not `link_referral`, which is revoked from `authenticated` and only reachable from the
   * trigger's security-definer context. This runs as the customer, under RLS, on a route where there is
   * now a real session to run as.
   *
   * Harmless on an email-link callback: the trigger has already linked that account, so the RPC answers
   * `already_linked` and the code below only clears a spent cookie.
   *
   * **Never blocks the redirect.** A failed claim is a support ticket an admin can fix from
   * `/admin/referrals`; a sign-in that dead-ends because a referral lookup threw is a lost customer.
   */
  await claimReferralFromCookie(supabase);

  return NextResponse.redirect(`${origin}${next}`);
}

type CallbackClient = Awaited<ReturnType<typeof createClient>>;

async function claimReferralFromCookie(supabase: CallbackClient): Promise<void> {
  try {
    const store = await cookies();
    const raw = store.get(REFERRAL_COOKIE_NAME)?.value;
    if (!raw) return;

    const code = normalizeReferralCode(raw);
    if (!code) {
      // A malformed cookie is not worth keeping around to fail again next time.
      store.delete(REFERRAL_COOKIE_NAME);
      return;
    }

    const { data, error } = await supabase.rpc('claim_referral_code', { p_code: code });
    const status = (data as { status?: string } | null)?.status ?? null;

    if (error) {
      logger.warn('Referral claim after auth callback failed', { cause: error.message });
      return;
    }

    /*
     * The cookie is spent on any definitive answer, including `invalid` — a code the database has
     * rejected will be rejected again, and leaving it set means re-asking on every future callback.
     * `already_linked` is the ordinary email-link case and is not worth a log line.
     */
    if (status && status !== 'already_linked') {
      logger.info('Referral claim after auth callback', { status });
    }
    store.delete(REFERRAL_COOKIE_NAME);
  } catch (cause) {
    logger.warn('Referral claim after auth callback threw', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
