import { NextResponse, type NextRequest } from 'next/server';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/server';
import { REFERRAL_COOKIE_MAX_AGE_SECONDS, REFERRAL_COOKIE_NAME } from '@/lib/constants';

/**
 * docs/17 §1 — the share link. `https://biocode.fit/r/BIO-K7F2M`.
 *
 * Remembers the code in a cookie and sends the visitor on to register. It deliberately does **not**
 * create the link: the code is a claim about who invited you, and it only becomes a referral when a
 * real account exists to attach it to.
 *
 * ── Why it lives under `[locale]` ──
 *
 * `routing.ts` turns off locale detection and the locale cookie on purpose, so locale is derived
 * from the path and nothing else. A handler outside the `[locale]` segment would therefore have no
 * way to know which language the visitor reads, and would have to guess or carry a query parameter.
 * Inside it, `/r/CODE` is Albanian and `/en/r/CODE` is English, for free and by the same rule as
 * every other page.
 *
 * ── Why the code is not validated here ──
 *
 * Answering "is this code real?" before the visitor has an account would make this an unauthenticated
 * oracle over the whole code space, which is the thing §6 rate-limits the authenticated endpoint to
 * prevent. So a bad code is stored, pre-fills the field, and is rejected once — by
 * `link_referral`, behind an account. The cost of a wrong code is one confused visitor; the cost of
 * validating here is a public code scanner.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; code: string }> },
): Promise<NextResponse> {
  const { locale: rawLocale, code } = await params;
  const locale = resolveLocale(rawLocale);

  /*
   * Signed-in visitors go to their account, where the grace-window card is. A visitor who already
   * has an account is not going to register again, and dropping them on a sign-up form reads as the
   * link being broken.
   */
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * A **relative** `Location`, which is the entire reason this is hand-rolled rather than
   * `NextResponse.redirect(new URL(path, origin))`.
   *
   * Both `request.nextUrl.origin` and `request.url` report the origin *Next* computed, not the host
   * the visitor asked for. A request to `http://127.0.0.1:3000/en/r/CODE` was answered with a redirect
   * to `http://localhost:3000/en/auth/sign-up` — so the cookie was stored against `127.0.0.1`, the
   * browser then asked `localhost` for the sign-up form, sent nothing, and the invite disappeared
   * between two lines of code that both looked correct.
   *
   * That is not a test-only curiosity: the same mismatch is `biocode.fit` against `www.biocode.fit`,
   * or any preview deployment — precisely the hosts a share link gets pasted into. A relative
   * `Location` (RFC 7231 §7.1.2) keeps the visitor on whatever host they arrived at, so the host that
   * sets the cookie is always the host that reads it, whatever Next thinks the origin is.
   */
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: localizePath(user ? '/account' : '/auth/sign-up', locale) },
  });

  /*
   * Capped at 32 characters. A code is nine, and the cookie is echoed back into a form field, so
   * there is no reason to carry a kilobyte of somebody's URL around for a month.
   */
  const candidate = decodeURIComponent(code).trim().slice(0, 32);
  if (candidate) {
    response.cookies.set(REFERRAL_COOKIE_NAME, candidate, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return response;
}
