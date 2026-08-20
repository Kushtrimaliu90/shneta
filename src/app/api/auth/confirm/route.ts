import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/schemas';
import { defaultNextFor, isEmailLinkType } from '@/features/auth/email-links';
import { claimReferralFromCookie } from '@/features/referrals/claim-from-cookie';
import { logger } from '@/lib/logger';

/**
 * Verifies an email link and signs the visitor in (docs/05 §15.3).
 *
 * `GET /api/auth/confirm?token_hash=…&type=magiclink&next=/account`
 *
 * This is the route every **email** link goes through: sign-in links, signup confirmation, password
 * recovery, email change, and the seller invitation. `/api/auth/callback` still exists and still uses
 * PKCE, but only for OAuth.
 *
 * ── Why two routes rather than one ──
 *
 * `exchangeCodeForSession` needs the PKCE code verifier, which lives in a cookie in the browser that
 * started the flow. That is correct for Google — the flow leaves and returns to the same browser
 * within seconds — and wrong for email, where the whole point is that the message can be opened
 * anywhere. `verifyOtp` with a token hash carries no device-bound secret, so a link requested on a
 * desktop opens on a phone. See `features/auth/email-links.ts` for the failure this replaced.
 *
 * The consequence worth stating: the visitor ends up signed in **on the device that opened the link**.
 * That is the honest behaviour of an emailed credential, and it is what somebody reading mail on their
 * phone expects to happen.
 *
 * Lives under `/api` so it is excluded from the intl middleware and one URL serves both locales.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  const invalid = () => NextResponse.redirect(`${origin}/auth/sign-in?error=link_invalid`);

  if (!isEmailLinkType(type)) {
    logger.info('Email confirm rejected: unknown type', { type });
    return invalid();
  }

  if (!tokenHash) {
    /*
     * Reached by a template that still points at `{{ .ConfirmationURL }}` — the old PKCE link — or by
     * somebody opening the bare path. Logged distinctly, because "no token hash" and "bad token hash"
     * mean different things to whoever is debugging a template.
     */
    logger.info('Email confirm rejected: no token hash', { type });
    return invalid();
  }

  const next = safeNextPath(searchParams.get('next'), defaultNextFor(type));

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    // Genuinely expired, already used, or tampered with. One message for all three (docs/05 §15).
    logger.info('Email confirm failed', { type, reason: error.code ?? error.message });
    return invalid();
  }

  /*
   * Referral attribution, shared with the OAuth callback. Harmless here in the ordinary case — the
   * sign-up trigger has already linked the code from user metadata, so the RPC answers
   * `already_linked` and only a spent cookie is cleared.
   */
  await claimReferralFromCookie(supabase);

  return NextResponse.redirect(`${origin}${next}`);
}
